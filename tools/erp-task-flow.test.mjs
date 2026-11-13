import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scenario } from './erp-collection-batches.test.mjs';
const require = createRequire(import.meta.url);
const { fixture } = require('./fixtures/erp-bulk-fixture.cjs');
const XLSX = createRequire(new URL('../frontend/package.json', import.meta.url))('xlsx');

const options = { fixture, bulk: true, taskFlow: true, maxLists: 1, returnMetrics: true, firstBatchListLimit: 2 };
const whole = await scenario(10, 'whole-task', options);
assert.equal(whole.deliveries.length, 1);
assert.equal(whole.deliveries[0].rows.length, 10);
assert.equal(whole.calls.filter(call => call.endpoint === 'export-purchase-order').length, 1);
assert.equal(whole.calls.filter(call => call.endpoint === 'purchase-order-details').length, 0);
assert.equal(whole.task.batches.length, 1);
assert.equal(whole.deliveries.reduce((sum, item) => sum + item.sourceMeta.requestCount, 0), whole.calls.length);
assert.doesNotMatch(whole.body, /分批采集|第\s*\d+\s*\/\s*\d+\s*批|重试失败批次/);

// One uncertain short mapping must not turn nine valid costs into native reads.
const partialFixture = async url => {
  const response = fixture(url);
  if (!response.binary) return response;
  const book = XLSX.read(new Uint8Array(response.binary), { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  for (const row of rows.slice(1)) if (row[1] === 'WH-9') row[2] = 'UNRELATED-SKU';
  book.Sheets[book.SheetNames[0]] = XLSX.utils.aoa_to_sheet(rows);
  return { binary: XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) };
};
const partial = await scenario(10, 'targeted-fallback', { ...options, fixture: partialFixture, expectedDeliveries: 2 });
assert.deepEqual(partial.deliveries.map(item => item.rows.length), [9, 1]);
assert.deepEqual(partial.deliveries.map(item => item.sourceMeta.collectionMethod), ['bulk_export', 'legacy']);
assert.equal(partial.calls.filter(call => call.endpoint === 'export-purchase-order').length, 1);
assert.equal(partial.calls.filter(call => call.endpoint === 'purchase-order-details').length, 48);
assert.ok(partial.calls.filter(call => call.endpoint === 'product-page').every(call => call.target === 'SKC-9'));
assert.equal(new Set(partial.deliveries.flatMap(item => item.rows.map(row => row.platformSku))).size, 10);
assert.ok(partial.deliveries.flatMap(item => item.rows).every(row => Number(row.unitCost ?? row.previewUnitCost) === 5));
assert.equal(partial.deliveries.reduce((sum, item) => sum + item.sourceMeta.requestCount, 0), partial.calls.length);
assert.equal(partial.deliveries.reduce((sum, item) => sum + (item.sourceMeta.bulkExportCount || 0), 0), 1);

const recovered = await scenario(10, 'workstation', { ...options, fixture: partialFixture, expectedDeliveries: 2 });
assert.deepEqual(recovered.deliveries.map(item => item.rows.length), [9, 1]);
const acknowledged = await scenario(10, 'lost-ack', options);
assert.equal(acknowledged.deliveries.length, 1);
const materials = await scenario(10, 'whole-task-materials', { ...options, afterCosts: true });
assert.equal(materials.catalogs.length, 1);
for (const recovery of ['lostPartition', 'pausePartition']) {
  const result = await scenario(10, recovery, { ...options, fixture: partialFixture, expectedDeliveries: 2, firstBatchListLimit: 4, [recovery]: true });
  assert.deepEqual(result.deliveries.map(item => item.rows.length), [9, 1]);
  assert.equal(new Set(result.deliveries.flatMap(item => item.rows.map(row => row.platformSku))).size, 10);
}

process.env.ERP_BULK_BROKEN = '1';
try {
  const fallback = await scenario(10, 'whole-source-fallback', { ...options, expectedDeliveries: 2, maxLists: 4, firstBatchListLimit: 31 });
  assert.equal(fallback.calls.filter(call => call.endpoint === 'export-purchase-order').length, 1);
  assert.equal(fallback.calls.filter(call => call.endpoint === 'purchase-order-details').length, 480);
  assert.ok(fallback.deliveries.every(item => item.sourceMeta.collectionMethod === 'legacy'));
} finally { delete process.env.ERP_BULK_BROKEN; }

// Hundreds of platform identities share one warehouse. The actual bridge rows
// repeat metadata, so the source state alone cannot predict the body size.
const sharedBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(sharedBook, XLSX.utils.aoa_to_sheet([
  ['采购单号', '仓库SKU', '平台SKU', '采购数量', '采购单价', '采购总价', '创建时间', '采购状态', '1688订单状态', '商品名称'],
  ...[1, 2, 3].map(index => [`SHARED-${index}`, 'SHARED-WH', 'X'.repeat(1024), 2, 3, 10, `2026-08-0${index} 12:00:00`, '已上架', '已付款', '合成共仓商品']),
]), 'Sheet1');
const sharedBytes = XLSX.write(sharedBook, { type: 'array', bookType: 'xlsx', compression: true });
const sharedFixture = url => {
  const endpoint = url.pathname.split('/').at(-1);
  if (endpoint === 'export-purchase-order') return { binary: sharedBytes };
  if (endpoint === 'purchase-order-page') return { code: 0, count: 3, data: [1, 2, 3].map(index => ({ purchaseOrderNo: `SHARED-${index}`, purchaseOrderId: `NATIVE-${index}` })) };
  if (endpoint === 'product-info-sku') return { code: 0, count: 400, data: Array.from({ length: 400 }, (_, index) => ({ associatedProductId: 'SHARED-WH', barcodeSkuid: `SKU-${index}`, barcodeSkcid: `SKC-${index}` })) };
  throw new Error(`Unexpected shared-warehouse request: ${endpoint}`);
};
const large = await scenario(400, 'shared-warehouse-payload', { ...options, fixture: sharedFixture, expectedDeliveries: 2 });
assert.deepEqual(large.deliveries.map(item => item.rows.length), [200, 200]);
assert.equal(new Set(large.deliveries.flatMap(item => item.rows.map(row => row.platformSku))).size, 400);
assert.ok(large.deliveries.every(item => new TextEncoder().encode(JSON.stringify(item)).byteLength < 25 * 1024 * 1024));
assert.ok(large.deliveries.flatMap(item => item.rows).every(row => Number(row.unitCost ?? row.previewUnitCost) === 5));
assert.equal(large.calls.filter(call => call.endpoint === 'export-purchase-order').length, 1);
assert.equal(large.calls.filter(call => call.endpoint === 'purchase-order-details').length, 0);
assert.equal(large.deliveries.reduce((sum, item) => sum + item.sourceMeta.requestCount, 0), large.calls.length);

console.log('Whole-task collection: one normal receipt, scoped fallback, unchanged costs and legacy recovery passed');
