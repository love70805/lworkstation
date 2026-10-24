// UI inputs only. The financial repositories, backups and original evidence
// continue to read complete records. Never use this projection to adopt costs.
const COST_FIELDS = ['id', 'workspaceId', 'ledgerId', 'period', 'platformSku', 'sku', 'canonicalPlatformSku',
  'platformSkc', 'warehouseSku', 'batchId', 'evidenceRef', 'catalogEligible', 'catalogQuerySkcs', 'mappingFallback', 'sourceWarnings',
  'unitCost', 'amount', 'currency', 'resolutionStatus', 'unresolvedAnomalyCount', 'effectiveAt', 'calculatedAt', 'finalizedAt',
  'createdAt', 'updatedAt', 'publishedAt', 'costApprovalId', 'approvalId', 'productName', 'imageUrl', 'attribute', 'storeName',
  'supplierName', 'supplierNames', 'supplier1688Url', 'supplier1688Links', 'purchaseCatalog', 'catalogMappings',
  'referenceOnly', 'selectedRecordIds', 'unitConversion', 'note', 'confirmedBy', 'confirmedAt'];
const PURCHASE_FIELDS = ['recordId', 'warehouseSku', 'productName', 'purchaseOrderId', 'purchaseOrderNo',
  'supplierName', 'supplier1688Url', 'supplier1688Links', 'purchaseCatalog'];
const pick = (row, fields) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));

export function projectSelectionErpCost(row) {
  return { ...pick(row, COST_FIELDS),
    ...(Array.isArray(row.purchaseRecords) ? { purchaseRecords: row.purchaseRecords.map(record => pick(record, PURCHASE_FIELDS)) } : {}) };
}
