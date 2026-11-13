import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleCollectionTaskRequest, recoverCollectionTasks, validateCollectionDelivery, recordCollectionDelivery } from './erp-collection-tasks.mjs';

function harness(size = 12, creation = { executionProtocol: 2, costFlow: 'task' }) {
  const records = [{ kind: 'request', status: 'registered', requestId: 'REQUEST', workspaceId: 'WORKSPACE', ledgerId: 'LEDGER',
    ledgerPeriod: '2026-10', ledgerVersion: 'IMPORT-1', platformSkcs: Array.from({ length: size }, (_, index) => `Skc-${index}`),
    expectedSkus: Array.from({ length: size }, (_, index) => ({ platformSkc: `Skc-${index}`, platformSku: `SKU-${index}`, store: '合成店铺' })) }];
  let now = 100000;
  const call = (suffix, payload = {}, method = 'POST') => handleCollectionTaskRequest(records, { method,
    url: new URL(`http://localhost/erp/v1/collection-tasks${suffix}`), payload: { workspaceId: 'WORKSPACE', ...payload }, instanceId: 'INSTANCE', now }).body;
  const { task } = call('', { requestId: 'REQUEST', ...creation });
  const control = payload => call(`/${task.taskId}/control`, payload);
  const resume = (payload = {}) => {
    control({ action: 'request_resume', ...payload });
    control({ action: 'claim', runnerId: 'RUNNER-CURRENT', resumeRequestId: task.resumeRequestId });
  };
  const batchCall = (batch, payload) => call(`/${task.taskId}/batches/${encodeURIComponent(batch.batchId)}`,
    { runnerId: 'RUNNER-CURRENT', attemptId: batch.attemptId, ...payload });
  const start = (batch = task.batches[0]) => batchCall(batch, { state: 'running' }).batch;
  const partition = (batch, groups, payload = {}) => batchCall(batch, { state: 'partition', groups, ...payload });
  const delivery = (batch, deliveryId = 'DELIVERY') => {
    batchCall(batch, { state: 'collected', resultDeliveryId: `${deliveryId}-RESULT` });
    recordCollectionDelivery({ task, batch }, { deliveryId, resultDeliveryId: `${deliveryId}-RESULT` }, now);
  };
  return { records, task, call, control, resume, start, batchCall, partition, delivery, advance: value => { now += value; } };
}

const group = (skcs, sourceMode = 'bulk', fallbackReason) => ({ platformSkcs: skcs, sourceMode, ...(fallbackReason ? { fallbackReason } : {}) });

test('delivery pause retains its bounded explanation and original unsent identity until continuation', () => {
  const h = harness(2); h.resume(); const batch = h.start();
  h.batchCall(batch, { state: 'collected', resultDeliveryId: 'RETAINED-OR-UNCONFIRMED' });
  const identity = structuredClone(batch);
  h.control({ action: 'pause', reason: { code: 'ERP_DELIVERY_FAILED', message: '回传未确认。'.repeat(150), credential: 'discard' } });
  assert.equal(h.task.status, 'paused');
  assert.equal(h.task.pauseReason.code, 'ERP_DELIVERY_FAILED');
  assert.equal(h.task.pauseReason.message.length, 500);
  assert.equal(h.task.pauseReason.credential, undefined);
  assert.deepEqual(batch, identity);
  h.resume();
  assert.equal(h.task.pauseReason, undefined);
  assert.deepEqual(batch, identity, 'continuation reconciles the exact old result before a new read');
});

test('whole-task mode creates one range and resumes without the legacy five-SKC split', () => {
  const h = harness(127);
  assert.equal(h.task.costFlow, 'task');
  assert.equal(h.task.batches.length, 1);
  assert.equal(h.task.summary.total, 127);
  h.resume();
  const batch = h.start();
  const attempt = batch.attemptId;
  h.control({ action: 'pause' });
  h.resume();
  assert.equal(h.task.batches.length, 1);
  assert.equal(h.task.batches[0].platformSkcs.length, 127);
  assert.equal(h.task.batches[0].status, 'pending');
  assert.notEqual(h.start().attemptId, attempt);
  const legacy = harness(12, { executionProtocol: 2 });
  assert.equal(legacy.task.batches.length, 3);
  assert.equal(legacy.task.costFlow, undefined);
  const old = harness(12, {});
  old.resume();
  assert.equal(old.task.batches.length, 3, 'older task continuation retains its existing protocol');
  assert.throws(() => harness(12, { executionProtocol: 1, costFlow: 'task' }), { code: 'ERP_TASK_MODE_INVALID' });
  assert.throws(() => harness(12, { executionProtocol: 2, costFlow: 'unknown' }), { code: 'ERP_TASK_MODE_INVALID' });
});

test('selective partition preserves exact scope and retires the original attempt', () => {
  const h = harness(); h.resume();
  const parent = h.start(), scopeHash = h.task.scopeHash, snapshot = structuredClone(h.task.requestSnapshot);
  const result = h.partition(parent, [group(parent.platformSkcs.slice(0, 10).map(skc => skc.toLowerCase())),
    group(['Skc-10'], 'legacy', 'target_mapping_unresolved'), group(['Skc-11'], 'legacy', 'purchase_month_boundary')]);
  assert.equal(result.batches.length, 3);
  assert.equal(h.task.summary.total, 12);
  assert.equal(h.task.scopeHash, scopeHash);
  assert.deepEqual(h.task.requestSnapshot, snapshot);
  assert.deepEqual(result.batches.flatMap(batch => batch.platformSkcs), parent.platformSkcs);
  assert.equal(new Set(result.batches.map(batch => batch.batchId)).size, 3);
  assert.ok(result.batches.every(batch => batch.parentBatchId === parent.batchId && batch.attemptId === null && batch.status === 'pending'));
  assert.deepEqual(result.batches.map(batch => batch.sourceMode), ['bulk', 'legacy', 'legacy']);
  assert.equal(result.batches[1].fallbackReason, 'target_mapping_unresolved');
  assert.throws(() => h.batchCall(parent, { state: 'collected' }), { code: 'ERP_TASK_BATCH_NOT_FOUND' });
  assert.throws(() => validateCollectionDelivery(h.records, { collectionTask: { taskId: h.task.taskId, batchId: parent.batchId, attemptId: parent.attemptId },
    workspaceId: h.task.workspaceId, ledgerId: h.task.ledgerId, requestId: h.task.requestId, querySkcs: parent.platformSkcs }), { code: 'ERP_TASK_STALE_ATTEMPT' });
  for (const [index, next] of result.batches.entries()) h.delivery(h.start(next), `DELIVERY-${index}`);
  assert.equal(h.task.summary.delivered, 12);
  assert.equal(h.task.status, 'cost_complete');
});

test('invalid partitions leave the task completely unchanged', () => {
  const invalid = [null, [], [group(['Skc-0', 'Skc-1', 'Skc-2'])],
    [group(['Skc-0']), group(['Skc-1'])],
    [group(['Skc-0', 'SKC-0']), group(['Skc-1', 'Skc-2'])],
    [group(['Skc-0', 'Skc-1']), group(['skc-1', 'Skc-2'])],
    [group(['Skc-0']), group(['Skc-1', 'Skc-2', 'FOREIGN'])],
    [group([]), group(['Skc-0', 'Skc-1', 'Skc-2'])],
    [group(['Skc-0'], 'unsupported'), group(['Skc-1', 'Skc-2'])],
    [group(['Skc-0'], 'legacy', 'private query data'), group(['Skc-1', 'Skc-2'])],
    [group([{ platformSkc: 'Skc-0' }]), group(['Skc-1', 'Skc-2'])],
    [group(['Skc-0']), group(['Skc-1']), group(['Skc-2']), group(['Skc-3'])]];
  for (const groups of invalid) {
    const h = harness(3); h.resume(); const parent = h.start();
    const before = structuredClone(h.records);
    assert.throws(() => h.partition(parent, groups), { code: 'ERP_TASK_PARTITION_INVALID' });
    assert.deepEqual(h.records, before);
  }
});

test('partition rejects stopped, paused, expired, foreign or stale executors and changed ledger scopes', () => {
  const cases = [
    [h => h.control({ action: 'pause' }), {}, 'ERP_TASK_NOT_RUNNING'],
    [h => h.control({ action: 'stop' }), {}, 'ERP_TASK_NOT_RUNNING'],
    [h => { h.task.status = 'invalidated'; }, {}, 'ERP_TASK_NOT_RUNNING'],
    [h => { h.task.recoveryRequired = true; }, {}, 'ERP_TASK_NOT_RUNNING'],
    [h => { h.task.runMode = 'catalog'; }, {}, 'ERP_TASK_NOT_RUNNING'],
    [h => h.advance(45001), {}, 'ERP_TASK_NOT_RUNNING'],
    [h => { h.records[0].ledgerVersion = 'IMPORT-2'; }, {}, 'ERP_TASK_SCOPE_CHANGED'],
    [h => { h.records[0].expectedSkus[0].store = '另一个店铺'; }, {}, 'ERP_TASK_SCOPE_CHANGED'],
    [h => { h.records[0].status = 'expired'; }, {}, 'ERP_TASK_SCOPE_CHANGED'],
    [() => {}, { runnerId: 'OTHER-RUNNER' }, 'ERP_TASK_RUNNER_CHANGED'],
    [() => {}, { workspaceId: 'OTHER-WORKSPACE' }, 'ERP_TASK_WORKSPACE_MISMATCH'],
    [() => {}, { attemptId: 'OLD-ATTEMPT' }, 'ERP_TASK_STALE_ATTEMPT'],
  ];
  for (const [change, payload, code] of cases) {
    const h = harness(3); h.resume(); const parent = h.start();
    change(h);
    const before = structuredClone(h.records);
    assert.throws(() => h.partition(parent, [group(['Skc-0']), group(['Skc-1', 'Skc-2'])], payload), { code });
    assert.deepEqual(h.records, before);
  }
  const legacy = harness(3, { executionProtocol: 2 }); legacy.resume();
  const batch = legacy.start();
  assert.throws(() => legacy.partition(batch, [group(['Skc-0']), group(['Skc-1', 'Skc-2'])]), { code: 'ERP_TASK_PARTITION_UNSUPPORTED' });
});

test('collected evidence and durable receipts cannot be partitioned', () => {
  for (const stage of ['pending', 'collected', 'delivered']) {
    const h = harness(3); h.resume(); const batch = h.start();
    if (stage === 'pending') h.batchCall(batch, { state: 'pending' });
    if (stage === 'collected') h.batchCall(batch, { state: 'collected', resultDeliveryId: 'RETAINED' });
    if (stage === 'delivered') h.delivery(batch);
    const before = structuredClone(h.records);
    assert.throws(() => h.partition(batch, [group(['Skc-0']), group(['Skc-1', 'Skc-2'])]),
      { code: stage === 'delivered' ? 'ERP_TASK_NOT_RUNNING' : stage === 'pending' ? 'ERP_TASK_STALE_ATTEMPT' : 'ERP_TASK_BATCH_TERMINAL' });
    assert.deepEqual(h.records, before);
  }
});

test('adaptive splitting and failed-range retries preserve already delivered outcomes across restart', () => {
  const h = harness(12); h.resume(); const original = h.start();
  const [completed, remaining] = h.partition(original, [group(original.platformSkcs.slice(0, 6)), group(original.platformSkcs.slice(6))]).batches;
  h.delivery(h.start(completed), 'KEPT');
  h.call(`/${h.task.taskId}/adoption`, { deliveryId: 'KEPT', adoptedCount: 5, manualEffectiveCount: 1, expectedCount: 6 });
  const kept = structuredClone(completed);
  h.start(remaining);
  const split = h.partition(remaining, [group(remaining.platformSkcs.slice(0, 4)), group(remaining.platformSkcs.slice(4), 'legacy', 'target_mapping_unresolved')]).batches;
  assert.deepEqual(h.task.batches[0], kept);
  assert.equal(h.task.summary.delivered, 6);
  assert.equal(h.task.summary.adopted, 5);
  const failed = h.start(split[1]);
  h.batchCall(failed, { state: 'failed', error: '合成接口失败' });
  const serialized = structuredClone(h.records);
  assert.equal(recoverCollectionTasks(serialized, 'AFTER-RESTART', 100001), true);
  const restored = serialized.find(record => record.kind === 'collection-task');
  const post = payload => handleCollectionTaskRequest(serialized, { method: 'POST',
    url: new URL(`http://localhost/erp/v1/collection-tasks/${restored.taskId}/control`),
    payload: { workspaceId: 'WORKSPACE', ...payload }, instanceId: 'AFTER-RESTART', now: 100002 });
  post({ action: 'request_resume', retryFailed: true });
  assert.equal(restored.costFlow, 'task');
  assert.equal(restored.batches.length, 3);
  assert.deepEqual(restored.batches[0], kept);
  assert.equal(restored.batches[2].status, 'pending');
  assert.equal(restored.batches[2].sourceMode, 'legacy');
  assert.equal(restored.batches[2].fallbackReason, 'target_mapping_unresolved');
  assert.equal(restored.summary.total, 12);
  assert.equal(restored.summary.delivered, 6);
  assert.equal(restored.summary.manualEffective, 1);
});

test('unsent receipt recovery retries the original evidence before resetting for a fresh partition', () => {
  const h = harness(2); h.resume(); const batch = h.start();
  const oldAttempt = batch.attemptId;
  h.batchCall(batch, { state: 'collected', resultDeliveryId: 'OLD-UNSENT', evidenceComplete: false, error: '尚未送达' });
  h.control({ action: 'release', runnerId: 'RUNNER-CURRENT' });
  h.resume();
  assert.equal(batch.status, 'collected');
  assert.equal(batch.attemptId, oldAttempt);
  assert.equal(batch.resultDeliveryId, 'OLD-UNSENT', 'continuation first preserves the exact original payload for cached retry');
  const oldPayload = { collectionTask: { taskId: h.task.taskId, batchId: batch.batchId, attemptId: oldAttempt },
    workspaceId: h.task.workspaceId, ledgerId: h.task.ledgerId, requestId: h.task.requestId, querySkcs: batch.platformSkcs, resultDeliveryId: 'OLD-UNSENT' };
  assert.equal(validateCollectionDelivery(h.records, oldPayload).batch, batch);
  // The caller explicitly discards the unsent identity only after cached
  // delivery cannot be recovered. A late original result must then be fenced.
  h.batchCall(batch, { state: 'pending' });
  assert.equal(batch.attemptId, null);
  for (const key of ['resultDeliveryId', 'collectedAt', 'evidenceComplete', 'error']) assert.equal(batch[key], undefined);
  assert.equal(h.task.summary.collected, 0);
  assert.throws(() => validateCollectionDelivery(h.records, oldPayload), { code: 'ERP_TASK_STALE_ATTEMPT' });
  h.start(batch);
  assert.notEqual(batch.attemptId, oldAttempt);
  const partitioned = h.partition(batch, [group(['Skc-0']), group(['Skc-1'], 'legacy', 'target_mapping_unresolved')]);
  assert.equal(partitioned.batches.length, 2);
  assert.equal(h.task.summary.total, 2);
  assert.throws(() => validateCollectionDelivery(h.records, oldPayload), { code: 'ERP_TASK_STALE_ATTEMPT' });
});

test('new attempts clean old pending metadata but never demote durable outcomes', () => {
  const h = harness(2); h.resume(); const batch = h.task.batches[0];
  Object.assign(batch, { attemptId: 'OBSOLETE', resultDeliveryId: 'UNSENT', collectedAt: 'OLD', startedAt: 'OLD', evidenceComplete: false,
    adoption: { adoptedCount: 1 }, adoptionReportedAt: 'OLD', catalogStatus: 'failed', catalogError: 'OLD', sourceMode: 'legacy', fallbackReason: 'target_mapping_unresolved' });
  h.start(batch);
  assert.notEqual(batch.attemptId, 'OBSOLETE');
  assert.notEqual(batch.startedAt, 'OLD');
  for (const key of ['resultDeliveryId', 'collectedAt', 'evidenceComplete', 'adoption', 'adoptionReportedAt', 'catalogStatus', 'catalogError']) assert.equal(batch[key], undefined);
  assert.equal(batch.sourceMode, 'legacy');
  assert.equal(batch.fallbackReason, 'target_mapping_unresolved');
  for (const incomplete of [false, true]) {
    const delivered = harness(2); delivered.resume(); const retained = delivered.start();
    delivered.batchCall(retained, { state: 'collected', resultDeliveryId: 'RESULT', evidenceComplete: !incomplete });
    recordCollectionDelivery({ task: delivered.task, batch: retained }, { deliveryId: 'DURABLE', resultDeliveryId: 'RESULT', evidenceComplete: !incomplete }, 100000);
    const before = structuredClone(delivered.records);
    assert.throws(() => delivered.batchCall(retained, { state: 'pending' }), { code: 'ERP_TASK_BATCH_TERMINAL' });
    assert.deepEqual(delivered.records, before);
  }
});
