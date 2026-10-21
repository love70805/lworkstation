import { parseSalesAddedDate } from "./salesAnalytics";

export function purchaseTimestamp(record) {
  return purchaseDateFacts(record).timestamp;
}

export function purchaseDateFacts(record) {
  const raw = String(record?.purchaseDate ?? record?.date ?? "").trim();
  const date = parseSalesAddedDate(raw);
  if (date.dateStatus !== "valid") return { period: null, timestamp: 0 };
  const clock = raw.match(/[ T](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  // ERP dates without a zone use the same China business timezone as the month cutoff.
  const parsed = clock?.[5] ? Date.parse(raw) : Date.parse(
    `${date.sourceAddedDate}T${(clock?.[1] ?? "00").padStart(2, "0")}:${clock?.[2] ?? "00"}:${clock?.[3] ?? "00"}${clock?.[4] ?? ""}+08:00`,
  );
  return { period: date.sourceAddedDate.slice(0, 7), timestamp: Number.isFinite(parsed) ? parsed : 0 };
}

export function selectLatestPurchaseRecords(records, maxRecords = 3) {
  // Keys belong to this call only: evidence may be edited before the next
  // validation. Parsing dates or constructing a collator inside the comparator
  // repeats expensive work for every pair in a large purchase history.
  return (records ?? [])
    .map(record => ({ record, timestamp: purchaseTimestamp(record) }))
    .filter(({ record, timestamp }) => record.eligible !== false
      && (record.exclusionReasons ?? []).length === 0 && timestamp > 0
      && Number.isFinite(Number(record.quantity))
      && Number(record.quantity) > 0
      && record.unitPrice != null
      && Number.isFinite(Number(record.unitPrice))
      && Number(record.unitPrice) >= 0)
    .toSorted((left, right) => right.timestamp - left.timestamp
      || purchaseIdOrder.compare(String(right.record.purchaseOrderId ?? ""), String(left.record.purchaseOrderId ?? ""))
      || purchaseIdOrder.compare(String(right.record.recordId ?? ""), String(left.record.recordId ?? "")))
    .slice(0, maxRecords).map(({ record }) => record);
}

const purchaseIdOrder = new Intl.Collator('zh-CN', { numeric: true });

export function purchaseOrderSummary(records = []) {
  const types = new Set(records.map(record => record.order1688 ? "1688" : "purchase_order"));
  return {
    orderNumber: records.map(record => record.order1688 || record.purchaseOrderNo || record.purchaseOrderId || "").filter(Boolean).join(" / ") || null,
    orderType: types.size > 1 ? "mixed" : [...types][0] ?? null,
  };
}
