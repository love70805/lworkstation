import { parseSalesAddedDate } from "./salesAnalytics";

export function purchaseTimestamp(record) {
  const raw = String(record?.purchaseDate ?? record?.date ?? "").trim();
  const date = parseSalesAddedDate(raw);
  if (date.dateStatus !== "valid") return 0;
  const clock = raw.match(/[ T](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  // ERP dates without a zone use the same China business timezone as the month cutoff.
  const parsed = clock?.[5] ? Date.parse(raw) : Date.parse(
    `${date.sourceAddedDate}T${(clock?.[1] ?? "00").padStart(2, "0")}:${clock?.[2] ?? "00"}:${clock?.[3] ?? "00"}${clock?.[4] ?? ""}+08:00`,
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectLatestPurchaseRecords(records, maxRecords = 3) {
  return (records ?? [])
    .filter(record => record.eligible !== false
      && (record.exclusionReasons ?? []).length === 0
      && purchaseTimestamp(record) > 0
      && Number.isFinite(Number(record.quantity))
      && Number(record.quantity) > 0
      && record.unitPrice != null
      && Number.isFinite(Number(record.unitPrice))
      && Number(record.unitPrice) >= 0)
    .toSorted((left, right) => purchaseTimestamp(right) - purchaseTimestamp(left)
      || String(right.purchaseOrderId ?? "").localeCompare(String(left.purchaseOrderId ?? ""), "zh-CN", { numeric: true })
      || String(right.recordId ?? "").localeCompare(String(left.recordId ?? ""), "zh-CN", { numeric: true }))
    .slice(0, maxRecords);
}

export function purchaseOrderSummary(records = []) {
  const types = new Set(records.map(record => record.order1688 ? "1688" : "purchase_order"));
  return {
    orderNumber: records.map(record => record.order1688 || record.purchaseOrderNo || record.purchaseOrderId || "").filter(Boolean).join(" / ") || null,
    orderType: types.size > 1 ? "mixed" : [...types][0] ?? null,
  };
}
