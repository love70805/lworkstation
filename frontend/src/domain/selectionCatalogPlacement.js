import { canonicalPlatformSkc } from './identifiers';

// Display placement only. New evidence must not silently change saved SKU ownership.
export function selectionCatalogPlacement({ products = [], rows = [], drafts = [] } = {}) {
  const catalog = products.filter(product => !['draft', 'deleted'].includes(product.status));
  const byId = new Map(catalog.map(product => [product.id, product]));
  const bySkc = new Map();
  for (const product of catalog) {
    if (!product.platformSkc) continue;
    const key = canonicalPlatformSkc(product.platformSkc);
    bySkc.set(key, [...(bySkc.get(key) ?? []), product]);
  }
  const parent = item => {
    const candidates = item.platformSkc ? bySkc.get(canonicalPlatformSkc(item.platformSkc)) ?? [] : [];
    return candidates.length === 1 ? candidates[0] : null;
  };
  const incomingByProduct = new Map(), draftsByProduct = new Map(), storesByProduct = new Map();
  const pendingRows = [], pendingDrafts = [];
  for (const row of rows) {
    const owner = byId.get(row.productId);
    const target = owner ?? (!row.platformSkcConflict && !row.erpCatalogRelationshipConflict ? parent(row) : null);
    if (!target) { pendingRows.push(row); continue; }
    storesByProduct.set(target.id, [...new Set([...(storesByProduct.get(target.id) ?? []), ...(row.storeNames ?? [])])]);
    if (!owner) incomingByProduct.set(target.id, [...(incomingByProduct.get(target.id) ?? []), row]);
  }
  for (const draft of drafts) {
    const target = parent(draft);
    // Keep genuinely conflicting branches in the queue until their identity is resolved.
    const hasConflict = rows.some(row => row.productId === draft.id && (row.platformSkcConflict || row.erpCatalogRelationshipConflict));
    if (!target || hasConflict) { pendingDrafts.push(draft); continue; }
    draftsByProduct.set(target.id, [...(draftsByProduct.get(target.id) ?? []), draft]);
  }
  return { pendingRows, pendingDrafts, incomingByProduct, draftsByProduct, storesByProduct };
}
