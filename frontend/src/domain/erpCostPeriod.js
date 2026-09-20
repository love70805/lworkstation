import { parseSalesAddedDate } from "./salesAnalytics";

export function validateCostPeriod(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "")) throw new Error("请先选择有效的账本月份，再核对 ERP 成本。");
  return period;
}

export function purchaseRecordPeriod(record) {
  const date = parseSalesAddedDate(record?.purchaseDate ?? record?.date);
  return date.dateStatus === "valid" ? date.sourceAddedDate.slice(0, 7) : null;
}

export function hasLegacyMonthExclusions(cost, period) {
  if (period == null) return false;
  validateCostPeriod(period);
  const evidence = cost?.warehouseEvidence ?? cost?.evidence ?? cost;
  const records = [...(evidence?.purchaseRecords ?? []), ...(evidence?.excludedRecords ?? [])];
  const excludedByMonth = records.filter(record => record.exclusionReasons?.includes("current_month"));
  if (excludedByMonth.some(record => {
    const month = purchaseRecordPeriod(record);
    return month === null || month <= period;
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
  const decision = cost?.costDecision ?? cost?.evidence?.costDecision;
  const records = cost?.purchaseRecords ?? cost?.evidence?.purchaseRecords ?? decision?.purchaseRecords ?? [];
  const ids = cost?.selectedRecordIds ?? decision?.selectedRecordIds ?? [];
  const selected = ids.length ? ids.map(id => records.find(record => record.recordId === id)) : decision?.selectedRecords ?? [];
  return selected.length > 0 && selected.every(record => {
    const purchasePeriod = purchaseRecordPeriod(record);
    return purchasePeriod !== null && purchasePeriod <= period;
  });
}
