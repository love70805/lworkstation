import { canonicalPlatformSku, canonicalPlatformSkc, canonicalWarehouseSku } from './identifiers';

// Only identities already known locally may receive file metadata. The export's
// concatenated SKU/SKC fragments (often limited to 1024 characters) are unused.
export function projectProductArchiveRows({ archives = [], platformSkus = [], erpCosts = [], erpBatches = [], products = [], workspaceId }) {
  const owned = new Set(products.filter(product => product.workspaceId === workspaceId).map(product => product.id));
  const batches = new Set(erpBatches.filter(batch => batch.workspaceId === workspaceId && batch.status === 'published').map(batch => batch.id));
  const localSkus = platformSkus.filter(row => row.workspaceId === workspaceId && owned.has(row.productId));
  const parents = new Map(localSkus.map(row => [canonicalPlatformSku(row.platformSku), row.platformSkc]));
  const identities = new Map();
  for (const row of [...localSkus, ...erpCosts.filter(row => row.workspaceId === workspaceId && batches.has(row.batchId) && row.evidenceComplete && !row.mappingFallback)]) {
    if (!row.platformSku || !row.platformSkc || !row.warehouseSku) continue;
    const sku = canonicalPlatformSku(row.platformSku), knownParent = parents.get(sku);
    if (knownParent && canonicalPlatformSkc(knownParent) !== canonicalPlatformSkc(row.platformSkc)) continue;
    const entries = identities.get(sku) ?? new Map();
    entries.set(JSON.stringify([canonicalPlatformSkc(row.platformSkc), canonicalWarehouseSku(row.warehouseSku)]), row);
    identities.set(sku, entries);
  }
  const byWarehouse = new Map();
  for (const entries of identities.values()) if (entries.size === 1) {
    const row = entries.values().next().value, key = canonicalWarehouseSku(row.warehouseSku);
    if (!byWarehouse.has(key)) byWarehouse.set(key, []);
    byWarehouse.get(key).push(row);
  }
  const metadata = new Map();
  for (const archive of archives) if (archive.workspaceId === workspaceId) for (const row of archive.rows) metadata.set(canonicalWarehouseSku(row.warehouseSku), { row, archive });
  const rows = [], unmatched = [];
  for (const [warehouse, {row, archive}] of metadata) {
    const mappings = byWarehouse.get(warehouse);
    if (!mappings?.length) { unmatched.push(row.warehouseSku); continue; }
    for (const identity of mappings) rows.push({ ...row, platformSku: identity.platformSku, platformSkc: identity.platformSkc,
      workspaceId, catalogQuerySkcs: [identity.platformSkc], catalogEligible: true, metadataSource: 'product_archive',
      batchId: archive.hash, publishedAt: archive.importedAt, sourceName: archive.fileName });
  }
  return { rows, unmatched, matchedWarehouseCount: metadata.size - unmatched.length };
}
