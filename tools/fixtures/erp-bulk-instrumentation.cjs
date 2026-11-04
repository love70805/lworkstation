const assert = require('node:assert/strict');
const { instrument: baseInstrument } = require('./erp-speed-instrumentation.cjs');
function instrument(source, cap) {
    let result = baseInstrument(source, cap);
    const marker = '    const semantic=state=>';
    const start = result.indexOf(marker), end = result.indexOf('\n', start);
    assert.ok(start >= 0 && result.indexOf(marker, start + 1) < 0, 'Exactly one disposable semantic adapter');
    const normalized = `    const semantic=state=>JSON.stringify(stable({
        results:state.results.map(row=>({warehouseSku:row.warehouseSku,unitCost:String(row.unitCost),
            mappings:row.mappings.map(mapping=>({platformSku:mapping.platformSku,platformSkc:mapping.platformSkc,warehouseSku:mapping.warehouseSku})),
            selectedOrders:(state.warehouseEvidence.warehouses.find(warehouse=>warehouse.warehouseSku===row.warehouseSku)?.purchaseRecords||[])
                .filter(record=>row.selectedRecordIds.includes(record.recordId)).map(record=>record.purchaseOrderNo)})),
        warehouses:state.warehouseEvidence.warehouses.map(warehouse=>({warehouseSku:warehouse.warehouseSku,evidenceComplete:warehouse.evidenceComplete,
            purchaseRecords:warehouse.purchaseRecords.map(record=>({purchaseOrderNo:record.purchaseOrderNo,purchaseDate:record.purchaseDate,quantity:record.quantity,unitPrice:record.unitPrice}))})),
        detailFailures:state.warehouseEvidence.detailFailures,mappingFailures:state.warehouseEvidence.mappingFailures}));`;
    result = result.slice(0, start) + normalized + result.slice(end);
    return `if(new URL(location.href).searchParams.get('bulkMode')==='legacy')window.ShopeersErpBulkPurchase=null;\n` + result;
}
module.exports = { instrument };
