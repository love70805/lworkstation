import { canonicalPlatformSkc, canonicalPlatformSku, canonicalWarehouseSku } from "./identifiers";
import { erpSupplierLink } from "./erpProductCatalog";

const text = value => String(value ?? "").trim();
const identifier = (normalize, value) => text(value) ? normalize(value) : "";
const objectKey = value => JSON.stringify(Object.entries(value ?? {}).toSorted(([a], [b]) => a.localeCompare(b)));
const addSource = (sources, source) => {
  if (source && !sources.some(item => objectKey(item) === objectKey(source))) sources.push(source);
};

// Presentation only: repeated deliveries share a card, while all provenance and
// different content remain available. No source envelope or draft is mutated.
export function groupErpCatalogSources(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = identifier(canonicalPlatformSku, row.platformSku);
    if (!groups.has(key)) groups.set(key, { key, platformSku: row.platformSku, versions: [] });
    const group = groups.get(key);
    const versionKey = JSON.stringify([identifier(canonicalPlatformSkc, row.platformSkc), identifier(canonicalWarehouseSku, row.warehouseSku),
      row.attribute, row.productName, row.imageUrl, row.storeName, row.trusted !== false, row.reason, row.supplierSummary]);
    let version = group.versions.find(item => item.key === versionKey);
    if (!version) { version = { ...row, key: versionKey, sources: [] }; group.versions.push(version); }
    addSource(version.sources, row.source);
  }
  return [...groups.values()];
}

export function groupErpCatalogPurchases(rows = []) {
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const purchase = row.purchaseCatalog ?? {};
    const platformSkus = [...new Set((row.platformSkus ?? [row.platformSku]).filter(text).map(canonicalPlatformSku))].sort();
    const key = JSON.stringify([text(row.supplierName), purchase.supplierId, identifier(canonicalWarehouseSku, row.warehouseSku), platformSkus,
      purchase.purchaseSpecificationAndModel1688, purchase.model1688, purchase.specificationAndModel, purchase.productColor,
      purchase.purchaseProportion1688, purchase.pictureLink1688, purchase.picturesLinking]);
    if (!groups.has(key)) groups.set(key, { ...row, key, platformSkus, records: [] });
    const group = groups.get(key), source = row.source ?? {};
    const identified = source.recordId || purchase.purchaseOrderDetailId || ((source.purchaseOrderId || source.purchaseOrderNo) && source.lineNumber != null);
    const recordKey = JSON.stringify([identified ? null : index, source.recordId, source.purchaseOrderId, source.purchaseOrderNo, source.lineNumber, objectKey(purchase)]);
    let record = group.records.find(item => item.key === recordKey);
    if (!record) { record = { ...row, key: recordKey, sources: [] }; group.records.push(record); }
    addSource(record.sources, source);
  }
  return [...groups.values()];
}

export function erpSupplierSourceChoices(supplier, candidates = []) {
  const matches = candidates.filter(item => supplier.stableSupplierId
    ? item.stableSupplierId === supplier.stableSupplierId
    : text(supplier.supplierName) ? text(item.supplierName) === text(supplier.supplierName)
      : supplier.sourceUrl && [item.sourceUrl, ...(item.sourceLinks ?? []).map(link => link.url)].includes(supplier.sourceUrl));
  const links = new Map();
  for (const match of matches) for (const item of [{ url: match.sourceUrl }, ...(match.sourceLinks ?? [])]) {
    const link = erpSupplierLink(item.url);
    if (!link) continue;
    if (!links.has(link.url)) links.set(link.url, { ...link, sources: [] });
    for (const source of match.sourceRecords ?? []) addSource(links.get(link.url).sources, source);
  }
  return [...links.values()];
}
