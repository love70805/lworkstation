import { canonicalPlatformSkc, canonicalPlatformSku } from './identifiers';

const text = value => String(value ?? '').normalize('NFKC').trim();
const key = value => text(value).toUpperCase();

// Keep identities only while the importer streams the source from disk.
// Sales prices and reference costs are deliberately absent from this contract.
export function createLedgerCatalogDraftBuilder() {
  const identities = new Map();
  return {
    addRows(rows, batchId) {
      for (const row of rows) {
        const platformSku = text(row.platformSku);
        if (!platformSku) continue;
        const sku = canonicalPlatformSku(platformSku);
        const entry = identities.get(sku) ?? {
          platformSku, canonicalPlatformSku: sku, skcs: new Map(), stores: new Map(),
          attributes: new Set(), supplierNumbers: new Set(), batchIds: new Set(),
        };
        if (text(row.platformSkc)) entry.skcs.set(canonicalPlatformSkc(row.platformSkc), text(row.platformSkc));
        if (text(row.store)) entry.stores.set(key(row.store), text(row.store));
        if (text(row.attribute)) entry.attributes.add(text(row.attribute));
        if (text(row.supplierNumber)) entry.supplierNumbers.add(text(row.supplierNumber));
        entry.batchIds.add(batchId);
        identities.set(sku, entry);
      }
    },
    finish() {
      const candidates = [], issues = [];
      for (const entry of identities.values()) {
        const reason = entry.skcs.size === 0 ? 'missing_skc' : entry.skcs.size > 1 ? 'skc_conflict'
          : entry.stores.size !== 1 ? 'store_conflict' : entry.attributes.size > 1 ? 'attribute_conflict' : null;
        if (reason) { issues.push({ platformSku: entry.platformSku, reason }); continue; }
        candidates.push({
          platformSku: entry.platformSku, canonicalPlatformSku: entry.canonicalPlatformSku,
          platformSkc: [...entry.skcs.values()][0], canonicalPlatformSkc: [...entry.skcs.keys()][0],
          store: [...entry.stores.values()][0], attribute: [...entry.attributes][0] ?? '',
          supplierNumbers: [...entry.supplierNumbers], batchIds: [...entry.batchIds],
        });
      }
      return { candidates, issues };
    },
  };
}
