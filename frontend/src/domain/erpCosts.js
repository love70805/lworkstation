import Decimal from "decimal.js";
import { assertDomain } from "./errors";
import {
  assertUniquePlatformSkus,
  canonicalPlatformSkc,
  canonicalPlatformSku,
  canonicalWarehouseSku,
  normalizePlatformSkc,
  normalizePlatformSku,
  normalizeWarehouseSku,
  normalizeWorkspaceId,
} from "./identifiers";
import { calculateWarehouseCostDecision } from "./erpCostResolution";

export const ERP_COST_ALGORITHM_VERSION = "erp-v8.0-compatible@1";
export const DEFAULT_CURRENCY = "CNY";
export const ERP_LEDGER_SCOPE_EXPECTED = "expected";
export const ERP_LEDGER_SCOPE_AUXILIARY = "auxiliary";

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  assertDomain(text.length > 0, "required_value", `${label}不能为空`, { label });
  return text;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function validIsoTimestamp(value, label) {
  const text = requiredText(value, label);
  assertDomain(Number.isFinite(Date.parse(text)), "invalid_timestamp", `${label}不是有效时间`, { label, value });
  return text;
}

function positiveDecimal(value) {
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.gt(0) ? amount : null;
  } catch {
    return null;
  }
}

function finiteDecimal(value) {
  try {
    const amount = new Decimal(value);
    return amount.isFinite() ? amount : null;
  } catch {
    return null;
  }
}

function optionalFiniteNumber(value, { minimum = null, integer = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (minimum != null && number < minimum) return null;
  if (integer && !Number.isInteger(number)) return null;
  return number;
}

const CANCELLED_PURCHASE_STATUS = /(?:^|[\s:：])(?:11|cancel(?:led)?|void(?:ed)?|已取消|取消|已作废|作废|已关闭|关闭)(?:$|[\s:：])/i;

export function isCancelledPurchaseRecord(record = {}) {
  const statusValues = [
    record.purchaseStatus,
    record.paymentStatus,
    record.payStatus,
    record.orderStatus,
    record.order1688Status,
    record.orderStatus1688,
    record.purchaseOrderStatus,
    record.status,
  ];
  Object.entries(record).forEach(([key, value]) => {
    if (/(status|state|状态)/i.test(key)) statusValues.push(value);
  });
  return statusValues.some((value) => {
    const normalized = String(value ?? "").normalize("NFKC").trim();
    return normalized === "11" || CANCELLED_PURCHASE_STATUS.test(normalized);
  });
}

function parsePurchaseDate(value) {
  const text = String(value ?? "");
  const match = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dateValue = year * 10000 + month * 100 + day;
  let timestamp = Date.parse(text.replace(" ", "T"));
  if (!Number.isFinite(timestamp)) timestamp = dateValue;

  return {
    text: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    yearMonth: year * 100 + month,
    dateValue,
    timestamp,
  };
}

function normalizeExpectedSku(item, workspaceId, index) {
  const source = typeof item === "string" ? { platformSku: item } : item;
  const platformSku = normalizePlatformSku(source.platformSku);
  const warehouseSku = optionalText(source.warehouseSku);

  return {
    ...source,
    id: source.id ?? null,
    workspaceId,
    platformSku,
    canonicalPlatformSku: canonicalPlatformSku(platformSku),
    warehouseSku: warehouseSku ? normalizeWarehouseSku(warehouseSku) : null,
    canonicalWarehouseSku: warehouseSku ? canonicalWarehouseSku(warehouseSku) : null,
    inputIndex: index,
  };
}

function normalizeCostRow(row, index, defaultBatchId, resolutions) {
  const platformSkuText = optionalText(row.platformSku);
  const warehouseSkuText = optionalText(row.warehouseSku);
  const previewCost = finiteDecimal(row.previewUnitCost ?? row.unitCost);
  const currency = String(row.currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  const reasons = [];
  const ledgerScopeRole = row.ledgerScopeRole == null || row.ledgerScopeRole === ""
    ? ERP_LEDGER_SCOPE_EXPECTED
    : String(row.ledgerScopeRole).trim().toLowerCase();
  const purchaseRecords = Array.isArray(row.purchaseRecords)
    ? row.purchaseRecords
    : (Array.isArray(row.warehouseEvidence?.purchaseRecords) ? row.warehouseEvidence.purchaseRecords : []);
  const evidenceComplete = row.evidenceComplete === true
    || row.warehouseEvidence?.evidenceComplete === true;
  const trustedPublishedLegacy = Boolean(row.publishedAt) && Boolean(previewCost?.gt(0));
  const decision = warehouseSkuText && purchaseRecords.length > 0
    ? calculateWarehouseCostDecision({
      warehouseSku: warehouseSkuText,
      purchaseRecords,
      resolutions,
      evidenceComplete,
      currentYearMonth: optionalFiniteNumber(row.currentYearMonth, { minimum: 190001, integer: true }),
    })
    : null;

  if (!platformSkuText && !warehouseSkuText) reasons.push("missing_sku");
  if (!decision && (!previewCost || !previewCost.gt(0))) reasons.push("invalid_unit_cost");
  if (currency !== DEFAULT_CURRENCY) reasons.push("unsupported_currency");
  if (![ERP_LEDGER_SCOPE_EXPECTED, ERP_LEDGER_SCOPE_AUXILIARY].includes(ledgerScopeRole)) reasons.push("invalid_ledger_scope_role");

  if (reasons.length > 0) {
    return {
      valid: false,
      sourceRow: row.sourceRow ?? index + 1,
      reasons,
      row,
    };
  }

  return {
    valid: true,
    sourceRow: row.sourceRow ?? index + 1,
    platformSku: platformSkuText ? normalizePlatformSku(platformSkuText) : null,
    canonicalPlatformSku: platformSkuText ? canonicalPlatformSku(platformSkuText) : null,
    warehouseSku: warehouseSkuText ? normalizeWarehouseSku(warehouseSkuText) : null,
    canonicalWarehouseSku: warehouseSkuText ? canonicalWarehouseSku(warehouseSkuText) : null,
    previewUnitCost: previewCost?.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber() ?? null,
    unitCost: decision?.unitCost ?? previewCost?.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber() ?? null,
    formalUnitCost: decision?.formalUnitCost ?? (trustedPublishedLegacy ? previewCost.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber() : null),
    currency,
    orderNumber: optionalText(row.orderNumber ?? row.orderNo ?? row.order1688),
    orderType: optionalText(row.orderType ?? row.sourceType),
    platformSkc: optionalText(row.platformSkc),
    canonicalPlatformSkc: row.platformSkc ? canonicalPlatformSkc(row.platformSkc) : null,
    productName: optionalText(row.productName ?? row.name),
    calculationCount: optionalFiniteNumber(row.calculationCount ?? row.calcTimes, { minimum: 1, integer: true }),
    dateRange: optionalText(row.dateRange),
    totalQuantity: optionalFiniteNumber(row.totalQuantity ?? row.totalQty, { minimum: 0 }),
    totalPrice: optionalFiniteNumber(row.totalPrice, { minimum: 0 }),
    supplierName: optionalText(row.supplierName),
    supplier1688Url: optionalText(row.supplier1688Url ?? row.supplierOfferUrl ?? row.sourceUrl),
    selectedRecordIds: Array.isArray(row.selectedRecordIds)
      ? row.selectedRecordIds.map((id) => String(id)).filter(Boolean)
      : [],
    purchaseRecords,
    excludedRecords: Array.isArray(row.excludedRecords)
      ? row.excludedRecords
      : (Array.isArray(row.warehouseEvidence?.excludedRecords) ? row.warehouseEvidence.excludedRecords : []),
    sourceWarnings: Array.isArray(row.sourceWarnings)
      ? row.sourceWarnings.map((warning) => String(warning)).filter(Boolean)
      : (Array.isArray(row.warehouseEvidence?.sourceWarnings) ? row.warehouseEvidence.sourceWarnings : []),
    evidenceComplete,
    currentYearMonth: optionalFiniteNumber(row.currentYearMonth, { minimum: 190001, integer: true }),
    costDecision: decision,
    resolutionStatus: decision?.resolutionStatus ?? (trustedPublishedLegacy ? "resolved" : "pending"),
    unresolvedAnomalyCount: decision?.unresolvedAnomalyCount ?? 0,
    resolvedAnomalyCount: decision?.resolvedAnomalyCount ?? 0,
    anomalyCount: decision?.anomalyCount ?? 0,
    anomalies: decision?.anomalies ?? [],
    resolutions: decision?.resolutions ?? [],
    baseline: decision?.baseline ?? null,
    batchId: optionalText(row.batchId ?? defaultBatchId),
    calculatedAt: optionalText(row.calculatedAt),
    mappingFallback: Boolean(row.mappingFallback),
    ledgerScopeRole,
    raw: row,
  };
}

function addIndexedCost(index, key, keyType, row, overrides) {
  if (!key) return;
  const previous = index.get(key);
  let next = row;

  if (previous) {
    next = {
      ...row,
      orderNumber: row.orderNumber || previous.orderNumber,
      orderType: row.orderNumber ? row.orderType : previous.orderType,
    };
    overrides.push({
      keyType,
      key,
      previousSourceRow: previous.sourceRow,
      nextSourceRow: row.sourceRow,
      previousUnitCost: previous.unitCost,
      nextUnitCost: row.unitCost,
      changedCost: previous.unitCost !== row.unitCost,
      retainedPreviousOrderNumber: !row.orderNumber && Boolean(previous.orderNumber),
    });
  }

  index.set(key, next);
}

export function buildErpCostRequest({
  id,
  workspaceId,
  platformSkcs,
  expectedSkus = [],
  requestedBy,
  requestedAt,
  ledgerId = null,
}) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const seen = new Set();
  const skcs = [];

  (platformSkcs ?? []).forEach((item) => {
    const sourceValue = typeof item === "string" ? item : item?.platformSkc;
    const platformSkc = normalizePlatformSkc(sourceValue);
    const canonicalSkc = canonicalPlatformSkc(platformSkc);
    if (seen.has(canonicalSkc)) return;
    seen.add(canonicalSkc);
    skcs.push({ platformSkc, canonicalPlatformSkc: canonicalSkc });
  });

  assertDomain(skcs.length > 0, "erp_request_empty", "ERP 成本请求至少需要一个平台 SKC");

  const expectedSkuMap = new Map();
  (expectedSkus ?? []).forEach((item) => {
    const platformSkuText = String(typeof item === "string" ? item : item?.platformSku ?? "").trim();
    const platformSkcText = String(typeof item === "string" ? "" : item?.platformSkc ?? "").trim();
    if (!platformSkuText || !platformSkcText) return;
    const platformSku = normalizePlatformSku(platformSkuText);
    const platformSkc = normalizePlatformSkc(platformSkcText);
    const canonicalSku = canonicalPlatformSku(platformSku);
    const canonicalSkc = canonicalPlatformSkc(platformSkc);
    if (!canonicalSku || !platformSkc) return;
    assertDomain(seen.has(canonicalSkc), "erp_expected_sku_outside_query", `平台 SKU ${platformSku} 的平台 SKC 不在 ERP 查询范围内`, {
      platformSku,
      platformSkc,
    });
    expectedSkuMap.set(canonicalSku, {
      platformSku,
      canonicalPlatformSku: canonicalSku,
      platformSkc,
      canonicalPlatformSkc: canonicalSkc,
    });
  });

  return {
    schemaVersion: 1,
    id: requiredText(id, "成本请求 ID"),
    workspaceId: normalizedWorkspaceId,
    ledgerId: optionalText(ledgerId),
    requestedBy: requiredText(requestedBy, "请求人"),
    requestedAt: validIsoTimestamp(requestedAt, "请求时间"),
    queryUnit: "platform_skc",
    platformSkcs: skcs,
    expectedSkus: [...expectedSkuMap.values()],
    currency: DEFAULT_CURRENCY,
    algorithmVersion: ERP_COST_ALGORITHM_VERSION,
    status: "draft",
  };
}

export function selectLegacyCostRecords(records, maxRecords = 3) {
  assertDomain(Number.isInteger(maxRecords) && maxRecords > 0, "invalid_record_limit", "采购记录上限必须是正整数");
  const records1688 = records.filter((record) => optionalText(record.order1688));
  return (records1688.length > 0 ? records1688 : records).slice(0, maxRecords);
}

export function calculateLegacyWarehouseCosts(records, { currentYearMonth = null, maxRecords = 3 } = {}) {
  const buckets = new Map();
  let skippedCancelled = 0;
  let skippedCurrentMonth = 0;
  let skippedInvalid = 0;

  records.forEach((record) => {
    if (isCancelledPurchaseRecord(record)) {
      skippedCancelled += 1;
      return;
    }

    const warehouseSkuText = optionalText(record.warehouseSku ?? record.productSku ?? record.productId);
    const date = parsePurchaseDate(record.purchaseDate ?? record.creationTime ?? record.date);
    const quantity = positiveDecimal(record.quantity ?? record.qty ?? record.purchaseQuantity);
    const unitPrice = finiteDecimal(record.unitPrice ?? record.purchaseUnitPrice);

    if (!warehouseSkuText || !date || !quantity || !unitPrice) {
      skippedInvalid += 1;
      return;
    }
    if (currentYearMonth != null && date.yearMonth === Number(currentYearMonth)) {
      skippedCurrentMonth += 1;
      return;
    }

    const warehouseSku = normalizeWarehouseSku(warehouseSkuText);
    const normalized = {
      id: optionalText(record.id ?? record.purchaseRecordId ?? record.purchaseOrderId) ?? `row-${buckets.size + 1}`,
      warehouseSku,
      name: optionalText(record.name ?? record.tradeName) ?? "",
      quantity,
      unitPrice,
      totalPrice: quantity.times(unitPrice),
      date: date.text,
      timestamp: date.timestamp,
      order1688: optionalText(record.order1688 ?? record.purchaseOrderNo1688),
      purchaseOrderNo: optionalText(record.purchaseOrderNo),
      purchaseOrderId: optionalText(record.purchaseOrderId) ?? "",
      raw: record,
    };

    const bucket = buckets.get(warehouseSku) ?? [];
    bucket.push(normalized);
    buckets.set(warehouseSku, bucket);
  });

  const costs = [...buckets.entries()].map(([warehouseSku, bucket]) => {
    const sorted = bucket.toSorted((a, b) => {
      if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return b.purchaseOrderId.localeCompare(a.purchaseOrderId, "zh-CN", { numeric: true });
    });
    const selected = selectLegacyCostRecords(sorted, maxRecords);
    const totalQuantity = selected.reduce((sum, record) => sum.plus(record.quantity), new Decimal(0));
    const totalPrice = selected.reduce((sum, record) => sum.plus(record.totalPrice), new Decimal(0));
    const newest = selected[0];
    const oldest = selected[selected.length - 1];

    return {
      warehouseSku,
      name: newest.name || sorted[0].name || "",
      sourceType: newest.order1688 ? "1688" : "purchase_order",
      orderNumber: newest.order1688 || newest.purchaseOrderNo || "",
      calculationCount: selected.length,
      dateRange: newest.date === oldest.date ? newest.date : `${oldest.date} ~ ${newest.date}`,
      totalQuantity: totalQuantity.toNumber(),
      totalPrice: totalPrice.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
      unitCost: totalPrice.div(totalQuantity).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
      selectedRecordIds: selected.map((record) => record.id),
      algorithmVersion: ERP_COST_ALGORITHM_VERSION,
      currency: DEFAULT_CURRENCY,
    };
  }).toSorted((a, b) => a.warehouseSku.localeCompare(b.warehouseSku, "zh-CN", { numeric: true }));

  return {
    costs,
    skippedCancelled,
    skippedCurrentMonth,
    skippedInvalid,
  };
}

export function reconcileErpCostRows({ workspaceId, expectedSkus, costRows, batchId = null, resolutions = [] }) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const expected = (expectedSkus ?? []).map((item, index) => normalizeExpectedSku(item, normalizedWorkspaceId, index));
  assertUniquePlatformSkus(expected);

  const platformIndex = new Map();
  const warehouseIndex = new Map();
  const validRows = [];
  const auxiliaryCostRows = [];
  const invalidRows = [];
  const overrides = [];

  (costRows ?? []).forEach((row, index) => {
    const normalized = normalizeCostRow(row, index, batchId, resolutions);
    if (!normalized.valid) {
      invalidRows.push(normalized);
      return;
    }

    validRows.push(normalized);
    if (normalized.ledgerScopeRole === ERP_LEDGER_SCOPE_AUXILIARY) {
      auxiliaryCostRows.push(normalized);
      return;
    }
    addIndexedCost(platformIndex, normalized.canonicalPlatformSku, "platform_sku", normalized, overrides);
    addIndexedCost(warehouseIndex, normalized.canonicalWarehouseSku, "warehouse_sku", normalized, overrides);
  });

  const usedRows = new Set();
  const matches = expected.map((item) => {
    const direct = platformIndex.get(item.canonicalPlatformSku);
    const warehouseFallback = !direct && item.canonicalWarehouseSku
      ? warehouseIndex.get(item.canonicalWarehouseSku)
      : null;
    const cost = direct ?? warehouseFallback;

    if (!cost) {
      return {
        ...item,
        status: "missing",
        matchMethod: null,
        unitCost: null,
        currency: DEFAULT_CURRENCY,
      };
    }

    usedRows.add(cost.sourceRow);
    const resolutionPending = cost.resolutionStatus !== "resolved";
    return {
      ...item,
      status: resolutionPending ? "anomaly_pending" : "matched",
      matchMethod: direct ? "platform_sku" : "warehouse_sku_fallback",
      unitCost: cost.unitCost,
      formalUnitCost: cost.formalUnitCost,
      previewUnitCost: cost.previewUnitCost,
      currency: cost.currency,
      sourceRow: cost.sourceRow,
      sourceBatchId: cost.batchId,
      sourcePlatformSku: cost.platformSku,
      platformSkc: cost.platformSkc,
      canonicalPlatformSkc: cost.canonicalPlatformSkc,
      sourceWarehouseSku: cost.warehouseSku,
      orderNumber: cost.orderNumber,
      orderType: cost.orderType,
      productName: cost.productName,
      calculationCount: cost.calculationCount,
      dateRange: cost.dateRange,
      totalQuantity: cost.totalQuantity,
      totalPrice: cost.totalPrice,
      supplierName: cost.supplierName,
      supplier1688Url: cost.supplier1688Url,
      selectedRecordIds: cost.costDecision?.selectedRecordIds ?? cost.selectedRecordIds,
      purchaseRecords: cost.purchaseRecords,
      excludedRecords: cost.excludedRecords,
      sourceWarnings: cost.sourceWarnings,
      evidenceRef: cost.raw?.evidenceRef ?? cost.evidenceRef ?? null,
      mappingFailures: cost.raw?.mappingFailures ?? cost.mappingFailures ?? [],
      detailFailures: cost.raw?.detailFailures ?? cost.detailFailures ?? [],
      raw: cost.raw,
      evidenceComplete: cost.evidenceComplete,
      currentYearMonth: cost.currentYearMonth,
      costDecision: cost.costDecision,
      resolutionStatus: cost.resolutionStatus,
      unresolvedAnomalyCount: cost.unresolvedAnomalyCount,
      resolvedAnomalyCount: cost.resolvedAnomalyCount,
      anomalyCount: cost.anomalyCount,
      anomalies: cost.anomalies,
      resolutions: cost.resolutions,
      baseline: cost.baseline,
      mappingFallback: cost.mappingFallback || !direct,
      ledgerScopeRole: cost.ledgerScopeRole,
      requiresReview: !direct || resolutionPending,
    };
  });

  const effectiveRows = [...new Map(
    [...platformIndex.values(), ...warehouseIndex.values()].map((row) => [row.sourceRow, row]),
  ).values()];
  const unmatchedCostRows = effectiveRows.filter((row) => !usedRows.has(row.sourceRow));

  return {
    matches,
    invalidRows,
    overrides,
    unmatchedCostRows,
    auxiliaryCostRows,
    summary: {
      expectedCount: expected.length,
      matchedCount: matches.filter((item) => item.status === "matched").length,
      missingCount: matches.filter((item) => item.status !== "matched").length,
      anomalyPendingCount: matches.filter((item) => item.status === "anomaly_pending").length,
      anomalyConfirmedCount: matches.filter((item) => item.status === "matched" && item.resolvedAnomalyCount > 0).length,
      unresolvedAnomalyCount: matches.reduce((sum, item) => sum + Number(item.unresolvedAnomalyCount ?? 0), 0),
      evidenceIncompleteCount: matches.filter((item) => item.status === "anomaly_pending" && item.evidenceComplete === false).length,
      invalidRowCount: invalidRows.length,
      overrideCount: overrides.length,
      fallbackCount: matches.filter((item) => item.matchMethod === "warehouse_sku_fallback").length,
      auxiliaryCount: auxiliaryCostRows.length,
    },
  };
}
