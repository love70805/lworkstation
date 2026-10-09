import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { handleCollectionTaskRequest, validateCollectionDelivery, recordCollectionDelivery } from './erp-collection-tasks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const names = ['background.js', 'catalog-collector.js', 'result-policy.js', 'request-context.js', 'shopeers-bridge.js', 'content.js'];
const sources = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(path.join(root, 'integrations/erp-assistant-extension/src', name), 'utf8')])));
const version = JSON.parse(await readFile(path.join(root, 'integrations/erp-assistant-extension/manifest.json'), 'utf8')).version;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sender = { url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html', frameId: 0 };

async function scenario(mode) {
  const skcs = Array.from({ length: 21 }, (_, i) => 'SKC-' + i);
  const request = { kind: 'request', requestId: 'RESILIENCE', workspaceId: 'WS', ledgerId: 'LEDGER', ledgerPeriod: '2026-09',
    registeredAt: new Date(Date.now() - 60000).toISOString(), status: 'registered', platformSkcs: skcs,
    expectedSkus: skcs.map((platformSkc, i) => ({ platformSkc, platformSku: 'SKU-' + i, store: '测试店铺' })) };
  const records = [request], deliveries = [], calls = [], counters = new Map();
  const storage = { shopeersErpInboxBaseUrl: 'http://127.0.0.1:5198', shopeersErpInboxCapability: 'SYNTHETIC-RESILIENCE-CAPABILITY-0123456789', shopeersErpWorkspaceId: 'WS' };
  let dispatch, healthy = false, releaseResume, holdResume = false;
  const chrome = { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(storage[key])])), set: async values => Object.assign(storage, structuredClone(values)) } },
    runtime: { getManifest: () => ({ version }), onMessage: { addListener: callback => { dispatch = callback; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }, alarms: { create() {}, onAlarm: { addListener() {} } } };
  const context = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout, console,
    fetch: async (raw, init = {}) => {
      const url = new URL(raw), payload = init.body ? JSON.parse(init.body) : {};
      try {
        let body = handleCollectionTaskRequest(records, { method: init.method || 'GET', url, payload, instanceId: 'TEST' })?.body;
        if (!body && url.pathname.endsWith('/requests')) body = { records: [request] };
        if (!body && url.pathname.endsWith('/extension-status')) body = { ok: true };
        if (!body && url.pathname.endsWith('/catalog-requests')) body = { records: [] };
        if (!body && url.pathname.endsWith('/cost-results')) {
          const identity = validateCollectionDelivery(records, payload);
          body = { deliveryId: 'D-' + deliveries.length, batchId: 'B-' + deliveries.length, resultDeliveryId: payload.resultDeliveryId };
          recordCollectionDelivery(identity, { ...body, evidenceComplete: payload.warehouseEvidence.warehouses.every(row => row.evidenceComplete) && !payload.sourceMeta.mappingFailureCount });
          deliveries.push(structuredClone({ ...payload, ...body }));
        }
        if (!body) throw new Error('Unexpected isolated endpoint: ' + url.pathname);
        return { ok: true, status: 200, json: async () => structuredClone(body) };
      } catch (error) { return { ok: false, status: error.status || 400, json: async () => ({ code: error.code, message: error.message }) }; }
    } });
  vm.runInContext(sources['background.js'], context);
  const window = new Window({ url: sender.url });
  const until = async check => { const end = Date.now() + 12000; while (!check()) { if (Date.now() > end) throw new Error(mode + ': ' + window.document.body.textContent.slice(0, 2200)); await delay(5); } };
  const warehouse = id => 'WH-' + (mode === 'persistent-directory' && healthy && id === '0' ? 'NEW-' : '') + id;
  window.chrome = { runtime: { sendMessage: (message, done) => dispatch(message, sender, done) } };
  window.fetch = async raw => {
    const url = new URL(raw), endpoint = url.pathname.split('/').at(-1);
    const target = url.searchParams.get('skuGroup') || url.searchParams.get('productId') || url.searchParams.get('sku') || url.searchParams.get('purchaseOrderId');
    const id = target.split('-').at(-1), callKey = endpoint + ':' + target;
    counters.set(callKey, (counters.get(callKey) || 0) + 1); calls.push({ endpoint, target, page: Number(url.searchParams.get('page')) });
    if (endpoint === 'product-page' && id === '20' && mode.startsWith('outage') && !healthy) {
      if (mode === 'outage-html') return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<h1>服务器维护中</h1>' };
      if (mode === 'outage-json') return { ok: true, status: 200, json: async () => ({ code: 503, msg: '系统维护，请稍后重试' }) };
      if (mode === 'outage-network') throw new TypeError('Failed to fetch');
      return { ok: false, status: 503, statusText: 'Service Unavailable', headers: { get: () => null } };
    }
    if (endpoint === 'product-page' && id === '20' && holdResume) {
      holdResume = false; await new Promise(resolve => { releaseResume = resolve; });
    }
    let body;
    if (endpoint === 'product-page') {
      const short = id === '0' && !healthy && (mode === 'persistent-directory' || mode === 'transient-directory' && counters.get(callKey) <= 2);
      body = { code: 0, count: short ? 2 : 1, data: Number(url.searchParams.get('page')) === 1 ? [{ itemId: warehouse(id) }] : [] };
    } else if (endpoint === 'product-info-sku') {
      body = mode === 'transient-mapping' && id === '0' && counters.get(callKey) === 1
        ? { code: 0, count: 0, data: '查询结果为空' }
        : { code: 0, count: 1, data: [{ associatedProductId: target, barcodeSkuid: 'SKU-' + id, barcodeSkcid: 'SKC-' + id }] };
    } else if (endpoint === 'purchase-order-page') body = { code: 0, count: 1, data: [{ purchaseOrderId: 'PO-' + id }] };
    else body = { code: 0, count: 1, data: [{ purchaseOrderDetailId: 'DETAIL-' + id, itemId: warehouse(id), creationTime: '2026-09-10', purchaseQuantity: 2, purchaseUnitPrice: 4 }] };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    for (const name of ['catalog-collector.js', 'result-policy.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) window.eval(sources[name]);
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-0' } }));
    window.document.getElementById('erpa-cost-trigger').click();
    const idle = () => !window.document.getElementById('erpa-recalculate').disabled;
    const task = () => records.find(record => record.kind === 'collection-task');
    if (mode.startsWith('outage')) {
      await until(() => task()?.status === 'paused' && idle());
      assert.equal(deliveries.length, 1); assert.equal(task().batches[0].status, 'delivered');
      assert.equal(task().batches[1].status, 'pending'); assert.equal(task().pauseReason.code, 'ERP_SERVICE_UNAVAILABLE');
      assert.match(window.document.getElementById('erpa-task-status').textContent, /ERP 服务暂不可用.*恢复后继续/);
      assert.equal(counters.get('product-page:SKC-20'), mode === 'outage-html' || mode === 'outage-json' ? 1 : 3);
      assert.equal(counters.get('purchase-order-page:SKC-20') || 0, 0);
      assert.equal(window.document.querySelectorAll('.erpa-result-row').length, 20);
      const originalReceipt = task().batches[0].deliveryId;
      healthy = true; holdResume = true;
      window.document.getElementById('erpa-resume').click();
      await until(() => releaseResume);
      assert.equal(window.document.querySelectorAll('.erpa-result-row').length, 20, 'resume preserves the completed preview while the next batch reads');
      releaseResume();
      await until(() => deliveries.length === 2 && idle());
      assert.equal(task().pauseReason, undefined); assert.equal(task().batches[0].deliveryId, originalReceipt);
      assert.equal(counters.get('purchase-order-page:SKC-0'), 1, 'recovery does not reread the completed cost batch');
      assert.equal(task().summary.delivered, 21);
    } else {
      await until(() => deliveries.length === 2 && idle());
      if (mode === 'persistent-directory') {
        assert.equal(task().batches[0].status, 'incomplete');
        assert.match(deliveries[0].sourceMeta.scopeDirectoryFailures[0].message, /product_count_mismatch/);
        assert.equal(deliveries[0].sourceMeta.scopeDirectoryComplete, false);
        assert.equal(counters.get('product-page:SKC-0'), 4, 'persistent omission is checked only twice, including page 2');
        assert.match(window.document.getElementById('erpa-statusbar').textContent, /整批仍有 1 批/);
        assert.doesNotMatch(window.document.getElementById('erpa-statusbar').textContent, /校验通过/);
        const old = deliveries[0]; healthy = true;
        window.document.getElementById('erpa-retry-batches').click();
        await until(() => deliveries.length === 3 && idle());
        assert.equal(task().batches[0].status, 'delivered');
        assert.notEqual(deliveries[2].collectionTask.attemptId, old.collectionTask.attemptId);
        assert.notEqual(deliveries[2].resultDeliveryId, old.resultDeliveryId);
        assert.equal(counters.get('purchase-order-page:SKC-20'), 1, 'retry does not reread the successful second batch');
        assert.throws(() => validateCollectionDelivery(records, old), /新尝试/);
        assert.equal(old.sourceMeta.scopeDirectoryComplete, false, 'old evidence remains unchanged');
        assert.equal(window.document.querySelectorAll('.erpa-result-row').length, 21, 'replacement does not leave an obsolete warehouse preview');
        assert.doesNotMatch(window.document.getElementById('erpa-table-body').textContent, /WH-0\b/);
        assert.match(window.document.getElementById('erpa-statusbar').textContent, /整批成本证据校验通过/);
      } else {
        assert.equal(task().batches[0].status, 'delivered');
        assert.equal(deliveries[0].sourceMeta.scopeRetrySkcCount, 1);
        assert.equal(counters.get('product-page:SKC-1'), 1, 'completed unrelated directory is not refreshed');
        assert.equal(counters.get('product-info-sku:WH-1'), 1, 'completed unrelated mapping is not refreshed');
        assert.equal(counters.get('product-info-sku:WH-0'), 2);
      }
    }
    // No catalog request is registered in this fixture: continuation does no
    // additional cost work and preserves preview even when every batch is sent.
    const before = window.document.querySelectorAll('.erpa-result-row').length;
    const costReads = calls.filter(call => call.endpoint === 'purchase-order-page').length;
    window.document.getElementById('erpa-resume').click();
    await until(() => idle()); await delay(25);
    assert.equal(window.document.querySelectorAll('.erpa-result-row').length, before);
    assert.equal(calls.filter(call => call.endpoint === 'purchase-order-page').length, costReads);
    console.log(JSON.stringify({ mode, ok: true, receipts: deliveries.length, previewRows: before, requests: calls.length }));
  } finally { releaseResume?.(); await window.happyDOM.close(); }
}

for (const mode of ['transient-directory', 'transient-mapping', 'persistent-directory', 'outage-html', 'outage-json', 'outage-http', 'outage-network']) await scenario(mode);
