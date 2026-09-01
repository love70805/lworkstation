import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const port = Number(process.env.SHOPEERS_ERP_INBOX_PORT || 8790);
const bindHost = "127.0.0.1";
const spoolPath = process.env.SHOPEERS_ERP_INBOX_FILE || path.join(os.tmpdir(), "shopeers-erp-inbox.json");
const inboxCapability = String(process.env.SHOPEERS_ERP_INBOX_CAPABILITY || "").trim();
const maxBytes = 25 * 1024 * 1024;
const requestTtlMs = Math.max(Number(process.env.SHOPEERS_ERP_REQUEST_TTL_MS || 2 * 60 * 60 * 1000), 60_000);
const extensionTtlMs = Math.max(Number(process.env.SHOPEERS_ERP_EXTENSION_TTL_MS || 90_000), 30_000);
const selectionCaptureMaxBytes = 5 * 1024 * 1024;
const selectionWorkspaceId = String(process.env.SHOPEERS_SELECTION_WORKSPACE_ID || "workspace-default").trim() || "workspace-default";
const BASELINE = Object.freeze({
  application: "ERP Assistant",
  version: "8.0.0",
  releaseSha256: "199561b86755b93000f3fc0197e8cd4ed5e699072a76d11d48e00c18f8e4a0ed",
});
const ALGORITHM_VERSION = "erp-v8.0-compatible@1";
const LEDGER_SCOPE_EXPECTED = "expected";
const LEDGER_SCOPE_AUXILIARY = "auxiliary";
let spoolWriteChain = Promise.resolve();
let latestTransportError = null;

if (inboxCapability.length < 32) {
  console.error("Shopeers ERP inbox requires SHOPEERS_ERP_INBOX_CAPABILITY with at least 32 characters.");
  process.exit(1);
}

async function readSpool() {
  try {
    const value = JSON.parse(await fs.readFile(spoolPath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeSpool(records) {
  await fs.mkdir(path.dirname(spoolPath), { recursive: true });
  const temporaryPath = `${spoolPath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(records, null, 2), "utf8");
  await fs.rename(temporaryPath, spoolPath);
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function authorized(req) {
  const header = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  const suppliedDigest = crypto.createHash("sha256").update(match?.[1] || "").digest();
  const expectedDigest = crypto.createHash("sha256").update(inboxCapability).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function unauthorized(res) {
  return json(res, 401, { error: "UNAUTHORIZED", message: "本机收件服务鉴权失败。" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("ERP 收件请求体过大。"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function canonicalSku(value) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function normalizedExpectedSkus(values, { strict = false } = {}) {
  const result = new Map();
  for (const [index, item] of (Array.isArray(values) ? values : []).entries()) {
    const platformSku = String(typeof item === "string" ? item : item?.platformSku ?? "").trim();
    const platformSkc = String(typeof item === "string" ? "" : item?.platformSkc ?? "").trim();
    if (!platformSku || !platformSkc) {
      if (strict) throw Object.assign(new Error(`ERP 请求第 ${index + 1} 个 expected SKU 缺少平台 SKU 或平台 SKC。`), { status: 400, code: "INVALID_ERP_REQUEST" });
      continue;
    }
    const canonicalPlatformSku = canonicalSku(platformSku);
    const canonicalPlatformSkc = canonicalSku(platformSkc);
    const previous = result.get(canonicalPlatformSku);
    if (previous && previous.canonicalPlatformSkc !== canonicalPlatformSkc) {
      throw Object.assign(new Error(`ERP 请求平台 SKU ${platformSku} 对应多个平台 SKC。`), { status: 400, code: "INVALID_ERP_REQUEST" });
    }
    result.set(canonicalPlatformSku, { platformSku, platformSkc, canonicalPlatformSku, canonicalPlatformSkc });
  }
  return result;
}

function classifyLedgerScopeRow(row, request, queriedSkcs) {
  const platformSku = String(row?.platformSku ?? "").trim();
  const platformSkc = String(row?.platformSkc ?? "").trim();
  const warehouseSku = String(row?.warehouseSku ?? "").trim();
  const expectedBySku = normalizedExpectedSkus(request?.expectedSkus);
  const expected = platformSku ? expectedBySku.get(canonicalSku(platformSku)) : null;
  const canonicalPlatformSkc = canonicalSku(platformSkc);
  const warnings = [];
  let ledgerScopeRole = LEDGER_SCOPE_EXPECTED;

  if (expected) {
    if (!canonicalPlatformSkc || canonicalPlatformSkc !== expected.canonicalPlatformSkc) {
      warnings.push(`mapping_failure:expected_skc_mismatch:${platformSku}`);
    }
  } else if (platformSku && platformSkc && warehouseSku && queriedSkcs.has(canonicalPlatformSkc) && expectedBySku.size > 0) {
    ledgerScopeRole = LEDGER_SCOPE_AUXILIARY;
  } else if (!platformSku) {
    warnings.push("mapping_failure:missing_platform_sku");
  } else if (!platformSkc) {
    warnings.push(`mapping_failure:missing_platform_skc:${platformSku}`);
  } else if (!queriedSkcs.has(canonicalPlatformSkc)) {
    warnings.push(`mapping_failure:outside_query_skc:${platformSku}`);
  } else if (expectedBySku.size === 0) {
    warnings.push("mapping_failure:expected_scope_unavailable");
  }

  return { ledgerScopeRole, warnings, expected };
}

function stripExtensionDecisions(value, depth = 0) {
  if (value == null || depth > 8) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => stripExtensionDecisions(item, depth + 1));
  if (typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const decisionKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (decisionKey.includes("confirm") || decisionKey.includes("manual") || decisionKey.includes("formal")) continue;
    if (["cacherestored", "deliveryterminal", "ledgerscoperole"].includes(decisionKey)) continue;
    if (/(token|authorization|cookie|password|secret)/i.test(key)) continue;
    result[key] = stripExtensionDecisions(child, depth + 1);
  }
  return result;
}

function requestExpired(request, now = Date.now()) {
  const registeredAt = Date.parse(String(request?.registeredAt ?? ""));
  return !Number.isFinite(registeredAt) || now - registeredAt > requestTtlMs;
}

function expireRegisteredRequests(records, now = Date.now()) {
  const expiredAt = new Date(now).toISOString();
  let changed = false;
  for (const record of records) {
    if (record.kind !== "request" || record.status !== "registered" || !requestExpired(record, now)) continue;
    record.status = "expired";
    record.expiredAt = expiredAt;
    changed = true;
  }
  return changed;
}

function extensionIsOnline(record, now = Date.now()) {
  const lastSeenAt = Date.parse(String(record?.lastSeenAt ?? ""));
  return Number.isFinite(lastSeenAt) && now - lastSeenAt <= extensionTtlMs;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function costResultInputHash(payload) {
  const input = {
    requestId: String(payload?.requestId ?? "").trim(),
    ledgerId: String(payload?.ledgerId ?? "").trim(),
    workspaceId: String(payload?.workspaceId ?? "").trim(),
    querySkcs: [...querySkcSet(payload?.querySkcs)].sort(),
    rows: stripExtensionDecisions(payload?.rows ?? []),
    sourceMeta: stripExtensionDecisions(payload?.sourceMeta ?? payload?.meta ?? {}),
    warehouseEvidence: stripExtensionDecisions(payload?.warehouseEvidence ?? {}),
  };
  return crypto.createHash("sha256").update(stableJson(input)).digest("hex");
}

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateOptionalNumber(value, label, { minimum = null, integer = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw invalidInbox(`${label}不是有效数字。`);
  if (minimum != null && number < minimum) throw invalidInbox(`${label}不能小于 ${minimum}。`);
  if (integer && !Number.isInteger(number)) throw invalidInbox(`${label}必须是整数。`);
  return number;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function evidenceRefFor(warehouseSku) {
  return `warehouse:${canonicalSku(warehouseSku)}`;
}

function sanitizePurchaseRecord(record, warehouseSku, index, excluded = false) {
  const quantity = optionalNumber(record?.quantity ?? record?.qty ?? record?.purchaseQuantity);
  const unitPrice = optionalNumber(record?.unitPrice ?? record?.purchaseUnitPrice);
  const totalPrice = optionalNumber(record?.totalPrice ?? record?.price);
  return {
    recordId: String(record?.recordId ?? record?.id ?? `${evidenceRefFor(warehouseSku)}:${excluded ? "excluded" : "record"}:${index + 1}`).trim(),
    warehouseSku,
    productName: String(record?.productName ?? record?.name ?? "").trim(),
    quantity,
    unitPrice,
    totalPrice: totalPrice ?? (quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(4)) : null),
    purchaseDate: String(record?.purchaseDate ?? record?.date ?? "").trim(),
    order1688: String(record?.order1688 ?? "").trim(),
    purchaseOrderNo: String(record?.purchaseOrderNo ?? "").trim(),
    purchaseOrderId: String(record?.purchaseOrderId ?? "").trim(),
    supplierName: String(record?.supplierName ?? "").trim(),
    supplier1688Url: String(record?.supplier1688Url ?? record?.supplierOfferUrl ?? record?.sourceUrl ?? "").trim(),
    eligible: excluded ? false : record?.eligible !== false,
    selectedForPreview: excluded ? false : Boolean(record?.selectedForPreview),
    exclusionReasons: uniqueStrings(record?.exclusionReasons),
    warningReasons: uniqueStrings(record?.warningReasons ?? record?.anomalyReasons),
    statusFields: Object.fromEntries(Object.entries({
      ...(record?.statusFields && typeof record.statusFields === "object" && !Array.isArray(record.statusFields) ? record.statusFields : {}),
      purchaseStatus: record?.purchaseStatus,
      paymentStatus: record?.paymentStatus ?? record?.payStatus,
      orderStatus: record?.orderStatus,
      order1688Status: record?.order1688Status ?? record?.orderStatus1688,
      purchaseOrderStatus: record?.purchaseOrderStatus,
      status: record?.status,
    }).filter(([, value]) => value != null && ["string", "number", "boolean"].includes(typeof value))),
  };
}

function sanitizeWarehouseEvidence(value, warehouseSkus = [], rowWarningsBySku = new Map(), { strictSourceWarnings = true } = {}) {
  const source = Array.isArray(value) ? value : (Array.isArray(value?.warehouses) ? value.warehouses : []);
  const evidenceRefs = new Set();
  const evidenceSkus = new Set();
  source.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw Object.assign(new Error(`ERP 成本批次第 ${index + 1} 份仓库证据无效。`), { status: 400, code: "INVALID_ERP_EVIDENCE" });
    }
    sourceWarningsContract(entry, {
      strict: strictSourceWarnings,
      label: `ERP 成本批次第 ${index + 1} 份仓库证据来源警告`,
    });
    const warehouseSku = String(entry.warehouseSku ?? "").trim();
    const canonicalWarehouseSku = canonicalSku(warehouseSku);
    const expectedEvidenceRef = evidenceRefFor(warehouseSku);
    const evidenceRef = String(entry.evidenceRef ?? expectedEvidenceRef).trim();
    if (!canonicalWarehouseSku || evidenceRef !== expectedEvidenceRef) {
      throw Object.assign(new Error(`ERP 成本批次第 ${index + 1} 份仓库证据引用与仓库 SKU 不一致。`), { status: 400, code: "INVALID_ERP_EVIDENCE" });
    }
    if (evidenceRefs.has(evidenceRef) || evidenceSkus.has(canonicalWarehouseSku)) {
      throw Object.assign(new Error(`ERP 成本批次仓库证据重复：${warehouseSku}。`), { status: 400, code: "INVALID_ERP_EVIDENCE" });
    }
    evidenceRefs.add(evidenceRef);
    evidenceSkus.add(canonicalWarehouseSku);
  });
  const excluded = [
    ...(Array.isArray(value?.excludedOrders) ? value.excludedOrders : []),
    ...(Array.isArray(value?.excludedDetails) ? value.excludedDetails : []),
  ];
  const globalWarnings = [
    ...(Array.isArray(value?.detailFailures) ? value.detailFailures : []).map((item) => `detail_failure:${item?.purchaseOrderId ?? item?.message ?? "unknown"}`),
    ...(Array.isArray(value?.mappingFailures) ? value.mappingFailures : [])
      .filter((item) => !item?.warehouseSku)
      .map((item) => `mapping_failure:${item?.message ?? "unknown"}`),
  ];
  const bySku = new Map(source.map((entry) => [canonicalSku(entry?.warehouseSku), entry]));
  return [...new Set(warehouseSkus.map(canonicalSku).filter(Boolean))].map((canonicalWarehouseSku) => {
    const entry = bySku.get(canonicalWarehouseSku);
    const warehouseSku = String(entry?.warehouseSku ?? warehouseSkus.find((sku) => canonicalSku(sku) === canonicalWarehouseSku) ?? "").trim();
    const scopedExcluded = excluded.filter((record) => canonicalSku(record?.warehouseSku) === canonicalWarehouseSku);
    const scopedMappingWarnings = (Array.isArray(value?.mappingFailures) ? value.mappingFailures : [])
      .filter((item) => canonicalSku(item?.warehouseSku) === canonicalWarehouseSku)
      .map((item) => `mapping_failure:${item?.warehouseSku ?? item?.message ?? "unknown"}`);
    const entryWarnings = sourceWarningsContract(entry, {
      strict: strictSourceWarnings,
      label: `仓库 SKU ${warehouseSku} 证据来源警告`,
    }).warnings;
    const sourceWarnings = [...entryWarnings, ...uniqueStrings(rowWarningsBySku.get(canonicalWarehouseSku)), ...scopedMappingWarnings, ...globalWarnings];
    return {
      evidenceRef: evidenceRefFor(warehouseSku),
      warehouseSku,
      purchaseRecords: (Array.isArray(entry?.purchaseRecords) ? entry.purchaseRecords : [])
        .map((record, index) => sanitizePurchaseRecord(record, warehouseSku, index)),
      excludedRecords: [
        ...(Array.isArray(entry?.excludedRecords) ? entry.excludedRecords : []),
        ...scopedExcluded,
      ].map((record, index) => sanitizePurchaseRecord(record, warehouseSku, index, true)),
      sourceWarnings,
      evidenceComplete: Boolean(entry)
        && entry?.evidenceComplete === true
        && sourceWarnings.length === 0
        && scopedMappingWarnings.length === 0
        && globalWarnings.length === 0,
    };
  });
}

function sourceWarningsContract(record, { strict = true, label = "ERP 来源警告" } = {}) {
  const hasField = Boolean(record && typeof record === "object" && !Array.isArray(record)
    && Object.prototype.hasOwnProperty.call(record, "sourceWarnings"));
  if (!hasField) return { hasField: false, warnings: [] };
  const invalid = !Array.isArray(record.sourceWarnings)
    || record.sourceWarnings.some((warning) => typeof warning !== "string");
  if (invalid && strict) {
    throw Object.assign(new Error(`${label} sourceWarnings 必须是字符串数组。`), {
      status: 400,
      code: "INVALID_ERP_EVIDENCE",
    });
  }
  return {
    hasField: true,
    warnings: invalid ? ["invalid_source_warnings_contract"] : uniqueStrings(record.sourceWarnings),
  };
}

function sanitizeSourceMeta(meta, warehouseEvidence, {
  strictSourceWarnings = true,
  expectedRows = null,
  expectedSkus = null,
} = {}) {
  const numericFields = ["orderCount", "validOrderCount", "skippedOrderCount", "detailCount", "skippedCancelledOrderCount", "skippedCurrentMonth", "skippedInvalid", "warehouseSkuCount", "platformSkuCount", "costWarningCount", "durationMs", "detailFailureCount", "mappingFailureCount", "evidenceRecordCount", "excludedEvidenceCount"];
  const topLevelWarnings = sourceWarningsContract(meta, { strict: strictSourceWarnings });
  const evidenceByRef = new Map(warehouseEvidence.map((entry) => [entry.evidenceRef, entry]));
  const expectedScope = normalizedExpectedSkus(expectedSkus);
  const matchedExpectedSkus = new Set((Array.isArray(expectedRows) ? expectedRows : [])
    .map((row) => canonicalSku(row?.platformSku)).filter(Boolean));
  const scopedEvidenceComplete = Array.isArray(expectedRows)
    ? expectedRows.length > 0
      && expectedScope.size > 0
      && [...expectedScope.keys()].every((sku) => matchedExpectedSkus.has(sku))
      && expectedRows.every((row) => row.ledgerScopeRole === LEDGER_SCOPE_EXPECTED
        && uniqueStrings(row.sourceWarnings).length === 0
        && evidenceByRef.get(row.evidenceRef)?.evidenceComplete === true)
    : warehouseEvidence.length > 0 && warehouseEvidence.every((entry) => entry.evidenceComplete);
  const result = {
    evidenceVersion: 1,
    evidenceComplete: scopedEvidenceComplete
      && topLevelWarnings.warnings.length === 0,
  };
  for (const field of numericFields) {
    const value = optionalNumber(meta?.[field]);
    if (value != null && value >= 0) result[field] = value;
  }
  for (const field of ["sourceFormat", "sourceName", "excludedMonth", "extensionVersion", "queryCapturedAt", "registeredBefore", "requestRegisteredAt"]) {
    const value = String(meta?.[field] ?? "").trim();
    if (value) result[field] = value;
  }
  for (const field of ["detailFailures", "mappingFailures", "exclusionStats", "failureStats"]) {
    if (Array.isArray(meta?.[field])) result[field] = meta[field].map((item) => {
      if (typeof item === "string") return item.slice(0, 500);
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      return Object.fromEntries(Object.entries(item)
        .filter(([key]) => !/(token|cookie|authorization|filter)/i.test(key))
        .filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value))
        .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 500) : value]));
    }).filter(Boolean);
  }
  if ((result.detailFailures?.length ?? 0) > 0 || (result.mappingFailures?.length ?? 0) > 0) {
    result.evidenceComplete = false;
  }
  if (topLevelWarnings.hasField) result.sourceWarnings = topLevelWarnings.warnings;
  return result;
}

function sanitizeDirectBatch(batch, {
  sourceFormatVersion = Number(batch?.formatVersion) === 1 ? 1 : 2,
  strictSourceWarnings = Number(batch?.formatVersion) !== 1,
  request = null,
} = {}) {
  const strippedBatch = stripExtensionDecisions(batch);
  const querySkcs = Array.isArray(strippedBatch?.query?.platformSkcs) ? strippedBatch.query.platformSkcs : [];
  const queriedSkcs = querySkcSet(querySkcs);
  const suppliedRows = Array.isArray(strippedBatch?.rows) ? strippedBatch.rows : [];
  const suppliedWarehouseSkus = new Set(suppliedRows.map((row) => canonicalSku(row?.warehouseSku)).filter(Boolean));
  const inputRows = [
    ...suppliedRows,
    ...evidenceWarehouseSkus(strippedBatch?.warehouseEvidence)
      .filter((warehouseSku) => !suppliedWarehouseSkus.has(canonicalSku(warehouseSku)))
      .map((warehouseSku) => ({
        warehouseSku,
        platformSku: "",
        previewUnitCost: null,
        sourceWarnings: ["evidence_only_warehouse_sku"],
      })),
  ];
  const rows = inputRows.map((row, index) => {
    const warehouseSku = String(row?.warehouseSku ?? "").trim();
    const scope = classifyLedgerScopeRow(row, request, queriedSkcs);
    return {
      platformSku: String(row?.platformSku ?? "").trim(),
      platformSkc: String(row?.platformSkc ?? "").trim() || null,
      warehouseSku,
      evidenceRef: evidenceRefFor(warehouseSku),
      orderNumber: String(row?.orderNumber ?? "").trim(),
      orderType: String(row?.orderType ?? row?.sourceType ?? "").trim(),
      productName: String(row?.productName ?? row?.name ?? "").trim(),
      calculationCount: optionalNumber(row?.calculationCount ?? row?.calcTimes),
      dateRange: String(row?.dateRange ?? "").trim(),
      totalQuantity: optionalNumber(row?.totalQuantity ?? row?.totalQty),
      totalPrice: optionalNumber(row?.totalPrice),
      supplierName: String(row?.supplierName ?? "").trim(),
      supplier1688Url: String(row?.supplier1688Url ?? row?.supplierOfferUrl ?? row?.sourceUrl ?? "").trim(),
      selectedRecordIds: uniqueStrings(row?.selectedRecordIds),
      previewUnitCost: optionalNumber(row?.previewUnitCost ?? row?.unitCost),
      unitCost: optionalNumber(row?.previewUnitCost ?? row?.unitCost),
      currency: "CNY",
      costRole: "preview",
      ledgerScopeRole: scope.ledgerScopeRole,
      mappingFallback: Boolean(row?.mappingFallback),
      sourceWarnings: [
        ...sourceWarningsContract(row, {
          strict: strictSourceWarnings,
          label: `ERP 成本批次第 ${index + 1} 行来源警告`,
        }).warnings,
        ...scope.warnings,
      ],
      sourceRow: Number(row?.sourceRow) || index + 1,
    };
  });
  const warehouseEvidence = sanitizeWarehouseEvidence(
    strippedBatch?.warehouseEvidence,
    rows.map((row) => row.warehouseSku),
    new Map(),
    { strictSourceWarnings },
  );
  const expectedRows = rows.filter((row) => row.ledgerScopeRole === LEDGER_SCOPE_EXPECTED);
  const sourceMeta = sanitizeSourceMeta(strippedBatch?.sourceMeta, warehouseEvidence, {
    strictSourceWarnings,
    expectedRows,
    expectedSkus: request?.expectedSkus ?? [],
  });
  if (sourceFormatVersion === 1) sourceMeta.evidenceComplete = false;
  const expectedBySku = normalizedExpectedSkus(request?.expectedSkus);
  const matchedExpectedSkus = new Set(expectedRows.map((row) => canonicalSku(row.platformSku)).filter(Boolean));
  const missingExpectedWarnings = [...expectedBySku.values()]
    .filter((item) => !matchedExpectedSkus.has(item.canonicalPlatformSku))
    .map((item) => `mapping_failure:missing_expected_platform_sku:${item.platformSku}`);
  if (missingExpectedWarnings.length > 0) {
    sourceMeta.sourceWarnings = uniqueStrings([...(sourceMeta.sourceWarnings ?? []), ...missingExpectedWarnings]);
    sourceMeta.evidenceComplete = false;
  }
  return {
    ...strippedBatch,
    formatVersion: Number(strippedBatch?.formatVersion) === 1 ? 1 : 2,
    sourceFormatVersion,
    currency: "CNY",
    summary: {
      outputRowCount: rows.length,
      warehouseSkuCount: new Set(rows.map((row) => canonicalSku(row.warehouseSku)).filter(Boolean)).size,
      mappingFallbackCount: rows.filter((row) => row.mappingFallback).length,
      querySkcCount: querySkcSet(querySkcs).size,
    },
    sourceMeta,
    warehouseEvidence,
    rows,
  };
}

function batchEvidenceStatus(record) {
  const envelope = record?.envelope ?? {};
  const batch = envelope.batch ?? {};
  const sourceFormatVersion = Number(envelope.sourceFormatVersion ?? batch.sourceFormatVersion ?? envelope.formatVersion ?? batch.formatVersion) === 1 ? 1 : 2;
  if (sourceFormatVersion === 1) return "legacy_partial";
  if (batch.sourceMeta?.evidenceComplete === false
    || (Array.isArray(batch.sourceMeta?.sourceWarnings) && batch.sourceMeta.sourceWarnings.length > 0)) return "legacy_partial";
  if (batch.evidenceStatus === "complete" || batch.evidenceStatus === "legacy_partial") return batch.evidenceStatus;
  const evidence = Array.isArray(batch.warehouseEvidence) ? batch.warehouseEvidence : [];
  return evidence.length > 0 && evidence.every((entry) => entry?.evidenceComplete === true) ? "complete" : "legacy_partial";
}

function publicRequest(record) {
  if (!record) return null;
  return Object.fromEntries(["requestId", "workspaceId", "ledgerId", "status", "requestedAt", "registeredAt", "usedAt", "expiredAt"]
    .map((key) => [key, record[key]])
    .filter(([, value]) => value != null));
}

function publicBatch(record) {
  if (!record) return null;
  const envelope = record.envelope ?? {};
  const batch = envelope.batch ?? {};
  const sourceFormatVersion = Number(envelope.sourceFormatVersion ?? batch.sourceFormatVersion ?? envelope.formatVersion ?? batch.formatVersion) === 1 ? 1 : 2;
  return {
    deliveryId: record.deliveryId,
    batchId: record.batchId,
    requestId: record.requestId,
    workspaceId: record.workspaceId,
    ledgerId: record.ledgerId,
    status: record.status,
    receivedAt: record.receivedAt,
    acknowledgedAt: record.acknowledgedAt ?? null,
    sourceFormatVersion,
    batchFormatVersion: Number(batch.formatVersion) || null,
    evidenceStatus: batchEvidenceStatus(record),
    warehouseEvidenceCount: Array.isArray(batch.warehouseEvidence) ? batch.warehouseEvidence.length : 0,
    rowCount: Array.isArray(batch.rows) ? batch.rows.length : 0,
  };
}

function runtimeStatus(records) {
  const requests = records.filter((item) => item.kind === "request")
    .toSorted((left, right) => String(right.registeredAt ?? "").localeCompare(String(left.registeredAt ?? "")));
  const batches = records.filter((item) => item.kind === "batch" || item.envelope?.type === "shopeers.erp.cost.batch")
    .toSorted((left, right) => String(right.receivedAt ?? "").localeCompare(String(left.receivedAt ?? "")));
  return {
    ok: true,
    application: "shopeers-erp-inbox",
    apiVersion: 2,
    inboxFormatVersions: [1, 2],
    batchFormatVersions: [1, 2],
    activeRequestCount: requests.filter((item) => item.status === "registered").length,
    pendingBatchCount: batches.filter((item) => item.status === "pending").length,
    latestRequest: publicRequest(requests[0]),
    latestBatch: publicBatch(batches[0]),
    latestTransportError,
  };
}

function normalizeSkc(value) {
  return canonicalSku(value);
}

function evidenceWarehouseSkus(value) {
  const source = value && typeof value === "object" ? value : {};
  const candidates = [
    ...(Array.isArray(value) ? value : []),
    ...(Array.isArray(source.warehouses) ? source.warehouses : []),
    ...(Array.isArray(source.excludedOrders) ? source.excludedOrders : []),
    ...(Array.isArray(source.excludedDetails) ? source.excludedDetails : []),
    ...(Array.isArray(source.mappingFailures) ? source.mappingFailures : []),
  ];
  return [...new Map(candidates
    .map((item) => [canonicalSku(item?.warehouseSku), String(item?.warehouseSku ?? "").trim()])
    .filter(([canonicalWarehouseSku]) => canonicalWarehouseSku)).values()];
}

function invalidInbox(message) {
  return Object.assign(new Error(message), { status: 400, code: "INVALID_INBOX_MESSAGE" });
}

function assertSupportedBaseline(value, label) {
  if (value?.application !== BASELINE.application
    || value?.version !== BASELINE.version
    || String(value?.releaseSha256 ?? "").toLowerCase() !== BASELINE.releaseSha256) {
    throw invalidInbox(`${label}未声明受支持的 ERP Assistant v8.0.0 权威基线。`);
  }
}

function assertTimestamp(value, label) {
  const text = String(value ?? "").trim();
  if (!text || !Number.isFinite(Date.parse(text))) throw invalidInbox(`${label}不是有效时间。`);
}

function validateDirectInboxContract(payload, { innerFormatVersion }) {
  if (payload?.type !== "shopeers.erp.cost.batch"
    || payload?.source !== "erp-assistant-v8"
    || payload?.format !== "shopeers-erp-cost-inbox") {
    throw invalidInbox("ERP 收件包来源或格式不受支持。");
  }
  assertTimestamp(payload.sentAt, "ERP 收件时间");
  assertSupportedBaseline(payload.baseline, "ERP 收件包");
  const batch = payload?.batch;
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) throw invalidInbox("ERP 收件包缺少成本批次。");
  if (batch.format !== "shopeers-erp-cost-batch") throw invalidInbox("ERP 成本批次格式不受支持。");
  if (batch.complete !== true || batch.status !== "completed") throw invalidInbox("ERP 成本批次尚未完整完成。");
  if (String(batch.currency ?? "").trim().toUpperCase() !== "CNY") throw invalidInbox("ERP 成本批次币种必须为 CNY。");
  assertSupportedBaseline(batch.baseline, "ERP 成本批次");
  if (batch.algorithmVersion !== ALGORITHM_VERSION) throw invalidInbox("ERP 成本批次算法版本不受支持。");
  for (const [value, label] of [
    [batch.batchId, "ERP 成本批次 ID"],
    [batch.workspaceId, "ERP 成本批次工作区"],
    [batch.ledgerId, "ERP 成本批次账本 ID"],
    [batch.requestId, "ERP 成本请求 ID"],
  ]) {
    if (!String(value ?? "").trim()) throw invalidInbox(`${label}不能为空。`);
  }
  assertTimestamp(batch.generatedAt, "ERP 成本批次生成时间");
  const querySkcs = validateQuerySkcs(batch.query?.platformSkcs);
  if (batch.query?.unit !== "platform_skc" || querySkcs.size === 0) {
    throw invalidInbox("ERP 成本批次缺少完整的平台 SKC 查询范围。");
  }
  if (!Array.isArray(batch.rows) || batch.rows.length === 0) throw invalidInbox("ERP 成本批次没有可导入的成本行。");
  const warehouseSkus = new Set();
  for (const [index, row] of batch.rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw invalidInbox(`ERP 成本批次第 ${index + 1} 行格式无效。`);
    }
    const warehouseSku = String(row?.warehouseSku ?? "").trim();
    if (!warehouseSku) throw invalidInbox(`ERP 成本批次第 ${index + 1} 行缺少仓库 SKU。`);
    warehouseSkus.add(canonicalSku(warehouseSku));
    const rowCurrency = String(row.currency ?? "CNY").trim().toUpperCase();
    if (rowCurrency !== "CNY") throw invalidInbox(`ERP 成本批次第 ${index + 1} 行币种必须为 CNY。`);
    const hasPreviewUnitCost = Object.prototype.hasOwnProperty.call(row, "previewUnitCost");
    const previewUnitCost = validateOptionalNumber(
      hasPreviewUnitCost ? row.previewUnitCost : row.unitCost,
      `ERP 成本批次第 ${index + 1} 行预览单件成本`,
      { minimum: 0 },
    );
    const compatibilityUnitCost = validateOptionalNumber(
      row.unitCost,
      `ERP 成本批次第 ${index + 1} 行兼容预览成本`,
      { minimum: 0 },
    );
    if (hasPreviewUnitCost && previewUnitCost != null && compatibilityUnitCost != null
      && previewUnitCost !== compatibilityUnitCost) {
      throw invalidInbox(`ERP 成本批次第 ${index + 1} 行预览成本字段不一致。`);
    }
    validateOptionalNumber(row.calculationCount ?? row.calcTimes, `ERP 成本批次第 ${index + 1} 行核算次数`, { minimum: 0, integer: true });
    validateOptionalNumber(row.totalQuantity ?? row.totalQty, `ERP 成本批次第 ${index + 1} 行总采购量`, { minimum: 0 });
    validateOptionalNumber(row.totalPrice, `ERP 成本批次第 ${index + 1} 行总采购价`, { minimum: 0 });
    if (innerFormatVersion === 2 && String(row?.evidenceRef ?? "").trim() !== evidenceRefFor(warehouseSku)) {
      throw invalidInbox(`ERP 成本批次第 ${index + 1} 行证据引用与仓库 SKU 不一致。`);
    }
  }
  const summary = batch.summary ?? {};
  if (Number(summary.outputRowCount) !== batch.rows.length
    || Number(summary.warehouseSkuCount) !== warehouseSkus.size
    || Number(summary.mappingFallbackCount) !== batch.rows.filter((row) => Boolean(row?.mappingFallback)).length
    || Number(summary.querySkcCount) !== querySkcs.size) {
    throw invalidInbox("ERP 成本批次汇总校验失败。");
  }
  if (innerFormatVersion === 2) {
    const evidence = Array.isArray(batch.warehouseEvidence)
      ? batch.warehouseEvidence
      : (Array.isArray(batch.warehouseEvidence?.warehouses) ? batch.warehouseEvidence.warehouses : []);
    const evidenceBySku = new Map();
    const evidenceRefs = new Set();
    for (const [index, entry] of evidence.entries()) {
      const warehouseSku = String(entry?.warehouseSku ?? "").trim();
      const canonicalWarehouseSku = canonicalSku(warehouseSku);
      const expectedEvidenceRef = evidenceRefFor(warehouseSku);
      const evidenceRef = String(entry?.evidenceRef ?? expectedEvidenceRef).trim();
      if (!canonicalWarehouseSku || evidenceRef !== expectedEvidenceRef) {
        throw invalidInbox(`ERP 成本批次第 ${index + 1} 份仓库证据引用与仓库 SKU 不一致。`);
      }
      if (evidenceBySku.has(canonicalWarehouseSku) || evidenceRefs.has(evidenceRef)) {
        throw invalidInbox(`ERP 成本批次仓库证据重复：${warehouseSku}。`);
      }
      for (const [recordIndex, record] of (Array.isArray(entry?.purchaseRecords) ? entry.purchaseRecords : []).entries()) {
        validateDirectPurchaseRecord(record, warehouseSku, recordIndex, false);
      }
      for (const [recordIndex, record] of (Array.isArray(entry?.excludedRecords) ? entry.excludedRecords : []).entries()) {
        validateDirectPurchaseRecord(record, warehouseSku, recordIndex, true);
      }
      evidenceBySku.set(canonicalWarehouseSku, entry);
      evidenceRefs.add(evidenceRef);
    }
    for (const warehouseSku of warehouseSkus) {
      if (!evidenceBySku.has(warehouseSku)) throw invalidInbox(`ERP 成本批次缺少仓库 SKU ${warehouseSku} 的采购证据。`);
    }
  }
}

function validateDirectPurchaseRecord(record, warehouseSku, index, excluded) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw invalidInbox(`仓库 SKU ${warehouseSku} 的第 ${index + 1} 条${excluded ? "排除" : "采购"}证据无效。`);
  }
  validateOptionalNumber(record.quantity ?? record.qty ?? record.purchaseQuantity, "采购数量", { minimum: 0 });
  validateOptionalNumber(record.unitPrice ?? record.purchaseUnitPrice, "采购单价", { minimum: 0 });
  validateOptionalNumber(record.totalPrice ?? record.price, "采购金额", { minimum: 0 });
}

function validateQuerySkcs(values) {
  if (!Array.isArray(values)) throw invalidInbox("ERP 成本批次缺少平台 SKC 查询范围。");
  const canonicalSkcs = new Set();
  for (const [index, item] of values.entries()) {
    const source = typeof item === "string" ? item : item?.platformSkc;
    const canonical = normalizeSkc(source);
    if (!canonical) throw invalidInbox(`ERP 成本批次第 ${index + 1} 个平台 SKC 查询项无效。`);
    canonicalSkcs.add(canonical);
  }
  return canonicalSkcs;
}

function querySkcSet(values) {
  const list = Array.isArray(values)
    ? values
    : String(values ?? "").split(/[\s,，;；、]+/);
  return new Set(list
    .map((item) => normalizeSkc(typeof item === "string" ? item : item?.platformSkc))
    .filter(Boolean));
}

function validateSelectionCaptureEnvelope(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("1688 采集包内容无效。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
  }
  if (Number(payload.schemaVersion) !== 1 || payload.source !== "1688") {
    throw Object.assign(new Error("1688 采集包版本或来源不受支持。"), { status: 400, code: "UNSUPPORTED_SELECTION_CAPTURE" });
  }
  const requestId = String(payload.requestId ?? "").trim();
  const sourceUrl = String(payload.sourceUrl ?? "").trim();
  const product = payload.product;
  if (requestId.length < 8 || requestId.length > 128) {
    throw Object.assign(new Error("1688 采集包缺少有效 requestId。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
  }
  let parsedUrl;
  try { parsedUrl = new URL(sourceUrl); } catch {
    throw Object.assign(new Error("1688 来源链接无效。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
  }
  if (parsedUrl.protocol !== "https:" || !/(^|\.)1688\.com$/i.test(parsedUrl.hostname)) {
    throw Object.assign(new Error("来源链接必须来自 1688。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
  }
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw Object.assign(new Error("1688 采集包缺少商品内容。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
  }
  if (String(product.name ?? "").trim().length === 0 || String(product.name ?? "").length > 500) {
    throw Object.assign(new Error("1688 采集包缺少商品名称。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
  }
  if (!Array.isArray(product.skus) || product.skus.length > 1000) {
    throw Object.assign(new Error("1688 SKU 明细数量无效。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
  }
  const skuIds = new Set();
  product.skus.forEach((sku) => {
    if (!sku || typeof sku !== "object") throw Object.assign(new Error("1688 SKU 明细格式无效。"), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
    for (const key of ["spec", "sourceSkuId", "imageUrl"]) {
      if (String(sku[key] ?? "").length > 4096) throw Object.assign(new Error(`1688 SKU 字段 ${key} 过长。`), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
    }
    const sourceSkuId = String(sku.sourceSkuId ?? "").trim();
    if (sourceSkuId) skuIds.add(sourceSkuId.toUpperCase());
    for (const key of ["purchasePrice", "purchaseQty", "lineSubtotal"]) {
      if (sku[key] != null && (!Number.isFinite(Number(sku[key])) || Number(sku[key]) < 0)) {
        throw Object.assign(new Error(`1688 SKU 字段 ${key} 数值无效。`), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
      }
    }
  });
  for (const key of ["purchasePrice", "priceMin", "priceMax", "shippingFee", "purchaseQty", "bundleQty"]) {
    if (product[key] != null && (!Number.isFinite(Number(product[key])) || Number(product[key]) < 0)) {
      throw Object.assign(new Error(`1688 商品字段 ${key} 数值无效。`), { status: 400, code: "INVALID_SELECTION_CAPTURE" });
    }
  }
  return { requestId, sourceUrl, sourceProductId: String(product.sourceProductId ?? "").trim(), skuIds };
}

function selectionCaptureDuplicate(records, details, workspaceId) {
  return records.find((item) => {
    if (item.kind !== "selection-capture" || item.workspaceId !== workspaceId) return false;
    if (item.requestId === details.requestId) return true;
    const envelope = item.envelope?.product ?? {};
    if (details.sourceProductId && String(envelope.sourceProductId ?? "").trim().toUpperCase() === details.sourceProductId.toUpperCase()) return true;
    if (details.sourceUrl && String(item.envelope?.sourceUrl ?? "").trim() === details.sourceUrl) return true;
    const existingIds = new Set((envelope.skus ?? []).map((sku) => String(sku?.sourceSkuId ?? "").trim().toUpperCase()).filter(Boolean));
    return details.skuIds.size > 0 && [...details.skuIds].some((id) => existingIds.has(id));
  }) ?? null;
}

function requestSkcSet(request) {
  return new Set((request?.platformSkcs ?? []).map((item) => normalizeSkc(item?.platformSkc ?? item)).filter(Boolean));
}

function scopeMismatch(message) {
  return Object.assign(new Error(message), { status: 409, code: "ERP_REQUEST_SCOPE_MISMATCH" });
}

function chooseRequest(records, { requestId, ledgerId, workspaceId, querySkcs }) {
  const now = Date.now();
  const active = records.filter((item) => item.kind === "request" && item.status === "registered" && !requestExpired(item, now));
  const queriedSkcs = querySkcSet(querySkcs);
  const candidates = active.filter((item) => (
    item.requestId === requestId
    && String(item.ledgerId ?? "").trim() === ledgerId
    && String(item.workspaceId ?? "").trim() === workspaceId
    && sameSet(requestSkcSet(item), queriedSkcs)
  ));
  if (candidates.length > 1) {
    throw Object.assign(new Error("多个 ERP 请求同时匹配 requestId、ledgerId、工作区和完整 SKC 集合。"), {
      status: 409,
      code: "ERP_REQUEST_AMBIGUOUS",
      candidates: candidates.map(publicRequest),
    });
  }
  if (candidates.length === 1) return candidates[0];
  const sameId = active.find((item) => item.requestId === requestId);
  if (sameId) throw scopeMismatch("成本结果的 ledgerId、工作区或平台 SKC 集合与 ERP 请求不完整匹配。");
  return null;
}

function requestInputHash({ requestId, workspaceId, ledgerId, platformSkcs, expectedSkus }) {
  const normalizedExpectedScope = normalizedExpectedSkus(expectedSkus);
  const input = {
    requestId: String(requestId ?? "").trim(),
    workspaceId: String(workspaceId ?? "").trim(),
    ledgerId: String(ledgerId ?? "").trim(),
    querySkcs: [...querySkcSet(platformSkcs)].sort(),
    expectedSkus: [...normalizedExpectedScope.values()]
      .map((item) => ({
        platformSku: item.canonicalPlatformSku,
        platformSkc: item.canonicalPlatformSkc,
      }))
      .sort((left, right) => left.platformSku.localeCompare(right.platformSku)
        || left.platformSkc.localeCompare(right.platformSkc)),
  };
  return crypto.createHash("sha256").update(stableJson(input)).digest("hex");
}

function directInboxInputHash(payload) {
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex");
}

function findDirectRequestContext(records, batch) {
  const requestedSkcs = querySkcSet(batch?.query?.platformSkcs);
  const candidates = records.filter((item) => item.kind === "request"
    && item.status === "registered"
    && !requestExpired(item)
    && item.requestId === String(batch?.requestId ?? "").trim()
    && String(item.ledgerId ?? "").trim() === String(batch?.ledgerId ?? "").trim()
    && String(item.workspaceId ?? "").trim() === String(batch?.workspaceId ?? "").trim()
    && sameSet(requestSkcSet(item), requestedSkcs));
  if (candidates.length > 1) {
    throw Object.assign(new Error("多个 ERP 请求同时匹配 direct 成本批次上下文。"), { status: 409, code: "ERP_REQUEST_AMBIGUOUS" });
  }
  return candidates[0] ?? null;
}

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/erp/v1/") && !req.url?.startsWith("/selection/v1/")) return json(res, 404, { error: "NOT_FOUND" });
  if (!authorized(req)) return unauthorized(res);
  if (req.method === "OPTIONS") return json(res, 204, null);

  let releaseSpool = null;
  if (req.method === "POST") {
    const previousWrite = spoolWriteChain;
    spoolWriteChain = new Promise((resolve) => { releaseSpool = resolve; });
    await previousWrite;
  }

  try {
    const records = await readSpool();
    const expiredChanged = expireRegisteredRequests(records);
    if (expiredChanged) await writeSpool(records);
    if (req.method === "GET") {
      const url = new URL(req.url, `http://${bindHost}:${port}`);
      if (url.pathname === "/erp/v1/status") return json(res, 200, runtimeStatus(records));
      if (url.pathname === "/selection/v1/status") {
        return json(res, 200, { ok: true, status: "ok", application: "selection-workbench-inbox", apiVersion: 1 });
      }
      if (url.pathname === "/selection/v1/extension-status") {
        const now = Date.now();
        const extensionRecords = records
          .filter((item) => item.kind === "selection-extension-status")
          .map((item) => ({ ...item, online: extensionIsOnline(item, now) }))
          .toSorted((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
        return json(res, 200, { ok: true, records: extensionRecords, online: extensionRecords.some((item) => item.online), ttlMs: extensionTtlMs });
      }
      if (url.pathname === "/selection/v1/context") {
        const context = records.find((item) => item.kind === "selection-active-context") ?? null;
        return json(res, 200, { ok: true, context: context ? { workspaceId: context.workspaceId, memberId: context.memberId, visibility: context.visibility, updatedAt: context.updatedAt } : null });
      }
      if (url.pathname === "/selection/v1/captures") {
        const workspaceId = String(url.searchParams.get("workspaceId") || selectionWorkspaceId).trim();
        const memberId = String(url.searchParams.get("memberId") || "").trim();
        const includeAll = url.searchParams.get("includeAll") === "true";
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
        const pending = records
          .filter((item) => item.kind === "selection-capture" && item.status === "pending" && item.workspaceId === workspaceId)
          .filter((item) => includeAll || item.visibility !== "private" || (memberId && item.ownerId === memberId))
          .toSorted((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)))
          .slice(0, limit);
        return json(res, 200, { ok: true, records: pending });
      }
      if (url.pathname === "/erp/v1/requests") {
        const includeHistory = url.searchParams.get("includeHistory") === "true";
        const workspaceId = String(url.searchParams.get("workspaceId") || "").trim();
        if (!workspaceId) return json(res, 400, { error: "INVALID_ERP_REQUEST_QUERY", message: "ERP 请求查询缺少 workspaceId。" });
        const registeredBefore = Date.parse(String(url.searchParams.get("registeredBefore") || ""));
        const requestRecords = records
          .filter((item) => item.kind === "request")
          .filter((item) => !workspaceId || item.workspaceId === workspaceId)
          .filter((item) => !Number.isFinite(registeredBefore) || Date.parse(String(item.registeredAt ?? "")) <= registeredBefore);
        return json(res, 200, { records: includeHistory ? requestRecords : requestRecords.filter((item) => item.status === "registered") });
      }
      if (url.pathname === "/erp/v1/extension-status") {
        const now = Date.now();
        const extensionRecords = records
          .filter((item) => item.kind === "extension-status")
          .map((item) => ({ ...item, online: extensionIsOnline(item, now) }))
          .toSorted((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
        return json(res, 200, { records: extensionRecords, online: extensionRecords.some((item) => item.online), ttlMs: extensionTtlMs });
      }
      if (url.pathname !== "/erp/v1/cost-batches") return json(res, 404, { error: "NOT_FOUND" });
      const workspaceId = String(url.searchParams.get("workspaceId") || "").trim();
      if (!workspaceId) return json(res, 400, { error: "INVALID_INBOX_QUERY", message: "成本收件查询缺少 workspaceId。" });
      const ledgerId = url.searchParams.get("ledgerId");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);
      const pending = records
        .filter((item) => item.kind === "batch" && item.status === "pending")
        .filter((item) => item.workspaceId === workspaceId)
        .filter((item) => !ledgerId || item.ledgerId === ledgerId)
        .toSorted((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)))
        .slice(0, limit);
      return json(res, 200, { records: pending });
    }

    if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
    const payload = JSON.parse(await readBody(req));
    const requestUrl = new URL(req.url, `http://${bindHost}:${port}`);
    if (requestUrl.pathname === "/selection/v1/extension-status") {
      const extensionId = String(payload?.extensionId ?? "selection-1688-capture").trim();
      const version = String(payload?.version ?? "").trim();
      if (!extensionId || !version) return json(res, 400, { ok: false, code: "INVALID_EXTENSION_STATUS", error: "扩展状态缺少 extensionId 或 version。" });
      const record = {
        kind: "selection-extension-status",
        extensionId,
        version,
        pageUrl: String(payload?.pageUrl ?? "").trim(),
        ready: payload?.ready !== false,
        lastSeenAt: new Date().toISOString(),
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 240),
      };
      const existingIndex = records.findIndex((item) => item.kind === "selection-extension-status" && item.extensionId === extensionId);
      if (existingIndex >= 0) records[existingIndex] = record;
      else records.push(record);
      await writeSpool(records);
      return json(res, 202, { ok: true, accepted: true, extensionId, version, lastSeenAt: record.lastSeenAt });
    }
    if (requestUrl.pathname === "/selection/v1/context") {
      const workspaceId = String(payload?.workspaceId ?? "").trim();
      const memberId = String(payload?.memberId ?? "").trim();
      const visibility = payload?.visibility === "private" ? "private" : "workspace";
      if (!workspaceId || !memberId) return json(res, 400, { ok: false, code: "INVALID_SELECTION_CONTEXT", error: "工作区上下文缺少 workspaceId 或 memberId。" });
      const record = { kind: "selection-active-context", workspaceId, memberId, visibility, updatedAt: new Date().toISOString() };
      const index = records.findIndex((item) => item.kind === "selection-active-context");
      if (index >= 0) records[index] = record;
      else records.push(record);
      await writeSpool(records);
      return json(res, 202, { ok: true, context: record });
    }
    if (requestUrl.pathname === "/selection/v1/captures") {
      const encodedSize = Buffer.byteLength(JSON.stringify(payload), "utf8");
      if (encodedSize > selectionCaptureMaxBytes) return json(res, 413, { ok: false, code: "CAPTURE_TOO_LARGE", error: "1688 采集包过大。" });
      const details = validateSelectionCaptureEnvelope(payload);
      const activeContext = records.find((item) => item.kind === "selection-active-context") ?? null;
      const workspaceId = String(req.headers["x-shopeers-workspace-id"] || payload.workspaceId || activeContext?.workspaceId || selectionWorkspaceId).trim() || selectionWorkspaceId;
      const ownerId = String(req.headers["x-shopeers-member-id"] || payload.ownerId || activeContext?.memberId || "local-user").trim() || "local-user";
      const visibility = activeContext?.visibility === "private" ? "private" : "workspace";
      const duplicate = selectionCaptureDuplicate(records, details, workspaceId);
      if (duplicate) return json(res, 200, { ok: true, code: "duplicate", idempotent: true, captureId: duplicate.captureId, deliveryId: duplicate.deliveryId });
      const receivedAt = new Date().toISOString();
      const record = {
        kind: "selection-capture",
        captureId: `SEL-CAP-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        deliveryId: `SEL-DELIVERY-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        requestId: details.requestId,
        workspaceId,
        ownerId,
        visibility,
        source: "1688",
        status: "pending",
        receivedAt,
        envelope: payload,
      };
      records.push(record);
      await writeSpool(records);
      return json(res, 202, { ok: true, code: "accepted", idempotent: false, captureId: record.captureId, deliveryId: record.deliveryId });
    }
    if (requestUrl.pathname === "/selection/v1/captures/ack") {
      const deliveryId = String(payload?.deliveryId ?? "").trim();
      const workspaceId = String(payload?.workspaceId ?? "").trim();
      if (!deliveryId || !workspaceId) return json(res, 400, { ok: false, code: "INVALID_CAPTURE_ACK", error: "缺少 deliveryId 或 workspaceId。" });
      const index = records.findIndex((item) => item.kind === "selection-capture" && item.deliveryId === deliveryId && item.workspaceId === workspaceId);
      if (index < 0) return json(res, 404, { ok: false, code: "CAPTURE_NOT_FOUND", error: "采集投递不存在。" });
      records[index] = { ...records[index], status: "acknowledged", acknowledgedAt: new Date().toISOString() };
      await writeSpool(records);
      return json(res, 200, { ok: true, acknowledged: true, deliveryId });
    }
    if (requestUrl.pathname === "/erp/v1/requests") {
      const requestId = String(payload?.request?.id ?? payload?.requestId ?? "").trim();
      const workspaceId = String(payload?.request?.workspaceId ?? payload?.workspaceId ?? "").trim();
      const ledgerId = payload?.request?.ledgerId ?? payload?.ledgerId ?? null;
      const platformSkcs = Array.isArray(payload?.request?.platformSkcs) ? payload.request.platformSkcs : [];
      const expectedSkus = Array.isArray(payload?.expectedSkus) ? payload.expectedSkus : [];
      if (!requestId || !workspaceId || platformSkcs.length === 0) return json(res, 400, { error: "INVALID_ERP_REQUEST", message: "请求缺少 requestId、workspaceId 或平台 SKC。" });
      const queryScope = querySkcSet(platformSkcs);
      const normalizedExpectedScope = normalizedExpectedSkus(expectedSkus, { strict: expectedSkus.length > 0 });
      if ([...normalizedExpectedScope.values()].some((item) => !queryScope.has(item.canonicalPlatformSkc))) {
        return json(res, 400, { error: "INVALID_ERP_REQUEST", message: "expectedSkus 包含不在完整平台 SKC 查询范围内的项目。" });
      }
      const inputHash = requestInputHash({ requestId, workspaceId, ledgerId, platformSkcs, expectedSkus: [...normalizedExpectedScope.values()] });
      const existingRequest = records.find((item) => item.kind === "request" && item.requestId === requestId);
      if (existingRequest) {
        const existingInputHash = existingRequest.requestInputHash || requestInputHash(existingRequest);
        if (existingInputHash !== inputHash) {
          return json(res, 409, {
            error: "ERP_REQUEST_CONFLICT",
            message: "requestId 已被不同的工作区、账本或 SKU/SKC 查询范围使用。",
            requestId,
          });
        }
        return json(res, 200, { accepted: true, idempotent: true, requestId });
      }
      records.push({
        kind: "request",
        requestId,
        workspaceId,
        ledgerId,
        platformSkcs,
        expectedSkus: [...normalizedExpectedScope.values()].map(({ platformSku, platformSkc }) => ({ platformSku, platformSkc })),
        requestInputHash: inputHash,
        requestedAt: payload?.request?.requestedAt ?? new Date().toISOString(),
        registeredAt: new Date().toISOString(),
        status: "registered",
      });
      await writeSpool(records);
      return json(res, 202, { accepted: true, idempotent: false, requestId });
    }
    if (requestUrl.pathname === "/erp/v1/extension-status") {
      const extensionId = String(payload?.extensionId ?? "erp-assistant").trim();
      const version = String(payload?.version ?? "").trim();
      const pageUrl = String(payload?.pageUrl ?? "").trim();
      if (!extensionId || !version) return json(res, 400, { error: "INVALID_EXTENSION_STATUS", message: "扩展状态缺少 extensionId 或 version。" });
      const record = {
        kind: "extension-status",
        extensionId,
        version,
        pageUrl,
        ready: payload?.ready !== false,
        lastSeenAt: new Date().toISOString(),
        userAgent: String(payload?.userAgent ?? "").slice(0, 240),
      };
      const existingIndex = records.findIndex((item) => item.kind === "extension-status" && item.extensionId === extensionId);
      if (existingIndex >= 0) records[existingIndex] = record;
      else records.push(record);
      await writeSpool(records);
      return json(res, 202, { accepted: true, extensionId, version, lastSeenAt: record.lastSeenAt });
    }
    if (requestUrl.pathname === "/erp/v1/cost-results") {
      const resultDeliveryId = String(payload?.resultDeliveryId ?? "").trim();
      if (!resultDeliveryId) return json(res, 400, { error: "INVALID_RESULT_DELIVERY", message: "成本结果缺少稳定的 resultDeliveryId。" });
      const requestId = String(payload?.requestId ?? "").trim();
      if (!requestId) return json(res, 400, { error: "INVALID_ERP_RESULT_CONTEXT", message: "成本结果缺少 requestId。" });
      const ledgerId = String(payload?.ledgerId ?? "").trim();
      if (!ledgerId) return json(res, 400, { error: "INVALID_ERP_RESULT_CONTEXT", message: "成本结果缺少 ledgerId。" });
      if (!Array.isArray(payload?.querySkcs) || querySkcSet(payload.querySkcs).size === 0) {
        return json(res, 400, { error: "INVALID_ERP_RESULT_CONTEXT", message: "成本结果缺少完整的 querySkcs canonical 集合。" });
      }
      const querySkcs = payload.querySkcs;
      const workspaceId = String(payload?.workspaceId ?? "").trim();
      if (!workspaceId) return json(res, 400, { error: "INVALID_ERP_RESULT_CONTEXT", message: "成本结果缺少 workspaceId。" });
      const suppliedRows = Array.isArray(payload?.rows) ? payload.rows : [];
      const evidenceSkus = evidenceWarehouseSkus(payload?.warehouseEvidence);
      const suppliedWarehouseSkus = new Set(suppliedRows.map((row) => canonicalSku(row?.warehouseSku)).filter(Boolean));
      const rawRows = [
        ...suppliedRows,
        ...evidenceSkus.filter((warehouseSku) => !suppliedWarehouseSkus.has(canonicalSku(warehouseSku))).map((warehouseSku) => ({
          warehouseSku,
          platformSku: "",
          previewUnitCost: null,
          sourceWarnings: ["evidence_only_warehouse_sku"],
        })),
      ];
      if (rawRows.length === 0) return json(res, 400, { error: "EMPTY_COST_RESULTS", message: "成本结果和仓库 SKU 证据均为空。" });
      const resultInputHash = costResultInputHash(payload);
      const duplicate = records.find((item) => item.kind === "batch" && item.resultDeliveryId === resultDeliveryId);
      if (duplicate) {
        if (!duplicate.resultInputHash || duplicate.resultInputHash !== resultInputHash) {
          return json(res, 409, {
            error: "ERP_RESULT_DELIVERY_CONFLICT",
            message: "resultDeliveryId 已被不同的请求范围或成本输入使用。",
            resultDeliveryId,
          });
        }
        return json(res, 200, {
          accepted: true,
          idempotent: true,
          resultDeliveryId,
          deliveryId: duplicate.deliveryId,
          batchId: duplicate.batchId,
          requestId: duplicate.requestId,
        });
      }
      const request = chooseRequest(records, { requestId, ledgerId, workspaceId, querySkcs });
      if (!request) return json(res, 409, { error: "ERP_REQUEST_NOT_FOUND", message: "没有可关联的 Shopeers ERP 成本请求。" });
      const queriedSkcs = requestSkcSet(request);
      const expectedBySku = normalizedExpectedSkus(request.expectedSkus);
      const rows = rawRows.map((rawRow, index) => {
        const row = stripExtensionDecisions(rawRow);
        const platformSku = String(row?.platformSku ?? "").trim();
        const platformSkc = String(row?.platformSkc ?? "").trim();
        const scope = classifyLedgerScopeRow({ ...row, platformSku, platformSkc }, request, queriedSkcs);
        return {
          platformSku,
          platformSkc: platformSkc || null,
          warehouseSku: String(row?.warehouseSku ?? "").trim(),
          orderNumber: String(row?.orderNumber ?? "").trim(),
          orderType: String(row?.sourceType ?? row?.orderType ?? "").trim(),
          productName: String(row?.name ?? row?.productName ?? "").trim(),
          calculationCount: Number(row?.calcTimes ?? row?.calculationCount) || null,
          dateRange: String(row?.dateRange ?? "").trim(),
          totalQuantity: Number(row?.totalQty ?? row?.totalQuantity) || null,
          totalPrice: Number(row?.totalPrice) || null,
          supplierName: String(row?.supplierName ?? "").trim(),
          supplier1688Url: String(row?.supplier1688Url ?? row?.supplierOfferUrl ?? row?.sourceUrl ?? "").trim(),
          selectedRecordIds: Array.isArray(row?.selectedRecordIds) ? row.selectedRecordIds.map((id) => String(id)).filter(Boolean) : [],
          evidenceRef: evidenceRefFor(String(row?.warehouseSku ?? "").trim()),
          previewUnitCost: optionalNumber(row?.previewUnitCost ?? row?.unitCost),
          unitCost: optionalNumber(row?.previewUnitCost ?? row?.unitCost),
          currency: "CNY",
          costRole: "preview",
          ledgerScopeRole: scope.ledgerScopeRole,
          mappingFallback: false,
          sourceWarnings: [
            ...sourceWarningsContract(row, {
              strict: true,
              label: `ERP 成本结果第 ${index + 1} 行来源警告`,
            }).warnings,
            ...scope.warnings,
          ],
          sourceRow: index + 1,
        };
      });
      if (rows.some((row) => !row.warehouseSku || (row.previewUnitCost != null && row.previewUnitCost < 0))) {
        return json(res, 400, { error: "INVALID_COST_RESULTS", message: "成本结果包含无效仓库 SKU 或预览单件成本。" });
      }
      const warehouseEvidence = sanitizeWarehouseEvidence(
        stripExtensionDecisions(payload?.warehouseEvidence),
        rows.map((row) => row.warehouseSku),
        new Map(),
        { strictSourceWarnings: true },
      );
      const expectedRows = rows.filter((row) => row.ledgerScopeRole === LEDGER_SCOPE_EXPECTED);
      const sourceMeta = sanitizeSourceMeta(
        stripExtensionDecisions(payload?.sourceMeta ?? payload?.meta),
        warehouseEvidence,
        { expectedRows, expectedSkus: request.expectedSkus },
      );
      const matchedExpectedSkus = new Set(expectedRows.map((row) => canonicalSku(row.platformSku)).filter(Boolean));
      const missingExpectedWarnings = [...expectedBySku.values()]
        .filter((item) => !matchedExpectedSkus.has(item.canonicalPlatformSku))
        .map((item) => `mapping_failure:missing_expected_platform_sku:${item.platformSku}`);
      if (missingExpectedWarnings.length > 0) {
        sourceMeta.sourceWarnings = uniqueStrings([...(sourceMeta.sourceWarnings ?? []), ...missingExpectedWarnings]);
        sourceMeta.evidenceComplete = false;
      }
      const batchId = `ERP-BATCH-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const platformSkcs = request.platformSkcs.map((item) => ({
        platformSkc: String(item.platformSkc ?? item).trim(),
      }));
      const batch = {
        format: "shopeers-erp-cost-batch",
        formatVersion: 2,
        batchId,
        workspaceId: request.workspaceId,
        ledgerId: request.ledgerId,
        requestId: request.requestId,
        generatedAt: new Date().toISOString(),
        complete: true,
        status: "completed",
        currency: "CNY",
        baseline: BASELINE,
        algorithmVersion: ALGORITHM_VERSION,
        query: { unit: "platform_skc", platformSkcs },
        summary: {
          outputRowCount: rows.length,
          warehouseSkuCount: new Set(rows.map((row) => row.warehouseSku.toUpperCase())).size,
          mappingFallbackCount: 0,
          querySkcCount: platformSkcs.length,
        },
        sourceMeta: { ...sourceMeta, sourceFormat: "erp-v8-http-bridge" },
        warehouseEvidence,
        evidenceStatus: sourceMeta.evidenceComplete ? "complete" : "legacy_partial",
        rows,
      };
      const envelope = {
        type: "shopeers.erp.cost.batch",
        source: "erp-assistant-v8",
        format: "shopeers-erp-cost-inbox",
        formatVersion: 2,
        deliveryId: `ERP-DELIVERY-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sentAt: new Date().toISOString(),
        transport: "local-http",
        baseline: BASELINE,
        batch,
      };
      records.push({
        kind: "batch",
        resultDeliveryId,
        resultInputHash,
        deliveryId: envelope.deliveryId,
        batchId,
        workspaceId: request.workspaceId,
        ledgerId: request.ledgerId,
        requestId: request.requestId,
        receivedAt: new Date().toISOString(),
        status: "pending",
        envelope,
      });
      const requestIndex = records.findIndex((item) => item.kind === "request" && item.requestId === request.requestId);
      if (requestIndex >= 0) records[requestIndex] = { ...records[requestIndex], status: "used", usedAt: new Date().toISOString() };
      await writeSpool(records);
      latestTransportError = null;
      return json(res, 202, { accepted: true, idempotent: false, resultDeliveryId, deliveryId: envelope.deliveryId, batchId, requestId: request.requestId });
    }
    if (requestUrl.pathname !== "/erp/v1/cost-batches") return json(res, 404, { error: "NOT_FOUND" });
    const deliveryId = String(payload?.deliveryId ?? "").trim();
    if (payload?.status === "acknowledged" && deliveryId) {
      const workspaceId = String(payload?.workspaceId ?? "").trim();
      if (!workspaceId) return json(res, 400, { error: "INVALID_INBOX_ACK", message: "成本收件确认缺少 workspaceId。" });
      const index = records.findIndex((item) => item.kind === "batch" && item.deliveryId === deliveryId && item.workspaceId === workspaceId);
      if (index < 0) return json(res, 404, { error: "DELIVERY_NOT_FOUND" });
      records[index] = { ...records[index], status: "acknowledged", acknowledgedAt: new Date().toISOString() };
      await writeSpool(records);
      return json(res, 200, { acknowledged: true, deliveryId });
    }
    const batchId = String(payload?.batch?.batchId ?? "").trim();
    if (!deliveryId || !batchId) return json(res, 400, { error: "INVALID_INBOX_MESSAGE", message: "缺少 deliveryId 或 batch.batchId。" });
    const directInputHash = directInboxInputHash(payload);

    const existing = records.find((item) => item.kind === "batch" && (item.deliveryId === deliveryId || item.batchId === batchId));
    if (existing) {
      if (existing.deliveryId !== deliveryId || existing.batchId !== batchId || existing.directInputHash !== directInputHash) {
        return json(res, 409, {
          error: "ERP_DIRECT_DELIVERY_CONFLICT",
          message: "deliveryId 或 batchId 已绑定到不同的 direct 成本批次。",
        });
      }
      return json(res, 200, { accepted: true, idempotent: true, deliveryId: existing.deliveryId, batchId: existing.batchId });
    }

    const outerFormatVersion = Number(payload?.formatVersion);
    const outerSourceFormatVersion = payload?.sourceFormatVersion == null
      ? outerFormatVersion
      : Number(payload.sourceFormatVersion);
    const innerFormatVersion = Number(payload?.batch?.formatVersion);
    const innerSourceFormatVersion = payload?.batch?.sourceFormatVersion == null
      ? innerFormatVersion
      : Number(payload.batch.sourceFormatVersion);
    if (![outerFormatVersion, outerSourceFormatVersion, innerFormatVersion, innerSourceFormatVersion]
      .every((version) => [1, 2].includes(version))) {
      return json(res, 400, { error: "INVALID_INBOX_MESSAGE", message: "ERP 收件包或内层成本批次版本不受支持。" });
    }
    validateDirectInboxContract(payload, { innerFormatVersion });
    const sourceFormatVersion = [outerFormatVersion, outerSourceFormatVersion, innerFormatVersion, innerSourceFormatVersion].includes(1) ? 1 : 2;
    const directRequest = findDirectRequestContext(records, payload.batch);
    if (!directRequest) {
      return json(res, 409, {
        error: "ERP_REQUEST_NOT_FOUND",
        message: "direct 成本批次没有匹配的已登记 ERP 请求上下文。",
      });
    }
    const sanitizedBatch = sanitizeDirectBatch(payload.batch, {
      sourceFormatVersion,
      strictSourceWarnings: innerFormatVersion === 2,
      request: directRequest,
    });
    sanitizedBatch.evidenceStatus = sourceFormatVersion === 1
      ? "legacy_partial"
      : (sanitizedBatch.sourceMeta?.evidenceComplete === true ? "complete" : "legacy_partial");
    const sanitizedPayload = {
      ...stripExtensionDecisions(payload),
      formatVersion: 2,
      sourceFormatVersion,
      batch: sanitizedBatch,
    };
    const record = {
      kind: "batch",
      deliveryId,
      batchId,
      directInputHash,
      workspaceId: String(sanitizedPayload.batch.workspaceId ?? "").trim(),
      ledgerId: sanitizedPayload.batch.ledgerId ?? null,
      requestId: String(sanitizedPayload.batch.requestId ?? "").trim(),
      receivedAt: new Date().toISOString(),
      status: "pending",
      envelope: sanitizedPayload,
    };
    records.push(record);
    const directRequestIndex = records.findIndex((item) => item.kind === "request" && item.requestId === directRequest.requestId);
    if (directRequestIndex >= 0) {
      records[directRequestIndex] = { ...records[directRequestIndex], status: "used", usedAt: new Date().toISOString() };
    }
    await writeSpool(records);
    latestTransportError = null;
    return json(res, 202, { accepted: true, idempotent: false, deliveryId, batchId });
  } catch (error) {
    if (req.url?.startsWith("/erp/v1/")) {
      latestTransportError = {
        code: error.code || "ERP_INBOX_ERROR",
        message: error.message || "ERP 收件失败。",
        path: req.url,
        occurredAt: new Date().toISOString(),
      };
    }
    return json(res, Number(error.status) || 400, {
      error: error.code || "ERP_INBOX_ERROR",
      message: error.message || "ERP 收件失败。",
      candidates: error.candidates,
    });
  } finally {
    releaseSpool?.();
  }
});

server.listen(port, bindHost, () => {
  console.log(`Shopeers ERP inbox listening on http://${bindHost}:${port}/erp/v1/cost-batches`);
  console.log(`ERP inbox spool: ${spoolPath}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
