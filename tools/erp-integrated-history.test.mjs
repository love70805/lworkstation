import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')));
const { createInboxServiceController, requestJson } = require('../desktop/inbox-service.cjs');
const source = process.env.ERP_TEST_SOURCE_ROOT || path.join(root, 'integrations/erp-assistant-extension/src');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-integrated-history-'));
assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
assert.ok(path.basename(directory).startsWith('erp-integrated-history-'));
const port = 32000 + Math.floor(Math.random() * 10000), capability = 'synthetic-history-integration-capability-0123456789';
const controller = createInboxServiceController({ executable: process.execPath,
  scriptPath: process.env.ERP_TEST_INBOX_SCRIPT || path.join(root, 'tools/erp-inbox-server.mjs'),
  spoolPath: path.join(directory, 'inbox.json'), port, capability, pollIntervalMs: 100 });
const until = async check => { const end = Date.now() + 15000; while (!await check()) { if (Date.now() > end) throw Error('Integrated ERP history test timed out'); await new Promise(resolve => setTimeout(resolve, 20)); } };
const senderUrl = 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html';
const sender = { url: senderUrl, tab: { url: senderUrl }, frameId: 0 };
try {
  await controller.start(); await until(() => controller.getState().status === 'online');
  for (const onlyHistory of [false, true]) {
    const workspaceId = onlyHistory ? 'ONLY-HISTORY' : 'MIXED-HISTORY';
    const expectedSkus = [
      ...(!onlyHistory ? [{ platformSku: 'SKU-LIVE', platformSkc: 'SKC-LIVE', store: '甲店' }] : []),
      { platformSku: 'SKU-HISTORY', platformSkc: 'SKC-HISTORY', store: '甲店' },
    ];
    const historyMappings = [{ platformSku: 'SKU-HISTORY', platformSkc: 'SKC-HISTORY', warehouseSku: 'WH-HISTORY',
      sourceRecordId: 'OLD-ROW', sourceBatchId: 'OLD-BATCH', observedAt: '2026-09-01T00:00:00Z' }];
    const request = { id: `REQ-${workspaceId}`, workspaceId, ledgerId: `LEDGER-${workspaceId}`, ledgerPeriod: '2026-09',
      platformSkcs: expectedSkus.map(row => row.platformSkc), expectedSkus, historyRecoveryVersion: 1, historyMappings };
    const registered = await requestJson({ port, capability, path: '/erp/v1/requests', method: 'POST', body: { request, expectedSkus } });
    assert.equal(registered.statusCode, 202);
    const storage = { shopeersErpInboxBaseUrl: `http://127.0.0.1:${port}`, shopeersErpInboxCapability: capability, shopeersErpWorkspaceId: workspaceId };
    let listener; const responses = [], reads = [];
    const chrome = { storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in storage).map(key => [key, structuredClone(storage[key])])); },
      async set(values) { Object.assign(storage, structuredClone(values)); },
    } }, runtime: { getManifest: () => ({ version: '8.0.48' }), onMessage: { addListener: callback => { listener = callback; } },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} } }, alarms: { create() {}, onAlarm: { addListener() {} } } };
    const context = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController,
      TextEncoder, crypto: webcrypto, setTimeout, clearTimeout, console, fetch });
    vm.runInContext(await fs.readFile(path.join(source, 'background.js'), 'utf8'), context);
    const window = new Window({ url: senderUrl });
    window.chrome = { runtime: { lastError: null, sendMessage(message, callback) {
      listener(message, sender, result => { responses.push({ type: message.type, result }); callback(result); });
    } } };
    window.fetch = async raw => {
      const url = new URL(raw), endpoint = url.pathname.split('/').at(-1); reads.push(url);
      let data = [];
      if (endpoint === 'product-page') data = url.searchParams.get('skuGroup') === 'SKC-LIVE' ? [{ itemId: 'WH-LIVE', tradeName: '合成商品' }] : [];
      else if (endpoint === 'product-info-sku') data = [{ associatedProductId: 'WH-LIVE', barcodeSkuid: 'SKU-LIVE', barcodeSkcid: 'SKC-LIVE' }];
      else if (endpoint === 'purchase-order-page') {
        assert.equal(url.searchParams.get('queryRange'), '0');
        assert.equal(url.searchParams.get('changePrice'), null, 'full history removes the captured price-change filter');
        assert.ok(['SKC-LIVE', 'SKC-HISTORY', 'WH-HISTORY'].includes(url.searchParams.get('sku')));
        data = [{ purchaseOrderId: 'SHARED-ORDER', purchaseOrderNo: 'SYNTHETIC-ORDER', purchaseTime: '2026-09-20', purchaseStatus: '7' }];
      } else if (endpoint === 'purchase-order-details') data = ['WH-LIVE', 'WH-HISTORY', 'UNRELATED'].map((itemId, index) => ({
        itemId, purchaseOrderDetailId: `DETAIL-${index}`, purchaseOrderId: 'SHARED-ORDER', creationTime: '2026-09-20',
        purchaseQuantity: '2', purchaseUnitPrice: '3.5000', tradeName: '合成商品',
      }));
      else throw Error(`Unexpected ERP endpoint: ${endpoint}`);
      return { ok: true, status: 200, json: async () => ({ code: 0, count: data.length, data }) };
    };
    try {
      for (const file of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) window.eval(await fs.readFile(path.join(source, file), 'utf8'));
      assert.equal(window.document.getElementById('erpa-history-trigger'), null);
      const filters = { page: '1', limit: '50', sku: request.platformSkcs.join(','), queryRange: '1', changePrice: onlyHistory ? '' : '1' };
      window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: {
        url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?' + new URLSearchParams(filters),
      } }));
      window.document.getElementById('erpa-cost-trigger').click();
      await until(() => responses.some(item => item.type === 'shopeers.erp.submitCostResult' && item.result.status === 'success')
        || window.document.getElementById('erpa-error').classList.contains('erpa-visible'));
      const errorText = window.document.getElementById('erpa-error-message').textContent;
      assert.ok(responses.some(item => item.type === 'shopeers.erp.submitCostResult' && item.result.status === 'success'), errorText);
      await until(() => responses.some(item => item.type === 'shopeers.erp.collectionTask' && item.result.task?.status === 'partial'));
      const snapshot = await controller.maintenanceRequest({ action: 'begin' });
      await controller.maintenanceRequest({ action: 'end', maintenanceId: snapshot.maintenanceId });
      const task = snapshot.snapshot.records.find(record => record.kind === 'collection-task' && record.workspaceId === workspaceId);
      assert.equal(task.filters.changePrice, filters.changePrice, 'the saved task retains the exact captured condition');
      const delivery = snapshot.snapshot.records.find(record => record.kind === 'batch' && record.workspaceId === workspaceId);
      assert.ok(delivery);
      const batch = delivery.envelope.batch;
      assert.equal(batch.historyMappings[0].warehouseSku, 'WH-HISTORY');
      assert.deepEqual(batch.rows.filter(row => row.platformSku).map(row => row.platformSku), onlyHistory ? [] : ['SKU-LIVE']);
      assert.ok(batch.rows.some(row => !row.platformSku && row.warehouseSku === 'WH-HISTORY'));
      assert.ok(!batch.rows.some(row => row.warehouseSku === 'UNRELATED'));
      const history = batch.warehouseEvidence.find(row => row.warehouseSku === 'WH-HISTORY');
      assert.equal(history.evidenceComplete, true); assert.equal(history.purchaseRecords.length, 1);
      assert.equal(reads.filter(url => url.pathname.endsWith('purchase-order-details')).length, 1, 'shared details are read once');
      assert.equal(reads.filter(url => url.pathname.endsWith('purchase-order-page') && url.searchParams.get('sku') === 'WH-HISTORY').length, 1);
      const api = context.__SHOPEERS_ERP_BACKGROUND_TEST_API__;
      await assert.rejects(api.collectionTask({ action: 'control', taskId: task.taskId, control: 'request_resume',
        filters: { ...task.filters, changePrice: 'changed' } }, sender), error => error.code === 'ERP_TASK_SCOPE_CHANGED');
      await assert.rejects(api.collectionTask({ action: 'create', requestId: request.id, filters: { ...task.filters, unsupportedField: 'PRIVATE' } }, sender),
        error => error.code === 'ERP_CHECKPOINT_QUERY_UNSUPPORTED' && error.message.includes('unsupportedField') && !error.message.includes('PRIVATE'));
      console.log(`Integrated history ${onlyHistory ? 'only' : 'mixed'}: real background, durable HTTP task, exact changePrice, scoped history evidence and no automatic historical mapping passed`);
    } finally { await window.happyDOM.close(); }
  }
} finally {
  await controller.stop({ wait: true });
  await fs.rm(directory, { recursive: true, force: true });
}
