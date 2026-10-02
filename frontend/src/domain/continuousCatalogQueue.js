import { canonicalPlatformSkc, canonicalPlatformSku } from "./identifiers";

// Transient identities only: never persist source rows or an editable draft.
const queues = new Map();
const skcKey = value => String(value ?? "").trim() ? canonicalPlatformSkc(value) : "";
const skuKey = value => String(value ?? "").trim() ? canonicalPlatformSku(value) : "";
export function createContinuousCatalogQueue(workspaceId, groups) {
  const seen = new Set();
  const items = [];
  for (const group of groups) {
    if (group.productId || group.variants?.some(row => row.productId)) continue;
    const row = group.variants?.[0];
    if (!row) continue;
    const platformSkc = row.platformSkcConflict ? "" : skcKey(row.platformSkc);
    const platformSku = skuKey(row.platformSku);
    const identity = platformSkc ? `SKC:${platformSkc}` : platformSku ? `SKU:${platformSku}` : "";
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    items.push({ identity, platformSkc, platformSku });
  }
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const queue = { id, workspaceId, items };
  queues.set(id, queue);
  while (queues.size > 8) queues.delete(queues.keys().next().value);
  return queue;
}

export const readContinuousCatalogQueue = id => queues.get(id);
export function continuousCatalogPath(queue, index) {
  const item = queue.items[index];
  return `/products/edit?${new URLSearchParams({ skc: item.platformSkc, sku: item.platformSku, queue: queue.id, position: String(index) })}`;
}

export function checkContinuousCatalogIdentity(item, snapshot) {
  if (!snapshot) return "商品来源已不可用，请返回参考列表重新核对。";
  const skc = skcKey(snapshot.draft?.platformSkc);
  if (item.platformSkc && skc !== item.platformSkc) return "平台 SKC 来源已变化，请返回参考列表重新核对身份。";
  if (snapshot.product) return null;
  const sources = snapshot.referenceIdentities ?? snapshot.prefill?.sources ?? [];
  if (!sources.some(row => skuKey(row.platformSku) === item.platformSku)) return "商品来源已变化或移除，请返回参考列表重新核对。";
  return null;
}
