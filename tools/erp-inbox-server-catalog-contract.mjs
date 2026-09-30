// frontend/src/domain/erpCatalogFields.js
var hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
function text(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const normalized = String(value).normalize("NFKC").trim();
  return normalized || null;
}
function normalizeErpCatalogUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => /token|cookie|authorization|password|secret|capability|endpoint|baseurl/i.test(key))) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
function normalizeErpSupplierLinks(values) {
  const links = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of Array.isArray(values) ? values : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const url = normalizeErpCatalogUrl(entry.url);
    if (!url) continue;
    const parsed = new URL(url);
    const isProduct = parsed.hostname === "detail.1688.com" && /^\/offer\/\d{7,20}\.html$/.test(parsed.pathname);
    const isStore = parsed.hostname.endsWith(".1688.com") && !["detail.1688.com", "www.1688.com"].includes(parsed.hostname);
    if (!(entry.type === "product" && isProduct) && !(entry.type === "store" && isStore)) continue;
    parsed.search = "";
    const link = { type: entry.type, url: parsed.href, supplierName: text(entry.supplierName) };
    const key = JSON.stringify(link);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}
function normalizeErpCatalogMappings(values) {
  const mappings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of Array.isArray(values) ? values : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const mapping = {
      platformSku: text(entry.platformSku),
      platformSkc: text(entry.platformSkc),
      warehouseSku: text(entry.warehouseSku),
      productName: text(entry.productName),
      imageUrl: normalizeErpCatalogUrl(entry.imageUrl),
      attribute: text(entry.attribute)
    };
    for (const key2 of ["storeName", "storeId", "articleNumber", "platform"]) {
      if (hasOwn(entry, key2)) mapping[key2] = text(entry[key2]);
    }
    if (hasOwn(entry, "unitConversion")) mapping.unitConversion = normalizeErpUnitConversion(entry.unitConversion);
    const key = JSON.stringify(mapping);
    if (seen.has(key)) continue;
    seen.add(key);
    mappings.push(mapping);
  }
  return mappings;
}
function normalizeErpPurchaseCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const catalog = {
    picturesLinking: normalizeErpCatalogUrl(value.picturesLinking),
    pictureLink1688: normalizeErpCatalogUrl(value.pictureLink1688)
  };
  for (const key of [
    "purchaseSpecificationAndModel1688",
    "model1688",
    "specificationAndModel",
    "productColor",
    "purchaseProportion1688",
    "purchaseOrderDetailId",
    "purchaseOrderId",
    "purchaseOrderNo",
    "lineNumber",
    "supplierId",
    "barcodeSkuid",
    "barcodeSkcid"
  ]) catalog[key] = text(value[key]);
  return catalog;
}
function normalizeErpCatalogFields(value, { includeMappings = true } = {}) {
  const fields = {};
  if (hasOwn(value, "supplierNames")) fields.supplierNames = [...new Set((Array.isArray(value.supplierNames) ? value.supplierNames : []).map(text).filter(Boolean))];
  if (hasOwn(value, "unitConversion")) fields.unitConversion = normalizeErpUnitConversion(value.unitConversion);
  if (hasOwn(value, "imageUrl")) fields.imageUrl = normalizeErpCatalogUrl(value.imageUrl);
  if (hasOwn(value, "attribute")) fields.attribute = text(value.attribute);
  if (includeMappings && hasOwn(value, "catalogMappings")) fields.catalogMappings = normalizeErpCatalogMappings(value.catalogMappings);
  if (hasOwn(value, "supplier1688Links")) fields.supplier1688Links = normalizeErpSupplierLinks(value.supplier1688Links);
  if (hasOwn(value, "purchaseCatalog")) fields.purchaseCatalog = normalizeErpPurchaseCatalog(value.purchaseCatalog);
  return fields;
}
var ERP_CATALOG_COVERAGE_GROUPS = Object.freeze(["directory", "mappings", "images", "suppliers", "purchaseEvidence"]);
function normalizeErpCatalogCoverage(value) {
  return Object.fromEntries(ERP_CATALOG_COVERAGE_GROUPS.map((group) => {
    const input = value?.[group];
    const state = ["complete", "partial", "unavailable"].includes(input?.state) ? input.state : "unavailable";
    const normalized = { state, reasons: [...new Set((Array.isArray(input?.reasons) ? input.reasons : []).map(text).filter(Boolean))] };
    if (!input) normalized.reasons.push("not_collected");
    if (text(input?.attemptedAt) && Number.isFinite(Date.parse(input.attemptedAt))) normalized.attemptedAt = input.attemptedAt;
    for (const key of ["pageCount", "recordCount", "missingCount"]) if (Number.isInteger(input?.[key]) && input[key] >= 0) normalized[key] = input[key];
    return [group, normalized];
  }));
}
function normalizeErpUnitConversion(value) {
  if (!value || !["erp_platform_mapping", "erp_purchase_detail"].includes(value.source) || !text(value.sourceRef)) return null;
  const warehouseUnits = Number(value.warehouseUnits), platformUnits = Number(value.platformUnits);
  if (!Number.isFinite(warehouseUnits) || !Number.isFinite(platformUnits) || warehouseUnits <= 0 || platformUnits <= 0) return null;
  return { warehouseUnits, platformUnits, source: value.source, sourceRef: text(value.sourceRef) };
}

// frontend/src/domain/errors.js
var DomainRuleError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainRuleError";
    this.code = code;
    this.details = details;
  }
};
function assertDomain(condition, code, message, details) {
  if (!condition) {
    throw new DomainRuleError(code, message, details);
  }
}

// frontend/src/domain/identifiers.js
function normalizeRequiredIdentifier(value, label) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  assertDomain(normalized.length > 0, "identifier_required", `${label}\u4E0D\u80FD\u4E3A\u7A7A`, { label });
  return normalized;
}
function normalizeWorkspaceId(value) {
  return normalizeRequiredIdentifier(value, "\u5DE5\u4F5C\u533A ID");
}
function normalizePlatformSku(value) {
  return normalizeRequiredIdentifier(value, "\u5E73\u53F0 SKU");
}
function canonicalPlatformSku(value) {
  return normalizePlatformSku(value).toUpperCase();
}
function normalizePlatformSkc(value) {
  return normalizeRequiredIdentifier(value, "\u5E73\u53F0 SKC");
}
function canonicalPlatformSkc(value) {
  return normalizePlatformSkc(value).toUpperCase();
}
function normalizeWarehouseSku(value) {
  return normalizeRequiredIdentifier(value, "\u4ED3\u5E93 SKU");
}
function canonicalWarehouseSku(value) {
  return normalizeWarehouseSku(value).toUpperCase();
}

// frontend/src/domain/erpCatalogRequest.js
var ERP_CATALOG_REQUEST_KIND = "catalog";
var ERP_CATALOG_MESSAGE_TYPE = "shopeers.erp.catalog.batch";
var ERP_CATALOG_INBOX_FORMAT = "shopeers-erp-catalog-inbox";
var ERP_CATALOG_BATCH_FORMAT = "shopeers-erp-catalog-batch";
var ERP_CATALOG_VERSION = 1;
var ERP_CATALOG_GROUPS = Object.freeze(["directory", "mappings", "images", "suppliers", "purchaseEvidence"]);
var required = (value, label) => {
  const text2 = String(value ?? "").trim();
  if (!text2) throw new Error(`${label}\u4E0D\u80FD\u4E3A\u7A7A\u3002`);
  return text2;
};
var optional = (value) => String(value ?? "").trim() || null;
var timestamp = (value, label) => {
  const text2 = required(value, label);
  if (!Number.isFinite(Date.parse(text2))) throw new Error(`${label}\u4E0D\u662F\u6709\u6548\u65F6\u95F4\u3002`);
  return text2;
};
var unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(optional).filter(Boolean))];
var period = (value) => {
  const text2 = required(value, "ERP \u8D44\u6599\u9002\u7528\u6708\u4EFD");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text2)) throw new Error("ERP \u8D44\u6599\u9002\u7528\u6708\u4EFD\u5FC5\u987B\u4E3A YYYY-MM\u3002");
  return text2;
};
var evidenceRef = (sku) => `warehouse:${canonicalWarehouseSku(sku)}`;
function skcs(values) {
  const result = /* @__PURE__ */ new Map();
  for (const item of Array.isArray(values) ? values : []) {
    const sku = normalizePlatformSkc(typeof item === "string" ? item : item?.platformSkc);
    result.set(canonicalPlatformSkc(sku), sku);
  }
  if (!result.size) throw new Error("ERP \u8D44\u6599\u8BF7\u6C42\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u5DF2\u7ECF\u786E\u8BA4\u7684\u5E73\u53F0 SKC\u3002");
  return [...result.values()];
}
function validateErpCatalogRequest(value) {
  if (!value || value.kind !== ERP_CATALOG_REQUEST_KIND) throw new Error("ERP \u8D44\u6599\u8BF7\u6C42\u7C7B\u578B\u4E0D\u53D7\u652F\u6301\u3002");
  const platformSkcs = skcs(value.platformSkcs);
  const scope = new Set(platformSkcs.map(canonicalPlatformSkc));
  const confirmed = /* @__PURE__ */ new Map();
  for (const entry of Array.isArray(value.confirmedSkus) ? value.confirmedSkus : []) {
    const platformSku = normalizePlatformSku(entry?.platformSku), platformSkc = normalizePlatformSkc(entry?.platformSkc);
    if (!scope.has(canonicalPlatformSkc(platformSkc))) throw new Error("ERP \u8D44\u6599\u8BF7\u6C42\u7684\u786E\u8BA4\u8EAB\u4EFD\u8D85\u51FA\u76EE\u6807 SKC \u8303\u56F4\u3002");
    const previous = confirmed.get(canonicalPlatformSku(platformSku));
    if (previous && canonicalPlatformSkc(previous.platformSkc) !== canonicalPlatformSkc(platformSkc)) throw new Error(`\u5E73\u53F0 SKU ${platformSku} \u7684\u786E\u8BA4\u8EAB\u4EFD\u5B58\u5728\u51B2\u7A81\u3002`);
    confirmed.set(canonicalPlatformSku(platformSku), { platformSku, platformSkc });
  }
  if (platformSkcs.some((skc) => ![...confirmed.values()].some((entry) => canonicalPlatformSkc(entry.platformSkc) === canonicalPlatformSkc(skc)))) throw new Error("ERP \u8D44\u6599\u8BF7\u6C42\u7684\u6BCF\u4E2A SKC \u5747\u987B\u6709\u672C\u673A\u5DF2\u786E\u8BA4\u7684 SKU \u8EAB\u4EFD\u3002");
  const sourceRequestId = optional(value.sourceRequestId), sourceProductIds = unique(value.sourceProductIds);
  if (!sourceRequestId && !sourceProductIds.length) throw new Error("ERP \u8D44\u6599\u8BF7\u6C42\u7F3A\u5C11\u5DF2\u9A8C\u8BC1\u8BF7\u6C42\u6216\u5DF2\u6709\u5546\u54C1\u6765\u6E90\u3002");
  const missingGroups = unique(value.missingGroups ?? ERP_CATALOG_GROUPS);
  if (!missingGroups.length || missingGroups.some((group) => !ERP_CATALOG_GROUPS.includes(group))) throw new Error("ERP \u8D44\u6599\u8865\u53D6\u5206\u7EC4\u4E0D\u53D7\u652F\u6301\u3002");
  const id = required(value.id ?? value.requestId, "ERP \u8D44\u6599\u8BF7\u6C42 ID");
  const supersedesRequestId = optional(value.supersedesRequestId);
  if (supersedesRequestId === id) throw new Error("ERP \u8D44\u6599\u8BF7\u6C42\u4E0D\u80FD\u66FF\u4EE3\u81EA\u8EAB\u3002");
  return { kind: ERP_CATALOG_REQUEST_KIND, id, requestId: id, workspaceId: normalizeWorkspaceId(value.workspaceId), ledgerId: optional(value.ledgerId), ledgerPeriod: period(value.ledgerPeriod), platformSkcs, confirmedSkus: [...confirmed.values()], sourceRequestId, sourceProductIds, missingGroups, supersedesRequestId, catalogVersion: ERP_CATALOG_VERSION, idempotencyKey: required(value.idempotencyKey, "ERP \u8D44\u6599\u5E42\u7B49\u6807\u8BC6"), requestedAt: timestamp(value.requestedAt, "ERP \u8D44\u6599\u8BF7\u6C42\u65F6\u95F4") };
}
function buildErpCatalogRequest(value = {}) {
  return validateErpCatalogRequest({ ...value, kind: ERP_CATALOG_REQUEST_KIND, requestedAt: value.requestedAt ?? (/* @__PURE__ */ new Date()).toISOString() });
}
function number(value, label) {
  if (value == null || String(value).trim() === "") return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label}\u5FC5\u987B\u4E3A\u975E\u8D1F\u6570\u5B57\u3002`);
  return result;
}
function normalizeErpCatalogPurchaseEvidence(value) {
  const source = Array.isArray(value) ? value : value?.warehouses;
  const seen = /* @__PURE__ */ new Set();
  return (Array.isArray(source) ? source : []).map((entry) => {
    const warehouseSku = normalizeWarehouseSku(entry?.warehouseSku), canonical = canonicalWarehouseSku(warehouseSku);
    if (seen.has(canonical)) throw new Error(`ERP \u8D44\u6599\u91C7\u8D2D\u8BC1\u636E\u7684\u4ED3\u5E93 SKU \u91CD\u590D\uFF1A${warehouseSku}\u3002`);
    seen.add(canonical);
    const ref = optional(entry?.evidenceRef) ?? evidenceRef(warehouseSku);
    if (ref !== evidenceRef(warehouseSku)) throw new Error("ERP \u8D44\u6599\u91C7\u8D2D\u8BC1\u636E\u4E0E\u4ED3\u5E93 SKU \u4E0D\u4E00\u81F4\u3002");
    const normalizeRecords = (records, excluded) => (Array.isArray(records) ? records : []).map((record, index) => {
      if (optional(record?.warehouseSku) && canonicalWarehouseSku(record.warehouseSku) !== canonical) throw new Error("ERP \u8D44\u6599\u91C7\u8D2D\u8BB0\u5F55\u4E0E\u4ED3\u5E93\u8BC1\u636E\u4E0D\u4E00\u81F4\u3002");
      return {
        recordId: required(record?.recordId ?? record?.id, `ERP \u8D44\u6599\u7B2C ${index + 1} \u6761\u91C7\u8D2D\u8BB0\u5F55 ID`),
        warehouseSku,
        productName: optional(record?.productName ?? record?.name),
        quantity: number(record?.quantity ?? record?.qty, "\u91C7\u8D2D\u6570\u91CF"),
        unitPrice: number(record?.unitPrice, "\u91C7\u8D2D\u5355\u4EF7"),
        totalPrice: number(record?.totalPrice, "\u91C7\u8D2D\u91D1\u989D"),
        purchaseDate: optional(record?.purchaseDate ?? record?.date),
        order1688: optional(record?.order1688),
        purchaseOrderNo: optional(record?.purchaseOrderNo),
        purchaseOrderId: optional(record?.purchaseOrderId),
        supplierName: optional(record?.supplierName),
        supplier1688Url: normalizeErpCatalogUrl(record?.supplier1688Url),
        ...normalizeErpCatalogFields(record, { includeMappings: false }),
        eligible: excluded ? false : record?.eligible !== false,
        selectedForPreview: false,
        exclusionReasons: unique(record?.exclusionReasons),
        warningReasons: unique(record?.warningReasons),
        statusFields: Object.fromEntries(Object.entries(record?.statusFields ?? {}).filter(([key, child]) => ["purchaseStatus", "paymentStatus", "payStatus", "orderStatus", "order1688Status", "orderStatus1688", "purchaseOrderStatus1688", "purchaseOrderStatus", "status"].includes(key) && child != null && ["string", "number", "boolean"].includes(typeof child)))
      };
    });
    const sourceWarnings = unique(entry?.sourceWarnings);
    return { warehouseSku, canonicalWarehouseSku: canonical, evidenceRef: ref, purchaseRecords: normalizeRecords(entry?.purchaseRecords, false), excludedRecords: normalizeRecords(entry?.excludedRecords, true), sourceWarnings, evidenceComplete: entry?.evidenceComplete === true && !sourceWarnings.length };
  });
}
function validateErpCatalogInboxEnvelope(value, { request = null, expectedWorkspaceId = null } = {}) {
  if (!value || value.type !== ERP_CATALOG_MESSAGE_TYPE || value.source !== "erp-assistant-v8" || value.format !== ERP_CATALOG_INBOX_FORMAT || Number(value.formatVersion) !== ERP_CATALOG_VERSION) throw new Error("ERP \u8D44\u6599\u6536\u4EF6\u5305\u6765\u6E90\u6216\u7248\u672C\u4E0D\u53D7\u652F\u6301\u3002");
  const input = value.catalog;
  if (!input || input.format !== ERP_CATALOG_BATCH_FORMAT || Number(input.formatVersion) !== ERP_CATALOG_VERSION) throw new Error("ERP \u8D44\u6599\u6279\u6B21\u7248\u672C\u4E0D\u53D7\u652F\u6301\u3002");
  const workspaceId = normalizeWorkspaceId(input.workspaceId), requestId = required(input.requestId, "ERP \u8D44\u6599\u8BF7\u6C42 ID");
  const ledgerPeriod = period(input.ledgerPeriod), platformSkcs = skcs(input.query?.platformSkcs);
  if (input.query?.unit !== "platform_skc") throw new Error("ERP \u8D44\u6599\u67E5\u8BE2\u5355\u4F4D\u5FC5\u987B\u4E3A\u5E73\u53F0 SKC\u3002");
  const trustedRequest = request ? validateErpCatalogRequest(request) : null;
  if (expectedWorkspaceId && workspaceId !== normalizeWorkspaceId(expectedWorkspaceId)) throw new Error("ERP \u8D44\u6599\u5DE5\u4F5C\u533A\u4E0D\u5339\u914D\u3002");
  if (trustedRequest && (workspaceId !== trustedRequest.workspaceId || requestId !== trustedRequest.id || ledgerPeriod !== trustedRequest.ledgerPeriod || optional(input.ledgerId) !== trustedRequest.ledgerId)) throw new Error("ERP \u8D44\u6599\u8BF7\u6C42\u3001\u5DE5\u4F5C\u533A\u3001\u8D26\u672C\u6216\u9002\u7528\u6708\u4EFD\u4E0D\u5339\u914D\u3002");
  const scope = new Set(platformSkcs.map(canonicalPlatformSkc));
  if (trustedRequest && platformSkcs.some((skc) => !trustedRequest.platformSkcs.some((target) => canonicalPlatformSkc(target) === canonicalPlatformSkc(skc)))) throw new Error("ERP \u8D44\u6599\u8FD4\u56DE\u6269\u5927\u4E86\u5DF2\u767B\u8BB0\u7684 SKC \u8303\u56F4\u3002");
  if (!Array.isArray(input.rows)) throw new Error("ERP \u8D44\u6599\u884C\u5FC5\u987B\u4E3A\u6570\u7EC4\u3002");
  const rowsByKey = /* @__PURE__ */ new Map();
  for (const source of input.rows) {
    const platformSku = normalizePlatformSku(source?.platformSku), platformSkc = normalizePlatformSkc(source?.platformSkc), warehouseSku = normalizeWarehouseSku(source?.warehouseSku);
    if (!scope.has(canonicalPlatformSkc(platformSkc))) throw new Error("ERP \u8D44\u6599\u5305\u542B\u76EE\u6807 SKC \u4E4B\u5916\u7684\u8EAB\u4EFD\u3002");
    const fields = normalizeErpCatalogFields(source);
    const sourceWarnings = unique(source?.sourceWarnings);
    const confirmed = trustedRequest?.confirmedSkus.find((item) => canonicalPlatformSku(item.platformSku) === canonicalPlatformSku(platformSku));
    if (confirmed && canonicalPlatformSkc(confirmed.platformSkc) !== canonicalPlatformSkc(platformSkc)) sourceWarnings.push("catalog_identity_conflict:confirmed_skc");
    const mappings = normalizeErpCatalogMappings(fields.catalogMappings ?? [{ platformSku, platformSkc, warehouseSku }]);
    if (!mappings.some((mapping) => mapping.platformSku && mapping.platformSkc && mapping.warehouseSku && canonicalPlatformSku(mapping.platformSku) === canonicalPlatformSku(platformSku) && canonicalPlatformSkc(mapping.platformSkc) === canonicalPlatformSkc(platformSkc) && canonicalWarehouseSku(mapping.warehouseSku) === canonicalWarehouseSku(warehouseSku))) throw new Error("ERP \u8D44\u6599\u884C\u7F3A\u5C11\u51C6\u786E\u5BF9\u5E94\u7684 SKC\u2014SKU\u2014\u4ED3\u5E93\u6620\u5C04\u3002");
    const row = { platformSku, platformSkc, warehouseSku, canonicalPlatformSku: canonicalPlatformSku(platformSku), canonicalPlatformSkc: canonicalPlatformSkc(platformSkc), canonicalWarehouseSku: canonicalWarehouseSku(warehouseSku), productName: optional(source?.productName ?? source?.name), supplierName: optional(source?.supplierName), supplier1688Url: normalizeErpCatalogUrl(source?.supplier1688Url), evidenceRef: evidenceRef(warehouseSku), ...fields, catalogMappings: mappings, sourceWarnings: unique(sourceWarnings) };
    const key = JSON.stringify(row);
    if (!rowsByKey.has(key)) rowsByKey.set(key, { ...row, sourceRow: rowsByKey.size + 1 });
  }
  const rows = [...rowsByKey.values()], warehouses = new Set(rows.map((row) => row.canonicalWarehouseSku));
  const warehouseEvidence = normalizeErpCatalogPurchaseEvidence(input.warehouseEvidence);
  if (warehouseEvidence.some((entry) => !warehouses.has(entry.canonicalWarehouseSku))) throw new Error("ERP \u8D44\u6599\u91C7\u8D2D\u8BC1\u636E\u8D85\u51FA\u5DF2\u786E\u8BA4\u4ED3\u5E93\u6620\u5C04\u3002");
  const coverage = normalizeErpCatalogCoverage(input.coverage);
  const catalog = { format: ERP_CATALOG_BATCH_FORMAT, formatVersion: ERP_CATALOG_VERSION, catalogVersion: ERP_CATALOG_VERSION, batchId: required(input.batchId, "ERP \u8D44\u6599\u6279\u6B21 ID"), workspaceId, ledgerId: optional(input.ledgerId), ledgerPeriod, requestId, generatedAt: timestamp(input.generatedAt, "ERP \u8D44\u6599\u91C7\u96C6\u65F6\u95F4"), query: { unit: "platform_skc", platformSkcs }, coverage, rows, warehouseEvidence, status: Object.values(coverage).every((group) => group.state === "complete") ? "completed" : rows.length ? "partial" : "retry_required" };
  const deliveryId = required(value.deliveryId, "ERP \u8D44\u6599\u6295\u9012 ID");
  return { envelope: { type: ERP_CATALOG_MESSAGE_TYPE, source: "erp-assistant-v8", format: ERP_CATALOG_INBOX_FORMAT, formatVersion: ERP_CATALOG_VERSION, deliveryId, sentAt: timestamp(value.sentAt, "ERP \u8D44\u6599\u6295\u9012\u65F6\u95F4"), transport: required(value.transport ?? "local-http", "ERP \u8D44\u6599\u4F20\u8F93\u65B9\u5F0F"), catalog }, catalog, rows, warehouseEvidence, deliveryId, workspaceId, requestId };
}
function buildErpCatalogInboxEnvelope({ catalog, deliveryId, sentAt = (/* @__PURE__ */ new Date()).toISOString(), transport = "local-http" } = {}, options = {}) {
  return validateErpCatalogInboxEnvelope({ type: ERP_CATALOG_MESSAGE_TYPE, source: "erp-assistant-v8", format: ERP_CATALOG_INBOX_FORMAT, formatVersion: ERP_CATALOG_VERSION, deliveryId, sentAt, transport, catalog: { ...catalog, format: ERP_CATALOG_BATCH_FORMAT, formatVersion: ERP_CATALOG_VERSION } }, options).envelope;
}
export {
  ERP_CATALOG_BATCH_FORMAT,
  ERP_CATALOG_GROUPS,
  ERP_CATALOG_INBOX_FORMAT,
  ERP_CATALOG_MESSAGE_TYPE,
  ERP_CATALOG_REQUEST_KIND,
  ERP_CATALOG_VERSION,
  buildErpCatalogInboxEnvelope,
  buildErpCatalogRequest,
  normalizeErpCatalogCoverage,
  normalizeErpCatalogPurchaseEvidence,
  normalizeErpUnitConversion,
  validateErpCatalogInboxEnvelope,
  validateErpCatalogRequest
};
