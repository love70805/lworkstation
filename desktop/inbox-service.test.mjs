import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createInboxServiceController, flowFromStatus, requestJson } = require("./inbox-service.cjs");
const serverPath = path.resolve(root, "../tools/erp-inbox-server.mjs");
const port = 19790 + Math.floor(Math.random() * 800);
const capability = crypto.randomBytes(32).toString("base64url");
const spoolPath = path.join(os.tmpdir(), `shopeers-desktop-inbox-controller-${process.pid}.json`);

await fs.rm(spoolPath, { force: true });
const managed = createInboxServiceController({
  executable: process.execPath,
  scriptPath: serverPath,
  spoolPath,
  port,
  capability,
  pollIntervalMs: 100,
  restartDelayMs: 100,
});

try {
  assert.deepEqual(await managed.start(), { ok: true, reused: false });
  assert.equal(managed.getState().status, "online");
  assert.equal(managed.getState().ownership, "managed");
  assert.ok(managed.getOwnedPid());

  const firstPid = managed.getOwnedPid();
  process.kill(firstPid);
  const recoveryDeadline = Date.now() + 5000;
  while ((!managed.getOwnedPid() || managed.getOwnedPid() === firstPid || managed.getState().status !== "online") && Date.now() < recoveryDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.notEqual(managed.getOwnedPid(), firstPid);
  assert.equal(managed.getState().status, "online");

  assert.equal(flowFromStatus({
    latestBatch: { status: "pending", requestId: "REQ", batchId: "BATCH", evidenceStatus: "complete", sourceFormatVersion: 2 },
  }).status, "batch_received");
  assert.deepEqual(flowFromStatus({}), {
    status: "idle",
    tone: "success",
    label: "ERP 通道正常",
    message: "收件服务已就绪，等待 ERP 请求。",
  });
  assert.deepEqual(flowFromStatus({
    latestBatch: { status: "acknowledged", requestId: "REQ", batchId: "BATCH", evidenceStatus: "legacy_partial", sourceFormatVersion: 1 },
  }), {
    status: "workspace_received",
    tone: "warning",
    label: "旧版预览，待成本核对",
    message: "该批次仅具备 legacy_partial 预览证据，不能由桌面标记为正式成本。",
    requestId: "REQ",
    batchId: "BATCH",
    sourceFormatVersion: 1,
    evidenceStatus: "legacy_partial",
  });
} finally {
  await managed.stop({ wait: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await requestJson({ port, capability })).reachable, false);
  await fs.rm(spoolPath, { force: true });
}

const conflictPort = port + 1000;
let conflictAuthorization = null;
const conflictServer = http.createServer((request, response) => {
  conflictAuthorization = request.headers.authorization || null;
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("not-shopeers");
});
await new Promise((resolve) => conflictServer.listen(conflictPort, "127.0.0.1", resolve));
try {
  const conflict = createInboxServiceController({
    executable: process.execPath,
    scriptPath: serverPath,
    spoolPath,
    port: conflictPort,
    capability,
  });
  assert.deepEqual(await conflict.start(), { ok: false, conflict: true });
  assert.equal(conflict.getState().status, "conflict");
  assert.equal(conflict.getOwnedPid(), null);
  assert.equal(conflictAuthorization, null);
  conflict.stop();
} finally {
  await new Promise((resolve) => conflictServer.close(resolve));
}

const spoofPort = conflictPort + 1;
let spoofAuthorization = null;
const spoofServer = http.createServer((request, response) => {
  spoofAuthorization = request.headers.authorization || null;
  response.writeHead(401, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "UNAUTHORIZED", message: "本机收件服务鉴权失败。" }));
});
await new Promise((resolve) => spoofServer.listen(spoofPort, "127.0.0.1", resolve));
try {
  const spoof = createInboxServiceController({
    executable: process.execPath,
    scriptPath: serverPath,
    spoolPath,
    port: spoofPort,
    capability,
  });
  assert.deepEqual(await spoof.start(), { ok: false, conflict: true });
  assert.equal(spoof.getState().status, "conflict");
  assert.equal(spoof.getOwnedPid(), null);
  assert.equal(spoofAuthorization, null);
  spoof.stop();
} finally {
  await new Promise((resolve) => spoofServer.close(resolve));
}

console.log("desktop inbox service lifecycle tests passed");
