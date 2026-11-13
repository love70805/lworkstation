import { canonicalPlatformSku, canonicalWarehouseSku } from './identifiers';
import { erpBatchAdoptionBoundary } from './erpAutomaticAdoption';
import { calculateWarehouseCostDecision, ERP_COST_RESOLUTION_VERSION } from './erpCostResolution';
import { normalizePurchaseEvidenceRecord } from './erpPurchaseEvidence';

const orderedObject = value => Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
const ordered = values => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

function purchaseFacts(record, index, warehouseSku, period) {
  const row = normalizePurchaseEvidenceRecord(record, index, warehouseSku, { period });
  return {
    recordId: row.recordId, warehouseSku: row.canonicalWarehouseSku,
    purchaseDate: row.purchaseDate, quantity: row.quantity, unitPrice: row.unitPrice,
    totalPrice: row.totalPrice, order1688: row.order1688,
    amountBasis: row.amountBasis ?? null,
    purchaseUnitPrice: row.purchaseUnitPrice ?? null, serviceUnitPrice: row.serviceUnitPrice ?? null,
    purchaseOrderNo: row.purchaseOrderNo, purchaseOrderId: row.purchaseOrderId,
    statusFields: orderedObject(row.statusFields), eligible: row.eligible,
    exclusionReasons: [...row.exclusionReasons].sort(),
  };
}

// Compare complete purchase facts, not a batch ID or a rounded/aggregated price.
// Keys are transient, collision-free canonical strings; no large fingerprint is
// persisted on each resolution. Catalog decoration is not financial evidence.
export function indexErpAnomalyEvidence(batch, period) {
  const result = new Map(), seen = new Set();
  const boundary = erpBatchAdoptionBoundary(batch);
  if (boundary.globalReasons.length) return result;
  for (const evidence of batch?.warehouseEvidence ?? []) {
    const warehouse = canonicalWarehouseSku(evidence.warehouseSku);
    if (!warehouse) continue;
    if (seen.has(warehouse)) { result.delete(warehouse); continue; }
    seen.add(warehouse);
    if (boundary.blockedWarehouses.has(warehouse) || batch.rows.some(row => canonicalWarehouseSku(row.warehouseSku) === warehouse && boundary.blockedSkus.has(canonicalPlatformSku(row.platformSku)))) continue;
    if (evidence.evidenceComplete !== true || evidence.sourceWarnings?.length || !evidence.purchaseRecords?.length) continue;
    const decision = calculateWarehouseCostDecision({ warehouseSku: evidence.warehouseSku, purchaseRecords: evidence.purchaseRecords, evidenceComplete: true, period });
    if (!decision.anomalies.length) continue;
    const key = JSON.stringify({
      version: ERP_COST_RESOLUTION_VERSION, period, warehouse,
      records: ordered(evidence.purchaseRecords.map((row, index) => purchaseFacts(row, index, warehouse, period))),
      excluded: ordered((evidence.excludedRecords ?? []).map((row, index) => purchaseFacts(row, index, warehouse, period))),
      selected: [...decision.selectedRecordIds].sort(),
      anomalies: ordered(decision.anomalies.map(row => ({ recordId: row.recordId, originalUnitPrice: row.originalUnitPrice, reasons: [...row.reasons].sort() }))),
    });
    result.set(warehouse, { key, decision });
  }
  return result;
}
