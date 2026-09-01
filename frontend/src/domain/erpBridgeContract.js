import {
  ERP_COST_ALGORITHM_VERSION,
  DEFAULT_CURRENCY,
} from "./erpCosts.js";
import {
  ERP_V8_BASELINE,
  validateErpCostBatchEnvelope,
  buildErpCostBatchEnvelope,
} from "./erpCostBatchEnvelope.js";
import {
  canonicalPlatformSkc,
  canonicalPlatformSku,
  normalizePlatformSkc,
  normalizePlatformSku,
  normalizeWorkspaceId,
} from "./identifiers.js";

export const ERP_BRIDGE_REQUEST_FORMAT = "shopeers-erp-v8-request";
export const ERP_BRIDGE_REQUEST_VERSION = 1;

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function validTimestamp(value, label) {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label}不是有效时间。`);
  return text;
}

function normalizeSkcs(values) {
  if (!Array.isArray(values)) throw new Error("ERP 请求缺少平台 SKC 查询范围。");
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const source = typeof value === "string" ? value : value?.platformSkc;
    const platformSkc = normalizePlatformSkc(source);
    const canonical = canonicalPlatformSkc(platformSkc);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push({ platformSkc, canonicalPlatformSkc: canonical });
  }
  if (result.length === 0) throw new Error("ERP 请求至少需要一个平台 SKC 查询项。");
  return result;
}

function assertExpected(actual, expected, label) {
  if (expected == null || String(expected).trim() === "") return;
  if (String(actual) !== String(expected)) throw new Error(`ERP 请求${label}与当前页面不一致。`);
}

function sameSkcSet(left, right) {
  const a = new Set(left.map((item) => item.canonicalPlatformSkc));
  const b = new Set(right.map((item) => item.canonicalPlatformSkc));
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export function buildErpBridgeRequest({ request } = {}) {
  if (!request || typeof request !== "object") throw new Error("ERP 成本请求内容无效。");
  const workspaceId = normalizeWorkspaceId(request.workspaceId);
  const platformSkcs = normalizeSkcs(request.platformSkcs);
  return validateErpBridgeRequest({
    format: ERP_BRIDGE_REQUEST_FORMAT,
    formatVersion: ERP_BRIDGE_REQUEST_VERSION,
    workspaceId,
    ledgerId: request.ledgerId ?? null,
    requestId: requiredText(request.id ?? request.requestId, "成本请求 ID"),
    requestedBy: requiredText(request.requestedBy, "请求人"),
    requestedAt: validTimestamp(request.requestedAt, "请求时间"),
    currency: String(request.currency ?? DEFAULT_CURRENCY).trim().toUpperCase(),
    baseline: ERP_V8_BASELINE,
    algorithmVersion: request.algorithmVersion ?? ERP_COST_ALGORITHM_VERSION,
    query: { unit: "platform_skc", platformSkcs },
    summary: { querySkcCount: platformSkcs.length },
  }).request;
}

export function validateErpBridgeRequest(payload, {
  expectedWorkspaceId = null,
  expectedLedgerId = null,
  expectedRequestId = null,
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("ERP 请求包内容无效。");
  if (payload.format !== ERP_BRIDGE_REQUEST_FORMAT) throw new Error("ERP 请求包格式不受支持。");
  if (Number(payload.formatVersion) !== ERP_BRIDGE_REQUEST_VERSION) throw new Error("ERP 请求包版本不受支持。");
  const baseline = payload.baseline ?? {};
  if (baseline.application !== ERP_V8_BASELINE.application
    || baseline.version !== ERP_V8_BASELINE.version
    || String(baseline.releaseSha256 ?? "").toLowerCase() !== ERP_V8_BASELINE.releaseSha256) {
    throw new Error("ERP 请求包未声明受支持的 ERP Assistant v8.0.0 权威基线。");
  }
  if (payload.algorithmVersion !== ERP_COST_ALGORITHM_VERSION) throw new Error("ERP 请求包算法版本不受支持。");

  const workspaceId = normalizeWorkspaceId(payload.workspaceId);
  const ledgerId = payload.ledgerId == null ? null : requiredText(payload.ledgerId, "ERP 请求账本 ID");
  const requestId = requiredText(payload.requestId, "ERP 请求 ID");
  const requestedBy = requiredText(payload.requestedBy, "ERP 请求人");
  const requestedAt = validTimestamp(payload.requestedAt, "ERP 请求时间");
  const currency = String(payload.currency ?? "").trim().toUpperCase();
  if (currency !== DEFAULT_CURRENCY) throw new Error("ERP 请求包币种必须为 CNY。");
  assertExpected(workspaceId, expectedWorkspaceId ? normalizeWorkspaceId(expectedWorkspaceId) : null, "工作区");
  assertExpected(ledgerId, expectedLedgerId, "账本");
  assertExpected(requestId, expectedRequestId, "请求 ID");
  if (payload.query?.unit !== "platform_skc") throw new Error("ERP 请求查询单位必须为平台 SKC。");
  const platformSkcs = normalizeSkcs(payload.query.platformSkcs);
  if (Number(payload.summary?.querySkcCount) !== platformSkcs.length) throw new Error("ERP 请求查询 SKC 数量校验失败。");

  return {
    request: {
      format: ERP_BRIDGE_REQUEST_FORMAT,
      formatVersion: ERP_BRIDGE_REQUEST_VERSION,
      workspaceId,
      ledgerId,
      requestId,
      requestedBy,
      requestedAt,
      currency,
      baseline: ERP_V8_BASELINE,
      algorithmVersion: ERP_COST_ALGORITHM_VERSION,
      query: { unit: "platform_skc", platformSkcs },
      summary: { querySkcCount: platformSkcs.length },
    },
    workspaceId,
    ledgerId,
    requestId,
    platformSkcs,
  };
}

export function validateErpBridgeResponse(payload, requestPayload, options = {}) {
  const request = requestPayload?.format === ERP_BRIDGE_REQUEST_FORMAT
    ? validateErpBridgeRequest(requestPayload, options)
    : validateErpBridgeRequest(buildErpBridgeRequest({ request: requestPayload }), options);
  const batch = validateErpCostBatchEnvelope(payload, {
    expectedWorkspaceId: request.workspaceId,
    expectedLedgerId: request.ledgerId,
    expectedRequestId: request.requestId,
  });
  if (!sameSkcSet(batch.envelope.query.platformSkcs, request.platformSkcs)) {
    throw new Error("ERP 回传批次的查询 SKC 集合与请求包不一致。");
  }
  return { request, batch: batch.envelope, rows: batch.rows };
}

/** Wrap the real v8.0 TSV/CSV output in the audited Shopeers batch envelope. */
export function buildErpBridgeBatchEnvelope({
  requestPayload,
  rows,
  expectedSkus = [],
  warehouseEvidence = [],
  batchId,
  sourceMeta = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const request = requestPayload?.format === ERP_BRIDGE_REQUEST_FORMAT
    ? validateErpBridgeRequest(requestPayload)
    : validateErpBridgeRequest(buildErpBridgeRequest({ request: requestPayload }));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("ERP v8.0 原始输出不能为空。");

  const skcBySku = new Map();
  for (const item of expectedSkus) {
    const platformSku = normalizePlatformSku(typeof item === "string" ? item : item?.platformSku);
    const platformSkc = String(typeof item === "string" ? "" : item?.platformSkc ?? "").trim();
    if (platformSku && platformSkc) skcBySku.set(canonicalPlatformSku(platformSku), normalizePlatformSkc(platformSkc));
  }

  const results = rows.map((row) => {
    const platformSku = String(row?.platformSku ?? "").trim();
    const platformSkc = row?.platformSkc || (platformSku ? skcBySku.get(canonicalPlatformSku(platformSku)) : null);
    return {
      warehouseSku: row?.warehouseSku,
      platformSkc,
      mappings: platformSku ? [{ platformSku, platformSkc }] : [],
      orderNumber: row?.orderNumber ?? "",
      sourceType: row?.orderType ?? row?.sourceType ?? "",
      name: row?.productName ?? row?.name ?? "",
      calcTimes: row?.calculationCount ?? row?.calcTimes ?? null,
      dateRange: row?.dateRange ?? "",
      totalQty: row?.totalQuantity ?? row?.totalQty ?? null,
      totalPrice: row?.totalPrice ?? null,
      supplierName: row?.supplierName ?? "",
      supplier1688Url: row?.supplier1688Url ?? row?.supplierOfferUrl ?? row?.sourceUrl ?? "",
      previewUnitCost: row?.previewUnitCost ?? row?.unitCost,
      unitCost: row?.previewUnitCost ?? row?.unitCost,
      selectedRecordIds: row?.selectedRecordIds ?? [],
    };
  });

  return buildErpCostBatchEnvelope({
    batchId: batchId ?? `ERP-BATCH-${Date.now()}`,
    workspaceId: request.workspaceId,
    ledgerId: request.ledgerId,
    requestId: request.requestId,
    platformSkcs: request.platformSkcs,
    results,
    warehouseEvidence,
    expectedSkus,
    sourceMeta: {
      ...sourceMeta,
      sourceFormat: sourceMeta.sourceFormat ?? "erp-v8-legacy-text",
    },
    generatedAt,
  });
}
