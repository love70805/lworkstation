import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-responsive-'));
const spool = path.join(directory, 'inbox.json');
const port = 24000 + Math.floor(Math.random() * 2000);
const capability = crypto.randomBytes(32).toString('base64url');
const server = fileURLToPath(new URL('./erp-inbox-server.mjs', import.meta.url));
const rows = Array.from({ length: 8000 }, (_, i) => ({ warehouseSku: `QA-${i}`, title: '仅隔离测试'.repeat(14), source: 'synthetic', records: Array.from({ length: 3 }, (_, n) => ({ purchaseOrder: `QA-ORDER-${i}-${n}`, quantity: 2, amount: 10, remark: 'synthetic-only-'.repeat(8) })) }));
const records = Array.from({ length: 10 }, (_, i) => ({ kind: 'catalog-batch', status: 'acknowledged', deliveryId: `QA-DELIVERY-${i}`, workspaceId: 'qa', envelope: { type: 'shopeers.erp.catalog.batch', catalog: { rows } } }));
const evidenceHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expectedEvidence = evidenceHash(records.map(record => record.envelope));
await fs.writeFile(spool, JSON.stringify(records));
const bytes = (await fs.stat(spool)).size;
const child = spawn(process.execPath, [server], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHOPEERS_ERP_INBOX_PORT: String(port), SHOPEERS_ERP_INBOX_FILE: spool, SHOPEERS_ERP_INBOX_CAPABILITY: capability } });
let output = ''; child.stdout.on('data', chunk => output += chunk);
child.stderr.on('data', chunk => output += chunk);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const measurements = [];
async function call(route, body) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/erp/v1/${route}`, { headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(4000) });
  const payload = await response.json();
  assert.ok(response.ok, JSON.stringify(payload));
  measurements.push({ route, ms: Math.round(performance.now() - started) });
  return payload;
}
try {
  const deadline = Date.now() + 5000;
  while (!output.includes('listening')) { assert.ok(Date.now() < deadline && child.exitCode === null, output); await pause(25); }
  await call('status');
  const beforeHeartbeat = await fs.stat(spool);
  const heartbeat = i => call('extension-status', { extensionId: `erp-assistant-frame-${i}`, version: '8.0.35', ready: true, context: 'extension-isolated', handshakeVersion: 1, workspaceId: 'qa', sessionState: 'authenticated', pageState: 'query_ready', queryAvailable: true });
  const warmStart = measurements.length;
  await Promise.all(Array.from({ length: 12 }, (_, i) => i % 4 === 0 ? heartbeat(i) : call('status')));
  assert.equal((await fs.stat(spool)).mtimeMs, beforeHeartbeat.mtimeMs, 'connection heartbeats do not rewrite evidence');
  const durableWrite = call('requests', { request: { id: 'QA-WRITE', workspaceId: 'qa', ledgerId: 'qa-ledger', ledgerPeriod: '2026-09', platformSkcs: ['QA-SKC'] }, expectedSkus: [{ platformSku: 'QA-SKU', platformSkc: 'QA-SKC' }] });
  await Promise.all(Array.from({ length: 20 }, (_, i) => i % 4 === 0 ? heartbeat(i) : call('status')));
  await durableWrite;
  const persisted = JSON.parse(await fs.readFile(spool, 'utf8'));
  assert.equal(evidenceHash(persisted.filter(item => item.kind === 'catalog-batch').map(item => item.envelope)), expectedEvidence, 'raw evidence remains unchanged');
  assert.ok(persisted.some(item => item.kind === 'request' && item.requestId === 'QA-WRITE'), 'business receipt follows durable write');
  const hot = measurements.slice(warmStart).filter(item => item.route !== 'requests');
  assert.ok(hot.every(item => item.ms < 1200), `status/heartbeat exceeded desktop timeout: ${JSON.stringify(hot)}`);
  const result = { ok: true, syntheticBytes: bytes, coldStatusMs: measurements[0].ms, concurrentMaximumMs: Math.max(...hot.map(item => item.ms)), requestCount: hot.length, evidencePreserved: true, businessCommitDurable: true, measurements };
  if (process.env.ERP_RESPONSIVENESS_REPORT) await fs.writeFile(process.env.ERP_RESPONSIVENESS_REPORT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  await fs.rm(directory, { recursive: true, force: true });
}
