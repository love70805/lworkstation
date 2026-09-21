import { canonicalWarehouseSku, normalizeWarehouseSku } from "./identifiers";
import { parseSalesAddedDate } from "./salesAnalytics";
import { purchaseTimestamp } from "./erpPurchaseSelection";

const text = value => String(value ?? "").trim() || null;
const finiteNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;
const CANCELLED_PURCHASE_STATUS = /(?:^|[\s:：])(?:11|cancel(?:led)?|void(?:ed)?|已取消|取消|已作废|作废|已关闭|关闭)(?:$|[\s:：])/i;

export function validateCostPeriod(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "")) throw new Error("请先选择有效的账本月份，再核对 ERP 成本。");
  return period;
}

export function purchaseRecordPeriod(record) {
  const date = parseSalesAddedDate(record?.purchaseDate ?? record?.date);
  return date.dateStatus === "valid" ? date.sourceAddedDate.slice(0, 7) : null;
}

export function normalizePurchaseEvidenceRecord(record, index = 0, fallbackWarehouseSku = null, { period = null, currentYearMonth = null } = {}) {
  const warehouseSkuText = text(record?.warehouseSku ?? fallbackWarehouseSku);
  const warehouseSku = warehouseSkuText ? normalizeWarehouseSku(warehouseSkuText) : null;
  const quantity = finiteNumber(record?.quantity ?? record?.qty ?? record?.purchaseQuantity);
  const unitPrice = finiteNumber(record?.unitPrice ?? record?.purchaseUnitPrice);
  const totalPriceValue = finiteNumber(record?.totalPrice ?? record?.price);
  const exclusionReasons = [...new Set((Array.isArray(record?.exclusionReasons) ? record.exclusionReasons : []).map(text).filter(Boolean))];
  const purchaseDate = text(record?.purchaseDate ?? record?.date);
  const purchasePeriod = purchaseRecordPeriod(record);
  const recordId = text(record?.recordId ?? record?.id) ?? `record-${index + 1}`;
  const statusFields = record?.statusFields && typeof record.statusFields === "object" && !Array.isArray(record.statusFields)
    ? { ...record.statusFields } : {};
  const derivedExclusionReasons = [...exclusionReasons];
  if (!warehouseSku || !purchaseDate || !purchasePeriod || purchaseTimestamp(record) <= 0
    || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
    derivedExclusionReasons.push("invalid_purchase_detail");
  }
  if (Object.values(statusFields).some(value => {
    const normalized = String(value ?? "").normalize("NFKC").trim();
    return normalized === "11" || CANCELLED_PURCHASE_STATUS.test(normalized);
  })) derivedExclusionReasons.push("cancelled_or_closed");
  if (period != null && purchasePeriod && purchasePeriod >= validateCostPeriod(period)) {
    derivedExclusionReasons.push("on_or_after_ledger_period");
  }
  if (period == null && currentYearMonth != null && Number(purchasePeriod?.replace("-", "")) === Number(currentYearMonth)) {
    derivedExclusionReasons.push("current_month");
  }
  const normalizedExclusionReasons = [...new Set(derivedExclusionReasons)];
  return {
    recordId, warehouseSku, canonicalWarehouseSku: warehouseSku ? canonicalWarehouseSku(warehouseSku) : null,
    purchaseDate, timestamp: purchaseTimestamp(record), quantity, unitPrice,
    totalPrice: totalPriceValue ?? (quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(4)) : null),
    order1688: text(record?.order1688), purchaseOrderNo: text(record?.purchaseOrderNo), purchaseOrderId: text(record?.purchaseOrderId),
    supplierName: text(record?.supplierName), supplier1688Url: text(record?.supplier1688Url), statusFields,
    eligible: record?.eligible !== false && normalizedExclusionReasons.length === 0,
    selectedForPreview: Boolean(record?.selectedForPreview), exclusionReasons: normalizedExclusionReasons,
  };
}

export function adoptedCostEvidence(cost) {
  const evidence = cost?.warehouseEvidence ?? cost?.evidence ?? cost;
  const decision = cost?.costDecision ?? evidence?.costDecision;
  const records = cost?.purchaseRecords ?? evidence?.purchaseRecords ?? decision?.purchaseRecords ?? [];
  const ids = cost?.selectedRecordIds ?? decision?.selectedRecordIds ?? [];
  const selected = ids.length ? ids.map(id => {
    const record = records.find(item => item.recordId === id);
    if (!record) return undefined;
    const resolved = decision?.selectedRecords?.find(item => item.recordId === id);
    return { ...record, effectiveUnitPrice: resolved?.effectiveUnitPrice ?? record.unitPrice };
  }) : decision?.selectedRecords ?? [];
  return { evidence, decision, records, selected };
}
