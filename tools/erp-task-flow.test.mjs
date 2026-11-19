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

const tallBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(tallBook, { A1: { t: 's', v: '合成采购表' }, A100002: { t: 'n', v: 1 }, '!ref': 'A1:A100002' }, 'Sheet1');
const tallBytes = XLSX.write(tallBook, { type: 'array', bookType: 'xlsx', compression: true });
const tallMeasurement = { kind: 'sheetRows', actual: 100002, limit: 100001 };
const oversizedFixture = url => {
  const scope = url.searchParams.get('sku')?.split(' ') || [];
  if (url.pathname.endsWith('/export-purchase-order') && scope.includes('SKC-2')) return { binary: tallBytes };
  return fixture(url);
};
const oversized = await scenario(5, 'recursive-workbook-split', { ...options, fixture: oversizedFixture,
  expectedDeliveries: 3, firstBatchListLimit: 4 });
const exportScopes = result => result.calls.filter(call => call.endpoint === 'export-purchase-order').map(call => call.target);
assert.deepEqual(exportScopes(oversized), ['SKC-0 SKC-1 SKC-2 SKC-3 SKC-4', 'SKC-0 SKC-1 SKC-2', 'SKC-0 SKC-1', 'SKC-2', 'SKC-3 SKC-4']);
assert.deepEqual(oversized.task.firstWorkbookLimit, { ...tallMeasurement, skcCount: 5 });
assert.deepEqual(oversized.deliveries.map(receipt => receipt.sourceMeta.collectionMethod), ['bulk_export', 'legacy', 'bulk_export']);
assert.deepEqual(oversized.deliveries.map(receipt => receipt.sourceMeta.historyTargetSku), ['SKC-0,SKC-1', 'SKC-2', 'SKC-3,SKC-4']);
assert.deepEqual(oversized.deliveries[1].sourceMeta.workbookLimit, tallMeasurement);
assert.equal(oversized.deliveries.reduce((sum, receipt) => sum + receipt.sourceMeta.bulkExportCount, 0), 5);
assert.equal(oversized.deliveries.reduce((sum, receipt) => sum + receipt.sourceMeta.requestCount, 0), oversized.calls.length);
const detailCalls = oversized.calls.filter(call => call.endpoint === 'purchase-order-details');
assert.equal(detailCalls.length, 48);
assert.ok(detailCalls.every(call => call.target.startsWith('PO-SKC-2-')));
const splitRows = oversized.deliveries.flatMap(receipt => receipt.rows);
assert.deepEqual(splitRows.map(row => row.platformSku).sort(), ['SKU-0', 'SKU-1', 'SKU-2', 'SKU-3', 'SKU-4']);
assert.ok(splitRows.every(row => Number(row.unitCost ?? row.previewUnitCost) === 5));
const fileLimit = 32 * 1024 * 1024;
const resumedSplit = await scenario(5, 'resume-workbook-split', { ...options, lostPartition: true,
  expectedDeliveries: 3, firstBatchListLimit: 4, fixture: url => {
    if (url.pathname.endsWith('/export-purchase-order') && url.searchParams.get('sku').split(' ').length === 5) {
      return { binary: new ArrayBuffer(0), contentLength: String(fileLimit + 1) };
    }
    return oversizedFixture(url);
  } });
assert.deepEqual(exportScopes(resumedSplit), exportScopes(oversized));
assert.deepEqual(resumedSplit.task.firstWorkbookLimit, { kind: 'fileBytes', actual: fileLimit + 1, limit: fileLimit, skcCount: 5 });

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

// The same shared-warehouse export fits a single HTTP receipt, but needs
// more than the standalone extension's storage budget to queue that receipt.
const quotaCase = { ...options, fixture: sharedFixture };
const standard = await scenario(280, 'standard-storage', { ...quotaCase, expectCapacitySplit: true });
const desktop = await scenario(280, 'desktop-storage', { ...quotaCase, desktopStorage: true });
assert.equal(desktop.deliveries.length, 1);
assert.ok(desktop.peakStorageBytes > 10 * 1024 * 1024 && desktop.peakStorageBytes < 32 * 1024 * 1024);
const costs = result => result.deliveries.flatMap(receipt => receipt.rows.map(row => [row.platformSku, row.unitCost])).sort();
assert.deepEqual(costs(desktop), costs(standard));
assert.equal(desktop.calls.filter(call => call.endpoint === 'export-purchase-order').length, 1);

// Each half fits as a workbook. Its receipt needs smaller pieces that must reuse that half's verified source.
const splitAndQueue = await scenario(64, 'workbook-then-receipt-split', { ...options, storageQuotaBytes: 300 * 1024,
  firstBatchListLimit: 3, expectCapacitySplit: true, fixture: url => {
    if (url.pathname.endsWith('/export-purchase-order') && url.searchParams.get('sku').split(' ').length === 64) return { binary: tallBytes };
    return sharedFixture(url);
  } });
assert.deepEqual(exportScopes(splitAndQueue).map(target => target.split(' ').length), [64, 32, 32]);
assert.ok(splitAndQueue.deliveries.length > 2);
assert.equal(new Set(splitAndQueue.deliveries.flatMap(receipt => receipt.rows.map(row => row.platformSku))).size, 64);
for (const receipt of splitAndQueue.deliveries) {
  const source = receipt.sourceMeta.historyTargetSku.split(',');
  assert.equal(source.length, 32);
  assert.ok(receipt.querySkcs.every(skc => source.includes(skc)));
  assert.equal(receipt.sourceMeta.collectionMethod, 'bulk_export');
}

console.log('Whole-task collection: one normal receipt, scoped fallback, unchanged costs and legacy recovery passed');
