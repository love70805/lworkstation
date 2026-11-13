import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scenario } from './erp-collection-batches.test.mjs';
const require = createRequire(import.meta.url);
const { fixture, businessOrder } = require('./fixtures/erp-bulk-fixture.cjs');
const xlsx = createRequire(new URL('../frontend/package.json', import.meta.url))('xlsx');

function serviceFixture(url) {
    const result = fixture(url);
    if (result.binary) {
        const book = xlsx.read(result.binary, { type: 'array' });
        const sheet = book.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: true });
        const price = rows[0].indexOf('采购单价');
        if (price < 0) return result; // The broken-export case must still exercise native fallback.
        rows[0].push('服务单价');
        for (const row of rows.slice(1)) { row[price] -= 2; row.push(2); }
        book.Sheets[sheet] = xlsx.utils.aoa_to_sheet(rows);
        return { binary: xlsx.write(book, { bookType: 'xlsx', type: 'array', compression: true }) };
    }
    if (url.pathname.endsWith('/purchase-order-details')) return { ...result,
        data: result.data.map(row => ({ ...row, purchaseUnitPrice: row.purchaseUnitPrice - 2, serviceUnitPrice: 2 })) };
    return result;
}

function verify(deliveries, serviceUnitPrice) {
    const rows = deliveries.flatMap(item => item.rows);
    assert.equal(rows.length, 10);
    for (const row of rows) {
        const scope = Number(row.platformSku.split('-').at(-1));
        assert.equal(Number(row.unitCost ?? row.previewUnitCost), 5);
        assert.equal(row.platformSkc, `SKC-${scope}`);
        assert.equal(row.warehouseSku, `WH-${scope}`);
        const warehouse = deliveries.flatMap(item => item.warehouseEvidence.warehouses).find(value => value.warehouseSku === row.warehouseSku);
        assert.equal(warehouse.purchaseRecords.length, 48);
        if (serviceUnitPrice != null) for (const evidence of warehouse.purchaseRecords) {
            assert.equal(evidence.amountBasis, 'purchase_total');
            assert.equal(evidence.serviceUnitPrice, serviceUnitPrice);
            assert.equal(evidence.totalPrice, evidence.quantity * (evidence.purchaseUnitPrice + serviceUnitPrice), 'partition and recovery preserve the complete line amount');
        }
        assert.deepEqual(warehouse.purchaseRecords.filter(record => row.selectedRecordIds.includes(record.recordId)).map(record => record.purchaseOrderNo).sort(), [45, 46, 47].map(index => businessOrder(scope, index)));
    }
}
const bulk = await scenario(10, 'bulk-pipeline', { fixture, bulk: true, maxLists: 1, returnMetrics: true, firstBatchListLimit: 2 });
verify(bulk.deliveries);
const capacity = await scenario(10, 'bulk-storage-capacity', { fixture: serviceFixture, bulk: true, taskFlow: true,
    storageQuotaBytes: 384 * 1024, expectCapacitySplit: true, maxLists: 1, returnMetrics: true, firstBatchListLimit: 2 });
verify(capacity.deliveries, 2);
assert.ok(capacity.peakStorageBytes <= 384 * 1024);
assert.equal(capacity.calls.filter(row => row.endpoint === 'export-purchase-order').length, 1, 'capacity partitions reuse the original complete export');
assert.equal(new Set(capacity.deliveries.flatMap(row => row.querySkcs)).size, 10, 'capacity partitions keep the entire original scope');
const resumedStorage = await scenario(10, 'bulk-storage-resume', { fixture: serviceFixture, bulk: true, taskFlow: true,
    storageResume: true, maxLists: 1, returnMetrics: true, firstBatchListLimit: 4 });
verify(resumedStorage.deliveries, 2);
assert.equal(resumedStorage.task.pauseReason, undefined, 'successful explicit continuation clears the old failure explanation');
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
assert.equal(catalog.calls.filter(row=>row.endpoint==='export-select-goods').length,2);
assert.ok(catalog.catalogs.flatMap(item=>item.rows).every(row=>row.productName.startsWith('表格商品')));
process.env.ERP_BULK_BROKEN = '1';
try {
    const fallback = await scenario(10, 'bulk-fallback', { fixture: serviceFixture, bulk: true, maxLists: 4, returnMetrics: true, firstBatchListLimit: 31 });
    verify(fallback.deliveries, 2);
    assert.equal(fallback.calls.filter(row => row.endpoint === 'export-purchase-order').length, 1);
    assert.equal(fallback.calls.filter(row => row.endpoint === 'purchase-order-details').length, 480);
    assert.ok(fallback.deliveries.every(row => row.sourceMeta.collectionMethod === 'legacy' && row.sourceMeta.bulkFallbackCount === 1));
} finally { delete process.env.ERP_BULK_BROKEN; }
console.log('Bulk full content/task/delivery pipeline: one export, selective mapping, on-demand catalog and legacy fallback passed');
