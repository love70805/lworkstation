import { selectLatestPurchaseRecords } from "./erpPurchaseSelection";
import { adoptedCostEvidence, normalizePurchaseEvidenceRecord, purchaseRecordPeriod, validateCostPeriod } from "./erpPurchaseEvidence";
export { purchaseRecordPeriod, validateCostPeriod } from "./erpPurchaseEvidence";

export function hasLegacyMonthExclusions(cost, period) {
  if (period == null) return false;
  validateCostPeriod(period);
  const evidence = cost?.warehouseEvidence ?? cost?.evidence ?? cost;
  const records = [...(evidence?.purchaseRecords ?? []), ...(evidence?.excludedRecords ?? [])];
  const excludedByMonth = records.filter(record => record.exclusionReasons?.includes("current_month"));
  if (excludedByMonth.some(record => {
    const month = purchaseRecordPeriod(record);
    return month === null || month < period;
  })) return true;
  const meta = cost?.sourceMeta ?? evidence?.sourceMeta;
  return Number(meta?.skippedCurrentMonth ?? 0) > 0 && excludedByMonth.length === 0;
}

// Published costs are not silently recalculated. Unverifiable or later-month
// evidence must be reviewed again before it can enter a live monthly report.
export function isErpCostWithinPeriod(cost, period) {
  if (period == null) return true;
  validateCostPeriod(period);
  if (hasLegacyMonthExclusions(cost, period)) return false;
  const { evidence, decision, records, selected } = adoptedCostEvidence(cost);
  if ([cost?.evidenceComplete, evidence?.evidenceComplete, decision?.evidenceComplete].includes(false)) return false;
  if (!(selected.length > 0 && selected.every(record => {
    const purchasePeriod = purchaseRecordPeriod(record);
    return purchasePeriod !== null && purchasePeriod < period;
  }))) return false;
  const expected = selectLatestPurchaseRecords(records.map((record, index) => normalizePurchaseEvidenceRecord(
    record, index, cost?.warehouseSku ?? evidence?.warehouseSku ?? decision?.warehouseSku, { period },
  )));
  return expected.length === selected.length
    && expected.every(record => selected.some(item => item.recordId === record.recordId));
}
