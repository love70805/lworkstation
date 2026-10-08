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
const src = process.env.ERP_ASSISTANT_TEST_SRC ? path.resolve(process.env.ERP_ASSISTANT_TEST_SRC) : path.join(root, 'integrations/erp-assistant-extension/src');
const source = await readFile(path.join(src, 'background.js'), 'utf8');
const key = 'shopeersErpCollectionCheckpointsV1';
const pendingKey = 'shopeersErpPendingCostResultsV2';
const sender = { url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html', frameId: 0 };
const request = (suffix = 'A') => ({ requestId: 'ERP-REQ-' + suffix, workspaceId: 'workspace-' + suffix, ledgerId: 'LEDGER-' + suffix, ledgerPeriod: suffix === 'A' ? '2026-08' : '2026-09', registeredAt: new Date(Date.now() - 60000).toISOString(), status: 'registered', platformSkcs: ['SKC-A'], expectedSkus: [{ platformSkc: 'SKC-A', platformSku: 'SKU-A' }] });
function fixture() {
  const state = { records: [request(), request('B')], posts: [], failPost: false, failSave: false, messages: [] };
  state.storage = { shopeersErpInboxBaseUrl: 'http://127.0.0.1:5397', shopeersErpInboxCapability: 'SYNTHETIC-ONLY-CAPABILITY-0123456789', shopeersErpWorkspaceId: 'workspace-A' };
  const chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => Object.hasOwn(state.storage, k)).map(k => [k, structuredClone(state.storage[k])])); },
    async set(values) { if (state.failSave && values[key]?.length) throw Error('synthetic storage unavailable'); Object.assign(state.storage, structuredClone(values)); },
  } }, runtime: { getManifest: () => ({ version: '8.0.37' }), onMessage: { addListener(fn) { state.dispatch = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }, alarms: { create() {}, onAlarm: { addListener() {} } } };
  const context = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController, TextEncoder, crypto: { randomUUID, subtle: webcrypto.subtle }, setTimeout, clearTimeout, Date, Math, Promise, console, fetch: async (raw, init) => {
    const url = new URL(raw);
    // This suite deliberately exercises the legacy checkpoint protocol.
    if (url.pathname === '/erp/v1/collection-tasks') return { ok: true, status: 200, json: async () => ({ tasks: [] }) };
    if (url.pathname === '/erp/v1/requests') return { ok: true, status: 200, json: async () => ({ records: state.records.filter(r => r.workspaceId === url.searchParams.get('workspaceId')) }) };
    if (url.pathname === '/erp/v1/extension-status') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    assert.equal(url.pathname, '/erp/v1/cost-results');
    state.posts.push(JSON.parse(init.body));
    if (state.failPost) throw Error('synthetic lost ACK');
    return { ok: true, status: 202, json: async () => ({ deliveryId: 'DELIVERY-A', batchId: 'BATCH-A' }) };
  } });
  vm.runInContext(source.replace('const MAX_ATTEMPTS = 3;', 'const MAX_ATTEMPTS = 1;'), context);
  state.api = context.__SHOPEERS_ERP_BACKGROUND_TEST_API__;
  state.queryCapturedAt = new Date().toISOString();
  state.preview = () => state.api.previewContext({ querySkcs: ['SKC-A'], queryCapturedAt: state.queryCapturedAt }, sender);
  state.save = preview => state.api.collectionCheckpoint({ action: 'save', requestId: preview.requestId, requestSnapshot: preview.requestSnapshot, queryCapturedAt: state.queryCapturedAt, filters: { sku: 'SKC-A' }, completedTargets: [] }, sender);
  state.input = id => ({ resultDeliveryId: id, createdAt: new Date().toISOString(), queryCapturedAt: state.queryCapturedAt, querySkcs: ['SKC-A'], results: [{ warehouseSku: 'WH-A', unitCost: 4, totalQty: 2, mappings: [{ platformSkc: 'SKC-A', platformSku: 'SKU-A' }] }], warehouseEvidence: { formatVersion: 1, warehouses: [{ warehouseSku: 'WH-A', evidenceComplete: true, purchaseRecords: [{ recordId: 'ROW-A', quantity: 2, unitPrice: 4, purchaseDate: '2026-08-20' }] }], excludedOrders: [], excludedDetails: [], detailFailures: [], mappingFailures: [] }, meta: { orderCountMismatch: false, detailFailureCount: 0, mappingFailureCount: 0 } });
  state.submit = async input => { try { return await state.api.submitCostResult(input, sender); } catch (error) { return { ok: false, code: error.code, message: error.message }; } };
  return state;
}

async function verifyBackgroundBinding() {
  const switched = fixture();
  const saved = await switched.save(await switched.preview());
  switched.storage.shopeersErpWorkspaceId = 'workspace-B';
  const blocked = await switched.submit(switched.input(saved.checkpoint.resultDeliveryId));
  assert.equal(blocked.ok, false, 'switch after collection starts cannot rebind its first delivery to workspace B');
  assert.equal(switched.posts.length, 0);
  assert.equal(switched.storage[pendingKey]?.length || 0, 0);

  for (const mutate of [r => { r.ledgerPeriod = '2026-09'; }, r => { r.ledgerId = 'REPLACED'; }, r => { r.registeredAt = new Date().toISOString(); }, r => { r.expectedSkus.push({ platformSkc: 'SKC-A', platformSku: 'SKU-NEW' }); }]) {
    const beforeSave = fixture();
    const preview = await beforeSave.preview();
    mutate(beforeSave.records[0]);
    await assert.rejects(() => beforeSave.save(preview), /范围|快照|变化/, 'first save must retain the previewed registration');
    assert.equal(beforeSave.posts.length, 0);
    const beforeSubmit = fixture();
    const checkpoint = (await beforeSubmit.save(await beforeSubmit.preview())).checkpoint;
    mutate(beforeSubmit.records[0]);
    const rejected = await beforeSubmit.submit(beforeSubmit.input(checkpoint.resultDeliveryId));
    assert.equal(rejected.ok, false);
    assert.equal(beforeSubmit.posts.length, 0, 'changed registration cannot receive old collection evidence');
  }
  for (const state of ['missing', 'expired', 'completed']) {
    const f = fixture();
    const checkpoint = (await f.save(await f.preview())).checkpoint;
    if (state === 'missing') f.storage[key] = [];
    if (state === 'expired') f.storage[key][0].updatedAt = Date.now() - 86400001;
    if (state === 'completed') f.storage[key][0].state = 'completed';
    assert.equal((await f.submit(f.input(checkpoint.resultDeliveryId))).ok, false, state + ' task cannot initiate a delivery');
    assert.equal(f.posts.length, 0);
  }
  const normal = fixture();
  const normalId = (await normal.save(await normal.preview())).checkpoint.resultDeliveryId;
  const input = normal.input(normalId);
  assert.equal((await normal.submit(input)).ok, true);
  assert.equal(normal.storage[key][0].state, 'completed');
  assert.equal(normal.storage[pendingKey].length, 0);
  assert.equal((await normal.submit(input)).ok, true, 'the completed checkpoint recognizes its exact already-delivered payload');
  assert.equal(normal.posts.length, 1, 'a delivered duplicate uses the persisted receipt');
  const conflict = structuredClone(input); conflict.results[0].unitCost = 9;
  assert.equal((await normal.submit(conflict)).ok, false, 'delivered identity cannot accept altered evidence');

  const lost = fixture();
  const lostId = (await lost.save(await lost.preview())).checkpoint.resultDeliveryId;
  lost.failPost = true;
  assert.equal((await lost.submit(lost.input(lostId))).status, 'cached');
  assert.equal(lost.storage[pendingKey][0].requestId, 'ERP-REQ-A');
  lost.failPost = false;
  const changed = lost.input(lostId); changed.results[0].unitCost = 99;
  assert.equal((await lost.submit(changed)).ok, true, 'lost ACK replays the immutable retained payload');
  assert.deepEqual(lost.posts[1], lost.posts[0]);
}

async function verifyContentBinding() {
  for (const mode of ['save-failure', 'unbound-preview', 'normal', 'partial']) {
    const f = fixture();
    f.failSave = mode === 'save-failure';
    const window = new Window({ url: sender.url });
    const reads = [], errors = [];
    let incomplete = mode === 'partial';
    window.addEventListener('unhandledrejection', event => errors.push(event.reason));
    window.chrome = { runtime: { sendMessage(message, done) {
      f.messages.push(structuredClone(message));
      if (mode === 'unbound-preview' && message.type === 'shopeers.erp.previewContext') { done({ ok: false, message: 'no registered request' }); return; }
      f.dispatch(message, sender, done);
    } } };
    window.fetch = async raw => {
      const url = new URL(raw), endpoint = url.pathname.split('/').at(-1); reads.push(endpoint);
      const data = endpoint === 'purchase-order-page' ? [{ purchaseOrderId: 'ORDER-A' }] : endpoint === 'purchase-order-details' ? [{ purchaseOrderDetailId: 'ROW-A', itemId: 'WH-A', creationTime: '2026-08-20', purchaseQuantity: 2, purchaseUnitPrice: 4 }] : [{ associatedProductId: 'WH-A', barcodeSkuid: 'SKU-A', barcodeSkcid: 'SKC-A' }];
      return { ok: true, status: 200, json: async () => ({ code: 0, count: data.length + (incomplete && endpoint === 'product-info-sku' ? 1 : 0), data }) };
    };
    const until = async predicate => { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) throw Error(mode + ': ' + window.document.body.textContent); await new Promise(resolve => setTimeout(resolve, 5)); } };
    try {
      for (const file of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) window.eval(await readFile(path.join(src, file), 'utf8'));
      window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-A' } }));
      window.document.getElementById('erpa-cost-trigger').click();
      if (mode === 'save-failure') {
        await until(() => window.document.getElementById('erpa-error').classList.contains('erpa-visible'));
        assert.equal(reads.length, 0, 'first checkpoint failure stops collection before business reads');
        assert.equal(f.messages.some(m => m.type === 'shopeers.erp.submitCostResult'), false);
      } else if (mode === 'unbound-preview') {
        await until(() => !window.document.getElementById('erpa-export').disabled);
        assert.ok(window.document.getElementById('erpa-table-body').textContent.includes('WH-A'));
        assert.equal(f.messages.some(m => m.type === 'shopeers.erp.submitCostResult'), false, 'independent preview never creates a formal delivery without a saved request');
      } else {
        await until(() => f.posts.length === 1 && f.storage[pendingKey]?.length === 0 && !window.document.getElementById('erpa-recalculate').disabled);
        if (mode === 'partial') {
          assert.equal(f.storage[key][0].state, 'pending');
          assert.notEqual(f.storage[key][0].resultDeliveryId, f.posts[0].resultDeliveryId);
          incomplete = false;
          window.document.getElementById('erpa-resume').click();
          await until(() => f.posts.length === 2 && f.storage[key][0].state === 'completed');
          assert.notEqual(f.posts[0].resultDeliveryId, f.posts[1].resultDeliveryId);
        } else assert.equal(f.storage[key][0].state, 'completed');
        assert.match(window.document.getElementById('erpa-task-status').textContent, /已送达/);
      }
      assert.equal(f.posts.length, mode === 'save-failure' || mode === 'unbound-preview' ? 0 : mode === 'partial' ? 2 : 1);
      assert.deepEqual(errors, []);
    } finally { await window.happyDOM.close(); }
  }
}

export async function verifyErpCollectionBinding() {
  await verifyBackgroundBinding();
  await verifyContentBinding();
  console.log('ERP collection binding: first-submit workspace/registration races, missing/expired state, durable duplicate/lost ACK and real content/background checkpoint failures passed');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyErpCollectionBinding();
