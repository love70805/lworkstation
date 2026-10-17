import assert from 'node:assert/strict';
import { handleCollectionTaskRequest, recoverCollectionTasks, recordCollectionDelivery, validateCollectionDelivery } from './erp-collection-tasks.mjs';

let now = Date.now();
const scope = size => ({ kind: 'request', requestId: 'REQ', workspaceId: 'WS', ledgerId: 'LEDGER', ledgerPeriod: '2026-09', ledgerVersion: 'IMPORT-1',
  status: 'registered', platformSkcs: Array.from({ length: size }, (_, i) => `SKC-${i}`),
  expectedSkus: Array.from({ length: size }, (_, i) => ({ platformSkc: `SKC-${i}`, platformSku: `SKU-${i}`, store: '一店' })) });
const call = (records, path = '', payload, workspaceId = 'WS') => handleCollectionTaskRequest(records, {
  method: payload ? 'POST' : 'GET', url: new URL(`http://localhost/erp/v1/collection-tasks${path}?workspaceId=${workspaceId}`),
  payload: payload ? { workspaceId, ...payload } : {}, instanceId: 'INSTANCE', now,
}).body;
const control = (records, task, action, extra = {}) => call(records, `/${task.taskId}/control`, { action, ...extra }).task;
const batchCall = (records, task, batch, state, extra = {}) => call(records, `/${task.taskId}/batches/${encodeURIComponent(batch.batchId)}`, { state, ...extra }).batch;
const rejects = (operation, code) => assert.throws(operation, error => error.code === code);

{
  const records = [scope(11)];
  const task = call(records, '', { requestId: 'REQ', executionProtocol: 2, filters: { sku: 'SKC-0' } }).task;
  assert.deepEqual(task.batches.map(batch => batch.platformSkcs.length), [5, 5, 1]);
  assert.equal(task.catalogMode, 'on_demand');
  control(records, task, 'request_resume');
  const command = task.resumeRequestId;
  assert.equal(task.status, 'ready');
  control(records, task, 'request_resume');
  assert.equal(task.resumeRequestId, command, 'duplicate continue clicks retain one durable command');
  rejects(() => control(records, task, 'resume'), 'ERP_TASK_USE_COORDINATED_RESUME');
  control(records, task, 'claim', { runnerId: 'RUNNER-A', resumeRequestId: command });
  rejects(() => control(records, task, 'claim', { runnerId: 'RUNNER-B', resumeRequestId: command }), 'ERP_TASK_ALREADY_CLAIMED');
  rejects(() => batchCall(records, task, task.batches[0], 'running', { runnerId: 'RUNNER-B' }), 'ERP_TASK_RUNNER_CHANGED');
  const first = batchCall(records, task, task.batches[0], 'running', { runnerId: 'RUNNER-A' });
  control(records, task, 'request_resume', { retryFailed: true });
  assert.equal(first.status, 'running', 'another page cannot reset an active attempt');
  batchCall(records, task, first, 'collected', { runnerId: 'RUNNER-A', attemptId: first.attemptId, resultDeliveryId: 'RESULT-1' });
  recordCollectionDelivery({ task, batch: first }, { deliveryId: 'DELIVERY-1', resultDeliveryId: 'RESULT-1' }, now);
  const second = batchCall(records, task, task.batches[1], 'running', { runnerId: 'RUNNER-A' });
  const oldAttempt = second.attemptId;
  now += 30000;
  control(records, task, 'heartbeat', { runnerId: 'RUNNER-A' });
  now += 30000;
  assert.equal(recoverCollectionTasks(records, 'INSTANCE', now), false, 'fresh executor heartbeat renews the short lease');
  now += 16000;
  assert.equal(recoverCollectionTasks(records, 'INSTANCE', now), true);
  assert.equal(task.status, 'paused');
  rejects(() => control(records, task, 'heartbeat', { runnerId: 'RUNNER-A' }), 'ERP_TASK_RUNNER_CHANGED');
  control(records, task, 'request_resume');
  assert.equal(first.deliveryId, 'DELIVERY-1');
  assert.equal(second.status, 'pending');
  control(records, task, 'claim', { runnerId: 'RUNNER-B', resumeRequestId: task.resumeRequestId });
  batchCall(records, task, second, 'running', { runnerId: 'RUNNER-B' });
  rejects(() => batchCall(records, task, second, 'collected', { runnerId: 'RUNNER-B', attemptId: oldAttempt }), 'ERP_TASK_STALE_ATTEMPT');
  rejects(() => validateCollectionDelivery(records, { collectionTask: { taskId: task.taskId, batchId: second.batchId, attemptId: oldAttempt } }), 'ERP_TASK_STALE_ATTEMPT');
  rejects(() => call(records, `/${task.taskId}`, null, 'OTHER'), 'ERP_TASK_WORKSPACE_MISMATCH');
  control(records, task, 'pause');
  control(records, task, 'release', { runnerId: 'RUNNER-B' });
}

{
  const records = [scope(45)];
  const task = call(records, '', { requestId: 'REQ', filters: {} }).task;
  assert.deepEqual(task.batches.map(batch => batch.platformSkcs.length), [20, 20, 5]);
  const first = task.batches[0];
  Object.assign(first, { status: 'delivered', deliveryId: 'ORIGINAL', attemptId: 'ORIGINAL-ATTEMPT', adoption: { adoptedCount: 20 } });
  const original = structuredClone(first);
  Object.assign(task.batches[1], { status: 'running', attemptId: 'STALE' });
  task.status = 'paused';
  control(records, task, 'request_resume');
  assert.deepEqual(task.batches[0], original, 'delivered legacy batches and adoption are preserved verbatim');
  assert.deepEqual(task.batches.slice(1).map(batch => batch.platformSkcs.length), [5, 5, 5, 5, 5]);
  assert.equal(new Set(task.batches.flatMap(batch => batch.platformSkcs)).size, 45);
  assert.equal(new Set(task.batches.map(batch => batch.batchId)).size, task.batches.length);
  control(records, task, 'pause');
  records[0].status = 'expired';
  rejects(() => control(records, task, 'request_resume'), 'ERP_TASK_REVALIDATION_REQUIRED');
  control(records, task, 'request_resume', { scopeHash: task.scopeHash });
  records[0].ledgerVersion = 'IMPORT-2';
  rejects(() => control(records, task, 'claim', { runnerId: 'RUNNER-A', resumeRequestId: task.resumeRequestId }), 'ERP_TASK_SCOPE_CHANGED');
}

{
  const records = [scope(1)];
  const task = call(records, '', { requestId: 'REQ', filters: {}, executionProtocol: 2 }).task;
  control(records, task, 'request_resume');
  control(records, task, 'claim', { runnerId: 'RUNNER-A', resumeRequestId: task.resumeRequestId });
  const first = batchCall(records, task, task.batches[0], 'running', { runnerId: 'RUNNER-A' });
  recordCollectionDelivery({ task, batch: first }, { deliveryId: 'DELIVERY', resultDeliveryId: 'RESULT' }, now);
  control(records, task, 'release', { runnerId: 'RUNNER-A' });
  assert.equal(task.status, 'cost_complete');
  assert.equal(first.catalogStatus, undefined, 'default cost execution never starts material collection');
  assert.equal(recoverCollectionTasks(records, 'RESTARTED', now), false, 'optional material omissions do not resurrect a completed cost run');
  control(records, task, 'request_resume', { mode: 'catalog' });
  control(records, task, 'claim', { runnerId: 'RUNNER-C', resumeRequestId: task.resumeRequestId });
  assert.equal(task.runMode, 'catalog');
  batchCall(records, task, first, 'catalog_running', { runnerId: 'RUNNER-C', attemptId: first.attemptId });
  batchCall(records, task, first, 'catalog_completed', { runnerId: 'RUNNER-C', attemptId: first.attemptId });
  control(records, task, 'release', { runnerId: 'RUNNER-C' });
  assert.equal(first.deliveryId, 'DELIVERY');
  assert.equal(first.catalogStatus, 'completed');
}

console.log('ERP continuation: durable intent, unique executor, short lease recovery, old-task splitting, preserved receipts, scope rejection and explicit material mode passed.');

{
  const secondRequest = { ...scope(1), requestId: 'REQ-TWO', ledgerId: 'ANOTHER-LEDGER' };
  const records = [scope(1), secondRequest];
  const first = call(records, '', { requestId: 'REQ', filters: {}, executionProtocol: 2 }).task;
  const second = call(records, '', { requestId: 'REQ-TWO', filters: {}, executionProtocol: 2 }).task;
  control(records, first, 'request_resume');
  control(records, first, 'claim', { runnerId: 'FIRST-RUNNER', resumeRequestId: first.resumeRequestId });
  control(records, second, 'request_resume');
  rejects(() => control(records, second, 'claim', { runnerId: 'SECOND-RUNNER', resumeRequestId: second.resumeRequestId }), 'ERP_TASK_OTHER_RUNNING');
  control(records, first, 'pause');
  control(records, first, 'release', { runnerId: 'FIRST-RUNNER' });
  control(records, second, 'claim', { runnerId: 'SECOND-RUNNER', resumeRequestId: second.resumeRequestId });
  rejects(() => control(records, second, 'request_resume', { filters: { sku: 'CHANGED' } }), 'ERP_TASK_SCOPE_CHANGED');
  control(records, second, 'pause');
  control(records, second, 'release', { runnerId: 'SECOND-RUNNER' });
  control(records, second, 'request_resume');
  assert.equal(recoverCollectionTasks(records, 'RESTARTED', now), true);
  assert.equal(second.status, 'paused', 'queued intent also needs explicit recovery after service restart');
}
console.log('Workspace-wide executor exclusion and queued service-restart recovery passed.');
