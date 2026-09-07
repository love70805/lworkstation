import Decimal from "decimal.js";
import { canonicalWarehouseSku, normalizeWarehouseSku } from "./identifiers";

export const ERP_COST_RESOLUTION_VERSION = "shopeers-cost-resolution@1";
export const ERP_HISTORY_MIN_SAMPLES = 6;
export const ERP_PREVIEW_RECORD_LIMIT = 3;

export const ERP_COST_ANOMALY_LABELS = Object.freeze({
  unit_price_zero: "采购单价为 0",
  unit_price_one: "采购单价为 1，请确认是否为真实采购价",
  recent_price_shift_high: "近期采购价整体明显高于历史区间",
  recent_price_shift_low: "近期采购价整体明显低于历史区间",
  extreme_price_deviation: "单次采购价极端偏离历史中位价",
});

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundPrice(value) {
  const number = finiteNumber(value);
  return number == null ? null : Number(number.toFixed(4));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function purchaseTimestamp(record) {
  const explicit = finiteNumber(record?.timestamp);
  if (explicit != null) return explicit;
  const parsed = Date.parse(String(record?.purchaseDate ?? record?.date ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const CANCELLED_PURCHASE_STATUS = /(?:^|[\s:：])(?:11|cancel(?:led)?|void(?:ed)?|已取消|取消|已作废|作废|已关闭|关闭)(?:$|[\s:：])/i;

function purchaseYearMonth(value) {
  const match = String(value ?? "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return match ? Number(match[1]) * 100 + Number(match[2]) : null;
}

function cancelledByStatus(statusFields) {
  return Object.values(statusFields ?? {}).some((value) => {
    const normalized = String(value ?? "").normalize("NFKC").trim();
    return normalized === "11" || CANCELLED_PURCHASE_STATUS.test(normalized);
  });
}

function normalizedResolution(resolution, warehouseSku, record) {
  if (!resolution || typeof resolution !== "object") return null;
  if (canonicalWarehouseSku(resolution.warehouseSku ?? warehouseSku) !== canonicalWarehouseSku(warehouseSku)) return null;
  if (text(resolution.recordId) !== record.recordId) return null;
  const action = text(resolution.action);
  if (!["correct_price", "confirm_true_price"].includes(action)) return null;
  const resolvedAt = text(resolution.resolvedAt);
  const resolvedBy = text(resolution.resolvedBy);
  const originalUnitPrice = roundPrice(resolution.originalUnitPrice);
  const resolvedUnitPrice = roundPrice(resolution.resolvedUnitPrice);
  if (!resolvedAt || !Number.isFinite(Date.parse(resolvedAt)) || !resolvedBy) return null;
  if (originalUnitPrice == null || originalUnitPrice !== record.unitPrice) return null;
  if (resolvedUnitPrice == null || resolvedUnitPrice <= 0) return null;
  if (action === "confirm_true_price") {
    if (record.unitPrice <= 0 || resolvedUnitPrice !== record.unitPrice) return null;
  } else if (resolvedUnitPrice === record.unitPrice) {
    return null;
  }
  return {
    resolutionVersion: ERP_COST_RESOLUTION_VERSION,
    warehouseSku,
    recordId: record.recordId,
    action,
    originalUnitPrice,
    resolvedUnitPrice,
    reason: text(resolution.reason),
    resolvedBy,
    resolvedAt,
  };
}

export function normalizePurchaseEvidenceRecord(record, index = 0, fallbackWarehouseSku = null, { currentYearMonth = null } = {}) {
  const warehouseSkuText = text(record?.warehouseSku ?? fallbackWarehouseSku);
  const warehouseSku = warehouseSkuText ? normalizeWarehouseSku(warehouseSkuText) : null;
  const quantity = finiteNumber(record?.quantity ?? record?.qty ?? record?.purchaseQuantity);
  const unitPrice = roundPrice(record?.unitPrice ?? record?.purchaseUnitPrice);
  const totalPriceValue = finiteNumber(record?.totalPrice ?? record?.price);
  const exclusionReasons = [...new Set((Array.isArray(record?.exclusionReasons) ? record.exclusionReasons : [])
    .map((reason) => text(reason))
    .filter(Boolean))];
  const purchaseDate = text(record?.purchaseDate ?? record?.date);
  const recordId = text(record?.recordId ?? record?.id) ?? `record-${index + 1}`;
  const statusFields = record?.statusFields && typeof record.statusFields === "object" && !Array.isArray(record.statusFields)
    ? { ...record.statusFields }
    : {};
  const derivedExclusionReasons = [...exclusionReasons];
  if (!warehouseSku
    || !purchaseDate
    || purchaseTimestamp(record) <= 0
    || !Number.isFinite(quantity)
    || quantity <= 0
    || !Number.isFinite(unitPrice)
    || unitPrice < 0) {
    derivedExclusionReasons.push("invalid_purchase_detail");
  }
  if (cancelledByStatus(statusFields)) derivedExclusionReasons.push("cancelled_or_closed");
  if (currentYearMonth != null && purchaseYearMonth(purchaseDate) === Number(currentYearMonth)) {
    derivedExclusionReasons.push("current_month");
  }
  const normalizedExclusionReasons = [...new Set(derivedExclusionReasons)];
  return {
    recordId,
    warehouseSku,
    canonicalWarehouseSku: warehouseSku ? canonicalWarehouseSku(warehouseSku) : null,
    purchaseDate,
    timestamp: purchaseTimestamp(record),
    quantity,
    unitPrice,
    totalPrice: totalPriceValue ?? (quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(4)) : null),
    order1688: text(record?.order1688),
    purchaseOrderNo: text(record?.purchaseOrderNo),
    purchaseOrderId: text(record?.purchaseOrderId),
    supplierName: text(record?.supplierName),
    supplier1688Url: text(record?.supplier1688Url),
    statusFields,
    eligible: record?.eligible !== false && normalizedExclusionReasons.length === 0,
    selectedForPreview: Boolean(record?.selectedForPreview),
    exclusionReasons: normalizedExclusionReasons,
  };
}

export function selectFormalPurchaseRecords(records, maxRecords = ERP_PREVIEW_RECORD_LIMIT) {
  const eligible = (records ?? [])
    .filter((record) => record.eligible !== false
      && record.exclusionReasons.length === 0
      && record.warehouseSku
      && record.purchaseDate
      && Number.isFinite(record.quantity)
      && record.quantity > 0
      && Number.isFinite(record.unitPrice)
      && record.unitPrice >= 0)
    .toSorted((left, right) => (
      right.timestamp - left.timestamp
      || String(right.purchaseOrderId ?? "").localeCompare(String(left.purchaseOrderId ?? ""), "zh-CN", { numeric: true })
    ));
  const records1688 = eligible.filter((record) => record.order1688);
  return (records1688.length > 0 ? records1688 : eligible).slice(0, maxRecords);
}

export function detectPurchaseCostAnomalies(records, selectedRecords) {
  const positivePrices = (records ?? [])
    .filter((record) => record.eligible !== false && record.exclusionReasons.length === 0 && Number(record.unitPrice) > 0)
    .map((record) => Number(record.unitPrice));
  const baselineMedian = median(positivePrices);
  const baselineMad = baselineMedian == null
    ? null
    : median(positivePrices.map((price) => Math.abs(price - baselineMedian)));
  const baselineEnabled = positivePrices.length >= ERP_HISTORY_MIN_SAMPLES && baselineMedian > 0;
  const tolerance = baselineEnabled
    ? Math.max(baselineMedian * 0.3, 0.5, 3 * baselineMad)
    : null;
  const states = (selectedRecords ?? []).map((record) => {
    const reasons = [];
    if (record.unitPrice === 0) reasons.push("unit_price_zero");
    if (record.unitPrice === 1) reasons.push("unit_price_one");
    let deviationSide = null;
    if (baselineEnabled && Math.abs(record.unitPrice - baselineMedian) > tolerance) {
      deviationSide = record.unitPrice > baselineMedian ? "high" : "low";
    }
    if (baselineEnabled
      && Math.abs(record.unitPrice - baselineMedian) >= 1
      && (record.unitPrice >= baselineMedian * 2 || record.unitPrice <= baselineMedian * 0.5)) {
      reasons.push("extreme_price_deviation");
    }
    return { record, reasons, deviationSide };
  });
  const highCount = states.filter((state) => state.deviationSide === "high").length;
  const lowCount = states.filter((state) => state.deviationSide === "low").length;
  if (highCount >= 2) {
    states.filter((state) => state.deviationSide === "high").forEach((state) => state.reasons.push("recent_price_shift_high"));
  }
  if (lowCount >= 2) {
    states.filter((state) => state.deviationSide === "low").forEach((state) => state.reasons.push("recent_price_shift_low"));
  }
  return {
    baseline: {
      enabled: baselineEnabled,
      sampleCount: positivePrices.length,
      median: baselineMedian == null ? null : roundPrice(baselineMedian),
      mad: baselineMad == null ? null : roundPrice(baselineMad),
      tolerance: tolerance == null ? null : roundPrice(tolerance),
      lowerBound: tolerance == null ? null : roundPrice(Math.max(0, baselineMedian - tolerance)),
      upperBound: tolerance == null ? null : roundPrice(baselineMedian + tolerance),
    },
    anomalies: states
      .filter((state) => state.reasons.length > 0)
      .map((state) => ({
        recordId: state.record.recordId,
        originalUnitPrice: state.record.unitPrice,
        reasons: [...new Set(state.reasons)],
      })),
  };
}

export function calculateWarehouseCostDecision({
  warehouseSku,
  purchaseRecords = [],
  resolutions = [],
  evidenceComplete = true,
  currentYearMonth = null,
} = {}) {
  const normalizedWarehouseSku = normalizeWarehouseSku(warehouseSku);
  const records = purchaseRecords.map((record, index) => normalizePurchaseEvidenceRecord(
    record,
    index,
    normalizedWarehouseSku,
    { currentYearMonth },
  ));
  const selectedRecords = selectFormalPurchaseRecords(records);
  const detection = detectPurchaseCostAnomalies(records, selectedRecords);
  const resolutionMap = new Map((resolutions ?? []).map((resolution) => [text(resolution?.recordId), resolution]));
  const anomalyByRecord = new Map(detection.anomalies.map((anomaly) => [anomaly.recordId, anomaly]));
  const anomalies = detection.anomalies.map((anomaly) => {
    const record = selectedRecords.find((item) => item.recordId === anomaly.recordId);
    const resolution = normalizedResolution(resolutionMap.get(anomaly.recordId), normalizedWarehouseSku, record);
    return {
      ...anomaly,
      warehouseSku: normalizedWarehouseSku,
      resolution,
      status: resolution ? "resolved" : "pending",
    };
  });
  const resolvedRecords = selectedRecords.map((record) => {
    const anomaly = anomalyByRecord.get(record.recordId);
    const resolution = anomaly
      ? normalizedResolution(resolutionMap.get(record.recordId), normalizedWarehouseSku, record)
      : null;
    return {
      ...record,
      effectiveUnitPrice: resolution?.resolvedUnitPrice ?? record.unitPrice,
      resolution,
    };
  });
  const totalQuantity = resolvedRecords.reduce((sum, record) => sum.plus(record.quantity || 0), new Decimal(0));
  const totalPrice = resolvedRecords.reduce((sum, record) => (
    sum.plus(new Decimal(record.quantity || 0).times(record.effectiveUnitPrice || 0))
  ), new Decimal(0));
  const unresolvedAnomalyCount = anomalies.filter((anomaly) => anomaly.status === "pending").length;
  const hasNonPositivePrice = resolvedRecords.some((record) => !Number.isFinite(record.effectiveUnitPrice) || record.effectiveUnitPrice <= 0);
  const computedUnitCost = totalQuantity.gt(0)
    ? totalPrice.div(totalQuantity).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber()
    : null;
  const resolutionStatus = evidenceComplete
    && selectedRecords.length > 0
    && unresolvedAnomalyCount === 0
    && !hasNonPositivePrice
    && computedUnitCost > 0
    ? "resolved"
    : "pending";
  return {
    resolutionVersion: ERP_COST_RESOLUTION_VERSION,
    warehouseSku: normalizedWarehouseSku,
    evidenceComplete: Boolean(evidenceComplete),
    purchaseRecords: records,
    selectedRecordIds: selectedRecords.map((record) => record.recordId),
    selectedRecords: resolvedRecords,
    calculationCount: resolvedRecords.length,
    totalQuantity: totalQuantity.toNumber(),
    totalPrice: totalPrice.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
    unitCost: computedUnitCost,
    formalUnitCost: resolutionStatus === "resolved" ? computedUnitCost : null,
    baseline: detection.baseline,
    anomalies,
    anomalyCount: anomalies.length,
    unresolvedAnomalyCount,
    resolvedAnomalyCount: anomalies.length - unresolvedAnomalyCount,
    resolutions: anomalies.map((anomaly) => anomaly.resolution).filter(Boolean),
    resolutionStatus,
  };
}

export function upsertCostResolution(resolutions, resolution) {
  const recordId = text(resolution?.recordId);
  const warehouseSku = normalizeWarehouseSku(resolution?.warehouseSku);
  return [
    ...(resolutions ?? []).filter((item) => (
      text(item?.recordId) !== recordId || canonicalWarehouseSku(item?.warehouseSku) !== canonicalWarehouseSku(warehouseSku)
    )),
    { ...resolution, warehouseSku, recordId },
  ];
}
