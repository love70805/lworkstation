import { canonicalPlatformSkc, canonicalPlatformSku, canonicalWarehouseSku } from "./identifiers";
import { normalizeErpCatalogFields, normalizeErpCatalogUrl, normalizeErpPurchaseCatalog, normalizeErpSupplierLinks } from "./erpCatalogFields";

const text = value => String(value ?? "").trim();
const fields = ["platformSkc", "productName", "imageUrl", "attribute", "warehouseSku", "storeName"];

export function catalogProductName(value) {
  const name = text(value);
  return ["未建立商品档案", "未命名商品"].includes(name) ? "" : name;
}

function safeUrl(value) {
  return normalizeErpCatalogUrl(value) || "";
}

export function erpSupplierLink(value) {
  const url = safeUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  if (!/(^|\.)1688\.com$/i.test(parsed.hostname)) return null;
  const offer = /^\/offer\/(\d+)\.html$/.exec(parsed.pathname);
  const link = normalizeErpSupplierLinks([{ type: offer ? "product" : "store", url }])[0];
  return link ? { ...link, sourceProductId: offer?.[1] ?? "" } : null;
}

function sourceFor(row, mapping, record = null) {
  const purchase = record?.purchaseCatalog;
  return {
    kind: "erp", batchId: row.batchId ?? null, evidenceRef: row.evidenceRef ?? null,
    recordId: record?.recordId ?? purchase?.purchaseOrderDetailId ?? null,
    purchaseOrderNo: record?.purchaseOrderNo ?? purchase?.purchaseOrderNo ?? null,
    purchaseOrderId: record?.purchaseOrderId ?? purchase?.purchaseOrderId ?? null,
    lineNumber: purchase?.lineNumber ?? null,
    platformSku: mapping.platformSku, platformSkc: mapping.platformSkc,
    warehouseSku: mapping.warehouseSku, capturedAt: row.publishedAt ?? null,
  };
}

// Called only after the financial repository has verified the complete source
// envelope. Auxiliary warehouse/SKU data stays catalog metadata, with no price,
// quantity or formal-cost fields and no ownership inferred from a warehouse.
export function erpProductCatalogRowsFromEnvelope(envelope, { batchId, publishedAt } = {}) {
  const evidenceByWarehouse = new Map((envelope.warehouseEvidence ?? []).filter(item => text(item.warehouseSku)).map(item => [canonicalWarehouseSku(item.warehouseSku), item]));
  return (envelope.rows ?? []).map(row => ({
    batchId, publishedAt, workspaceId: envelope.workspaceId, ledgerId: envelope.ledgerId,
    platformSku: text(row.platformSku), platformSkc: text(row.platformSkc), warehouseSku: text(row.warehouseSku),
    productName: catalogProductName(row.productName),
    ...normalizeErpCatalogFields(row),
    catalogQuerySkcs: (envelope.query?.platformSkcs ?? []).map(item => item.platformSkc),
    evidenceRef: row.evidenceRef ?? null,
    supplierName: text(row.supplierName), supplier1688Url: erpSupplierLink(row.supplier1688Url)?.url || "",
    mappingFallback: Boolean(row.mappingFallback),
    sourceWarnings: [...new Set([...(row.sourceWarnings ?? []), ...(text(row.warehouseSku) ? evidenceByWarehouse.get(canonicalWarehouseSku(row.warehouseSku))?.sourceWarnings ?? [] : [])])],
    purchaseRecords: (text(row.warehouseSku) ? evidenceByWarehouse.get(canonicalWarehouseSku(row.warehouseSku))?.purchaseRecords ?? [] : []).filter(record => record.eligible !== false).map(record => ({
      recordId: record.recordId, warehouseSku: record.warehouseSku,
      productName: catalogProductName(record.productName),
      purchaseOrderId: record.purchaseOrderId, purchaseOrderNo: record.purchaseOrderNo,
      supplierName: text(record.supplierName), supplier1688Url: erpSupplierLink(record.supplier1688Url)?.url || "",
      ...normalizeErpCatalogFields(record, { includeMappings: false }),
    })),
  }));
}

// Read-only projection of explicit ERP mappings. It does not create costs for
// auxiliary SKUs, infer a mapping from a warehouse code, or write catalog data.
export function buildErpProductCatalogIndex(erpCosts = []) {
  const index = new Map();
  const rejected = [];
  const arrayKeys = new WeakMap();
  const supplierMaps = new WeakMap();
  const supplierExpansions = new WeakMap();
  const fieldCache = new Map();
  const purchaseCache = new Map();
  const appendUnique = (items, item) => {
    if (!arrayKeys.has(items)) arrayKeys.set(items, new Set());
    const keys = arrayKeys.get(items), key = JSON.stringify(item);
    if (keys.has(key)) return false;
    keys.add(key); items.push(item); return true;
  };
  for (const row of erpCosts) {
    if (row.catalogEligible === false || row.mappingFallback || (row.sourceWarnings ?? []).some(value => String(value).startsWith("mapping_failure"))) continue;
    const allowed = new Set((row.catalogQuerySkcs?.length ? row.catalogQuerySkcs : [row.platformSkc]).filter(Boolean).map(canonicalPlatformSkc));
    const rowWarehouse = text(row.warehouseSku);
    const canonicalRowWarehouse = rowWarehouse ? canonicalWarehouseSku(rowWarehouse) : "";
    // A full warehouse mapping can be attached to many expected cost rows.
    // Resolve each purchase/link set once and expand it once per catalog SKU.
    const records = row.purchaseRecords?.length ? row.purchaseRecords : [{
      supplierName: row.supplierName,
      supplier1688Links: (row.supplier1688Links ?? []).filter(link => text(link.supplierName)),
      ...(row.purchaseCatalog ? { purchaseCatalog: row.purchaseCatalog } : {}),
    }];
    const purchaseKey = JSON.stringify(records.map(record => [record.recordId, record.purchaseOrderId, record.purchaseOrderNo, record.warehouseSku, record.supplierName, record.supplier1688Url, record.supplier1688Links, record.purchaseCatalog]));
    if (!purchaseCache.has(purchaseKey)) purchaseCache.set(purchaseKey, records.flatMap(record => {
      const name = text(record.supplierName);
      const supplied = Array.isArray(record.supplier1688Links) ? record.supplier1688Links : [];
      const links = [...supplied, { url: record.supplier1688Url }].map(link => {
        const resolved = erpSupplierLink(link.url);
        if (!resolved || (link.type && link.type !== resolved.type)) return null;
        return { ...resolved, supplierName: text(link.supplierName) || name };
      }).filter(Boolean);
      const pairs = links.length ? links : name ? [{ url: "", type: null, sourceProductId: "", supplierName: name }] : [];
      const purchaseCatalog = normalizeErpPurchaseCatalog(record.purchaseCatalog);
      return [{ pairs, record, purchaseCatalog, warehouse: text(record.warehouseSku) ? canonicalWarehouseSku(record.warehouseSku) : "" }];
    }));
    const candidates = [row, ...(Array.isArray(row.catalogMappings) ? row.catalogMappings : [])];
    for (const candidate of candidates) {
      const platformSku = text(candidate.platformSku), platformSkc = text(candidate.platformSkc);
      const warehouseSku = text(candidate.warehouseSku);
      if (!platformSku || !platformSkc) continue;
      const outsideQuery = !allowed.has(canonicalPlatformSkc(platformSkc));
      const wrongWarehouse = candidate !== row && (!warehouseSku || !canonicalRowWarehouse || canonicalWarehouseSku(warehouseSku) !== canonicalRowWarehouse);
      if (outsideQuery || wrongWarehouse) { rejected.push({ platformSku, platformSkc, warehouseSku, source: sourceFor(row, { platformSku, platformSkc, warehouseSku }), reason: outsideQuery ? "query_outside" : "warehouse_mismatch" }); continue; }
      const key = canonicalPlatformSku(platformSku);
      if (!index.has(key)) {
        const catalog = { platformSku, entries: [], suppliers: [], purchases: [], fields: Object.fromEntries(fields.map(field => [field, new Map()])) };
        index.set(key, catalog); supplierMaps.set(catalog, new Map()); supplierExpansions.set(catalog, new Set());
      }
      const catalog = index.get(key);
      const source = sourceFor(row, { platformSku, platformSkc, warehouseSku });
      const rawFields = [catalogProductName(candidate.productName || row.productName), text(candidate.imageUrl || (candidate === row ? row.imageUrl : "")), text(candidate.attribute), text(candidate.storeName)];
      const fieldKey = JSON.stringify(rawFields);
      if (!fieldCache.has(fieldKey)) fieldCache.set(fieldKey, { productName: rawFields[0], imageUrl: safeUrl(rawFields[1]), attribute: rawFields[2], storeName: rawFields[3] });
      const entry = {
        platformSku, platformSkc, warehouseSku,
        ...fieldCache.get(fieldKey), source,
        ...(!row.purchaseRecords?.length && row.supplier1688Url ? { supplierSummary: { supplierName: text(row.supplierName), link: erpSupplierLink(row.supplier1688Url), samePurchaseVerified: false } } : {}),
      };
      const newEntry = appendUnique(catalog.entries, entry);
      for (const field of newEntry ? fields : []) {
        const value = entry[field];
        if (!value) continue;
        const normalized = field === "platformSkc" ? canonicalPlatformSkc(value) : field === "warehouseSku" ? canonicalWarehouseSku(value) : value;
        if (!catalog.fields[field].has(normalized)) catalog.fields[field].set(normalized, { value, sources: [] });
        appendUnique(catalog.fields[field].get(normalized).sources, source);
      }
      // Legacy row-level supplier summaries may pair fields from different
      // purchases. Prefer the complete per-record pairs whenever available.
      const expansionKey = JSON.stringify([source, purchaseKey]);
      const expansions = supplierExpansions.get(catalog);
      if (expansions.has(expansionKey)) continue;
      expansions.add(expansionKey);
      const suppliersById = supplierMaps.get(catalog);
      for (const { pairs, record, purchaseCatalog, warehouse } of purchaseCache.get(purchaseKey)) {
        if (warehouse && warehouseSku && warehouse !== canonicalWarehouseSku(warehouseSku)) continue;
        if (purchaseCatalog?.barcodeSkuid && canonicalPlatformSku(purchaseCatalog.barcodeSkuid) !== key) continue;
        if (purchaseCatalog?.barcodeSkcid && canonicalPlatformSkc(purchaseCatalog.barcodeSkcid) !== canonicalPlatformSkc(platformSkc)) continue;
        const recordSource = sourceFor(row, { platformSku, platformSkc, warehouseSku }, record);
        if (purchaseCatalog) appendUnique(catalog.purchases, { platformSku, platformSkc, warehouseSku, productName: text(record.productName), supplierName: text(record.supplierName), purchaseCatalog, source: recordSource });
        for (const pair of pairs) {
          const id = JSON.stringify([pair.supplierName, pair.url]);
          let supplier = suppliersById.get(id);
          if (!supplier) { supplier = { id, supplierName: pair.supplierName, sourceUrl: pair.url, sourceUrlKind: pair.type, sourceProductId: pair.sourceProductId, sourceRecords: [] }; catalog.suppliers.push(supplier); suppliersById.set(id, supplier); }
          appendUnique(supplier.sourceRecords, recordSource);
        }
      }
    }
  }
  for (const entry of rejected) {
    const catalog = index.get(canonicalPlatformSku(entry.platformSku));
    if (!catalog) continue; // Untrusted mappings cannot manufacture catalog SKUs.
    catalog.relationshipConflict = true;
    appendUnique(catalog.entries, { ...entry, trusted: false, productName: "", imageUrl: "", attribute: "", storeName: "" });
    const key = canonicalPlatformSkc(entry.platformSkc);
    if (!catalog.fields.platformSkc.has(key)) catalog.fields.platformSkc.set(key, { value: entry.platformSkc, sources: [] });
    appendUnique(catalog.fields.platformSkc.get(key).sources, entry.source);
  }
  return index;
}

export function erpCatalogField(catalog, field) {
  const candidates = [...(catalog?.fields[field]?.values() ?? [])];
  return { value: candidates.length === 1 ? candidates[0].value : "", conflict: candidates.length > 1, candidates };
}

export function erpCatalogIdentityRows(index) {
  return [...index.values()].flatMap(item => item.entries);
}

export function erpCatalogSuppliers(rows = []) {
  const suppliers = new Map();
  rows.forEach(row => (row.erpCatalogSuppliers ?? []).forEach(item => {
    const key = JSON.stringify([item.supplierName, item.sourceUrl]);
    if (!suppliers.has(key)) suppliers.set(key, { ...item, id: `ERP-${key}`, supplierId: `ERP-${key}`, catalogSource: "erp", shippingAmount: 0, handlingFee: 0, sourceRecords: [], variants: [] });
    const supplier = suppliers.get(key);
    supplier.sourceRecords.push(...item.sourceRecords);
    if (!supplier.variants.some(variant => canonicalPlatformSku(variant.platformSku) === row.canonicalPlatformSku)) {
      supplier.variants.push({ platformSku: row.platformSku, sourceSku: "", purchaseUnitPrice: "", purchasePackCount: 0, unitsPerPack: 1 });
    }
  }));
  return [...suppliers.values()];
}

function catalogDisplaySources(entries) {
  const sources = [];
  for (const entry of entries) {
    const sameSource = item => item.trusted !== false && entry.trusted !== false && JSON.stringify(item.source) === JSON.stringify(entry.source);
    const compatible = item => fields.every(field => !item[field] || !entry[field] || item[field] === entry[field]);
    const previous = sources.find(item => sameSource(item) && compatible(item));
    if (!previous) { sources.push({ ...entry }); continue; }
    // The cost row and its explicit mapping can carry complementary fields.
    // Merge only one identical source; conflicting values stay separate.
    for (const field of fields) previous[field] ||= entry[field];
  }
  return sources;
}

export function prefillErpProductDraft({ draft, rows, platformSku = "", platformSkc = "", productId = null, ownership = [] }) {
  const anchor = platformSku ? rows.find(row => row.canonicalPlatformSku === canonicalPlatformSku(platformSku)) : null;
  const warnings = [];
  const ownershipBySku = new Map(ownership.map(item => [item.canonicalPlatformSku || canonicalPlatformSku(item.platformSku), item]));
  const trustedSkc = draft.platformSkc || (anchor?.platformSkcConflict || anchor?.erpCatalogRelationshipConflict ? "" : anchor?.platformSkc) || (!anchor ? platformSkc : "");
  const target = trustedSkc ? canonicalPlatformSkc(trustedSkc) : "";
  const selected = rows.filter(row => {
    if (!target) return anchor && row.canonicalPlatformSku === anchor.canonicalPlatformSku;
    const belongs = row.platformSkc && canonicalPlatformSkc(row.platformSkc) === target || row.erpCatalogSources?.some(item => canonicalPlatformSkc(item.platformSkc) === target);
    if (!belongs) return false;
    if ((row.platformSkcConflict || row.erpCatalogRelationshipConflict) && row.platformSkcSource !== "catalog") { warnings.push(`${row.platformSku} 的 SKC 来源有冲突，未自动加入同组。`); return false; }
    return true;
  });
  if (anchor?.platformSkcConflict) warnings.push(`${anchor.platformSku} 的 SKC 来源有冲突，请核对后填写。`);
  if (anchor?.erpCatalogRelationshipConflict) warnings.push(`${anchor.platformSku} 的 ERP 映射超出查询范围或仓库关联不一致，请核对。`);
  const allowed = selected.filter(row => {
    const owner = ownershipBySku.get(row.canonicalPlatformSku);
    if (owner?.productId && owner.productId !== productId) { warnings.push(`${row.platformSku} 已属于其他商品，未加入本次草稿。`); return false; }
    return true;
  });
  const unique = field => {
    const values = [...new Set(allowed.flatMap(row => row.erpCatalogFields?.[field]?.candidates?.map(item => item.value) ?? []).filter(Boolean))];
    if (values.length > 1) warnings.push(`${({ productName: "商品名称", imageUrl: "商品图片", storeName: "店铺" })[field]}有多个 ERP 来源，请核对。`);
    return values.length === 1 ? values[0] : "";
  };
  const erpName = unique("productName");
  const primarySku = text(draft.variants?.[0]?.platformSku);
  const primaryRow = anchor ?? (primarySku ? allowed.find(row => row.canonicalPlatformSku === canonicalPlatformSku(primarySku)) : null) ?? allowed[0];
  // Different warehouse/SKU pictures are valid branch images. The anchor's
  // unique image can be the catalog cover; a disputed image for that SKU stays
  // empty rather than borrowing another SKU's picture.
  const erpImage = primaryRow?.erpImage?.conflict ? "" : primaryRow?.erpImage?.value || unique("imageUrl");
  const variants = [...(draft.variants ?? [])].map(variant => ({ ...variant }));
  allowed.forEach(row => {
    let variant = variants.find(item => text(item.platformSku) && canonicalPlatformSku(item.platformSku) === row.canonicalPlatformSku);
    if (!variant) { variant = { platformSku: row.platformSku, attribute: "", warehouseSku: "", imageUrl: "", sourceSku: "", purchaseUnitPrice: "", purchasePackCount: 1, unitsPerPack: 1, salePrice: "" }; variants.push(variant); }
    variant.attribute ||= row.attribute;
    variant.warehouseSku ||= row.warehouseSku;
    variant.imageUrl ||= row.erpImage?.value;
    if (row.attributeConflict) warnings.push(`${row.platformSku} 的属性有不同来源，请核对。`);
  });
  const erpSuppliers = erpCatalogSuppliers(allowed);
  let suppliers = draft.suppliers?.length ? draft.suppliers.map(item => ({ ...item })) : erpSuppliers;
  // Existing manual profiles remain authoritative. Fill missing fields only
  // from a uniquely matching purchase pair; additional sources stay reviewable.
  if (draft.suppliers?.length) suppliers = suppliers.map(supplier => {
    const matches = erpSuppliers.filter(item => supplier.sourceUrl ? supplier.sourceUrl === item.sourceUrl : supplier.supplierName && supplier.supplierName === item.supplierName);
    if (matches.length !== 1) {
      if (matches.length > 1) warnings.push(`${supplier.supplierName || "供应商"} 有多个 ERP 链接来源，保持已有资料，请核对。`);
      return supplier;
    }
    const source = matches[0];
    return { ...source, ...supplier, supplierName: supplier.supplierName || source.supplierName, sourceUrl: supplier.sourceUrl || source.sourceUrl, sourceProductId: supplier.sourceProductId || source.sourceProductId };
  });
  const firstSupplier = suppliers[0] ?? {};
  const next = {
    ...draft,
    name: catalogProductName(draft.name) || erpName,
    platformSkc: trustedSkc,
    imageUrl: draft.imageUrl || erpImage,
    store: draft.store || unique("storeName"),
    variants, suppliers,
    supplierName: draft.supplierName || firstSupplier.supplierName || "",
    sourceUrl: draft.sourceUrl || firstSupplier.sourceUrl || "",
    sourceProductId: draft.sourceProductId || firstSupplier.sourceProductId || "",
    sourceUrlKind: draft.sourceUrlKind || firstSupplier.sourceUrlKind || null,
  };
  const sources = catalogDisplaySources(allowed.flatMap(row => row.erpCatalogSources ?? []));
  const purchasesBySource = new Map();
  allowed.flatMap(row => row.erpCatalogPurchases ?? []).forEach(item => {
    const source = { ...item.source };
    delete source.platformSku; delete source.platformSkc;
    const key = JSON.stringify([source, item.purchaseCatalog, item.supplierName]);
    if (!purchasesBySource.has(key)) purchasesBySource.set(key, { ...item, platformSkus: [], source });
    const purchase = purchasesBySource.get(key);
    if (!purchase.platformSkus.includes(item.platformSku)) purchase.platformSkus.push(item.platformSku);
  });
  const conflicts = allowed.flatMap(row => ["platformSkc", "attribute"].filter(field => row[`${field}Conflict`]).map(field => ({ platformSku: row.platformSku, field, candidates: row[`${field}Evidence`] })));
  return { draft: next, prefill: { source: sources.length ? "erp" : null, skuCount: allowed.length, warnings: [...new Set(warnings)], sources, purchases: [...purchasesBySource.values()], conflicts, suppliers: erpSuppliers } };
}
