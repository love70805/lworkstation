import assert from 'node:assert/strict';
import { handleCollectionTaskRequest, recordCollectionDelivery, recoverCollectionTasks, collectionCatalogSeed } from './erp-collection-tasks.mjs';
import { verifyErpCatalogTransport } from './erp-catalog-transport.test.mjs';
import { scenario } from './erp-collection-batches.test.mjs';

const request = { kind: 'request', requestId: 'R', workspaceId: 'W', ledgerId: 'L', ledgerPeriod: '2026-09', status: 'registered',
  platformSkcs: Array.from({ length: 10 }, (_, i) => `C${i}`), expectedSkus: Array.from({ length: 10 }, (_, i) => ({ platformSkc: `C${i}`, platformSku: `S${i}` })) };
const records = [request];
const call = (suffix, payload, workspace = 'W') => handleCollectionTaskRequest(records, { method: payload ? 'POST' : 'GET',
  url: new URL(`http://localhost/erp/v1/collection-tasks${suffix}${suffix.includes('?') ? '&' : '?'}workspaceId=${workspace}`),
  payload: payload ? { ...payload, workspaceId: workspace } : {}, instanceId: 'I' }).body;
const task = call('', { requestId: 'R', executionProtocol: 2, catalogMode: 'after_costs' }).task;
assert.equal(task.batches.length, 2);
const control = (action, extra = {}) => call(`/${task.taskId}/control`, { action, ...extra });
control('request_resume'); control('claim', { runnerId: 'RUNNER-1', resumeRequestId: task.resumeRequestId });
let runnerId = task.runnerId;
const batchCall = (batch, state) => call(`/${task.taskId}/batches/${encodeURIComponent(batch.batchId)}`, { runnerId, attemptId: batch.attemptId, state });
const seed = (batch, extra = '') => call(`/${task.taskId}/batches/${encodeURIComponent(batch.batchId)}/catalog-seed?runnerId=${runnerId}&attemptId=${batch.attemptId}${extra}`);
const rejects = (operation, code) => assert.throws(operation, error => error.code === code);
const [first, second] = task.batches;
for (const batch of [first, second]) {
  batchCall(batch, 'running');
  recordCollectionDelivery({ task, batch }, { deliveryId: `D${batch === first ? 1 : 2}` });
  records.push({ kind: 'batch', deliveryId: batch.deliveryId, requestId: 'R', workspaceId: 'W' });
  rejects(() => batchCall(first, 'catalog_running'), 'ERP_TASK_COST_FIRST');
  rejects(() => seed(first), 'ERP_TASK_COST_FIRST');
  if (batch === first) call(`/${task.taskId}/adoption`, { deliveryId: batch.deliveryId, adoptedCount: 5 });
}
// A terminal calculation may preserve manual/finalized costs or report missing
// prices; these outcomes settle the barrier without inventing adopted costs.
call(`/${task.taskId}/adoption`, { deliveryId: second.deliveryId, adoptedCount: 1, manualEffectiveCount: 1, protectedCount: 1, missingCount: 1, anomalyCount: 1 });
assert.equal(seed(first).catalogSeedReceipt, 'D1');
call(`/${task.taskId}/adoption`, { deliveryId: first.deliveryId, state: 'pending' });
rejects(() => seed(first), 'ERP_TASK_COST_FIRST');
call(`/${task.taskId}/adoption`, { deliveryId: first.deliveryId, adoptedCount: 5 });
batchCall(first, 'catalog_running');
rejects(() => call(`/${task.taskId}/batches/${encodeURIComponent(first.batchId)}/catalog-seed?runnerId=OTHER&attemptId=${first.attemptId}`), 'ERP_TASK_RUNNER_CHANGED');
rejects(() => call(`/${task.taskId}/batches/${encodeURIComponent(first.batchId)}/catalog-seed?runnerId=${runnerId}&attemptId=STALE`), 'ERP_TASK_STALE_ATTEMPT');
rejects(() => call(`/${task.taskId}/batches/${encodeURIComponent(first.batchId)}/catalog-seed?runnerId=${runnerId}&attemptId=${first.attemptId}`, null, 'OTHER'), 'ERP_TASK_WORKSPACE_MISMATCH');
control('pause'); rejects(() => seed(first), 'ERP_TASK_COST_FIRST');
control('release', { runnerId }); control('request_resume', { mode: 'catalog' });
control('claim', { runnerId: 'RUNNER-2', resumeRequestId: task.resumeRequestId }); runnerId = 'RUNNER-2';
assert.equal(seed(first).catalogSeedReceipt, 'D1');
const persisted = structuredClone(records);
assert.equal(recoverCollectionTasks(persisted, 'RESTART'), true);
assert.equal(persisted.find(item => item.taskId === task.taskId).recoveryRequired, true);
request.expectedSkus[0].platformSkc = 'CHANGED'; rejects(() => seed(first), 'ERP_TASK_SCOPE_CHANGED');
const restored = collectionCatalogSeed({ rows: [{ warehouseSku: 'WH', platformSku: 'S', platformSkc: 'C', productName: '暂存资料', unitCost: 99 }],
  sourceMeta: { scopeDirectoryComplete: true }, warehouseEvidence: [{ warehouseSku: 'WH', evidenceComplete: true }] });
assert.equal(restored.results[0].name, '暂存资料');
assert.equal(restored.results[0].unitCost, undefined);
assert.equal(restored.warehouseEvidence.warehouses[0].evidenceComplete, true);
await verifyErpCatalogTransport({ legacyScope: false, afterCosts: true, includeConflict: false,
  expectedSkus: ['RED', 'BLUE'].map(id => ({ platformSku: `SKU-${id}`, platformSkc: 'SKC-CATALOG' })) });
await scenario(10, 'cost-before-catalog', { afterCosts: true });
await scenario(10, 'continue-legacy-with-barrier', { afterCosts: true, resumeLegacy: true });
await scenario(10, 'receiver-restart-during-adoption', { afterCosts: true, receiverRestart: true });
console.log('All-batch cost/adoption barrier, pause/restart/identity rejection and durable metadata reuse passed.');
