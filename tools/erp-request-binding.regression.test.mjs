import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';

const source = await readFile(new URL('../integrations/erp-assistant-extension/src/background.js', import.meta.url), 'utf8');
const sender = { url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html', frameId: 0 };
sender.tab = { id: 1, url: sender.url };
const queryCapturedAt = new Date().toISOString();
const checkpointKey = 'shopeersErpCollectionCheckpointsV1';
function fixture() {
  let records = [{ requestId: 'ERP-REQ-REGRESSION', workspaceId: 'REGRESSION-A', ledgerId: 'LEDGER-A', ledgerPeriod: '2026-08',
    status: 'registered', registeredAt: '2026-08-01T00:00:00.000Z', version: 1, platformSkcs: ['SKC-A'],
    expectedSkus: [{ platformSkc: 'SKC-A', platformSku: 'SKU-A' }] }];
  const storage = { shopeersErpInboxBaseUrl: 'http://127.0.0.1:5397', shopeersErpInboxCapability: 'synthetic-regression-capability-at-least-32-characters', shopeersErpWorkspaceId: 'REGRESSION-A' };
  const posts = [];
  const chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(storage, key)).map(key => [key, structuredClone(storage[key])])); },
    async set(values) { Object.assign(storage, structuredClone(values)); },
  } }, runtime: { getManifest: () => ({ version: '8.0.28' }), onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }, alarms: { create() {}, onAlarm: { addListener() {} } } };
  const context = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController, TextEncoder,
    crypto: { randomUUID, subtle: webcrypto.subtle }, setTimeout, clearTimeout, Date, Math, Promise, console,
    fetch: async (raw, init = {}) => {
      const url = new URL(raw);
      assert.equal(url.origin, 'http://127.0.0.1:5397', 'no real ERP or external network is used');
      if (url.pathname === '/erp/v1/requests') return { ok: true, status: 200, json: async () => ({ records: structuredClone(records) }) };
      assert.equal(url.pathname, '/erp/v1/cost-results');
      assert.equal(init.method, 'POST');
      posts.push(JSON.parse(init.body));
      return { ok: true, status: 202, json: async () => ({ deliveryId: 'SYN-DELIVERY', batchId: 'SYN-BATCH' }) };
    },
  });
  vm.runInContext(source, context);
  const api = context.__SHOPEERS_ERP_BACKGROUND_TEST_API__;
  const preview = () => api.previewContext({ querySkcs: ['SKC-A'], queryCapturedAt }, sender);
  const save = snapshot => api.collectionCheckpoint({ action: 'save', requestId: snapshot.requestId,
    requestSnapshot: snapshot.requestSnapshot, filters: { sku: 'SKC-A' }, queryCapturedAt, completedTargets: [] }, sender);
  const input = resultDeliveryId => ({ resultDeliveryId, querySkcs: ['SKC-A'], queryCapturedAt,
    createdAt: new Date().toISOString(),
    results: [{ warehouseSku: 'WAREHOUSE-A', totalQty: 2, unitCost: 4,
      mappings: [{ platformSkc: 'SKC-A', platformSku: 'SKU-A' }] }],
    warehouseEvidence: { formatVersion: 2, warehouses: [{ warehouseSku: 'WAREHOUSE-A', evidenceComplete: true,
      purchaseRecords: [{ quantity: 2, unitPrice: 4 }], excludedRecords: [], sourceWarnings: [] }],
      excludedOrders: [], excludedDetails: [], detailFailures: [], mappingFailures: [] },
    meta: { orderCountMismatch: false, detailFailureCount: 0, mappingFailureCount: 0 },
  });
  return { api, storage, posts, preview, save, input, change: patch => { records = [{ ...records[0], ...patch }]; } };
}
async function blocked(operation, test, label) {
  let outcome;
  try { outcome = await operation(); } catch (error) { outcome = { ok: false, code: error.code }; }
  assert.equal(outcome?.ok, false, `${label}: operation must fail closed`);
  assert.match(outcome?.code || '', /^ERP_(?:CHECKPOINT|COLLECTION|WORKSPACE|REQUEST)_/, `${label}: explicit scope error`);
  assert.equal(test.posts.length, 0, `${label}: no cost result is sent`);
  assert.equal((test.storage.shopeersErpPendingCostResultsV2 || []).length, 0, `${label}: no new payload is queued under a changed request`);
}

const changes = [
  ['month', { ledgerPeriod: '2026-09', ledgerId: 'LEDGER-SEPTEMBER' }],
  ['request revision', { version: 2 }],
  ['registered target set', { platformSkcs: ['SKC-A', 'SKC-B'] }],
  ['expected SKU set', { expectedSkus: [{ platformSkc: 'SKC-A', platformSku: 'SKU-CHANGED' }] }],
];
for (const [name, patch] of changes) {
  const beforeSave = fixture();
  const snapshot = await beforeSave.preview();
  beforeSave.change(patch);
  await blocked(() => beforeSave.save(snapshot), beforeSave, `preview to first save: ${name}`);

  const beforeSubmit = fixture();
  const initial = await beforeSubmit.preview();
  const saved = await beforeSubmit.save(initial);
  assert.equal(saved.ok, true);
  beforeSubmit.change(patch);
  await blocked(() => beforeSubmit.api.submitCostResult(beforeSubmit.input(saved.checkpoint.resultDeliveryId), sender), beforeSubmit, `saved task to first submit: ${name}`);
}

for (const state of ['missing', 'expired']) {
  const test = fixture(), snapshot = await test.preview(), saved = await test.save(snapshot);
  if (state === 'missing') test.storage[checkpointKey] = [];
  else test.storage[checkpointKey][0].updatedAt = Date.now() - 25 * 60 * 60 * 1000;
  await blocked(() => test.api.submitCostResult(test.input(saved.checkpoint.resultDeliveryId), sender), test, `${state} binding cannot rematch`);
}

const valid = fixture(), validSnapshot = await valid.preview(), validSaved = await valid.save(validSnapshot);
const delivered = await valid.api.submitCostResult({ ...valid.input(validSaved.checkpoint.resultDeliveryId), workspaceId: 'FORGED', ledgerId: 'FORGED', requestId: 'FORGED' }, sender);
assert.equal(delivered.ok, true, 'unchanged controlled request still succeeds');
assert.equal(valid.posts.length, 1);
assert.equal(valid.posts[0].workspaceId, 'REGRESSION-A');
assert.equal(valid.posts[0].ledgerId, 'LEDGER-A');
assert.equal(valid.posts[0].requestId, 'ERP-REQ-REGRESSION');
assert.equal(valid.posts[0].rows[0].unitCost, 4);
console.log('ERP request binding regression: preview/save/submit scope changes, missing/expired binding and unchanged delivery passed (11 isolated scenarios).');
