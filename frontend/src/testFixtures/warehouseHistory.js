export const historyTarget = { store: '甲店', platformSku: 'SKU-A', platformSkc: 'SKC-A', warehouseSku: 'WH-A' };
export function warehouseHistoryFixture() {
  return { format: 'shopeers-erp-warehouse-history', formatVersion: 1, generatedAt: '2026-10-19T00:00:00Z', ledgerPeriod: '2026-09', warehouseSkus: ['WH-A'],
    historicalMappings: [{ ...historyTarget }], sourceMeta: { complete: true, detailFailureCount: 0 }, warehouseEvidence: { warehouses: [{ warehouseSku: 'WH-A', evidenceComplete: true, sourceWarnings: [], excludedRecords: [],
      purchaseRecords: [['R1', '2026-08-20', 1, 0.2], ['R2', '2026-09-20', 3, 0.4], ['FUTURE', '2026-10-01', 100, 100]].map(([recordId,purchaseDate,quantity,unitPrice]) => ({ recordId,purchaseDate,quantity,unitPrice,warehouseSku:'WH-A',purchaseOrderId:recordId,statusFields:{purchaseStatus:'7'},eligible:true })) }] } };
}
