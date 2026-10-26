// Synthetic equivalent of erp-collection-throughput.test.mjs's paginated history.
// No credentials or live ERP responses are used.
const assert = require('node:assert/strict');
const TARGETS = 10;
const ORDERS = 48;
const targets = Array.from({ length: TARGETS }, (_, i) => ({ platformSkc: `SKC-${i}`, platformSku: `SKU-${i}`, store: '合成基准店' }));
function fixture(url) {
  const endpoint = url.pathname.split('/').at(-1);
  const target = url.searchParams.get('sku') || url.searchParams.get('purchaseOrderId') || url.searchParams.get('productId') || url.searchParams.get('skuGroup');
  const id = Number(target?.split('-').at(-1));
  let data, count;
  if (endpoint === 'product-page') data = [{ itemId: `WH-${id}` }];
  else if (endpoint === 'product-info-sku') data = [
    { associatedProductId: `WH-${id}`, barcodeSkuid: `SKU-${id}`, barcodeSkcid: `SKC-${id}` },
    { associatedProductId: `WH-${id}`, barcodeSkuid: `FOREIGN-${id}`, barcodeSkcid: 'FOREIGN-SKC' },
  ];
  else if (endpoint === 'purchase-order-page') {
    const page = Number(url.searchParams.get('page') || 1);
    data = Array.from({ length: Math.max(0, Math.min(8, ORDERS - (page - 1) * 8)) }, (_, i) => ({ purchaseOrderId: `PO-${target}-${(page - 1) * 8 + i}` }));
    count = ORDERS;
  } else if (endpoint === 'purchase-order-details') {
    const match = target.match(/^PO-SKC-(\d+)-(\d+)$/);
    if (!match) throw new Error(`Unexpected synthetic order: ${target}`);
    const [, scope, index] = match;
    data = [{ purchaseOrderDetailId: `D-${scope}-${index}`, itemId: `WH-${scope}`, tradeName: '合成基准商品', creationTime: '2026-08-20', purchaseQuantity: 2, purchaseUnitPrice: 4 + Number(index) % 3 }];
  } else throw new Error(`Unplanned synthetic ERP endpoint: ${endpoint}`);
  return { code: 0, count: count ?? data.length, data };
}
function assertBusinessResult({ envelopes, calculations, adoption }) {
  const rows = envelopes.flatMap(value => value.batch.rows);
  assert.deepEqual(rows.map(row => row.platformSku).sort(), targets.map(row => row.platformSku).sort());
  for (const row of rows) {
    const id = Number(row.platformSku.slice(4));
    assert.equal(row.platformSkc, `SKC-${id}`);
    assert.equal(row.warehouseSku, `WH-${id}`);
    assert.equal(row.unitCost, 5);
    assert.equal(row.currency, 'CNY');
    assert.deepEqual(row.sourceWarnings, []);
    assert.deepEqual(row.selectedRecordIds.slice().sort(), [45, 46, 47].map(index => `D-${id}-${index}`));
    assert.ok(row.catalogMappings.every(mapping => mapping.platformSku === row.platformSku && mapping.platformSkc === row.platformSkc));
  }
  for (const envelope of envelopes) for (const warehouse of envelope.batch.warehouseEvidence) {
    const id = Number(warehouse.warehouseSku.slice(3));
    assert.deepEqual(warehouse.purchaseRecords.map(row => row.recordId).sort(), Array.from({ length: ORDERS }, (_, index) => `D-${id}-${index}`).sort());
    assert.ok(warehouse.purchaseRecords.every(row => row.warehouseSku === warehouse.warehouseSku && row.quantity === 2 && row.unitPrice === 4 + Number(row.recordId.split('-').at(-1)) % 3));
  }
  for (const item of adoption) {
    assert.equal(item.adoption.summary.adoptedCount, 5);
    for (const key of ['anomalyCount', 'evidenceIncompleteCount', 'missingCount', 'remainingCount']) assert.equal(item.adoption.summary[key], 0);
  }
  for (const { meta } of calculations) {
    assert.equal(meta.excludedMappingCount, 5);
    for (const key of ['detailFailureCount', 'mappingFailureCount', 'costWarningCount']) assert.equal(meta[key], 0);
    assert.equal(meta.evidenceRecordCount, 240);
    assert.equal(meta.purchaseHistoryScope, 'complete_target_history');
  }
}
module.exports = { TARGETS, ORDERS, targets, fixture, assertBusinessResult };
