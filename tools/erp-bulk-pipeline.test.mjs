import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scenario } from './erp-collection-batches.test.mjs';
const require = createRequire(import.meta.url);
const { fixture, businessOrder } = require('./fixtures/erp-bulk-fixture.cjs');

function verify(deliveries) {
    const rows = deliveries.flatMap(item => item.rows);
    assert.equal(rows.length, 10);
    for (const row of rows) {
        const scope = Number(row.platformSku.split('-').at(-1));
        assert.equal(Number(row.unitCost ?? row.previewUnitCost), 5);
        assert.equal(row.platformSkc, `SKC-${scope}`);
        assert.equal(row.warehouseSku, `WH-${scope}`);
        const warehouse = deliveries.flatMap(item => item.warehouseEvidence.warehouses).find(value => value.warehouseSku === row.warehouseSku);
        assert.equal(warehouse.purchaseRecords.length, 48);
        assert.deepEqual(warehouse.purchaseRecords.filter(record => row.selectedRecordIds.includes(record.recordId)).map(record => record.purchaseOrderNo).sort(), [45, 46, 47].map(index => businessOrder(scope, index)));
    }
}
const bulk = await scenario(10, 'bulk-pipeline', { fixture, bulk: true, maxLists: 1, returnMetrics: true, firstBatchListLimit: 2 });
verify(bulk.deliveries);
assert.equal(bulk.calls.filter(row => row.endpoint === 'export-purchase-order').length, 1);
assert.equal(bulk.calls.filter(row => row.endpoint === 'product-info-sku').length, 1);
assert.equal(bulk.calls.filter(row => row.endpoint === 'product-page').length, 0);
assert.equal(bulk.calls.filter(row => row.endpoint === 'purchase-order-details').length, 0);
assert.equal(bulk.catalogs.length, 0);
assert.ok(bulk.deliveries.every(row => row.sourceMeta.collectionMethod === 'bulk_export'));
assert.equal(bulk.deliveries.flatMap(row=>row.rows).find(row=>row.platformSku==='SKU-0').catalogMappingsComplete,true);
assert.equal(bulk.deliveries.flatMap(row=>row.rows).find(row=>row.platformSku==='SKU-1').catalogMappingsComplete,false);
const catalog = await scenario(10, 'bulk-requested-catalog', { fixture, bulk:true, afterCosts:true, maxLists:1, returnMetrics:true, firstBatchListLimit:2 });
verify(catalog.deliveries);
assert.equal(catalog.calls.filter(row=>row.endpoint==='export-purchase-order').length,1);
assert.equal(catalog.calls.filter(row=>row.endpoint==='product-info-sku').length,10,'one long map during costs plus nine short maps only when materials are requested');
assert.equal(catalog.calls.filter(row=>row.endpoint==='purchase-order-details'||row.endpoint==='product-page').length,0);
assert.equal(catalog.catalogs.length,2);
process.env.ERP_BULK_BROKEN = '1';
try {
    const fallback = await scenario(10, 'bulk-fallback', { fixture, bulk: true, maxLists: 4, returnMetrics: true, firstBatchListLimit: 31 });
    verify(fallback.deliveries);
    assert.equal(fallback.calls.filter(row => row.endpoint === 'export-purchase-order').length, 1);
    assert.equal(fallback.calls.filter(row => row.endpoint === 'purchase-order-details').length, 480);
    assert.ok(fallback.deliveries.every(row => row.sourceMeta.collectionMethod === 'legacy' && row.sourceMeta.bulkFallbackCount === 1));
} finally { delete process.env.ERP_BULK_BROKEN; }
console.log('Bulk full content/task/delivery pipeline: one export, selective mapping, on-demand catalog and legacy fallback passed');
