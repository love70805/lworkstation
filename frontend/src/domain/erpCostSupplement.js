import { canonicalPlatformSku, canonicalPlatformSkc } from './identifiers';
import { collectErpPlatformSkcs } from './erpQueryScope';

const skcKey = value => canonicalPlatformSkc(value?.platformSkc ?? value);
// Filter store decisions before deduplicating the ERP SKU. Different stores
// can have different manual prices for the same platform SKU.
export function missingErpCostScope(rows, { request, batches = [], inboxes = [] } = {}) {
  const requested = request?.expectedSkus?.length ? new Set(request.expectedSkus.map(row => canonicalPlatformSku(row.platformSku))) : null;
  const parentScope = request ? new Set((request.platformSkcs ?? []).map(skcKey)) : null;
  const pendingDelivery = new Set();
  const byDelivery = new Map(inboxes.map(row => [row.deliveryId, row]));
  for (const batch of batches) {
    const receipt = byDelivery.get(batch.deliveryId);
    const awaitingLocal = receipt && !['voided','rejected'].includes(receipt.status)
      ? receipt.adoptionPending || receipt.adoptionFailure || (!receipt.adoption && !batch.adoptionReportedAt)
      : !receipt && !batch.adoptionReportedAt;
    if (batch.deliveryId && awaitingLocal) {
      for (const skc of batch.platformSkcs ?? []) pendingDelivery.add(skcKey(skc));
    }
  }
  const unique = new Map();
  for (const row of rows) {
    if (row.decision?.eligibleForExactProfit || !row.platformSkc || !row.platformSku) continue;
    const sku = canonicalPlatformSku(row.platformSku), skc = skcKey(row.platformSkc);
    if (requested && !requested.has(sku) || parentScope?.size && !parentScope.has(skc) || pendingDelivery.has(skc)) continue;
    if (!unique.has(sku)) unique.set(sku, { platformSku: row.platformSku, platformSkc: row.platformSkc, store: row.store });
  }
  const expectedSkus = [...unique.values()];
  return { expectedSkus, platformSkcs: collectErpPlatformSkcs(expectedSkus).platformSkcs };
}

export function retryErpCostScope(request, batches, missing) {
  const unread = new Set(), incomplete = new Set();
  for (const batch of batches) {
    if (!['failed', 'incomplete'].includes(batch.status)) continue;
    const target = batch.deliveryId ? incomplete : unread;
    for (const skc of batch.platformSkcs ?? []) target.add(skcKey(skc));
  }
  // An explicit retry may still fetch ERP evidence for a manually priced,
  // undelivered SKU. A delivered batch only needs its outstanding SKU siblings.
  const unreadRows = request.expectedSkus.filter(row => unread.has(skcKey(row)))
    .map(({ platformSku, platformSkc, store }) => ({ platformSku, platformSkc, store }));
  return missingErpCostScope([...unreadRows, ...missing.expectedSkus.filter(row => incomplete.has(skcKey(row)))]);
}

export function needsNarrowerCostRequest(request, batches, missing) {
  if (!request || !batches?.length) return false;
  if (!batches.some(batch => batch.platformSkcs?.length)) return false;
  const unread = new Set(batches.filter(batch => !batch.deliveryId || batch.status === 'incomplete' || batch.status === 'failed')
    .flatMap(batch => batch.platformSkcs ?? []).map(skcKey));
  const missingSkus = new Set(missing.expectedSkus.map(row => canonicalPlatformSku(row.platformSku)));
  const missingSkcs = new Set(missing.platformSkcs.map(skcKey));
  // A delivered but still unpriced item needs its own request. Likewise an
  // old unread batch can contain SKU siblings whose costs are already valid.
  return [...missingSkcs].some(skc => !unread.has(skc)) || [...unread].some(skc => !missingSkcs.has(skc)) ||
    (request.expectedSkus ?? []).some(row => unread.has(skcKey(row.platformSkc)) && !missingSkus.has(canonicalPlatformSku(row.platformSku)));
}
