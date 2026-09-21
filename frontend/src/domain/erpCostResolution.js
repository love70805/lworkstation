import Decimal from "decimal.js";
import { canonicalWarehouseSku, normalizeWarehouseSku } from "./identifiers";
import { normalizePurchaseEvidenceRecord, validateCostPeriod } from "./erpPurchaseEvidence";
import { selectLatestPurchaseRecords } from "./erpPurchaseSelection";
export { normalizePurchaseEvidenceRecord } from "./erpPurchaseEvidence";

export const ERP_COST_RESOLUTION_VERSION = "shopeers-cost-resolution@5-unit-4dp-beta-current-month-latest-three";
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

function normalizedResolution(resolution, warehouseSku, record) {
  if (!resolution || typeof resolution !== "object") return null;
  if (canonicalWarehouseSku(resolution.warehouseSku ?? warehouseSku) !== canonicalWarehouseSku(warehouseSku)) return null;
  if (text(resolution.recordId) !== record.recordId) return null;
  const action = text(resolution.action);
  if (!["correct_price", "confirm_true_price"].includes(action)) return null;
  const resolvedAt = text(resolution.resolvedAt);
  const resolvedBy = text(resolution.resolvedBy);
  const originalUnitPrice = finiteNumber(resolution.originalUnitPrice);
  const resolvedUnitPrice = action === "confirm_true_price" ? finiteNumber(resolution.resolvedUnitPrice) : roundPrice(resolution.resolvedUnitPrice);
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

export function selectFormalPurchaseRecords(records, maxRecords = ERP_PREVIEW_RECORD_LIMIT) {
  return selectLatestPurchaseRecords(records, maxRecords);
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
  period = null,
  currentYearMonth = null,
} = {}) {
  if (period != null) validateCostPeriod(period);
  const normalizedWarehouseSku = normalizeWarehouseSku(warehouseSku);
  const records = purchaseRecords.map((record, index) => normalizePurchaseEvidenceRecord(
    record,
    index,
    normalizedWarehouseSku,
    { period, currentYearMonth },
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
    ? totalPrice.div(totalQuantity).toDecimalPlaces(4, Decimal.ROUND_DOWN).toNumber()
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
    costPeriod: period,
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
