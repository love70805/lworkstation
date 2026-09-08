import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const desktop = path.dirname(fileURLToPath(import.meta.url));
const executable = process.env.SHOPEERS_DESKTOP_SINGLE_INSTANCE_ELECTRON || path.join(desktop, "node_modules/electron/dist/electron.exe");
assert.ok(fs.existsSync(executable), "set SHOPEERS_DESKTOP_SINGLE_INSTANCE_ELECTRON to an Electron 44 executable");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lworkstation-single-instance-"));
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = http.createServer((_request, response) => response.end("<!doctype html><title>Synthetic workspace</title><p>single-instance fixture</p>"));
await new Promise(resolve => page.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${page.address().port}/`;
const report = id => { try { return JSON.parse(fs.readFileSync(path.join(root, `${id}.json`), "utf8")); } catch (_) { return {}; } };
async function waitFor(predicate, label) {
  const until = Date.now() + 25000;
  while (Date.now() < until) { if (await predicate()) return; await delay(100); }
  throw new Error(`Timed out: ${label}; reports ${JSON.stringify(children.map(c => report(c.id)))}`);
}
async function launch(id, profile) {
  const portProbe = net.createServer();
  await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const userData = path.join(root, profile);
  fs.mkdirSync(userData, { recursive: true });
  const env = { ...process.env, SINGLE_INSTANCE_SMOKE_ROOT: root, SINGLE_INSTANCE_SMOKE_ID: id,
    SHOPEERS_DESKTOP_SMOKE_USER_DATA: userData, SHOPEERS_DESKTOP_SMOKE_CACHE: path.join(userData, "cache"),
    SHOPEERS_DESKTOP_DEV_URL: url, SHOPEERS_ERP_INBOX_PORT: String(port),
    SHOPEERS_ERP_INBOX_FILE: path.join(userData, "synthetic-inbox.json") };
  for (const key of ["ELECTRON_RUN_AS_NODE", "SHOPEERS_DESKTOP_SMOKE_REPORT", "SHOPEERS_DESKTOP_UPDATE_SMOKE_REPORT", "SHOPEERS_DESKTOP_UPDATE_SMOKE", "SHOPEERS_DESKTOP_UPDATE_URL"]) delete env[key];
  const child = spawn(executable, [path.join(desktop, "single-instance-smoke-app.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.id = id;
  const logPath = path.join(root, `${id}.log`);
  fs.writeFileSync(logPath, "");
  child.stdout.on("data", data => fs.appendFileSync(logPath, data));
  child.stderr.on("data", data => fs.appendFileSync(logPath, data));
  child.on("error", error => fs.appendFileSync(logPath, String(error)));
  children.push(child);
  return child;
}
let sequence = 0;
async function command(id, action) {
  const current = ++sequence;
  fs.writeFileSync(path.join(root, `${id}.command.json`), JSON.stringify({ sequence: current, action }));
  await waitFor(() => report(id).sequence === current, action);
}
try {
  const first = await launch("first", "profile-a");
  await waitFor(() => report("first").ready, "first ready");
  await command("first", "probe");
  assert.equal(report("first").data, "retained");
  await command("first", "minimize");
  await waitFor(() => report("first").minimized, "first minimized");
  const second = await launch("second", "profile-a");
  await waitFor(() => second.exitCode !== null, "second exits");
  assert.equal(second.exitCode, 0);
  assert.equal(report("second").initialized, undefined, "loser never evaluates main services");
  await waitFor(() => report("first").visible && !report("first").minimized && report("first").focused, "first restored and focused");
  assert.equal(first.exitCode, null);
  await command("first", "probe");
  assert.equal(report("first").data, "retained");
  const separate = await launch("separate", "profile-b");
  await waitFor(() => report("separate").ready, "different profile ready");
  assert.equal(first.exitCode, null);
  assert.equal(separate.exitCode, null);
  await command("separate", "probe");
  assert.equal(report("separate").data, "retained");
  assert.equal(first.kill("SIGKILL"), true); // Only our child PID, never an existing user process.
  await waitFor(() => first.signalCode !== null || first.exitCode !== null, "abnormal exit");
  const restarted = await launch("restarted", "profile-a");
  await waitFor(() => report("restarted").ready, "lock released after abnormal exit");
  await command("restarted", "probe");
  assert.equal(report("restarted").data, "retained");
  await command("restarted", "quit");
  await command("separate", "quit");
  await waitFor(() => restarted.exitCode !== null && separate.exitCode !== null, "clean exit");
  fs.writeFileSync(path.join(root, "result.json"), JSON.stringify({ ok: true, electron: executable, root,
    checks: ["same profile excluded before initialization", "restore/focus", "IDB usable", "different profiles concurrent", "abnormal exit lock released"] }, null, 2));
  console.log(`Single-instance real candidate process smoke passed. Evidence: ${root}`);
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  page.close();
}
