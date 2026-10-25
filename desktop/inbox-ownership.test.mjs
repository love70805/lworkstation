import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createInboxServiceController } = require('./inbox-service.cjs');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shopeers-inbox-ownership-'));
const serverPath = fileURLToPath(new URL('../tools/erp-inbox-server.mjs', import.meta.url));
const source = await fs.readFile(new URL('./main.cjs', import.meta.url), 'utf8');
const begin = source.indexOf('async function requestJson(pathname, options = {}) {');
const end = source.indexOf('\nasync function runErpV2SmokeFixture()', begin);
assert.ok(begin > 0 && end > begin);
// Exercise the actual workspace transport, not a duplicate of its ownership check.
const workspaceTransport = controller => new Function('inboxService', `${source.slice(begin, end)}; return requestJson;`)(controller);
const capability = 'SYNTHETIC-OWNERSHIP-CAPABILITY-20261025';
const unavailable = error => error.status === 503 && error.code === 'INBOX_SERVICE_UNAVAILABLE';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 6000;
  while (!await check() && Date.now() < deadline) await pause(10);
  assert.ok(await check(), message);
}
async function listener(port = 0) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization,
      resetCapability: request.headers['x-shopeers-reset-capability'] });
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ application: 'shopeers-erp-inbox', apiVersion: 2, records: [] }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, requests, port: server.address().port, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
async function unusedPort() { const reserve = await listener(); const port = reserve.port; await reserve.close(); return port; }
function controller(port, options = {}) {
  return createInboxServiceController({ executable: process.execPath, scriptPath: serverPath,
    spoolPath: path.join(directory, 'inbox.json'), port, capability, pollIntervalMs: 30,
    restartDelayMs: 250, ...options });
}

try {
  const occupied = await listener();
  const blocked = controller(occupied.port, { pollIntervalMs: 60_000 });
  const send = workspaceTransport(blocked);
  try {
    await assert.rejects(send('/erp/v1/status'), unavailable);
    assert.equal(occupied.requests.length, 0, 'stopped transport sends nothing');
    assert.deepEqual(await blocked.start(), { ok: false, conflict: true });
    assert.equal(blocked.getOwnedPid(), null);
    const before = occupied.requests.length;
    await assert.rejects(send('/erp/v1/cost-batches', { query: { workspaceId: 'SYNTHETIC-WORKSPACE' } }), unavailable);
    await assert.rejects(send('/erp/v1/requests', { method: 'POST', body: { request: { id: 'SYNTHETIC-PRIVATE-REQUEST' } } }), unavailable);
    await assert.rejects(blocked.maintenanceRequest({ action: 'begin' }), unavailable);
    await assert.rejects(blocked.clearBusinessData({ maintenanceId: 'SYNTHETIC' }), unavailable);
    assert.equal(occupied.requests.length, before, 'conflict blocks business bodies and both capabilities before any HTTP request');
    await blocked.refresh();
    assert.equal(blocked.getState().status, 'conflict', 'a plausible status response does not grant ownership');
    assert.ok(occupied.requests.every(request => !request.authorization && !request.resetCapability));
    await blocked.stop();
    await assert.rejects(send('/erp/v1/status'), unavailable);
  } finally { await blocked.stop({ wait: true }); await occupied.close(); }

  // The port is free at the initial probe, but an unrelated listener wins it
  // before the genuinely spawned, slow-starting child begins listening.
  const sleepingChild = path.join(directory, 'slow-start.cjs');
  await fs.writeFile(sleepingChild, 'setTimeout(() => {}, 60000);');
  const racePort = await unusedPort(), raceRequests = [];
  const raceServer = http.createServer((request, response) => {
    raceRequests.push({ path: request.url, authorization: request.headers.authorization,
      resetCapability: request.headers['x-shopeers-reset-capability'] });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ application: 'shopeers-erp-inbox', apiVersion: 2 }));
  });
  let raceListening = false;
  const racing = controller(racePort, { scriptPath: sleepingChild, pollIntervalMs: 60_000,
    onState: state => {
      if (state.status === 'starting' && !raceListening) {
        raceListening = true; raceServer.listen(racePort, '127.0.0.1');
      }
    } });
  try {
    assert.deepEqual(await racing.start(), { ok: false, conflict: true });
    assert.ok(racing.getOwnedPid(), 'a real live child is not sufficient proof of the listener');
    await assert.rejects(workspaceTransport(racing)('/erp/v1/status'), unavailable);
    assert.ok(raceRequests.some(request => request.path.startsWith('/erp/v1/identity?challenge=')));
    assert.ok(raceRequests.every(request => !request.authorization && !request.resetCapability));
  } finally {
    await racing.stop({ wait: true }); raceServer.closeAllConnections();
    if (raceListening) await new Promise(resolve => raceServer.close(resolve));
  }

  const port = await unusedPort();
  const managed = controller(port);
  const sendManaged = workspaceTransport(managed);
  let replacement;
  try {
    const starting = managed.start();
    await until(() => managed.getState().status === 'starting', 'controller enters starting state');
    await assert.rejects(sendManaged('/erp/v1/requests', { method: 'POST', body: { request: { id: 'TOO-EARLY' } } }), unavailable);
    assert.deepEqual(await starting, { ok: true, reused: false });
    assert.equal((await sendManaged('/erp/v1/status')).application, 'shopeers-erp-inbox');
    const registered = await sendManaged('/erp/v1/requests', { method: 'POST', body: {
      request: { id: 'SYNTHETIC-OWNED', workspaceId: 'fixture', ledgerId: 'fixture-ledger',
        ledgerPeriod: '2026-10', platformSkcs: ['SYNTHETIC-SKC'] },
      expectedSkus: [{ platformSku: 'SYNTHETIC-SKU', platformSkc: 'SYNTHETIC-SKC' }],
    } });
    assert.equal(registered.accepted, true, 'normal managed POST reaches the actual service');
    const registeredRequests = await sendManaged('/erp/v1/requests', { query: { workspaceId: 'fixture' } });
    assert.deepEqual(registeredRequests.records.map(record => record.requestId), ['SYNTHETIC-OWNED']);
    // Execute the packaged-smoke registration statement unchanged against the
    // actual HTTP transport: serializing its body twice must fail this test.
    const smokeStart = source.indexOf('  await requestJson("/erp/v1/requests", {', end);
    const smokeEnd = source.indexOf('  const deliveryCapturedAt', smokeStart);
    assert.ok(smokeStart > 0 && smokeEnd > smokeStart);
    await new Function('requestJson', `return (async () => {
      const requestId='SYNTHETIC-SMOKE', workspaceId='fixture-smoke', ledgerId='fixture-ledger';
      const requestedAt=new Date().toISOString(), platformSkc='SKC-SMOKE';
      const expectedSkus=[{platformSku:'SKU-SMOKE',platformSkc}];
      ${source.slice(smokeStart, smokeEnd)}
    })();`)(sendManaged);
    assert.equal((await sendManaged('/erp/v1/requests', { query: { workspaceId: 'fixture-smoke' } })).records[0].requestId, 'SYNTHETIC-SMOKE');
    const restart = managed.retry();
    await assert.rejects(sendManaged('/erp/v1/status'), unavailable);
    assert.equal((await restart).ok, true);
    assert.equal((await sendManaged('/erp/v1/requests', { query: { workspaceId: 'fixture' } })).records.length, 1);

    process.kill(managed.getOwnedPid());
    await until(() => managed.getOwnedPid() === null, 'owned child exits');
    replacement = await listener(port);
    await assert.rejects(sendManaged('/erp/v1/cost-batches', { query: { workspaceId: 'fixture' } }), unavailable);
    await until(() => managed.getState().status === 'conflict', 'replacement listener is rejected during recovery');
    await pause(350); // Include the scheduled automatic restart deadline.
    assert.equal(managed.getOwnedPid(), null, 'a retry must not spawn over an occupied port');
    assert.ok(replacement.requests.length > 0);
    assert.ok(replacement.requests.every(request => !request.authorization && !request.resetCapability), 'post-exit replacement receives no capabilities');
    const before = replacement.requests.length;
    await assert.rejects(sendManaged('/erp/v1/status'), unavailable);
    assert.equal(replacement.requests.length, before);
    await replacement.close(); replacement = null;
    assert.equal((await managed.retry()).ok, true);
    assert.equal((await sendManaged('/erp/v1/status')).application, 'shopeers-erp-inbox', 'explicit retry reconnects after the conflict is removed');
  } finally { await managed.stop({ wait: true }); if (replacement) await replacement.close(); }

  // A genuine owned child begins a response, then the controller stops it. The
  // pending workspace call must settle promptly and cannot accept a stale reply.
  const marker = path.join(directory, 'request-started');
  const modeFile = path.join(directory, 'identity-mode');
  const requestLog = path.join(directory, 'fixture-requests.jsonl');
  const fixture = path.join(directory, 'delayed-service.cjs');
  await fs.writeFile(fixture, `
    const http = require('node:http'), fs = require('node:fs'), crypto = require('node:crypto');
    let previousProof;
    http.createServer((request, response) => {
      fs.appendFileSync(${JSON.stringify(requestLog)}, JSON.stringify({path:request.url,
        socket:request.socket.remotePort, credential:Boolean(request.headers.authorization),
        resetCredential:Boolean(request.headers['x-shopeers-reset-capability'])})+'\\n');
      const mode = fs.existsSync(${JSON.stringify(modeFile)}) ? fs.readFileSync(${JSON.stringify(modeFile)},'utf8') : 'normal';
      if (request.url.startsWith('/erp/v1/identity?')) {
        const challenge = new URL(request.url,'http://127.0.0.1').searchParams.get('challenge');
        const proof = crypto.createHmac('sha256', process.env.SHOPEERS_ERP_INBOX_CAPABILITY)
          .update('lworkstation-inbox-identity@1\\0').update(challenge).digest('hex');
        const returnedProof = mode === 'oversized' ? '0'.repeat(2048) : mode === 'wrong-proof' ? '0'.repeat(64) : mode === 'replay' ? previousProof : proof;
        previousProof=proof;
        response.writeHead(200, {'content-type':'application/json', ...(mode === 'close' ? {connection:'close'} : {})});
        response.end(JSON.stringify({challenge,proof:returnedProof}));
      } else if (request.url.startsWith('/erp/v1/cost-batches')) {
        fs.writeFileSync(${JSON.stringify(marker)}, 'started');
        response.writeHead(200, {'content-type':'application/json'});
        response.write('{"records":');
        setTimeout(() => response.end('[]}'), 60000);
      } else {
        response.writeHead(200, {'content-type':'application/json'});
        response.end(JSON.stringify({application:'shopeers-erp-inbox',apiVersion:2}));
      }
    }).listen(Number(process.env.SHOPEERS_ERP_INBOX_PORT), '127.0.0.1');
  `);
  const identityChecks = controller(await unusedPort(), { scriptPath: fixture, pollIntervalMs: 60_000 });
  try {
    assert.equal((await identityChecks.start()).ok, true);
    const startupRequests = (await fs.readFile(requestLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(startupRequests.length, 2);
    assert.equal(startupRequests[0].credential, false);
    assert.equal(startupRequests[1].credential, true);
    assert.equal(startupRequests[0].socket, startupRequests[1].socket, 'authenticated request reuses the challenge connection');
    for (const mode of ['wrong-proof', 'replay', 'close', 'oversized']) {
      await fs.writeFile(modeFile, mode); await fs.writeFile(requestLog, '');
      await assert.rejects(identityChecks.requestInbox({ route: '/erp/v1/status' }), error => [502, 503].includes(error.status));
      const requests = (await fs.readFile(requestLog, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(requests.length, 1, `${mode} must not create an authenticated request or a replacement connection`);
      assert.equal(requests[0].credential, false); assert.equal(requests[0].resetCredential, false);
    }
    await fs.writeFile(modeFile, 'close'); await fs.writeFile(requestLog, '');
    await assert.rejects(identityChecks.maintenanceRequest({ action: 'begin' }), error => error.status === 503);
    assert.ok((await fs.readFile(requestLog, 'utf8')).trim().split('\n').map(JSON.parse).every(request => !request.credential && !request.resetCredential));
  } finally { await identityChecks.stop({ wait: true }); await fs.rm(modeFile, { force: true }); }
  for (const shutdown of ['stop', 'exit']) {
    await fs.rm(marker, { force: true });
    const delayed = controller(await unusedPort(), { scriptPath: fixture, pollIntervalMs: 60_000, restartDelayMs: 5000 });
    try {
      await delayed.start();
      const pending = workspaceTransport(delayed)('/erp/v1/cost-batches', { query: { workspaceId: 'fixture' } })
        .then(value => ({ value }), error => ({ error }));
      await until(async () => fs.access(marker).then(() => true, () => false), 'owned request begins response');
      if (shutdown === 'stop') await delayed.stop({ wait: true });
      else process.kill(delayed.getOwnedPid());
      const result = await Promise.race([pending, pause(2000).then(() => ({ timeout: true }))]);
      assert.equal(result.timeout, undefined, `${shutdown} settles in-flight requests without waiting for the HTTP timeout`);
      assert.ok(result.error && ['INBOX_SERVICE_UNAVAILABLE', 'INBOX_REQUEST_FAILED'].includes(result.error.code));
    } finally { await delayed.stop({ wait: true }); }
  }
} finally {
  assert.ok(directory.startsWith(path.join(os.tmpdir(), 'shopeers-inbox-ownership-')));
  await fs.rm(directory, { recursive: true, force: true });
}

console.log('desktop inbox ownership: lifecycle no-send, startup port race, bounded HMAC/same-socket proof, wrong/replayed proof and closed-socket rejection, real GET/POST/smoke, restart and in-flight stop/exit passed');
