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
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Progress condition timed out'); await delay(5); }
}
const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
const pending = new Map(), sent = [];
const skcs = ['A', 'B', 'C'];
const ids = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'C1'];
const expectedSkus = ids.map(id => ({ platformSku: 'SKU-W-' + id, platformSkc: id[0] }));
window.chrome = { runtime: { sendMessage(message, callback) {
  if (message.type === 'shopeers.erp.submitCostResult') sent.push(message.payload);
  callback(collectionReply(message, { platformSkcs: skcs, expectedSkus }) || { ok: true, status: 'success', resultDeliveryId: message.payload?.resultDeliveryId });
} } };
window.fetch = raw => {
  const url = new URL(raw), endpoint = url.pathname.split('/').at(-1);
  const target = url.searchParams.get('sku') || url.searchParams.get('purchaseOrderId') || url.searchParams.get('productId') || url.searchParams.get('skuGroup');
  const key = `${endpoint}:${target}:${url.searchParams.get('page') || ''}`;
  return new Promise(resolve => pending.set(key, body => resolve({ ok: true, status: 200, json: async () => body })));
};
async function reply(key, data, count) {
  await until(() => pending.has(key));
  const resolve = pending.get(key); pending.delete(key);
  resolve({ code: 0, data, ...(count === undefined ? {} : { count }) });
}
const orders = (...ids) => ids.map(purchaseOrderId => ({ purchaseOrderId }));
const stage = () => window.document.getElementById('erpa-progress-bar');
const lane = id => window.document.querySelector(`[data-progress-lane="${id}"] progress`);
try {
  for (const file of files) window.eval(source[file]);
  window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=A,B,C' } }));
  window.document.getElementById('erpa-cost-trigger').click();
  await until(() => pending.size === 2);
  assert.match(window.document.getElementById('erpa-loading-meters').textContent, /正在处理 2 个目标.*实际读取 2 \/ 8 个请求/);
  for (const skc of skcs) await reply('product-page:' + skc + ':1', ids.filter(id => id[0] === skc).map(id => ({ itemId: 'W-' + id })), ids.filter(id => id[0] === skc).length);
  await until(() => pending.size === 5);
  assert.match(stage().getAttribute('aria-label'), /平台 SKU 映射/); assert.equal(stage().value, 0); assert.equal(stage().max, 9);
  await reply('product-info-sku:W-A1:', '查询结果为空', 0);
  await until(() => stage().value === 1);
  for (let i = 0; i < 8; i++) {
    await until(() => pending.size > 0);
    const key = [...pending.keys()].find(key => key.startsWith('product-info-sku:'));
    const warehouse = key.split(':')[1];
    await reply(key, [{ associatedProductId: warehouse, barcodeSkuid: 'SKU-' + warehouse, barcodeSkcid: warehouse.slice(2, 3) }], 1);
  }
  await until(() => pending.has('product-page:A:1'));
  await reply('product-page:A:1', ids.filter(id => id[0] === 'A').map(id => ({ itemId: 'W-' + id })), 5);
  await until(() => pending.size === 5);
  await reply('product-info-sku:W-A1:', '查询结果为空', 0);
  for (const id of ids.filter(id => id[0] === 'A' && id !== 'A1')) await reply('product-info-sku:W-' + id + ':', [{ associatedProductId: 'W-' + id, barcodeSkuid: 'SKU-W-' + id, barcodeSkcid: 'A' }], 1);
  await until(() => pending.size === 2 && [...pending.keys()].every(key => key.startsWith('purchase-order-page:')));
  assert.equal(stage().getAttribute('value'), '0'); assert.equal(stage().max, 3);
  assert.equal(lane(0).hasAttribute('value'), false, 'total pages remain unknown until ERP responds');
  await reply('purchase-order-page:A:1', orders('A1', 'A2'), 5);
  await reply('purchase-order-page:B:1', orders('B1'), 3);
  await until(() => pending.has('purchase-order-page:B:2') && pending.has('purchase-order-page:A:2'));
  assert.equal(lane(0).value, 1); assert.equal(lane(0).max, 3);
  assert.equal(lane(1).value, 1); assert.equal(stage().value, 0, 'started targets are not completed targets');
  await reply('purchase-order-page:B:2', orders('B2'), 3);
  await until(() => lane(1).value === 2);
  assert.equal(lane(0).value, 1, 'a faster worker cannot overwrite the slower worker page count');
  await reply('purchase-order-page:B:3', orders('B3'), 3);
  await until(() => pending.has('purchase-order-page:C:1'));
  assert.equal(stage().value, 1); assert.equal(stage().max, 3);
  assert.equal(lane(1).hasAttribute('value'), false);
  await reply('purchase-order-page:C:1', orders('C1'));
  await until(() => pending.has('purchase-order-page:C:2'));
  assert.equal(lane(1).hasAttribute('value'), false);
  assert.match(window.document.querySelector('[data-progress-lane="1"]').textContent, /已读 1 页.*总量待确认/);
  await reply('purchase-order-page:C:2', []);
  await until(() => stage().value === 2);
  await reply('purchase-order-page:A:2', orders('A3', 'A4'), 5);
  await reply('purchase-order-page:A:3', orders('A5'), 5);
  await until(() => pending.size === 8);
  assert.match(stage().getAttribute('aria-label'), /采购明细/); assert.equal(stage().max, 9); assert.equal(stage().value, 0);
  const details = id => [{ purchaseOrderDetailId: 'D-' + id, itemId: 'W-' + id, creationTime: '2026-08-20', purchaseQuantity: 2, purchaseUnitPrice: 4 }];
  for (let i = 0; i < 7; i++) {
    const key = [...pending.keys()].find(key => key.startsWith('purchase-order-details:'));
    await reply(key, details(key.split(':')[1]), 1);
    await until(() => stage().value === i + 1);
  }
  assert.equal(stage().value, 7); assert.equal(window.document.querySelectorAll('[data-progress-lane]').length, 2);
  for (const key of [...pending.keys()]) await reply(key, details(key.split(':')[1]), 1);
  await until(() => sent.length && !window.document.getElementById('erpa-recalculate').disabled);
  assert.equal(sent[0].meta.mappingFailureCount, 1);
  assert.equal(sent[0].warehouseEvidence.mappingFailures[0].platformSku, 'SKU-W-A1');
  assert.equal(sent[0].meta.targetMappingFailureCount, 1);
  assert.equal(window.document.querySelectorAll('#erpa-progress-bar').length, 1);
  console.log('Real response-driven list, page, detail and mapping progress, independent workers, unknown totals and empty mapping passed');
} finally { await window.happyDOM.close(); }

// Directory completion must not mark warehouse material complete before its
// mapping and evidence responses. Completed checks can still have missing data.
const catalogWindow = new Window();
try {
  catalogWindow.eval(source['result-policy.js']); catalogWindow.eval(source['catalog-collector.js']);
  let productReply, mappingReply, evidenceReply;
  const updates = [];
  const collector = catalogWindow.ShopeersErpCatalogCollector.create({
    policy: catalogWindow.ShopeersErpResultPolicy,
    onProgress: (label, completed, total, detail) => updates.push({ label, completed, total, detail }),
    apiGet: endpoint => new Promise(resolve => { if (endpoint.endsWith('product-page')) productReply = resolve; else mappingReply = resolve; }),
    readWarehouseEvidence: () => new Promise(resolve => { evidenceReply = resolve; }),
  });
  const work = collector.collect(['A'], { controller: new AbortController(), expectedSkus: [{ platformSku: 'SKU-A', platformSkc: 'A' }] });
  await until(() => productReply);
  assert.equal(updates.at(-1).completed, 0);
  productReply({ code: 0, count: 1, data: [{ itemId: 'W-A' }] });
  await until(() => mappingReply);
  assert.ok(updates.some(update => update.label === '目标商品档案' && update.completed === 1));
  assert.equal(updates.at(-1).label, '资料与采购证据'); assert.equal(updates.at(-1).completed, 0);
  mappingReply({ code: 0, count: 1, data: [{ associatedProductId: 'W-A', barcodeSkuid: 'SKU-A', barcodeSkcid: 'A' }] });
  await until(() => evidenceReply);
  assert.equal(updates.at(-1).completed, 0, 'mapping done alone cannot complete the warehouse');
  evidenceReply({ warehouseSku: 'W-A', evidenceComplete: true, purchaseRecords: [], excludedRecords: [] });
  const result = await work;
  assert.equal(updates.at(-1).completed, 1); assert.equal(updates.at(-1).total, 1);
  assert.notEqual(result.coverage.images.state, 'complete'); assert.notEqual(result.coverage.suppliers.state, 'complete');
  console.log('Catalog directory/material stages count completed responses without declaring missing materials complete');
} finally { await catalogWindow.happyDOM.close(); }
