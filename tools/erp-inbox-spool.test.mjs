import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createValidDirectV2Envelope } from "./fixtures/erp-direct-v2-contract.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "erp-spool-atomic-"));
const spool = path.join(directory, "inbox.json");
const control = path.join(directory, "control.json");
const trace = path.join(directory, "trace.jsonl");
const release = path.join(directory, "release");
const loader = path.join(directory, "faults.mjs");
const capability = "atomic-spool-test-capability-0123456789abcdef";
const serverPath = process.argv[2] || fileURLToPath(new URL("./erp-inbox-server.mjs", import.meta.url));
const port = 21000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
let child;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("spool test condition timed out");
    await pause(10);
  }
}
const events = async () => (await fs.readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const configure = async (value) => fs.writeFile(control, JSON.stringify(value));
const request = (route, payload) => fetch(base + route, {
  headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" },
  ...(payload ? { method: "POST", body: JSON.stringify(payload) } : {}),
  signal: AbortSignal.timeout(5000),
});
const register = (id) => ({ request: { id, workspaceId: "qa", ledgerId: "ledger", platformSkcs: ["SKC"] }, expectedSkus: [{ platformSku: id, platformSkc: "SKC" }] });

try {
  // Fault injection lives exclusively in the child test preload. No production switches.
  await fs.writeFile(loader, `
import fs from 'node:fs/promises';
const spool=${JSON.stringify(spool)}, control=${JSON.stringify(control)}, trace=${JSON.stringify(trace)}, release=${JSON.stringify(release)};
const read=fs.readFile.bind(fs), rename=fs.rename.bind(fs), append=fs.appendFile.bind(fs);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let attempt=0, previousMode='', readers=0;
fs.readFile=async function(file,...args) {
  if(String(file)!==spool) return read(file,...args);
  const config=JSON.parse(await read(control,'utf8'));
  readers++; await append(trace,JSON.stringify({kind:'read',readers})+'\\n');
  try {
    if(config.blockRead) {
      while(true) { try { await read(release); break; } catch(error) { if(error.code!=='ENOENT') throw error; await pause(10); } }
    }
    if(config.readDelay) await pause(config.readDelay);
    return await read(file,...args);
  } finally { readers--; }
};
fs.rename=async function(from,to) {
  if(String(to)!==spool) return rename(from,to);
  const config=JSON.parse(await read(control,'utf8'));
  if(config.mode!==previousMode) { attempt=0; previousMode=config.mode; }
  attempt++; await append(trace,JSON.stringify({kind:'rename',from,attempt,mode:config.mode})+'\\n');
  if(config.failures && attempt<=config.failures) throw Object.assign(new Error('injected Windows rename lock'),{code:config.code});
  return rename(from,to);
};
`);
  await fs.writeFile(trace, "");
  await configure({ mode: "normal", readDelay: 15 });
  await fs.writeFile(spool, JSON.stringify([{ kind: "request", requestId: "OLD", workspaceId: "qa", status: "registered", registeredAt: "2020-01-01T00:00:00Z" }]));
  // An unrelated legacy .tmp is never ours to remove.
  await fs.writeFile(`${spool}.tmp`, "foreign temporary data");
  child = spawn(process.execPath, ["--import", pathToFileURL(loader).href, serverPath], {
    env: { ...process.env, SHOPEERS_ERP_INBOX_PORT: String(port), SHOPEERS_ERP_INBOX_FILE: spool, SHOPEERS_ERP_INBOX_CAPABILITY: capability },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await until(() => { if (child.exitCode != null) throw new Error(output); return output.includes("listening"); });

  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => Promise.all([
    request("/erp/v1/status"), request("/erp/v1/requests", register(`Q${index}`)),
  ])));
  assert.ok(concurrent.flat().every((response) => response.ok));
  let records = JSON.parse(await fs.readFile(spool, "utf8"));
  assert.equal(records.find((row) => row.requestId === "OLD").status, "expired");
  assert.equal(records.filter((row) => /^Q\d+$/.test(row.requestId)).length, 12, "GET expiry must not overwrite POST registrations");
  assert.ok((await events()).filter((event) => event.kind === "read").every((event) => event.readers === 1));

  // An incomplete POST must not acquire the spool queue.
  const slow = http.request(base + "/erp/v1/requests", { method: "POST", headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" } });
  const slowResponse = new Promise((resolve, reject) => { slow.on("error", reject); slow.on("response", (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }); });
  slow.write('{"request":');
  try { assert.equal((await request("/erp/v1/status")).status, 200); }
  finally { slow.end(JSON.stringify(register("SLOW").request) + ',"expectedSkus":[{"platformSku":"SLOW","platformSkc":"SKC"}]}'); }
  assert.equal(await slowResponse, 202);

  // A blocked disk read must retain transaction ownership until it completes.
  await configure({ mode: "blocked-read", blockRead: true });
  const beforeRead = (await events()).length;
  const blocked = request("/erp/v1/status");
  await until(async () => (await events()).length > beforeRead);
  const waiting = request("/erp/v1/requests", register("AFTER-READ"));
  await pause(50);
  assert.equal((await events()).slice(beforeRead).filter((event) => event.kind === "read").length, 1);
  await fs.writeFile(release, "released");
  assert.equal((await blocked).status, 200);
  assert.equal((await waiting).status, 202);

  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    await configure({ mode: code, failures: 2, code });
    assert.equal((await request("/erp/v1/requests", register(code))).status, 202);
    assert.equal((await events()).filter((event) => event.mode === code).length, 3);
  }

  const delivery = createValidDirectV2Envelope();
  const batch = delivery.batch;
  assert.equal((await request("/erp/v1/requests", { request: { id: batch.requestId, workspaceId: batch.workspaceId, ledgerId: batch.ledgerId, platformSkcs: batch.query.platformSkcs }, expectedSkus: batch.rows.filter((row) => row.ledgerScopeRole !== "auxiliary").map((row) => ({ platformSku: row.platformSku, platformSkc: row.platformSkc })) })).status, 202);
  const original = await fs.readFile(spool);
  await configure({ mode: "nonretryable", failures: 100, code: "EIO" });
  const nonretryable = await request("/erp/v1/cost-batches", delivery);
  assert.equal(nonretryable.status, 400);
  assert.equal((await nonretryable.json()).error, "EIO");
  assert.equal((await events()).filter((event) => event.mode === "nonretryable").length, 1);
  assert.deepEqual(await fs.readFile(spool), original);
  await configure({ mode: "permanent", failures: 100, code: "EPERM" });
  const started = Date.now();
  const failed = await request("/erp/v1/cost-batches", delivery);
  assert.equal(failed.status, 400);
  assert.equal((await failed.json()).error, "EPERM");
  assert.ok(Date.now() - started < 3000, "permanent lock must fail within the bounded retry budget");
  assert.equal((await events()).filter((event) => event.mode === "permanent").length, 6);
  assert.deepEqual(await fs.readFile(spool), original, "failed rename leaves committed bytes unchanged");
  await configure({ mode: "recovered" });
  const retried = await request("/erp/v1/cost-batches", delivery);
  assert.equal(retried.status, 202);
  assert.equal((await retried.json()).idempotent, false);
  assert.equal((await (await request("/erp/v1/cost-batches", delivery)).json()).idempotent, true);
  records = JSON.parse(await fs.readFile(spool, "utf8"));
  assert.equal(records.filter((row) => row.kind === "batch" && row.batchId === batch.batchId).length, 1);
  assert.equal(records.find((row) => row.requestId === batch.requestId && row.kind === "request").status, "registered");
  assert.ok(records.find((row) => row.requestId === batch.requestId && row.kind === "request").lastCompletedAt);
  assert.equal(await fs.readFile(`${spool}.tmp`, "utf8"), "foreign temporary data");
  assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")), ["inbox.json.tmp"]);
  const names = (await events()).filter((event) => event.kind === "rename" && event.attempt === 1).map((event) => event.from);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((name) => path.dirname(name) === directory && name !== `${spool}.tmp`));
  console.log("ERP spool concurrency, Windows lock recovery, atomic failure and HTTP queue tests passed");
} finally {
  if (child && child.exitCode == null) { const exit = once(child, "exit"); child.kill("SIGTERM"); await exit; }
  // mkdtemp creates this test-owned directory; no user runtime paths are used.
  await fs.rm(directory, { recursive: true, force: true });
}
