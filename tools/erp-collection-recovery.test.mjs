import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const src = path.join(root, 'integrations/erp-assistant-extension/src');
const backgroundSource = await readFile(path.join(src, 'background.js'), 'utf8');
const checkpointKey = 'shopeersErpCollectionCheckpointsV1';
const sender = { url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html', frameId: 0 };
sender.tab = { url: sender.url };
const fresh = () => ({ requestId: 'ERP-REQ-RECOVERY', workspaceId: 'isolated-recovery', ledgerId: 'LEDGER-A', ledgerPeriod: '2026-08', registeredAt: '2026-08-01T00:00:00.000Z', status: 'registered', platformSkcs: ['SKC-A', 'SKC-B'], expectedSkus: [{ platformSkc: 'SKC-A', platformSku: 'SKU-A' }] });
const storage = { shopeersErpInboxBaseUrl: 'http://127.0.0.1:5397', shopeersErpInboxCapability: 'isolated-synthetic-capability-at-least-32-characters', shopeersErpWorkspaceId: 'isolated-recovery' };
let request = fresh();
function background() {
  const runtimeListeners = [];
  const chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(storage, key)).map(key => [key, structuredClone(storage[key])])); },
    async set(values) { Object.assign(storage, structuredClone(values)); },
  } }, runtime: { getManifest: () => ({ version: '8.0.29' }), onMessage: { addListener: fn => runtimeListeners.push(fn) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }, alarms: { create() {}, onAlarm: { addListener() {} } } };
  const context = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController, TextEncoder, crypto: { randomUUID, subtle: webcrypto.subtle }, setTimeout, clearTimeout, Date, Math, Promise, console, fetch: async raw => {
    if (new URL(raw).pathname === '/erp/v1/cost-results') return { ok: true, status: 202, json: async () => ({ deliveryId: 'SYN-DELIVERY', batchId: 'SYN-BATCH' }) };
    assert.equal(new URL(raw).pathname, '/erp/v1/requests');
    return { ok: true, status: 200, json: async () => ({ records: [request] }) };
  } });
  vm.runInContext(backgroundSource, context);
  return context.__SHOPEERS_ERP_BACKGROUND_TEST_API__;
}
// Names verified from the current official ERP form/searchArr and submit/sort
// handlers on 2026-10-06. Synthetic values only; include empty default fields,
// which used to block every normal form submit before its first purchase read.
const currentQueryFilters = {
  sku: 'SKC-A', limit: '50', storeId: 'STORE-A', queryRange: '1',
  createTimePeriod: '2026-08-01 - 2026-08-31', orderNo: '', supplierName: '',
  organizationName: '', createdBy: '', warehouseId: '0', paymentType: '0',
  paymentStatus: '0', purchaseStatus: '', exceptionSheetStatus: '2',
  tradeName: 'SYNTHETIC PRODUCT', inTransitTime: '3', exceptionHandlingStatus: '',
  emergencySign: '', purchasingPersonnel: '', accountName1688: '',
  storeAssociatedAccountName1688: '', suggestedPayment: '', orderType: '',
  buildType: '', mineableType: '', adjacentToTheSameSupplier: '0', sort: '0',
};
const capturedQueryUrl = 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?' + new URLSearchParams({ ...currentQueryFilters, page: '1' });
const input = async () => ({ requestSnapshot: (await api.previewContext({ querySkcs: [request.platformSkcs[0]], queryCapturedAt: '2026-09-01T00:00:00.000Z' }, sender)).requestSnapshot, action: 'save', requestId: request.requestId, filters: { ...currentQueryFilters, token: 'NEVER-PERSIST', password: 'NEVER-PERSIST', endpoint: 'https://invalid.example' }, queryCapturedAt: '2026-09-01T00:00:00.000Z', completedTargets: ['SKC-A', 'OTHER-SKC'], account: { cookie: 'NEVER-PERSIST' } });
let api = background();
const saved = await api.collectionCheckpoint((await input()), sender);
assert.equal(saved.ok, true);
assert.deepEqual([...saved.checkpoint.completedTargets], ['SKC-A']);
assert.equal(saved.checkpoint.accountState, 'unverified');
assert.ok(saved.checkpoint.resultDeliveryId.startsWith('ERP-RESULT-'));
assert.deepEqual(JSON.parse(JSON.stringify(saved.checkpoint.filters)), Object.fromEntries(Object.entries(currentQueryFilters).sort(([a], [b]) => a.localeCompare(b))));
assert.doesNotMatch(JSON.stringify(storage[checkpointKey]), /NEVER-PERSIST|cookie|token|password|endpoint/i);
await assert.rejects(api.collectionCheckpoint({ ...(await input()), filters: { sku: 'SKC-A', unknownScope: 'cannot-silently-drop' } }, sender), /尚未验证的条件/);
await assert.rejects(api.collectionCheckpoint({ action: 'restore', requestId: request.requestId, filters: { ...currentQueryFilters, tradeName: 'CHANGED' } }, sender), /查询条件已变化/);
await assert.rejects(api.collectionCheckpoint({ action: 'restore', requestId: request.requestId, filters: { ...currentQueryFilters, sort: '1' } }, sender), /查询条件已变化/);

// Recreate the actual background VM: no JS memory survives service worker restart.
api = background();
const restored = await api.collectionCheckpoint({ action: 'restore', requestId: request.requestId }, sender);
assert.equal(restored.checkpoint.resultDeliveryId, saved.checkpoint.resultDeliveryId, 'lost ACK/reopen keeps stable delivery identity');
assert.equal(restored.reuseEvidence, false, 'unknown account/history never authorizes cross-restart evidence reuse');
assert.equal(restored.checkpoint.accountState, 'unverified', 're-reading current-session data does not verify the original account');
assert.equal(restored.reason, 'original_account_unverified_current_session_reread');
assert.equal((await api.collectionCheckpoint({ action: 'list' }, sender)).records.length, 1);
await api.collectionCheckpoint({ ...(await input()), state: 'completed', resultDeliveryId: saved.checkpoint.resultDeliveryId }, sender);
const replacement = await api.collectionCheckpoint((await input()), sender);
assert.notEqual(replacement.checkpoint.resultDeliveryId, saved.checkpoint.resultDeliveryId);
await assert.rejects(api.collectionCheckpoint({ ...(await input()), state: 'completed', resultDeliveryId: saved.checkpoint.resultDeliveryId }, sender), /旧采集|检查点已失效/);
const pendingRecord = { workspaceId: request.workspaceId, resultDeliveryId: replacement.checkpoint.resultDeliveryId, createdAt: new Date().toISOString(), sourceMeta: { detailFailureCount: 0, mappingFailureCount: 0, orderCountMismatch: false } };
storage.shopeersErpPendingCostResultsV2 = [pendingRecord];
assert.equal((await api.collectionCheckpoint({ action: 'restore', requestId: request.requestId }, sender)).pendingDeliveryId, pendingRecord.resultDeliveryId, 'recovery retries the exact persisted payload before any new ERP reads');
await api.acknowledgeCheckpointDelivery(pendingRecord);
assert.equal(storage[checkpointKey][0].state, 'completed', 'background durable ACK retires task even if the content document closed');
const another = await api.collectionCheckpoint((await input()), sender);
await api.acknowledgeCheckpointDelivery(pendingRecord);
assert.equal(storage[checkpointKey][0].state, 'pending', 'late background ACK cannot retire replacement task');
await api.acknowledgeCheckpointDelivery({ ...pendingRecord, resultDeliveryId: another.checkpoint.resultDeliveryId, sourceMeta: { mappingFailureCount: 1 } });
assert.equal(storage[checkpointKey][0].state, 'pending');
assert.notEqual(storage[checkpointKey][0].resultDeliveryId, another.checkpoint.resultDeliveryId, 'partial ACK advances delivery identity without losing continuation');
storage.shopeersErpPendingCostResultsV2 = [];
await assert.rejects(api.collectionCheckpoint((await input()), { url: 'https://attacker.example/', tab: { url: sender.url } }), /只允许/);
await assert.rejects(api.collectionCheckpoint({ action: 'restore', requestId: request.requestId, filters: { sku: 'SKC-B' } }, sender), /查询条件已变化/);
for (const change of [r => { r.ledgerPeriod = '2026-09'; }, r => { r.platformSkcs.push('SKC-C'); }, r => { r.expectedSkus.push({ platformSkc: 'SKC-A', platformSku: 'SKU-NEW' }); }, r => { r.registeredAt = '2026-09-02T00:00:00.000Z'; }, r => { r.status = 'cancelled'; }, r => { r.ledgerId = 'LEDGER-REPLACED'; }]) {
  request = fresh(); await api.collectionCheckpoint((await input()), sender); change(request);
  await assert.rejects(api.collectionCheckpoint({ action: 'restore', requestId: request.requestId }, sender), /范围已变化或失效/);
  assert.equal(storage[checkpointKey].length, 0, 'invalidated checkpoints are deleted, not silently rebound');
}
request = fresh(); await api.collectionCheckpoint((await input()), sender);
storage.shopeersErpWorkspaceId = 'workspace-other';
assert.equal((await api.collectionCheckpoint({ action: 'list' }, sender)).records.length, 0);
await assert.rejects(api.collectionCheckpoint({ action: 'restore', requestId: request.requestId }, sender), /范围已变化或失效/);
storage.shopeersErpWorkspaceId = 'isolated-recovery';
await api.collectionCheckpoint((await input()), sender);
storage[checkpointKey][0].updatedAt = Date.now() - 24 * 60 * 60 * 1000 - 1;
assert.equal((await api.collectionCheckpoint({ action: 'list' }, sender)).records.length, 0);
await api.collectionCheckpoint((await input()), sender); storage[checkpointKey][0].extensionVersion = '8.0.27';
assert.equal((await api.collectionCheckpoint({ action: 'list' }, sender)).records.length, 0);

for (let i = 0; i < 10; i++) { request = { ...fresh(), requestId: `REQ-${i}` }; await api.collectionCheckpoint((await input()), sender); }
assert.equal(storage[checkpointKey].length, 8);
request = fresh();
request.platformSkcs = Array.from({ length: 5000 }, (_, i) => `SYN-SKC-${String(i).padStart(8, '0')}`);
request.expectedSkus = request.platformSkcs.map((skc, i) => ({ platformSkc: skc, platformSku: `SYN-SKU-${String(i).padStart(8, '0')}` }));
const largeInput = { ...(await input()), completedTargets: request.platformSkcs };
const started = performance.now();
await api.collectionCheckpoint(largeInput, sender);
const bytes = Buffer.byteLength(JSON.stringify(storage[checkpointKey]));
assert.ok(bytes <= 1024 * 1024);
console.log(JSON.stringify({ checkpointTargets: 5000, storedUtf8Bytes: bytes, saveMs: Math.round(performance.now() - started), ttlHours: 24, maxTasks: 8, byteLimit: 1024 * 1024 }));
request = { ...fresh(), requestId: 'SYN-OVERSIZED', platformSkcs: Array.from({ length: 10000 }, (_, i) => 'SYN-LONG-SKC-' + 'X'.repeat(60) + i) };
request.expectedSkus = request.platformSkcs.map((skc, i) => ({ platformSkc: skc, platformSku: 'SYN-SKU-' + i }));
await assert.rejects(api.collectionCheckpoint({ ...(await input()), completedTargets: request.platformSkcs }, sender), /空间上限/);
assert.ok(Buffer.byteLength(JSON.stringify(storage[checkpointKey])) <= 1024 * 1024, 'oversized task is rejected instead of trimming its necessary target scope');

// Real production content/bridge against the real checkpoint background logic.
// Closing both window + background and retaining only chrome.storage.local models
// refresh, tab close/reopen and browser restart without touching any user profile.
storage[checkpointKey] = []; request = fresh();
async function page({ cancel = false, mappingIncomplete = false } = {}) {
  api = background();
  const window = new Window({ url: sender.url });
  const reads = [], deliveries = [];
  window.chrome = { runtime: { sendMessage(message, done) {
    const type = message.type;
    if (type === 'shopeers.erp.collectionCheckpoint') { api.collectionCheckpoint(message.payload, sender).then(done, error => done({ ok: false, message: error.message })); return; }
    if (type === 'shopeers.erp.previewContext') { api.previewContext(message.payload, sender).then(done, error => done({ ok: false, message: error.message })); return; }
    if (type === 'shopeers.erp.submitCostResult') { deliveries.push(structuredClone(message.payload)); api.submitCostResult(message.payload, sender).then(done, error => done({ ok: false, message: error.message })); return; }
    done(type === 'shopeers.erp.catalogContext' ? { ok: false } : { ok: true });
  } } };
  window.fetch = async raw => {
    const url = new URL(raw), name = url.pathname.split('/').at(-1), sku = url.searchParams.get('sku');
    reads.push({ name, sku });
    if (name === 'purchase-order-page') {
      assert.equal(url.searchParams.get('storeId'), 'STORE-A', 'selected store remains bounded');
      assert.equal(url.searchParams.get('queryRange'), '0', 'official cost reads the full target history');
      for (const key of ['createTimePeriod', 'tradeName', 'exceptionSheetStatus', 'inTransitTime', 'mineableType', 'buildType', 'sort']) assert.equal(url.searchParams.has(key), false, key + ' cannot silently restrict complete target history');
    }
    if (cancel && name === 'purchase-order-page' && sku === 'SKC-B') {
      window.document.getElementById('erpa-cancel').click();
      return new Promise(() => {});
    }
    const data = name === 'purchase-order-page' ? [{ purchaseOrderId: sku + '-ORDER' }] : name === 'purchase-order-details' ? [{ purchaseOrderDetailId: url.searchParams.get('purchaseOrderId'), itemId: url.searchParams.get('purchaseOrderId').startsWith('SKC-A') ? 'WH-A' : 'WH-B', creationTime: '2026-08-20 12:00:00', purchaseQuantity: 2, purchaseUnitPrice: 4 }] : [{ associatedProductId: url.searchParams.get('productId'), barcodeSkuid: url.searchParams.get('productId') === 'WH-A' ? 'SKU-A' : 'SKU-B', barcodeSkcid: url.searchParams.get('productId') === 'WH-A' ? 'SKC-A' : 'SKC-B' }];
    return { ok: true, status: 200, json: async () => ({ code: 0, count: mappingIncomplete && name === 'product-info-sku' ? data.length + 1 : data.length, data }) };
  };
  for (const file of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) window.eval(await readFile(path.join(src, file), 'utf8'));
  return { window, reads, deliveries };
}
const waitFor = async predicate => { const until = Date.now() + 5000; while (!predicate()) { if (Date.now() > until) throw Error('Recovery wait timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };
const first = await page({ cancel: true });
first.window.dispatchEvent(new first.window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: capturedQueryUrl } }));
first.window.document.getElementById('erpa-cost-trigger').click();
await waitFor(() => first.reads.some(item => item.sku === 'SKC-B'));
assert.equal(first.deliveries.length, 0);
assert.ok(first.window.document.getElementById('erpa-task-status').textContent.includes('待继续'));
const identity = storage[checkpointKey][0].resultDeliveryId;
await first.window.happyDOM.close();
for (const lifecycle of ['refresh', 'reopen', 'browser-restart']) {
  const next = await page({ cancel: lifecycle !== 'browser-restart' });
  await waitFor(() => !next.window.document.getElementById('erpa-resume').hidden);
  assert.match(next.window.document.getElementById('erpa-task-status').textContent, /原账号未验证/);
  next.window.document.getElementById('erpa-cost-trigger').click();
  assert.equal(next.reads.length, 0, 'reopen offers explicit continuation without issuing collection');
  next.window.document.getElementById('erpa-resume').click();
  await waitFor(() => next.reads.some(item => item.sku === 'SKC-B'));
  assert.equal(next.reads.find(item => item.name === 'purchase-order-page').sku, 'SKC-A', 'unknown identity rereads even previously complete targets');
  if (lifecycle === 'browser-restart') {
    await waitFor(() => next.deliveries.length === 1 && storage[checkpointKey][0].state === 'completed');
    assert.equal(next.deliveries[0].resultDeliveryId, identity);
    assert.equal(next.deliveries[0].meta.orderCount, 2);
    assert.ok(next.deliveries[0].warehouseEvidence.warehouses.every(item => item.evidenceComplete));
    assert.ok(next.window.document.getElementById('erpa-task-status').textContent.includes('已送达'));
    assert.equal((await api.collectionCheckpoint({ action: 'list' }, sender)).records.length, 0);
  }
  await next.window.happyDOM.close();
}
storage[checkpointKey] = [];
const partial = await page({ mappingIncomplete: true });
partial.window.dispatchEvent(new partial.window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: capturedQueryUrl } }));
partial.window.document.getElementById('erpa-cost-trigger').click();
await waitFor(() => partial.deliveries.length === 1 && partial.window.document.getElementById('erpa-task-status').textContent.includes('证据未齐'));
assert.equal(storage[checkpointKey][0].state, 'pending', 'partial ACK must preserve the task for continuation');
assert.notEqual(storage[checkpointKey][0].resultDeliveryId, partial.deliveries[0].resultDeliveryId, 'a fuller retry cannot reuse the immutable acknowledged partial payload identity');
await partial.window.happyDOM.close();
console.log('ERP recovery: real background restart/storage isolation, invalidation, bounded retention, credentials exclusion, refresh/reopen/restart, cancellation, explicit continuation and stable ACK identity passed');
