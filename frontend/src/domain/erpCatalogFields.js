// Optional ERP catalog evidence is separate from cost and ownership decisions.
// Keep conflicting mappings as evidence; never fill identifiers from a cost row.
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);

function text(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const normalized = String(value).normalize("NFKC").trim();
  return normalized || null;
}

export function normalizeErpCatalogUrl(value) {
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

export function normalizeErpSupplierLinks(values) {
  const links = [];
  const seen = new Set();
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

export function normalizeErpCatalogMappings(values) {
  const mappings = [];
  const seen = new Set();
  for (const entry of Array.isArray(values) ? values : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const mapping = {
      platformSku: text(entry.platformSku),
      platformSkc: text(entry.platformSkc),
      warehouseSku: text(entry.warehouseSku),
      productName: text(entry.productName),
      imageUrl: normalizeErpCatalogUrl(entry.imageUrl),
      attribute: text(entry.attribute),
    };
    for (const key of ["storeName", "storeId", "articleNumber", "platform"]) {
      if (hasOwn(entry, key)) mapping[key] = text(entry[key]);
    }
    if (hasOwn(entry, "unitConversion")) mapping.unitConversion = normalizeErpUnitConversion(entry.unitConversion);
    const key = JSON.stringify(mapping);
    if (seen.has(key)) continue;
    seen.add(key);
    mappings.push(mapping);
  }
  return mappings;
}

// Purchase-detail fields remain evidence from one purchase line. In particular,
// 1688 specifications and ratios do not become platform attributes or cost units.
export function normalizeErpPurchaseCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const catalog = {
    picturesLinking: normalizeErpCatalogUrl(value.picturesLinking),
    pictureLink1688: normalizeErpCatalogUrl(value.pictureLink1688),
  };
  for (const key of [
    "purchaseSpecificationAndModel1688", "model1688", "specificationAndModel", "productColor",
    "purchaseProportion1688", "purchaseOrderDetailId", "purchaseOrderId", "purchaseOrderNo",
    "lineNumber", "supplierId", "barcodeSkuid", "barcodeSkcid",
  ]) catalog[key] = text(value[key]);
  return catalog;
}

export function normalizeErpCatalogFields(value, { includeMappings = true } = {}) {
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

export const ERP_CATALOG_COVERAGE_GROUPS = Object.freeze(['directory', 'mappings', 'images', 'suppliers', 'purchaseEvidence']);

export function normalizeErpCatalogCoverage(value) {
  return Object.fromEntries(ERP_CATALOG_COVERAGE_GROUPS.map(group => {
    const input = value?.[group];
    const state = ['complete', 'partial', 'unavailable'].includes(input?.state) ? input.state : 'unavailable';
    const normalized = { state, reasons: [...new Set((Array.isArray(input?.reasons) ? input.reasons : []).map(text).filter(Boolean))] };
    if (!input) normalized.reasons.push('not_collected');
    if (text(input?.attemptedAt) && Number.isFinite(Date.parse(input.attemptedAt))) normalized.attemptedAt = input.attemptedAt;
    for (const key of ['pageCount', 'recordCount', 'missingCount']) if (Number.isInteger(input?.[key]) && input[key] >= 0) normalized[key] = input[key];
    return [group, normalized];
  }));
}

// A conversion is accepted only with an explicit positive relation and its
// verified ERP source. A missing ratio never silently becomes one-to-one.
export function normalizeErpUnitConversion(value) {
  if (!value || !['erp_platform_mapping', 'erp_purchase_detail'].includes(value.source) || !text(value.sourceRef)) return null;
  const warehouseUnits = Number(value.warehouseUnits), platformUnits = Number(value.platformUnits);
  if (!Number.isFinite(warehouseUnits) || !Number.isFinite(platformUnits) || warehouseUnits <= 0 || platformUnits <= 0) return null;
  return { warehouseUnits, platformUnits, source: value.source, sourceRef: text(value.sourceRef) };
}
