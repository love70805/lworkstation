import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { collectionReply } from './fixtures/erp-content-checkpoint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const files = ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js'];
const source = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(path.join(root, 'integrations/erp-assistant-extension/src', file), 'utf8')])));
const expectedSkus = [{ platformSku: 'SKU-USED', platformSkc: 'SKC-USED' }];
const mapping = (sku, skc, warehouse = 'WH-SHARED') => ({ associatedProductId: warehouse, barcodeSkuid: sku, barcodeSkcid: skc });
const shared = [...Array.from({ length: 230 }, (_, i) => mapping('UNUSED-' + i, i % 2 ? 'SKC-FOREIGN' : 'SKC-USED')), mapping('SKU-USED', 'SKC-USED')];
const evidence = warehouseSku => ({ warehouseSku, evidenceComplete: true, sourceWarnings: [], purchaseRecords: [{ recordId: 'D', warehouseSku, quantity: 2, unitPrice: 3, purchaseDate: '2026-09-02', supplierName: '供应商', supplier1688Links: [{ type: 'product', url: 'https://detail.1688.com/offer/123456789012.html' }], imageUrl: 'https://images.example.invalid/item.png' }], excludedRecords: [] });
const body = data => ({ code: 0, count: data.length, data });
const until = async check => { const end = Date.now() + 8000; while (!check()) { if (Date.now() > end) throw Error('Scope pipeline timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

const policyWindow = new Window();
try {
 for (const file of files.slice(0, 2)) policyWindow.eval(source[file]);
 const policy = policyWindow.ShopeersErpResultPolicy;
 assert.throws(() => policy.platformScope([], ['SKC-USED']), /缺少已确认/);
 assert.throws(() => policy.platformScope([{ platformSku: 'SKU-USED', platformSkc: 'SKC-USED' }, { platformSku: 'SKU-USED', platformSkc: 'SKC-OTHER' }], ['SKC-USED']), /身份冲突/);
 const scoped = policy.filterCatalogByPlatformScope([{ warehouseSku: 'WH-SHARED', mappings: policy.normalizeMappings(shared), catalogMappings: policy.normalizeCatalogMappings(shared) }], [{ platformSku: 'sku-used', platformSkc: 'skc-used' }], ['SKC-USED']);
 assert.equal(scoped.results[0].mappings.length, 1);
 assert.equal(scoped.results[0].catalogMappings.length, 1);
 assert.equal(scoped.excludedMappingCount, 230);
 const reads = [], queried = [];
 const collector = policyWindow.ShopeersErpCatalogCollector.create({ policy, readWarehouseEvidence: async sku => { reads.push(sku); return evidence(sku); }, apiGet: async (endpoint, params) => {
  queried.push([endpoint, params]);
  if (endpoint.endsWith('product-page')) return body([{ itemId: 'WH-SHARED' }, { itemId: 'WH-UNUSED-EMPTY' }]);
  return params.productId === 'WH-SHARED' ? body(shared) : { code: 0, count: 0, data: '查询结果为空' };
 } });
 const result = await collector.collect(['SKC-USED'], { controller: new AbortController(), expectedSkus });
 assert.deepEqual(reads, ['WH-SHARED'], 'unused archives never trigger purchase evidence reads');
 assert.equal(result.results.length, 1);
 assert.equal(result.results[0].mappings.length, 1);
 assert.equal(result.coverage.mappings.state, 'complete', 'an empty unused archive mapping does not taint target completeness');
 assert.equal(result.coverage.mappings.missingCount, 0);
 const missing = await collector.collect(['SKC-USED'], { controller: new AbortController(), expectedSkus: [{ platformSku: 'SKU-MISSING', platformSkc: 'SKC-USED' }] });
 assert.equal(missing.results.length, 0);
 assert.equal(missing.coverage.mappings.missingCount, 1, 'a real missing target is still missing');
 assert.match(missing.coverage.mappings.reasons.join(' '), /SKU-MISSING/);
 const conflictReader = policyWindow.ShopeersErpCatalogCollector.create({ policy, readWarehouseEvidence: evidence, apiGet: async endpoint => endpoint.endsWith('product-page') ? body([{ itemId: 'WH-SHARED' }]) : body([mapping('SKU-USED', 'SKC-USED'), mapping('SKU-USED', 'SKC-FOREIGN')]) });
 const conflict = await conflictReader.collect(['SKC-USED'], { controller: new AbortController(), expectedSkus });
 assert.match(conflict.coverage.mappings.reasons.join(' '), /platform_identity_conflict/);
 assert.equal(conflict.results[0].catalogMappings.length, 1);
} finally { await policyWindow.happyDOM.close(); }

for (const mode of ['normal', 'scope-missing', 'target-conflict', 'directory-short']) {
 const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
 const requests = [], costs = [], catalogs = [];
 window.chrome = { runtime: { sendMessage(message, callback) {
  if (message.type === 'shopeers.erp.submitCostResult') costs.push(message.payload);
  if (message.type === 'shopeers.erp.submitCatalogResult') catalogs.push(message.payload);
  callback(collectionReply(message, { platformSkcs: ['SKC-USED'], expectedSkus: mode === 'scope-missing' ? [] : expectedSkus }) || (message.type === 'shopeers.erp.catalogContext' ? { ok: true, request: { requestId: 'CAT', ledgerPeriod: '2026-09', platformSkcs: ['SKC-USED'], expectedSkus } } : { ok: true, status: 'success', resultDeliveryId: message.payload?.resultDeliveryId }));
 } } };
 window.fetch = async raw => {
  const url = new URL(raw), endpoint = url.pathname.split('/').at(-1);
  requests.push(url);
  let value;
  if (endpoint === 'product-page') value = mode === 'directory-short' ? { code: 0, count: 2, data: Number(url.searchParams.get('page')) === 1 ? [{ itemId: 'WH-SHARED' }] : [] } : body([{ itemId: 'WH-SHARED' }, { itemId: 'WH-UNUSED-EMPTY' }]);
  else if (endpoint === 'product-info-sku') value = url.searchParams.get('productId') === 'WH-SHARED' ? body(mode === 'target-conflict' ? [...shared, mapping('SKU-USED', 'SKC-FOREIGN')] : shared) : { code: 0, count: 0, data: '查询结果为空' };
  else if (endpoint === 'purchase-order-page') value = body([{ purchaseOrderId: 'PO-1' }]);
  else if (endpoint === 'purchase-order-details') value = body([
   { itemId: 'WH-SHARED', purchaseOrderDetailId: 'D-USED', creationTime: '2026-08-02', purchaseQuantity: 2, purchaseUnitPrice: 3, supplierName: '供应商', picturesLinking: 'https://images.example.invalid/item.png', supplier1688Url: 'https://detail.1688.com/offer/123456789012.html' },
   { itemId: 'WH-ORDER-ONLY', purchaseOrderDetailId: 'D-UNUSED', creationTime: '2026-08-02', purchaseQuantity: 2, purchaseUnitPrice: 99 },
  ]);
  else throw Error('Unexpected endpoint ' + endpoint);
  return { ok: true, status: 200, json: async () => value };
 };
 try {
  for (const file of files) window.eval(source[file]);
  window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-USED' } }));
  window.document.getElementById('erpa-cost-trigger').click();
  if (mode === 'scope-missing') {
   await until(() => !window.document.getElementById('erpa-recalculate').disabled && /缺少已确认的平台/.test(window.document.body.textContent));
   assert.equal(requests.length, 0, 'missing approved platform scope stops before reading ERP');
   continue;
  }
  await until(() => costs.length && !window.document.getElementById('erpa-recalculate').disabled).catch(error => { throw new Error(mode + ': ' + window.document.body.textContent, { cause: error }); });
  const sent = costs[0];
  assert.equal(sent.meta.platformScopePolicy, 'ledger_platform_pair');
  assert.equal(sent.results.length, 1);
  assert.equal(sent.results[0].mappings.length, 1);
  assert.equal(sent.results[0].catalogMappings.length, 1);
  assert.equal(sent.results[0].unitCost, mode === 'normal' ? '3.0000' : null);
  assert.equal(sent.meta.ignoredDetailCount, 1);
  assert.equal(requests.some(url => url.searchParams.get('productId') === 'WH-ORDER-ONLY'), false, 'unrelated lines never expand mapping queries');
  assert.equal(JSON.stringify(sent.warehouseEvidence).includes('WH-ORDER-ONLY'), false);
  if (mode === 'normal') {
   assert.equal(sent.meta.mappingFailureCount, 0);
   assert.equal(sent.warehouseEvidence.warehouses[0].evidenceComplete, true);
  } else {
   assert.equal(sent.warehouseEvidence.warehouses[0].evidenceComplete, false, 'real scope discovery faults cannot silently become formal cost');
   assert.equal(sent.results[0].previewStatus, 'evidence_incomplete');
  }
  await until(() => catalogs.length);
  assert.equal(catalogs[0].platformScopePolicy, 'ledger_platform_pair');
  assert.equal(catalogs[0].results[0].mappings.length, 1);
 } finally { await window.happyDOM.close(); }
}
console.log('ERP exact platform SKU/SKC scope: 230 shared mappings, unused archives/order lines, target gaps/conflicts, scope/count faults and cost/catalog pipeline passed');
