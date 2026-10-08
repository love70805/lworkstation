import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createInboxServiceController } = require('../desktop/inbox-service.cjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lworkstation-reset-contract-'));
const spoolPath = path.join(root, 'inbox.json');
const port = 29000 + Math.floor(Math.random() * 2000);
const capability = crypto.randomBytes(32).toString('base64url');
const service = createInboxServiceController({
  executable: process.execPath, scriptPath: fileURLToPath(new URL('./erp-inbox-server.mjs', import.meta.url)),
  spoolPath, port, capability, pollIntervalMs: 100,
});
const runtime = [
  { kind: 'extension-status', extensionId: 'erp-assistant', version: 'fixture' },
  { kind: 'selection-extension-status', extensionId: '1688', version: 'fixture' },
  { kind: 'selection-active-context', workspaceId: 'W', memberId: 'local-user', visibility: 'workspace' },
];
await fs.writeFile(spoolPath, JSON.stringify([...runtime,
  { kind: 'selection-capture', workspaceId: 'W', status: 'pending', envelope: { synthetic: true } },
  { kind: 'catalog-batch', workspaceId: 'W', status: 'acknowledged', envelope: { synthetic: true } },
  { kind: 'request', requestId: 'FOREIGN-OLD', workspaceId: 'OTHER-LOCAL-WORKSPACE', status: 'canceled' },
]));
async function call(route, body, expected = 200, extraHeaders = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json', ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), JSON.stringify(payload));
  return payload;
}
const request = { id: 'RESET-REQUEST', workspaceId: 'W', ledgerId: 'LEDGER-W-2026-09', ledgerPeriod: '2026-09',
  ledgerVersion: 'OLD-IMPORT', platformSkcs: ['SKC-A'] };
const expectedSkus = [{ platformSku: 'SKU-A', platformSkc: 'SKC-A', store: '680店' }];
try {
  await assert.rejects(service.clearBusinessData(), /尚未就绪/);
  assert.equal((await service.start()).ok, true);
  await call('/erp/v1/requests', { request, expectedSkus }, 202);
  const { task } = await call('/erp/v1/collection-tasks', { workspaceId: 'W', requestId: request.id }, 201);
  const taskUrl = `/erp/v1/collection-tasks/${task.taskId}`;
  const batchUrl = `${taskUrl}/batches/${encodeURIComponent(task.batches[0].batchId)}`;
  await call(`${taskUrl}/control`, { workspaceId: 'W', action: 'resume' });
  const { batch } = await call(batchUrl, { workspaceId: 'W', state: 'running' });
  await call(batchUrl, { workspaceId: 'W', state: 'collected', attemptId: batch.attemptId });
  const result = {
    requestId: request.id, workspaceId: 'W', ledgerId: request.ledgerId, querySkcs: ['SKC-A'], resultDeliveryId: 'OLD-RESULT',
    collectionTask: { taskId: task.taskId, batchId: batch.batchId, attemptId: batch.attemptId },
    rows: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A', warehouseSku: 'WH-A', unitCost: 4, totalPrice: 8, totalQuantity: 2, calculationCount: 1 }],
    sourceMeta: { evidenceComplete: true },
    warehouseEvidence: { evidenceVersion: 1, evidenceComplete: true, warehouses: [{ warehouseSku: 'WH-A', evidenceComplete: true,
      purchaseRecords: [{ recordId: 'P-1', warehouseSku: 'WH-A', quantity: 2, totalPrice: 8, unitPrice: 4 }] }] },
  };
  await call('/erp/v1/cost-results', result, 202);
  await call(`${taskUrl}/control`, { workspaceId: 'W', action: 'heartbeat' });
  assert.ok(JSON.parse(await fs.readFile(`${spoolPath}.leases.json`, 'utf8')).length);
  const before = await fs.readFile(spoolPath, 'utf8');
  await call('/erp/v1/workspace-reset', {}, 403);
  await call('/erp/v1/workspace-reset', {}, 403, { 'x-shopeers-reset-capability': capability });
  assert.equal(await fs.readFile(spoolPath, 'utf8'), before, 'extension capability cannot clear history');

  // Runtime-only heartbeat writes racing the reset cannot leave stale leases.
  const renewals = Array.from({ length: 12 }, () => call(`${taskUrl}/control`, { workspaceId: 'W', action: 'heartbeat' }, [200, 404]));
  const receipt = await service.clearBusinessData();
  await Promise.all(renewals);
  assert.equal(receipt.ok, true); assert.ok(receipt.clearedCount >= 6);
  assert.deepEqual(JSON.parse(await fs.readFile(`${spoolPath}.leases.json`, 'utf8')), []);
  assert.deepEqual(JSON.parse(await fs.readFile(spoolPath, 'utf8')), runtime);
  assert.equal((await call('/erp/v1/requests?workspaceId=W&includeHistory=true')).records.length, 0);
  assert.equal((await call('/erp/v1/collection-tasks?workspaceId=W')).tasks.length, 0);
  await call(`${taskUrl}/control`, { workspaceId: 'W', action: 'resume' }, 404);
  await call('/erp/v1/cost-results', result, [404, 409]);
  await service.retry();
  assert.equal((await call('/erp/v1/collection-tasks?workspaceId=W&ledgerId=LEDGER-W-2026-09')).tasks.length, 0);
  assert.equal((await call('/erp/v1/cost-batches?workspaceId=W')).records.length, 0);
  assert.equal((await call('/erp/v1/catalog-batches?workspaceId=W')).records.length, 0);
  const newRequest = { ...request, id: 'NEW-REQUEST', ledgerVersion: 'NEW-IMPORT' };
  await call('/erp/v1/requests', { request: newRequest, expectedSkus }, 202);
  const next = await call('/erp/v1/collection-tasks', { workspaceId: 'W', requestId: newRequest.id }, 201);
  assert.notEqual(next.task.taskId, task.taskId);
  assert.equal(next.task.summary.delivered, 0);
  assert.equal((await service.clearBusinessData()).ok, true, 'reset is retryable');
  console.log('local reset: owner-only IPC service capability, all business histories, heartbeat race, durable restart, old-result rejection and fresh same-month task passed');
} finally {
  await service.stop({ wait: true });
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(root, { recursive: true, force: true });
}
