const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const xlsx = createRequire(path.join(__dirname, '../../frontend/package.json'))('xlsx');
const TARGETS = 10, ORDERS = 48;
const targets = Array.from({ length: TARGETS }, (_, index) => ({ platformSku: `SKU-${index}`, platformSkc: `SKC-${index}`, store: '合成基准店' }));
const date = index => new Date(Date.UTC(2026, 5, index + 1, 12, 0, 0)).toISOString().slice(0, 19).replace('T', ' ');
const businessOrder = (scope, index) => `PUR-${scope}-${String(index).padStart(4, '0')}`;
const rows = targets.flatMap((_, scope) => Array.from({ length: ORDERS }, (_, index) => ({ scope, index,
    purchaseOrderId: `PO-SKC-${scope}-${index}`, purchaseOrderNo: businessOrder(scope, index), creationTime: date(index), purchaseStatus: '7' })));
const longMapping = Array.from({ length: 200 }, (_, index) => `FOREIGN-${index}`).join(',').slice(0, 1024);
const headers = ['采购单号', '仓库SKU', '平台SKU', '采购数量', '采购单价', '采购总价', '创建时间', '采购状态', '1688订单状态', '商品名称', '供应商名称'];
function exportBytes(broken = false) {
    const book = xlsx.utils.book_new();
    const values = [broken ? ['未知列'] : headers, ...(!broken ? rows.map(row => [row.purchaseOrderNo, `WH-${row.scope}`, row.scope === 0 ? longMapping : `SKU-${row.scope}`,
        2, 4 + row.index % 3, 2 * (4 + row.index % 3), row.creationTime, '已上架', '已付款', '合成采购商品', '合成供应商']) : [])];
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(values), 'Sheet1');
    return xlsx.write(book, { bookType: 'xlsx', type: 'array', compression: true });
}
const binary = exportBytes(), brokenBinary = exportBytes(true);
function fixture(url) {
    const endpoint = url.pathname.split('/').at(-1);
    const target = url.searchParams.get('sku') || url.searchParams.get('purchaseOrderId') || url.searchParams.get('productId') || url.searchParams.get('skuGroup') || '';
    if (endpoint === 'export-purchase-order') return { binary: process.env.ERP_BULK_BROKEN === '1' ? brokenBinary : binary };
    const scope = Number(target.split('-').at(-1));
    let data, count;
    if (endpoint === 'product-page') data = [{ itemId: `WH-${scope}`, tradeName: '合成采购商品' }];
    else if (endpoint === 'product-info-sku') data = [
        { associatedProductId: `WH-${scope}`, barcodeSkuid: `SKU-${scope}`, barcodeSkcid: `SKC-${scope}` },
        { associatedProductId: `WH-${scope}`, barcodeSkuid: `FOREIGN-${scope}`, barcodeSkcid: 'FOREIGN-SKC' },
    ];
    else if (endpoint === 'purchase-order-page') {
        const selected = target.split(/[,\s]+/).map(value => Number(value.split('-').at(-1)));
        const matching = rows.filter(row => selected.includes(row.scope));
        const page = Number(url.searchParams.get('page') || 1);
        data = matching.slice((page - 1) * 8, page * 8);
        count = matching.length;
    } else if (endpoint === 'purchase-order-details') {
        const row = rows.find(value => value.purchaseOrderId === target);
        assert.ok(row, `Unexpected fixture order ${target}`);
        data = [{ purchaseOrderDetailId: `D-${row.scope}-${row.index}`, itemId: `WH-${row.scope}`,
            tradeName: '合成采购商品', creationTime: row.creationTime, purchaseQuantity: 2, purchaseUnitPrice: 4 + row.index % 3 }];
    } else throw new Error(`Unplanned fixture endpoint ${endpoint}`);
    return { code: 0, count: count ?? data.length, data };
}
function assertBusinessResult({ envelopes, adoption }) {
    const results = envelopes.flatMap(envelope => envelope.batch.rows);
    assert.equal(results.length, TARGETS);
    assert.equal(new Set(results.map(row => row.platformSku)).size, TARGETS, 'every target has exactly one cost row');
    assert.deepEqual(results.map(row => row.platformSku).sort(), targets.map(row => row.platformSku).sort());
    for (const row of results) {
        const scope = Number(row.platformSku.split('-').at(-1));
        assert.equal(row.platformSkc, `SKC-${scope}`);
        assert.equal(row.warehouseSku, `WH-${scope}`);
        assert.equal(row.unitCost, 5);
        assert.equal(row.currency, 'CNY');
        assert.deepEqual(row.sourceWarnings, []);
        const warehouse = envelopes.flatMap(envelope => envelope.batch.warehouseEvidence).find(value => value.warehouseSku === row.warehouseSku);
        assert.equal(warehouse.purchaseRecords.length, ORDERS);
        assert.deepEqual(warehouse.purchaseRecords.filter(record => row.selectedRecordIds.includes(record.recordId)).map(record => record.purchaseOrderNo).sort(), [45, 46, 47].map(index => businessOrder(scope, index)));
    }
    assert.equal(adoption.length, envelopes.length);
    for (const [index, value] of adoption.entries()) {
        assert.equal(value.adoptionError, null);
        const covered = new Set(envelopes[index].batch.rows.map(row => row.platformSku));
        assert.equal(value.adoption.summary.adoptedCount, covered.size);
        for (const field of ['anomalyCount', 'evidenceIncompleteCount', 'missingCount', 'remainingCount']) assert.equal(value.adoption.summary[field], 0);
    }
    assert.equal(adoption.reduce((sum, value) => sum + value.adoption.summary.adoptedCount, 0), TARGETS);
}
module.exports = { TARGETS, ORDERS, targets, fixture, assertBusinessResult, businessOrder, exportBytes };
