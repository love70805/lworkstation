import assert from 'node:assert/strict';
import { collectionReply } from './fixtures/erp-content-checkpoint.mjs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, webcrypto } from 'node:crypto';

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsRoot, '..');
const sourceRoot = path.join(root, 'integrations/erp-assistant-extension/src');
const json = value => JSON.parse(JSON.stringify(value));
const run = () => ({ controller: new AbortController() });
const completeEvidence = warehouseSku => ({ warehouseSku, evidenceComplete: true, sourceWarnings: [], purchaseRecords: [0, 0.00001, 2, 3, 4].map((unitPrice, index) => ({ recordId: warehouseSku + ':' + index, warehouseSku, quantity: 2, unitPrice, purchaseDate: '2026-08-20', supplierName: '供应商甲', supplier1688Links: [{ type: 'product', url: 'https://detail.1688.com/offer/123456789012.html', supplierName: '供应商甲' }], selectedForPreview: false })), excludedRecords: [] });
const response = (code, data, count = data.length) => ({ code, count, data });
async function policyAndCollector() {
  const sandbox = { window: {}, URL, AbortController, setTimeout, clearTimeout };
  for (const file of ['result-policy.js', 'catalog-collector.js']) vm.runInNewContext(await readFile(path.join(sourceRoot, file), 'utf8'), sandbox, { filename: file });
  return { policy: sandbox.window.ShopeersErpResultPolicy, create: sandbox.window.ShopeersErpCatalogCollector.create };
}

export async function verifyErpCatalogCollection() {
  const { policy, create } = await policyAndCollector();
  const products = Array.from({ length: 205 }, (_, index) => ({ itemId: 'WH-' + index, tradeName: '目录商品' + index, picturesLinking: 'https://images.example.invalid/warehouse.jpg', supplierData: [{ supplierName: '供应商甲' }], productSellerId: index % 2 ? 'other-person' : 'current-person', platformSkuCost: 999, '7-daySales': 999, '30DaySales': 999 }));
  const calls = [];
  const cache = new Map();
  const evidenceReads = [];
  const reader = create({ policy, getCache: key => cache.get(key), setCache: (key, value) => cache.set(key, value), readWarehouseEvidence: async warehouseSku => { evidenceReads.push(warehouseSku); return completeEvidence(warehouseSku); }, apiGet: async (endpoint, params) => {
    calls.push({ endpoint, params });
    if (endpoint.endsWith('product-page')) {
      assert.equal(params.skuGroup, 'SKC-TARGET'); assert.equal(params.composite, 1); assert.equal(params.limit, 100);
      assert.deepEqual(Object.keys(params).sort(), ['composite', 'limit', 'page', 'skuGroup']);
      return response(0, products.slice((params.page - 1) * params.limit, params.page * params.limit), products.length);
    }
    assert.equal(endpoint, '/purchase/product/v1/product-info-sku');
    assert.deepEqual(Object.keys(params), ['productId'], 'the observed mapping endpoint has no paging parameters');
    return response(0, Array.from({ length: 128 }, (_, index) => ({ associatedProductId: params.productId, barcodeSkuid: index === 127 ? 'SKU-' + params.productId : 'FOREIGN-' + index, barcodeSkcid: index === 127 ? 'SKC-TARGET' : 'SKC-OTHER', barcodeAttributeSet: '蓝色 / 加厚', barcodePrimaryAttribute: 'ENCODED', storeId: 'STORE-ORIGIN', storeName: '店铺甲', barcodeImageLink: 'https://images.example.invalid/sku.jpg' })));
  } });
  const initial = { results: [{ warehouseSku: 'WH-0', unitCost: '4.2000', selectedRecordIds: ['WH-0:0'] }], warehouseEvidence: { warehouses: [completeEvidence('WH-0')] } };
  const collected = await reader.collect(['SKC-TARGET'], run(), initial);
  assert.equal(collected.coverage.directory.pageCount, 3);
  assert.equal(evidenceReads.length, 204, 'complete initial WH-0 evidence is reused without another history read');
  assert.equal(new Set(evidenceReads).size, evidenceReads.length, 'each warehouse is read only once');
  assert.equal(collected.results.length, 205, 'all unsold siblings from every product page remain');
  assert.equal(collected.results[0].unitCost, '4.2000', 'catalog metadata preserves existing cost fields');
  assert.equal(collected.results.every(result => result.mappings.length === 1 && result.mappings[0].platformSkc === 'SKC-TARGET'), true, 'shared warehouses do not widen the target SKC');
  assert.equal(collected.results[0].mappings[0].attribute, '蓝色 / 加厚');
  assert.equal(collected.results[0].catalogMappings.length, 1, 'unrelated shared-warehouse SKUs are not sent as catalog candidates');
  assert.equal(collected.coverage.mappings.recordCount, 205 * 128, 'complete mapping response coverage still records every inspected candidate');
  assert.equal(collected.results[0].mappings[0].storeId, 'STORE-ORIGIN');
  assert.equal(collected.warehouseEvidence.warehouses[0].purchaseRecords.length, 5, 'catalog evidence is not trimmed to the latest three');
  assert.equal(collected.warehouseEvidence.warehouses[0].purchaseRecords[1].unitPrice, 0.00001);
  assert.equal(collected.coverage.suppliers.state, 'complete');
  assert.doesNotMatch(JSON.stringify(collected), /other-person|current-person|platformSkuCost|7-daySales|30DaySales|ENCODED/);
  const productsCalls = calls.filter(call => call.endpoint.endsWith('product-page')).length;
  await reader.products('SKC-TARGET', run());
  assert.equal(calls.filter(call => call.endpoint.endsWith('product-page')).length, productsCalls, 'only count-complete product pages are cached');
  await reader.collect(['SKC-TARGET'], run());
  assert.equal(evidenceReads.length, 204, 'retry reuses completed warehouses including initially supplied evidence');
  await reader.collect(['SKC-TARGET'], { ...run(), ledgerPeriod: '2026-09' });
  assert.equal(evidenceReads.length, 409, 'a different month cannot reuse another scope\'s purchase evidence');

  const faultCases = [
    { name: 'repeated page', expected: 'product_page_not_advancing', request: async (_endpoint, params) => response(0, [{ itemId: 'WH-ONE' }], 2) },
    { name: 'short response', expected: 'product_count_mismatch', request: async (_endpoint, params) => response(0, params.page === 1 ? [{ itemId: 'WH-ONE' }] : [], 2) },
    { name: 'count drift', expected: 'product_count_changed', request: async (_endpoint, params) => response(0, [{ itemId: 'WH-' + params.page }], params.page === 1 ? 3 : 4) },
    { name: 'mid page failure', expected: 'synthetic_page_failure', request: async (_endpoint, params) => { if (params.page > 1) throw new Error('synthetic_page_failure'); return response(0, products.slice(0, 100), 101); } },
    { name: 'missing warehouse identity', expected: 'product_item_id_missing', request: async () => response(0, [{ tradeName: '缺映射' }], 1) },
  ];
  for (const fault of faultCases) {
    let writes = 0;
    const failed = create({ policy, readWarehouseEvidence: async () => {}, apiGet: fault.request, setCache: () => writes++ });
    const state = await failed.products('SKC-TARGET', run());
    assert.equal(state.complete, false, fault.name);
    assert.ok(state.reasons.includes(fault.expected), fault.name + ' keeps an explicit failure');
    assert.equal(writes, 0, fault.name + ' never caches an incomplete page set');
  }
  const mappings = [{ associatedProductId: 'WH-ONE', barcodeSkuid: 'SKU-ONE', barcodeSkcid: 'SKC-TARGET' }, { associatedProductId: 'WH-FOREIGN', barcodeSkuid: 'SKU-FOREIGN', barcodeSkcid: 'SKC-TARGET' }];
  const mismatched = create({ policy, readWarehouseEvidence: async () => {}, apiGet: async () => response(0, mappings, 3) });
  const mismatch = await mismatched.mappings('WH-ONE', run());
  assert.equal(mismatch.complete, false);
  assert.equal(mismatch.mappings.length, 1, 'available warehouse-matched mappings survive a partial response');
  const wrongWarehouse = create({ policy, readWarehouseEvidence: async () => {}, apiGet: async () => response(0, mappings) });
  assert.equal((await wrongWarehouse.mappings('WH-ONE', run())).reasons[0], 'mapping_warehouse_mismatch');

  const originalMappings = [{ platformSku: 'SKU-ONE', platformSkc: 'SKC-TARGET', warehouseSku: 'WH-ONE' }];
  const originalEvidence = completeEvidence('WH-ONE');
  const optional = create({ policy, apiGet: async endpoint => endpoint.endsWith('product-page') ? response(0, [{ itemId: 'WH-ONE', tradeName: '资料标题' }]) : response(0, [], 1), readWarehouseEvidence: async warehouseSku => ({ warehouseSku, evidenceComplete: false, sourceWarnings: ['detail_failure'], purchaseRecords: [], excludedRecords: [] }) });
  const preserved = await optional.collect(['SKC-TARGET'], run(), { results: [{ warehouseSku: 'WH-ONE', unitCost: '4.2000', selectedRecordIds: ['WH-ONE:0'], mappings: originalMappings, catalogMappings: originalMappings, catalogMappingsComplete: true }], warehouseEvidence: { warehouses: [originalEvidence] } });
  assert.equal(preserved.results[0].unitCost, '4.2000');
  assert.deepEqual(json(preserved.results[0].mappings), originalMappings, 'an incomplete supplemental mapping never replaces a complete original mapping');
  assert.deepEqual(json(preserved.warehouseEvidence.warehouses[0]), originalEvidence, 'an incomplete supplemental warehouse read never replaces complete cost evidence');
  assert.equal(preserved.coverage.purchaseEvidence.state, 'complete');
  assert.equal(preserved.coverage.mappings.state, 'complete');
  let sharedReads = 0, sharedMappings = 0;
  const shared = create({ policy, readWarehouseEvidence: async warehouseSku => { sharedReads++; return completeEvidence(warehouseSku); }, apiGet: async (endpoint, params) => {
    if (endpoint.endsWith('product-page')) return response(0, [{ itemId: 'SHARED' }]);
    sharedMappings++; return response(0, ['SKC-A', 'SKC-B'].map((skc, index) => ({ associatedProductId: 'SHARED', barcodeSkuid: 'SKU-' + index, barcodeSkcid: skc })));
  } });
  const siblings = await shared.collect(['SKC-A','SKC-B'], run());
  assert.equal(siblings.results.length, 1); assert.equal(siblings.results[0].mappings.length, 2);
  assert.equal(sharedReads, 1); assert.equal(sharedMappings, 1);
  console.log('ERP catalog collection: full 205-item/3-page and 128-map scope, page/count faults and optional cost preservation passed');
}

export async function verifyErpCatalogButtonAndCostPipeline() {
  const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
  const { Window } = await import(pathToFileURL(frontendRequire.resolve('happy-dom')).href);
  const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
  const messages = [];
  const fetched = [];
  window.chrome = { runtime: { lastError: null, sendMessage(message, callback) { messages.push(json(message)); callback(collectionReply(message) || (message.type === 'shopeers.erp.catalogContext' ? { ok: true, request: { requestId: 'CATALOG-CLICK', ledgerPeriod: '2026-08', platformSkcs: ['SKC-TARGET'] } } : { ok: true, status: 'success', resultDeliveryId: message.payload?.resultDeliveryId })); } } };
  window.fetch = async rawUrl => {
    const url = new URL(rawUrl); fetched.push(url);
    let body;
    if (url.pathname.endsWith('product-page')) body = response(0, [{ itemId: 'WH-ORIGINAL', tradeName: '目录原标题' }, { itemId: 'WH-AUX', tradeName: '无销量分支', productSellerId: 'other-person' }]);
    else if (url.pathname.endsWith('product-info-sku')) body = response(0, [{ associatedProductId: url.searchParams.get('productId'), barcodeSkuid: url.searchParams.get('productId') === 'WH-ORIGINAL' ? 'SKU-ORIGINAL' : 'SKU-AUX', barcodeSkcid: 'SKC-TARGET', barcodeAttributeSet: '可读属性' }, { associatedProductId: url.searchParams.get('productId'), barcodeSkuid: 'OTHER-PERSON-SKU', barcodeSkcid: 'SKC-FOREIGN' }]);
    else if (url.pathname.endsWith('purchase-order-page')) body = response(0, [{ purchaseOrderId: url.searchParams.get('sku') === 'WH-AUX' ? 'PO-AUX' : 'PO-ORIGINAL' }]);
    else if (url.pathname.endsWith('purchase-order-details') && url.searchParams.get('purchaseOrderId') === 'PO-AUX') body = response(1, [], 0);
    else if (url.pathname.endsWith('purchase-order-details')) body = response(0, [{ purchaseOrderDetailId: 'DETAIL-ORIGINAL', itemId: 'WH-ORIGINAL', tradeName: '采购原标题', creationTime: '2026-08-20 12:00:00', purchaseQuantity: '2', purchaseUnitPrice: '4', supplierName: '供应商甲' }]);
    else throw new Error('Unobserved endpoint ' + url.pathname);
    return { ok: true, json: async () => body };
  };
  try {
    for (const file of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) window.eval(await readFile(path.join(sourceRoot, file), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fetched.length, 0, 'loading the extension and its status heartbeat do not read ERP business data');
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-TARGET' } }));
    assert.equal(fetched.length, 0, 'capturing an existing query does not start catalog collection');
    window.document.getElementById('erpa-cost-trigger').click();
    for (let attempt = 0; attempt < 150 && !messages.some(message => message.type === 'shopeers.erp.submitCostResult'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    const cost = messages.find(message => message.type === 'shopeers.erp.submitCostResult')?.payload;
    assert.ok(cost, window.document.body.textContent);
    const original = cost.results.find(result => result.warehouseSku === 'WH-ORIGINAL');
    const evidence = cost.warehouseEvidence.warehouses.find(entry => entry.warehouseSku === 'WH-ORIGINAL');
    assert.equal(original.unitCost, '4.0000');
    assert.deepEqual(original.selectedRecordIds, ['DETAIL-ORIGINAL']);
    assert.equal(evidence.evidenceComplete, true);
    assert.equal(evidence.purchaseRecords[0].selectedForPreview, true);
    assert.equal(cost.meta.detailFailureCount, 0, 'auxiliary catalog detail failure does not alter original formal-cost completeness');
    assert.equal(cost.meta.mappingFailureCount, 0);
    assert.equal(cost.meta.catalogCoverage.purchaseEvidence.state, 'unavailable');
    assert.equal(cost.results.some(result => result.mappings.some(mapping => mapping.platformSkc === 'SKC-FOREIGN')), false);
    assert.equal(cost.results.some(result => result.warehouseSku === 'WH-AUX'), false, 'optional sibling is delivered on its independent channel');
    for (let attempt = 0; attempt < 100 && window.document.getElementById('erpa-supplement-catalog').disabled; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    const contextCalls = messages.filter(message => message.type === 'shopeers.erp.catalogContext').length;
    assert.equal(contextCalls, 1, 'optional catalog lookup follows cost dispatch');
    window.document.getElementById('erpa-supplement-catalog').click();
    for (let attempt = 0; attempt < 150 && !messages.some(message => message.type === 'shopeers.erp.submitCatalogResult'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    const catalog = messages.find(message => message.type === 'shopeers.erp.submitCatalogResult')?.payload;
    assert.ok(catalog, window.document.body.textContent);
    assert.equal(catalog.requestId, 'CATALOG-CLICK');
    assert.equal(messages.filter(message => message.type === 'shopeers.erp.submitCostResult').length, 1, 'catalog supplement does not submit monthly costs');
    assert.doesNotMatch(JSON.stringify(catalog), /other-person|OTHER-PERSON-SKU/);
    console.log('ERP explicit supplement button and real content pipeline: optional auxiliary detail failure preserves original cost/selection/evidence passed');
  } finally { await window.happyDOM.close(); }
}

export async function verifyErpCatalogBackgroundBinding() {
  const storage = { shopeersErpInboxBaseUrl: 'http://127.0.0.1:8790', shopeersErpInboxCapability: 'synthetic-only-capability-abcdefghijklmnopqrstuvwxyz', shopeersErpWorkspaceId: 'workspace-confirmed' };
  let requests = [{ requestId: 'COST-OTHER', requestKind: 'cost', workspaceId: 'workspace-confirmed', status: 'registered', platformSkcs: ['SKC-TARGET'], ledgerPeriod: '2026-08' }, { requestId: 'CATALOG-CONFIRMED', requestKind: 'catalog', workspaceId: 'workspace-confirmed', status: 'registered', platformSkcs: ['SKC-TARGET'], ledgerPeriod: '2026-08', ledgerId: null }];
  const posted = [];
  const chrome = { storage: { local: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(storage, key)).map(key => [key, json(storage[key])])); }, async set(values) { Object.assign(storage, json(values)); } } }, runtime: { getManifest: () => ({ version: '8.0.29' }), onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }, alarms: { create() {}, onAlarm: { addListener() {} } } };
  const sandbox = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController, crypto: { randomUUID, subtle: webcrypto.subtle }, setTimeout, clearTimeout, Date, Math, Promise, console: { info() {}, warn() {}, error() {} }, fetch: async (rawUrl, options) => {
    const url = new URL(rawUrl); assert.equal(url.hostname, '127.0.0.1', 'page-controlled destinations never leave loopback');
    if (url.pathname === '/erp/v1/requests') return { ok: true, status: 200, json: async () => ({ records: requests }) };
    assert.equal(url.pathname, '/erp/v1/catalog-results'); posted.push(JSON.parse(options.body)); return { ok: true, status: 202, json: async () => ({ deliveryId: 'DELIVERY', batchId: 'BATCH', envelope: { type: 'shopeers.erp.catalog.batch' } }) };
  } });
  vm.runInContext(await readFile(path.join(sourceRoot, 'background.js'), 'utf8'), sandbox);
  const api = sandbox.__SHOPEERS_ERP_BACKGROUND_TEST_API__;
  const sender = { frameId: 0, url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html', tab: { url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' } };
  assert.equal((await api.catalogContext({}, sender)).request.requestId, 'CATALOG-CONFIRMED');
  requests[0].registeredAt = '2026-09-01T00:00:00.000Z';
  requests.push({ ...requests[1], requestId: 'COST-OTHER-CATALOG', sourceRequestId: 'COST-OTHER' });
  assert.equal((await api.catalogContext({}, sender)).request.requestId, 'CATALOG-CONFIRMED', 'explicit supplement remains usable beside an automatic companion');
  assert.equal((await api.catalogContext({ querySkcs: ['SKC-TARGET'], queryCapturedAt: '2026-09-30T00:00:00.000Z' }, sender)).request.requestId, 'COST-OTHER-CATALOG');
  requests.pop();

  await assert.rejects(api.catalogContext({}, { url: 'https://attacker.invalid' }), error => error.code === 'ERP_UNTRUSTED_SENDER');
  requests.push({ ...requests[1], requestId: 'CATALOG-AMBIGUOUS' });
  await assert.rejects(api.catalogContext({}, sender), error => error.code === 'ERP_REQUEST_AMBIGUOUS'); requests.pop();
  const input = { requestId: 'CATALOG-CONFIRMED', workspaceId: 'forged', endpoint: 'https://attacker.invalid', token: 'page-secret', resultDeliveryId: 'ERP-RESULT-CATALOG-CONFIRMED', querySkcs: ['SKC-TARGET'], results: [{ warehouseSku: 'WH-ONE', name: '合成标题', unitCost: 999, mappings: [{ platformSku: 'SKU-ONE', platformSkc: 'SKC-TARGET', warehouseSku: 'WH-ONE' }] }], warehouseEvidence: { warehouses: [completeEvidence('WH-ONE')] }, catalogCoverage: { directory: { state: 'complete' } } };
  await assert.rejects(api.submitCatalogResult({ ...input, requestId: 'FORGED' }, sender), error => error.code === 'ERP_REQUEST_NOT_FOUND');
  await assert.rejects(api.submitCatalogResult({ ...input, querySkcs: ['OTHER'] }, sender), error => error.code === 'ERP_REQUEST_CONTEXT_MISSING');
  assert.equal((await api.submitCatalogResult(input, sender)).ok, true);
  assert.equal(posted[0].workspaceId, 'workspace-confirmed');
  assert.equal(posted[0].ledgerId, null);
  assert.equal(posted[0].rows[0].unitCost, undefined);
  assert.equal(posted[0].rows[0].previewUnitCost, undefined);
  assert.equal(posted[0].warehouseEvidence.warehouses[0].purchaseRecords.length, 5);
  assert.doesNotMatch(JSON.stringify(posted), /attacker|page-secret|forged/);
  assert.deepEqual(storage.shopeersErpPendingCostResultsV2, []);
  console.log('ERP catalog background: unique trusted request, sender/workspace/SKC binding and loopback-only price-free rows passed');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyErpCatalogCollection();
  await verifyErpCatalogButtonAndCostPipeline();
  await verifyErpCatalogBackgroundBinding();
}
