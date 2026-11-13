import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const background = await readFile(new URL('../integrations/erp-assistant-extension/src/background.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../integrations/erp-assistant-extension/src/shopeers-bridge.js', import.meta.url), 'utf8');
const extensionVersion = JSON.parse(await readFile(new URL('../integrations/erp-assistant-extension/manifest.json', import.meta.url), 'utf8')).version;
const PENDING = 'shopeersErpPendingCostResultsV2';
const CHECKPOINTS = 'shopeersErpCollectionCheckpointsV1';
const sender = { url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html', frameId: 0 };
const utf8Bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

function fixture(count = 1, storageSeed = {}) {
  const mappings = Array.from({ length: count }, (_, index) => ({ platformSku: `SYNTHETIC-SKU-${index}`, platformSkc: `SYNTHETIC-SKC-${index}`, warehouseSku: 'SHARED-WAREHOUSE', productName: '合成中文商品🧪' }));
  const request = { kind: 'request', requestId: 'REQ', ledgerId: 'LEDGER', ledgerPeriod: '2026-10', workspaceId: 'WS', status: 'registered',
    registeredAt: '2026-11-04T00:00:00Z', platformSkcs: mappings.map(item => item.platformSkc), expectedSkus: structuredClone(mappings) };
  const task = { taskId: 'TASK', requestId: request.requestId, workspaceId: request.workspaceId, status: 'running', requestSnapshot: request,
    queryCapturedAt: request.registeredAt, batches: [{ batchId: 'TASK:1', attemptId: 'ATTEMPT', status: 'running', platformSkcs: request.platformSkcs }] };
  const input = { collectionTask: { taskId: 'TASK', batchId: 'TASK:1', attemptId: 'ATTEMPT' }, resultDeliveryId: 'RESULT', querySkcs: request.platformSkcs,
    results: [{ warehouseSku: 'SHARED-WAREHOUSE', mappings, catalogMappings: mappings, unitCost: 5, selectedRecordIds: ['P-1'] }],
    meta: { platformScopePolicy: 'ledger_platform_pair', querySkcs: request.platformSkcs },
    warehouseEvidence: { warehouses: [{ warehouseSku: 'SHARED-WAREHOUSE', evidenceComplete: true,
      purchaseRecords: [{ recordId: 'P-1', quantity: 2, unitPrice: 5, purchaseDate: '2026-10-01 12:00:00' }] }] } };
  const storage = { shopeersErpInboxBaseUrl: 'http://127.0.0.1:5397', shopeersErpInboxCapability: 'SYNTHETIC-CAPABILITY-01234567890123456789', shopeersErpWorkspaceId: 'WS',
    [PENDING]: [], [CHECKPOINTS]: [{ schemaVersion: 1, extensionVersion: '8.0.57', updatedAt: Date.now(), requestId: 'UNRELATED', binding: 'unchanged' }], ...storageSeed };
  const calls = [], writes = [];
  let dispatch, afterTaskRead;
  const storedBytes = values => Object.entries(values).reduce((sum, [key, value]) => sum + Buffer.byteLength(key) + utf8Bytes(value), 0);
  const chrome = { storage: { local: {
    QUOTA_BYTES: 10 * 1024 * 1024,
    getBytesInUse: async () => storedBytes(storage),
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(storage[key])])),
    set: async values => {
      if (storedBytes({ ...storage, ...values }) > 10 * 1024 * 1024) throw new Error('Resource::kQuotaBytes quota exceeded');
      writes.push(structuredClone(values)); Object.assign(storage, structuredClone(values));
    },
  } }, runtime: { getManifest: () => ({ version: extensionVersion }), onMessage: { addListener: listener => { dispatch = listener; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
    sendMessage: (message, callback) => dispatch(message, sender, callback),
  }, alarms: { create() {}, onAlarm: { addListener() {} } } };
  const context = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, TextEncoder, AbortController, crypto: webcrypto, setTimeout, clearTimeout, console,
    window: { setTimeout, clearTimeout }, fetch: async (raw, init = {}) => {
      const url = new URL(raw), method = init.method ?? 'GET';
      calls.push({ path: url.pathname, method, body: init.body });
      let body;
      if (url.pathname.startsWith('/erp/v1/collection-tasks/') && method === 'GET') { body = { task: structuredClone(task) }; afterTaskRead?.(); }
      else if (url.pathname === '/erp/v1/requests' && method === 'GET') body = { records: [structuredClone(request)] };
      else if (url.pathname === '/erp/v1/cost-results' && method === 'POST') body = { deliveryId: 'DELIVERY', batchId: 'INBOX', resultDeliveryId: 'RESULT' };
      else throw new Error(`Unexpected ${method} ${url.pathname}`);
      return { ok: true, status: 200, json: async () => body };
    } });
  vm.runInContext(background, context);
  vm.runInContext(bridgeSource, context);
  const message = (type, payload, source = sender) => new Promise(resolve => dispatch({ type: `shopeers.erp.${type}`, payload }, source, resolve));
  return { input, request, task, storage, calls, writes, message, bridge: context.window.ShopeersErpDeliveryBridge, api: context.__SHOPEERS_ERP_BACKGROUND_TEST_API__,
    afterTaskRead: callback => { afterTaskRead = callback; } };
}

{
  const sample = fixture(400), initialStorage = structuredClone(sample.storage);
  const measured = await sample.bridge.measureCost(sample.input);
  assert.equal(measured.ok, true);
  assert.ok(utf8Bytes(sample.input) < 1024 * 1024, 'small collector results can expand when each SKU carries the shared mapping list');
  assert.ok(measured.bytes > 25 * 1024 * 1024, 'measure the expanded outbound rows rather than the compact collector state');
  assert.equal(sample.writes.length, 0, 'measurement never saves pending evidence or modifies checkpoints');
  assert.deepEqual(sample.storage, initialStorage);
  assert.ok(sample.calls.every(call => call.method === 'GET'), 'measurement never mutates business state');
  const submitted = await sample.message('submitCostResult', sample.input);
  assert.equal(submitted.code, 'ERP_COST_PAYLOAD_TOO_LARGE');
  assert.equal(submitted.status, 'failed');
  assert.equal(sample.writes.length, 0, 'direct legacy callers cannot queue permanently oversized evidence');
  assert.ok(sample.calls.every(call => call.method === 'GET'));
  console.log(JSON.stringify({ compactStateBytes: utf8Bytes(sample.input), expandedPayloadBytes: measured.bytes, refusedBeforePersistence: true }));
}

{
  const sample = fixture();
  sample.input.warehouseEvidence.syntheticEvidence = 'x'.repeat(11 * 1024 * 1024);
  const initial = structuredClone(sample.storage);
  const measured = await sample.bridge.measureCost(sample.input);
  assert.equal(measured.ok, true);
  assert.ok(measured.bytes < 20 * 1024 * 1024, 'HTTP preflight alone used to accept a batch that native storage rejects');
  assert.equal(measured.storageFits, false);
  assert.ok(measured.storageBytes > measured.storageAvailableBytes);
  assert.equal(sample.writes.length, 0);
  const submitted = await sample.bridge.submit(sample.input);
  assert.equal(submitted.code, 'ERP_COST_STORAGE_FULL');
  assert.equal(submitted.status, 'failed');
  assert.deepEqual(sample.storage, initial, 'capacity failure cannot replace previously retained evidence');
  assert.ok(sample.calls.every(call => call.method === 'GET'));
}

{
  const retained = { resultDeliveryId: 'UNRELATED-RETAINED', syntheticEvidence: 'x'.repeat(9 * 1024 * 1024) };
  const sample = fixture(1, { [PENDING]: [retained] });
  sample.input.warehouseEvidence.syntheticEvidence = 'x'.repeat(1024 * 1024);
  const measured = await sample.bridge.measureCost(sample.input);
  assert.equal(measured.storageFits, false, 'preflight accounts for all already retained results');
  assert.ok(measured.storageAvailableBytes < 1024 * 1024);
  assert.equal((await sample.bridge.submit(sample.input)).code, 'ERP_COST_STORAGE_FULL');
  assert.deepEqual(sample.storage[PENDING], [retained]);
}

{
  const sample = fixture(5);
  const measured = await sample.bridge.measureCost(sample.input);
  assert.equal(measured.ok, true);
  assert.equal(measured.storageFits, true);
  assert.equal(sample.writes.length, 0);
  const submitted = await sample.bridge.submit(sample.input);
  assert.equal(submitted.status, 'success');
  const delivered = sample.calls.find(call => call.method === 'POST');
  assert.equal(measured.bytes, Buffer.byteLength(delivered.body, 'utf8'), 'measurement and delivery use exactly the same HTTP body with Unicode data');
  assert.ok(measured.bytes > delivered.body.length, 'UTF-8 bytes are not JavaScript UTF-16 character count');
  assert.equal(JSON.parse(delivered.body).rows.length, 5);
  assert.equal(sample.storage[PENDING].length, 0, 'successful delivery retires its exact retained payload');
}

{
  const sample = fixture();
  const original = await sample.bridge.submit(sample.input);
  assert.equal(original.status, 'success');
  const retained = { ...original, syntheticRetainedEvidence: 'x'.repeat(Math.floor(9.8 * 1024 * 1024)) };
  sample.storage[PENDING] = [retained];
  const retried = await sample.bridge.retry(retained.resultDeliveryId);
  assert.equal(retried.status, 'success', 'a near-quota original payload can be retried without allocating a second copy');
  assert.equal(sample.storage[PENDING].length, 0);
}

for (const [name, mutate, code] of [
  ['different task', sample => { sample.input.collectionTask.taskId = 'ANOTHER'; }, 'ERP_TASK_ATTEMPT_STALE'],
  ['different attempt', sample => { sample.input.collectionTask.attemptId = 'OLD'; }, 'ERP_TASK_ATTEMPT_STALE'],
  ['different range', sample => { sample.input.querySkcs = ['OUTSIDE']; }, 'ERP_TASK_ATTEMPT_STALE'],
  ['different workspace', sample => { sample.task.workspaceId = 'OTHER'; }, 'ERP_WORKSPACE_CONTEXT_CHANGED'],
  ['stopped task', sample => { sample.task.status = 'stopped'; }, 'ERP_TASK_ATTEMPT_STALE'],
  ['pending range', sample => { sample.task.batches[0].status = 'pending'; }, 'ERP_TASK_ATTEMPT_STALE'],
  ['outside SKU', sample => { sample.input.results[0].mappings[0].platformSku = 'OUTSIDE'; }, 'ERP_PLATFORM_SCOPE_MISMATCH'],
  ['workspace changes during lookup', sample => { sample.afterTaskRead(() => { sample.storage.shopeersErpWorkspaceId = 'OTHER'; }); }, 'ERP_WORKSPACE_CONTEXT_CHANGED'],
]) {
  const sample = fixture(); mutate(sample);
  const measured = await sample.bridge.measureCost(sample.input);
  assert.equal(measured.ok, false, name);
  assert.equal(measured.code, code, name);
  assert.equal(sample.writes.length, 0, name);
  assert.ok(sample.calls.every(call => call.method === 'GET'), name);
}

{
  const sample = fixture();
  const untrusted = await sample.message('measureCostResult', sample.input, { url: 'https://untrusted.invalid/' });
  assert.equal(untrusted.code, 'ERP_UNTRUSTED_SENDER');
  assert.equal(sample.calls.length, 0);
  assert.equal(sample.writes.length, 0);
}

{
  const sample = fixture();
  const checkpointUpdatedAt = Date.now();
  sample.storage[CHECKPOINTS] = ['8.0.55', '8.0.56', '8.0.57', '8.0.58', '8.0.59', '8.0.60', '8.0.61', '8.0.28'].map(extensionVersion => ({
    schemaVersion: 1, extensionVersion, updatedAt: checkpointUpdatedAt, requestId: `SYNTHETIC-${extensionVersion}`, binding: `unchanged-${extensionVersion}`,
  }));
  const preserved = await sample.api.cleanCheckpoints();
  assert.deepEqual(Array.from(preserved, value => value.extensionVersion), ['8.0.55', '8.0.56', '8.0.57', '8.0.58', '8.0.59', '8.0.60', '8.0.61']);
  assert.ok(preserved.every(value => value.binding === `unchanged-${value.extensionVersion}`), 'upgrade keeps the exact original binding for later identity checks');
  sample.storage[CHECKPOINTS] = [{ ...preserved[2], requestId: 'REQ', workspaceId: 'WS', state: 'pending', binding: 'wrong-original-scope' }];
  const restored = await sample.message('collectionCheckpoint', { action: 'restore', requestId: 'REQ' });
  assert.equal(restored.code, 'ERP_CHECKPOINT_INVALID', 'version compatibility never authorizes a changed request snapshot');
}

console.log('ERP cost payload: exact expanded UTF-8 measurement without writes, oversized preflight rejection, normal delivery, sender/scope isolation and checkpoint upgrade passed.');
