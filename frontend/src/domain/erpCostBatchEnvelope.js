import {
  DEFAULT_CURRENCY,
  ERP_COST_ALGORITHM_VERSION,
  ERP_LEDGER_SCOPE_AUXILIARY,
  ERP_LEDGER_SCOPE_EXPECTED,
} from "./erpCosts";
import {
  canonicalPlatformSkc,
  canonicalPlatformSku,
  canonicalWarehouseSku,
  normalizePlatformSkc,
  normalizePlatformSku,
  normalizeWarehouseSku,
  normalizeWorkspaceId,
} from "./identifiers";

export const ERP_COST_BATCH_FORMAT = "shopeers-erp-cost-batch";
export const ERP_COST_BATCH_VERSION = 2;
export const ERP_COST_EVIDENCE_VERSION = 1;
export const ERP_V8_BASELINE = Object.freeze({
  application: "ERP Assistant",
  version: "8.0.0",
  releaseSha256: "199561b86755b93000f3fc0197e8cd4ed5e699072a76d11d48e00c18f8e4a0ed",
});

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function validTimestamp(value, label) {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label}不是有效时间。`);
  return text;
}

function optionalFiniteNumber(value, label, { minimum = null, integer = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}不是有效数字。`);
  if (minimum != null && number < minimum) throw new Error(`${label}不能小于 ${minimum}。`);
  if (integer && !Number.isInteger(number)) throw new Error(`${label}必须是整数。`);
  return number;
}

function uniqueText(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(optionalText).filter(Boolean))];
}

function sourceWarningsContract(record, { strict = false, label = "ERP 成本批次来源警告" } = {}) {
  const hasField = Boolean(record && typeof record === "object" && !Array.isArray(record)
    && Object.prototype.hasOwnProperty.call(record, "sourceWarnings"));
  if (!hasField) return { hasField: false, warnings: [] };
  if (!Array.isArray(record.sourceWarnings)) {
    if (strict) throw new Error(`${label} sourceWarnings 必须是字符串数组。`);
    return { hasField: true, warnings: ["invalid_source_warnings_contract"] };
  }
  if (record.sourceWarnings.some((warning) => typeof warning !== "string")) {
    if (strict) throw new Error(`${label} sourceWarnings 只能包含字符串。`);
    return { hasField: true, warnings: ["invalid_source_warnings_contract"] };
  }
  return { hasField: true, warnings: uniqueText(record.sourceWarnings) };
}

function safeStatusFields(record) {
  const explicit = record?.statusFields && typeof record.statusFields === "object" && !Array.isArray(record.statusFields)
    ? record.statusFields
    : {};
  return Object.fromEntries(Object.entries({
    ...explicit,
    purchaseStatus: record?.purchaseStatus,
    paymentStatus: record?.paymentStatus ?? record?.payStatus,
    orderStatus: record?.orderStatus,
    order1688Status: record?.order1688Status ?? record?.orderStatus1688,
    purchaseOrderStatus: record?.purchaseOrderStatus,
    status: record?.status,
  }).filter(([, value]) => value != null && ["string", "number", "boolean"].includes(typeof value)));
}

function normalizeQuerySkcs(values) {
  if (!Array.isArray(values)) throw new Error("ERP 成本批次缺少平台 SKC 查询范围。");
  const seen = new Set();
  const skcs = [];
  for (const value of values) {
    const source = typeof value === "string" ? value : value?.platformSkc;
    const platformSkc = normalizePlatformSkc(source);
    const canonical = canonicalPlatformSkc(platformSkc);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    skcs.push({ platformSkc, canonicalPlatformSkc: canonical });
  }
  if (skcs.length === 0) throw new Error("ERP 成本批次至少需要一个平台 SKC 查询项。");
  return skcs;
}

function evidenceRefFor(warehouseSku) {
  return `warehouse:${canonicalWarehouseSku(warehouseSku)}`;
}

function normalizePurchaseRecord(record, index, warehouseSku, excluded = false) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`仓库 SKU ${warehouseSku} 的第 ${index + 1} 条采购证据无效。`);
  }
  const quantity = optionalFiniteNumber(record.quantity ?? record.qty ?? record.purchaseQuantity, "采购数量", { minimum: 0 });
  const unitPrice = optionalFiniteNumber(record.unitPrice ?? record.purchaseUnitPrice, "采购单价", { minimum: 0 });
  const totalPrice = optionalFiniteNumber(record.totalPrice ?? record.price, "采购金额", { minimum: 0 });
  return {
    recordId: optionalText(record.recordId ?? record.id) ?? `${evidenceRefFor(warehouseSku)}:${excluded ? "excluded" : "record"}:${index + 1}`,
    warehouseSku,
    productName: optionalText(record.productName ?? record.name),
    quantity,
    unitPrice,
    totalPrice: totalPrice ?? (quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(4)) : null),
    purchaseDate: optionalText(record.purchaseDate ?? record.date),
    order1688: optionalText(record.order1688),
    purchaseOrderNo: optionalText(record.purchaseOrderNo),
    purchaseOrderId: optionalText(record.purchaseOrderId),
    supplierName: optionalText(record.supplierName),
    supplier1688Url: optionalText(record.supplier1688Url ?? record.supplierOfferUrl ?? record.sourceUrl),
    eligible: excluded ? false : record.eligible !== false,
    selectedForPreview: excluded ? false : Boolean(record.selectedForPreview),
    exclusionReasons: uniqueText(record.exclusionReasons),
    warningReasons: uniqueText(record.warningReasons ?? record.anomalyReasons),
    statusFields: safeStatusFields(record),
  };
}

function normalizeEvidenceEntry(entry, index, { strictSourceWarnings = true } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`ERP 成本批次第 ${index + 1} 份仓库证据无效。`);
  }
  const warehouseSku = normalizeWarehouseSku(entry.warehouseSku);
  const expectedEvidenceRef = evidenceRefFor(warehouseSku);
  const evidenceRef = optionalText(entry.evidenceRef) ?? expectedEvidenceRef;
  if (evidenceRef !== expectedEvidenceRef) {
    throw new Error(`ERP 成本批次第 ${index + 1} 份仓库证据引用与仓库 SKU 不一致。`);
  }
  const sourceWarnings = sourceWarningsContract(entry, {
    strict: strictSourceWarnings,
    label: `ERP 成本批次第 ${index + 1} 份仓库证据来源警告`,
  }).warnings;
  return {
    evidenceRef,
    warehouseSku,
    canonicalWarehouseSku: canonicalWarehouseSku(warehouseSku),
    purchaseRecords: (Array.isArray(entry.purchaseRecords) ? entry.purchaseRecords : [])
      .map((record, recordIndex) => normalizePurchaseRecord(record, recordIndex, warehouseSku)),
    excludedRecords: (Array.isArray(entry.excludedRecords) ? entry.excludedRecords : [])
      .map((record, recordIndex) => normalizePurchaseRecord(record, recordIndex, warehouseSku, true)),
    sourceWarnings,
    evidenceComplete: entry.evidenceComplete === true && sourceWarnings.length === 0,
  };
}

function normalizeWarehouseEvidence(value, { strictSourceWarnings = true } = {}) {
  const source = Array.isArray(value)
    ? value
    : (Array.isArray(value?.warehouses) ? value.warehouses : []);
  const entries = source.map((entry, index) => normalizeEvidenceEntry(entry, index, { strictSourceWarnings }));
  const refs = new Set();
  const skus = new Set();
  for (const entry of entries) {
    if (refs.has(entry.evidenceRef)) throw new Error(`ERP 成本批次证据引用重复：${entry.evidenceRef}。`);
    if (skus.has(entry.canonicalWarehouseSku)) throw new Error(`ERP 成本批次仓库 SKU 证据重复：${entry.warehouseSku}。`);
    refs.add(entry.evidenceRef);
    skus.add(entry.canonicalWarehouseSku);
  }
  return entries;
}

function normalizeExpectedSkuScope(values) {
  if (!Array.isArray(values)) return null;
  const scope = new Map();
  for (const item of values) {
    const platformSkuText = String(typeof item === "string" ? item : item?.platformSku ?? "").trim();
    const platformSkcText = String(typeof item === "string" ? "" : item?.platformSkc ?? "").trim();
    if (!platformSkuText || !platformSkcText) throw new Error("ERP 成本请求的 expectedSkus 必须同时包含平台 SKU 和平台 SKC。");
    const platformSku = normalizePlatformSku(platformSkuText);
    const canonicalSku = canonicalPlatformSku(platformSku);
    const platformSkc = normalizePlatformSkc(platformSkcText);
    const canonicalSkc = canonicalPlatformSkc(platformSkc);
    const previous = scope.get(canonicalSku);
    if (previous && previous.canonicalPlatformSkc !== canonicalSkc) {
      throw new Error(`平台 SKU ${platformSku} 在 ERP 成本请求中对应多个平台 SKC。`);
    }
    scope.set(canonicalSku, { platformSku, canonicalPlatformSku: canonicalSku, platformSkc, canonicalPlatformSkc: canonicalSkc });
  }
  return scope;
}

function normalizeLedgerScopeRole(value, { legacyFormat = false } = {}) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (![ERP_LEDGER_SCOPE_EXPECTED, ERP_LEDGER_SCOPE_AUXILIARY].includes(text)) {
    if (legacyFormat) return ERP_LEDGER_SCOPE_EXPECTED;
    throw new Error("ERP 成本批次 ledgerScopeRole 不受支持。");
  }
  return text;
}

function normalizeEvidenceRow(row, index, {
  legacyFormat = false,
  expectedScopeBySku = null,
  queriedSkcs = new Set(),
} = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`ERP 成本批次第 ${index + 1} 行格式无效。`);
  const platformSkuText = optionalText(row.platformSku);
  const warehouseSkuText = optionalText(row.warehouseSku);
  if (!platformSkuText && !warehouseSkuText) throw new Error(`ERP 成本批次第 ${index + 1} 行缺少平台 SKU 和仓库 SKU。`);
  const hasPreviewUnitCost = Object.prototype.hasOwnProperty.call(row, "previewUnitCost");
  const previewUnitCost = optionalFiniteNumber(
    hasPreviewUnitCost ? row.previewUnitCost : row.unitCost,
    `第 ${index + 1} 行预览单件成本`,
    { minimum: 0 },
  );
  const compatibilityUnitCost = optionalFiniteNumber(row.unitCost, `第 ${index + 1} 行兼容预览成本`, { minimum: 0 });
  if (hasPreviewUnitCost && previewUnitCost != null && compatibilityUnitCost != null && previewUnitCost !== compatibilityUnitCost) {
    throw new Error(`ERP 成本批次第 ${index + 1} 行预览成本字段不一致。`);
  }
  const currency = String(row.currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  if (currency !== DEFAULT_CURRENCY) throw new Error(`ERP 成本批次第 ${index + 1} 行币种必须为 CNY。`);
  const platformSku = platformSkuText ? normalizePlatformSku(platformSkuText) : null;
  const warehouseSku = warehouseSkuText ? normalizeWarehouseSku(warehouseSkuText) : null;
  const sourceWarnings = sourceWarningsContract(row, {
    strict: !legacyFormat,
    label: `ERP 成本批次第 ${index + 1} 行来源警告`,
  }).warnings;
  const declaredLedgerScopeRole = normalizeLedgerScopeRole(row.ledgerScopeRole, { legacyFormat });
  let ledgerScopeRole = declaredLedgerScopeRole ?? ERP_LEDGER_SCOPE_EXPECTED;
  if (expectedScopeBySku) {
    const expected = platformSku ? expectedScopeBySku.get(canonicalPlatformSku(platformSku)) : null;
    const rowCanonicalSkc = row.platformSkc ? canonicalPlatformSkc(row.platformSkc) : null;
    const derivedRole = expected
      ? ERP_LEDGER_SCOPE_EXPECTED
      : (platformSku && warehouseSku && rowCanonicalSkc && queriedSkcs.has(rowCanonicalSkc)
        ? ERP_LEDGER_SCOPE_AUXILIARY
        : ERP_LEDGER_SCOPE_EXPECTED);
    if (declaredLedgerScopeRole && declaredLedgerScopeRole !== derivedRole) {
      throw new Error(`ERP 成本批次第 ${index + 1} 行账本范围角色与已登记请求不一致。`);
    }
    ledgerScopeRole = derivedRole;
    if (expected && (!rowCanonicalSkc || rowCanonicalSkc !== expected.canonicalPlatformSkc)) {
      sourceWarnings.push(`mapping_failure:expected_skc_mismatch:${platformSku}`);
    } else if (!expected && derivedRole === ERP_LEDGER_SCOPE_EXPECTED) {
      if (!platformSku) sourceWarnings.push("mapping_failure:missing_platform_sku");
      else if (!rowCanonicalSkc) sourceWarnings.push(`mapping_failure:missing_platform_skc:${platformSku}`);
      else if (!queriedSkcs.has(rowCanonicalSkc)) sourceWarnings.push(`mapping_failure:outside_query_skc:${platformSku}`);
    }
  }
  return {
    platformSku,
    canonicalPlatformSku: platformSku ? canonicalPlatformSku(platformSku) : null,
    platformSkc: optionalText(row.platformSkc),
    canonicalPlatformSkc: row.platformSkc ? canonicalPlatformSkc(row.platformSkc) : null,
    warehouseSku,
    canonicalWarehouseSku: warehouseSku ? canonicalWarehouseSku(warehouseSku) : null,
    evidenceRef: legacyFormat ? null : requiredText(row.evidenceRef, `ERP 成本批次第 ${index + 1} 行证据引用`),
    orderNumber: optionalText(row.orderNumber ?? row.orderNo ?? row.order1688),
    orderType: optionalText(row.orderType ?? row.sourceType),
    productName: optionalText(row.productName ?? row.name),
    calculationCount: optionalFiniteNumber(row.calculationCount ?? row.calcTimes, `第 ${index + 1} 行核算次数`, { minimum: 0, integer: true }),
    dateRange: optionalText(row.dateRange),
    totalQuantity: optionalFiniteNumber(row.totalQuantity ?? row.totalQty, `第 ${index + 1} 行总采购量`, { minimum: 0 }),
    totalPrice: optionalFiniteNumber(row.totalPrice, `第 ${index + 1} 行总采购价`, { minimum: 0 }),
    supplierName: optionalText(row.supplierName),
    supplier1688Url: optionalText(row.supplier1688Url ?? row.supplierOfferUrl ?? row.sourceUrl),
    previewUnitCost,
    unitCost: previewUnitCost,
    currency,
    costRole: "preview",
    ledgerScopeRole,
    mappingFallback: Boolean(row.mappingFallback),
    sourceWarnings,
    selectedRecordIds: uniqueText(row.selectedRecordIds),
    sourceRow: Number(row.sourceRow) || index + 1,
  };
}

function normalizeSourceMeta(meta, { evidenceComplete, legacy }) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = {};
  const numericFields = [
    "orderCount", "validOrderCount", "skippedOrderCount", "detailCount",
    "skippedCancelledOrderCount", "skippedCurrentMonth", "skippedInvalid",
    "warehouseSkuCount", "platformSkuCount", "durationMs", "detailFailureCount",
    "mappingFailureCount", "evidenceRecordCount", "excludedEvidenceCount", "costWarningCount",
  ];
  const result = {
    evidenceVersion: legacy ? 0 : (Number(meta.evidenceVersion) || ERP_COST_EVIDENCE_VERSION),
    evidenceComplete: legacy ? false : Boolean(evidenceComplete),
  };
  for (const field of numericFields) {
    const value = Number(meta[field]);
    if (Number.isFinite(value) && value >= 0) result[field] = value;
  }
  for (const field of ["sourceFormat", "sourceName", "excludedMonth", "extensionVersion", "queryCapturedAt", "registeredBefore", "requestRegisteredAt"]) {
    if (optionalText(meta[field])) result[field] = optionalText(meta[field]);
  }
  for (const field of ["detailFailures", "mappingFailures", "exclusionStats", "failureStats", "sourceWarnings"]) {
    if (Array.isArray(meta[field])) result[field] = meta[field].map((item) => {
      if (typeof item === "string") return item.slice(0, 500);
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      return Object.fromEntries(Object.entries(item)
        .filter(([key]) => !/(token|cookie|authorization|filter)/i.test(key))
        .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 500) : value])
        .filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value)));
    }).filter(Boolean);
  }
  return result;
}

function assertExpected(actual, expected, label) {
  if (expected == null || String(expected).trim() === "") return;
  if (String(actual) !== String(expected)) throw new Error(`ERP 成本批次${label}与当前页面不一致。`);
}

export function validateErpCostBatchEnvelope(payload, {
  expectedWorkspaceId = null,
  expectedLedgerId = null,
  expectedRequestId = null,
  expectedPlatformSkcs = null,
  expectedSkus = null,
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("ERP 成本批次包内容无效。");
  if (payload.format !== ERP_COST_BATCH_FORMAT) throw new Error("ERP 成本批次包格式不受支持。");
  const formatVersion = Number(payload.formatVersion);
  if (![1, ERP_COST_BATCH_VERSION].includes(formatVersion)) throw new Error("ERP 成本批次包版本不受支持。");
  const declaredSourceFormatVersion = payload.sourceFormatVersion == null
    ? formatVersion
    : Number(payload.sourceFormatVersion);
  if (![1, ERP_COST_BATCH_VERSION].includes(declaredSourceFormatVersion)) throw new Error("ERP 成本批次来源版本不受支持。");
  const sourceFormatVersion = formatVersion === 1 || declaredSourceFormatVersion === 1 ? 1 : ERP_COST_BATCH_VERSION;
  const legacyFormat = formatVersion === 1;
  if (payload.complete !== true || payload.status !== "completed") throw new Error("ERP 成本批次尚未完整完成，不能导入。");
  const baseline = payload.baseline ?? {};
  if (baseline.application !== ERP_V8_BASELINE.application
    || baseline.version !== ERP_V8_BASELINE.version
    || String(baseline.releaseSha256 ?? "").toLowerCase() !== ERP_V8_BASELINE.releaseSha256) {
    throw new Error("ERP 成本批次未声明受支持的 ERP Assistant v8.0.0 权威基线。");
  }
  if (payload.algorithmVersion !== ERP_COST_ALGORITHM_VERSION) throw new Error("ERP 成本批次算法版本不受支持。");
  const workspaceId = normalizeWorkspaceId(payload.workspaceId);
  const ledgerId = requiredText(payload.ledgerId, "ERP 成本批次账本 ID");
  const requestId = requiredText(payload.requestId, "ERP 成本请求 ID");
  const batchId = requiredText(payload.batchId, "ERP 成本批次 ID");
  const generatedAt = validTimestamp(payload.generatedAt, "ERP 成本批次生成时间");
  const currency = String(payload.currency ?? "").trim().toUpperCase();
  if (currency !== DEFAULT_CURRENCY) throw new Error("ERP 成本批次币种必须为 CNY。");
  assertExpected(workspaceId, expectedWorkspaceId ? normalizeWorkspaceId(expectedWorkspaceId) : null, "工作区");
  assertExpected(ledgerId, expectedLedgerId, "账本");
  assertExpected(requestId, expectedRequestId, "请求 ID");
  if (payload.query?.unit !== "platform_skc") throw new Error("ERP 成本批次查询单位必须为平台 SKC。");
  const platformSkcs = normalizeQuerySkcs(payload.query.platformSkcs);
  const queriedSkcs = new Set(platformSkcs.map((item) => item.canonicalPlatformSkc));
  const expectedScopeBySku = normalizeExpectedSkuScope(expectedSkus);
  if (expectedScopeBySku && [...expectedScopeBySku.values()].some((item) => !queriedSkcs.has(item.canonicalPlatformSkc))) {
    throw new Error("ERP 成本请求的 expectedSkus 包含不在完整平台 SKC 查询范围内的项目。");
  }
  if (expectedPlatformSkcs != null) {
    const expected = normalizeQuerySkcs(expectedPlatformSkcs);
    const actualSet = new Set(platformSkcs.map((item) => item.canonicalPlatformSkc));
    const expectedSet = new Set(expected.map((item) => item.canonicalPlatformSkc));
    if (actualSet.size !== expectedSet.size || [...actualSet].some((value) => !expectedSet.has(value))) {
      throw new Error("ERP 成本批次查询 SKC 集合与当前页面不一致。");
    }
  }
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) throw new Error("ERP 成本批次没有可导入的成本行。");
  const legacy = sourceFormatVersion === 1;
  const topLevelWarnings = sourceWarningsContract(payload.sourceMeta, { strict: !legacyFormat });
  const rows = payload.rows.map((row, index) => normalizeEvidenceRow(row, index, {
    legacyFormat,
    expectedScopeBySku,
    queriedSkcs,
  }));
  const warehouseEvidence = normalizeWarehouseEvidence(payload.warehouseEvidence, { strictSourceWarnings: !legacyFormat });
  const evidenceByRef = new Map(warehouseEvidence.map((entry) => [entry.evidenceRef, entry]));
  if (!legacyFormat) {
    for (const row of rows) {
      const evidence = evidenceByRef.get(row.evidenceRef);
      if (!evidence || evidence.canonicalWarehouseSku !== row.canonicalWarehouseSku) {
        throw new Error(`ERP 成本批次第 ${row.sourceRow} 行证据引用与仓库 SKU 不一致。`);
      }
    }
  }
  const uniqueWarehouseSkus = new Set(rows.map((row) => row.canonicalWarehouseSku).filter(Boolean));
  const mappingFallbackCount = rows.filter((row) => row.mappingFallback).length;
  const summary = payload.summary ?? {};
  if (Number(summary.outputRowCount) !== rows.length) throw new Error("ERP 成本批次输出行数校验失败。");
  if (Number(summary.warehouseSkuCount) !== uniqueWarehouseSkus.size) throw new Error("ERP 成本批次仓库 SKU 数量校验失败。");
  if (Number(summary.mappingFallbackCount) !== mappingFallbackCount) throw new Error("ERP 成本批次映射兜底数量校验失败。");
  if (Number(summary.querySkcCount) !== platformSkcs.length) throw new Error("ERP 成本批次查询 SKC 数量校验失败。");
  const expectedRows = rows.filter((row) => row.ledgerScopeRole === ERP_LEDGER_SCOPE_EXPECTED);
  const expectedEvidenceRefs = new Set(expectedRows.map((row) => row.evidenceRef).filter(Boolean));
  const matchedExpectedSkus = new Set(expectedRows.map((row) => row.canonicalPlatformSku).filter(Boolean));
  const expectedScopeComplete = expectedScopeBySku
    ? expectedScopeBySku.size > 0 && [...expectedScopeBySku.keys()].every((sku) => matchedExpectedSkus.has(sku))
    : rows.every((row) => row.ledgerScopeRole === ERP_LEDGER_SCOPE_EXPECTED);
  const sourceFailuresPresent = [payload.sourceMeta?.detailFailures, payload.sourceMeta?.mappingFailures]
    .some((items) => Array.isArray(items) && items.length > 0);
  const declaredIncomplete = payload.evidenceStatus === "legacy_partial"
    || payload.sourceMeta?.evidenceComplete === false;
  const evidenceComplete = !legacy
    && !declaredIncomplete
    && !sourceFailuresPresent
    && expectedRows.length > 0
    && expectedScopeComplete
    && [...expectedEvidenceRefs].every((ref) => evidenceByRef.get(ref)?.evidenceComplete === true)
    && expectedRows.every((row) => row.sourceWarnings.length === 0)
    && topLevelWarnings.warnings.length === 0;
  const reconciliationRows = rows.map((row) => {
    const evidence = row.evidenceRef ? evidenceByRef.get(row.evidenceRef) : null;
    return {
      ...row,
      purchaseRecords: evidence?.purchaseRecords ?? [],
      excludedRecords: evidence?.excludedRecords ?? [],
      sourceWarnings: uniqueText([...(evidence?.sourceWarnings ?? []), ...row.sourceWarnings]),
      evidenceComplete: Boolean(evidence?.evidenceComplete) && row.sourceWarnings.length === 0,
      warehouseEvidence: evidence ?? null,
      currentYearMonth: Number(generatedAt.slice(0, 4)) * 100 + Number(generatedAt.slice(5, 7)),
    };
  });
  return {
    envelope: {
      format: ERP_COST_BATCH_FORMAT,
      formatVersion,
      sourceFormatVersion,
      evidenceStatus: evidenceComplete ? "complete" : "legacy_partial",
      batchId,
      workspaceId,
      ledgerId,
      requestId,
      generatedAt,
      complete: true,
      status: "completed",
      currency,
      baseline: ERP_V8_BASELINE,
      algorithmVersion: ERP_COST_ALGORITHM_VERSION,
      query: { unit: "platform_skc", platformSkcs },
      summary: { outputRowCount: rows.length, warehouseSkuCount: uniqueWarehouseSkus.size, mappingFallbackCount, querySkcCount: platformSkcs.length },
      sourceMeta: normalizeSourceMeta(topLevelWarnings.hasField
        ? { ...payload.sourceMeta, sourceWarnings: topLevelWarnings.warnings }
        : payload.sourceMeta, { evidenceComplete, legacy }),
      warehouseEvidence,
      rows,
    },
    rows: reconciliationRows,
    warehouseEvidence,
    evidenceComplete,
    evidenceStatus: evidenceComplete ? "complete" : "legacy_partial",
    rowCount: rows.length,
    workspaceId,
    ledgerId,
    requestId,
  };
}

function evidenceInputByWarehouse(value) {
  const source = Array.isArray(value)
    ? value
    : (Array.isArray(value?.warehouses) ? value.warehouses : []);
  const globalExcluded = [
    ...(Array.isArray(value?.excludedOrders) ? value.excludedOrders : []),
    ...(Array.isArray(value?.excludedDetails) ? value.excludedDetails : []),
  ];
  const globalWarnings = [
    ...(Array.isArray(value?.detailFailures) ? value.detailFailures : []).map((item) => `detail_failure:${item?.purchaseOrderId ?? item?.message ?? "unknown"}`),
    ...(Array.isArray(value?.mappingFailures) ? value.mappingFailures : [])
      .filter((item) => !item?.warehouseSku)
      .map((item) => `mapping_failure:${item?.message ?? "unknown"}`),
  ];
  return new Map(source.map((entry) => {
    const sku = normalizeWarehouseSku(entry.warehouseSku);
    const scopedMappingWarnings = (Array.isArray(value?.mappingFailures) ? value.mappingFailures : [])
      .filter((item) => item?.warehouseSku && canonicalWarehouseSku(item.warehouseSku) === canonicalWarehouseSku(sku))
      .map((item) => `mapping_failure:${item?.warehouseSku ?? item?.message ?? "unknown"}`);
    return [canonicalWarehouseSku(sku), {
      ...entry,
      warehouseSku: sku,
      excludedRecords: [
        ...(Array.isArray(entry.excludedRecords) ? entry.excludedRecords : []),
        ...globalExcluded.filter((record) => record?.warehouseSku
          && canonicalWarehouseSku(record.warehouseSku) === canonicalWarehouseSku(sku)),
      ],
      sourceWarnings: [...uniqueText(entry.sourceWarnings), ...scopedMappingWarnings, ...globalWarnings],
      evidenceComplete: entry.evidenceComplete !== false && scopedMappingWarnings.length === 0 && globalWarnings.length === 0,
    }];
  }));
}

export function buildErpCostBatchEnvelope({
  batchId,
  workspaceId,
  ledgerId,
  requestId,
  platformSkcs,
  results,
  warehouseEvidence: rawWarehouseEvidence = [],
  sourceMeta = {},
  expectedSkus = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(results) || results.length === 0) throw new Error("ERP v8.0 核算结果不能为空。");
  const evidenceInputs = evidenceInputByWarehouse(rawWarehouseEvidence);
  const rows = [];
  const warehouseEvidence = [];
  for (const result of results) {
    const warehouseSku = normalizeWarehouseSku(result?.warehouseSku);
    const evidenceRef = evidenceRefFor(warehouseSku);
    const input = evidenceInputs.get(canonicalWarehouseSku(warehouseSku));
    warehouseEvidence.push(input ? { ...input, evidenceRef } : {
      evidenceRef,
      warehouseSku,
      purchaseRecords: [],
      excludedRecords: [],
      sourceWarnings: ["purchase_evidence_missing"],
      evidenceComplete: false,
    });
    const mappings = Array.isArray(result?.mappings) ? result.mappings : [];
    const platformSkuValues = mappings.length > 0 ? mappings.map((mapping) => normalizePlatformSku(mapping?.platformSku)) : [warehouseSku];
    for (const [mappingIndex, platformSku] of platformSkuValues.entries()) {
      const mapping = mappings[mappingIndex] ?? {};
      rows.push({
        platformSku,
        platformSkc: mapping.platformSkc ?? result.platformSkc ?? null,
        warehouseSku,
        evidenceRef,
        orderNumber: result.orderNumber ?? "",
        orderType: result.sourceType ?? "",
        productName: result.name ?? "",
        calculationCount: result.calcTimes ?? result.calculationCount ?? null,
        dateRange: result.dateRange ?? "",
        totalQuantity: result.totalQty ?? result.totalQuantity ?? null,
        totalPrice: result.totalPrice ?? null,
        supplierName: result.supplierName ?? "",
        supplier1688Url: result.supplier1688Url ?? result.supplierOfferUrl ?? "",
        previewUnitCost: result.previewUnitCost ?? result.unitCost,
        unitCost: result.previewUnitCost ?? result.unitCost,
        currency: DEFAULT_CURRENCY,
        ledgerScopeRole: mapping.ledgerScopeRole ?? result.ledgerScopeRole ?? null,
        mappingFallback: mappings.length === 0,
        selectedRecordIds: result.selectedRecordIds ?? [],
        sourceRow: rows.length + 1,
      });
    }
  }
  const normalizedSkcs = normalizeQuerySkcs(platformSkcs);
  const envelope = {
    format: ERP_COST_BATCH_FORMAT,
    formatVersion: ERP_COST_BATCH_VERSION,
    batchId,
    workspaceId,
    ledgerId,
    requestId,
    generatedAt,
    complete: true,
    status: "completed",
    currency: DEFAULT_CURRENCY,
    baseline: ERP_V8_BASELINE,
    algorithmVersion: ERP_COST_ALGORITHM_VERSION,
    query: { unit: "platform_skc", platformSkcs: normalizedSkcs },
    summary: {
      outputRowCount: rows.length,
      warehouseSkuCount: new Set(rows.map((row) => canonicalWarehouseSku(row.warehouseSku))).size,
      mappingFallbackCount: rows.filter((row) => row.mappingFallback).length,
      querySkcCount: normalizedSkcs.length,
    },
    sourceMeta,
    warehouseEvidence,
    rows,
  };
  return validateErpCostBatchEnvelope(envelope, { expectedSkus }).envelope;
}

export function parseErpCostBatchJson(text, options = {}) {
  let payload;
  try { payload = JSON.parse(String(text ?? "")); } catch { throw new Error("ERP 成本批次 JSON 无法解析。"); }
  return validateErpCostBatchEnvelope(payload, options);
}
