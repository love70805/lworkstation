import { canonicalPlatformSkc, canonicalPlatformSku } from "./identifiers";

const text = (value) => String(value ?? "").normalize("NFKC").trim();

// Inputs are workspace-scoped by the repository. Conflicts remain evidence,
// never an arbitrary first/last identity or a write to the product catalog.
export function buildReferenceIdentityIndex({ ledgerIdentityRows = [], profitLines = [], erpCatalogRows = [] } = {}) {
  const index = new Map();
  for (const [kind, rows] of [["erp", erpCatalogRows], ["ledger", ledgerIdentityRows], ["profit", profitLines]]) {
    for (const row of rows) {
      const sku = text(row.platformSku ?? row.sku);
      if (!sku) continue;
      const key = canonicalPlatformSku(sku);
      if (!index.has(key)) index.set(key, { platformSkc: new Map(), attribute: new Map() });
      const fields = index.get(key);
      for (const field of ["platformSkc", "attribute"]) {
        const value = text(row[field]);
        if (!value) continue;
        const canonical = field === "platformSkc" ? canonicalPlatformSkc(value) : value;
        if (!fields[field].has(canonical)) fields[field].set(canonical, { value, sources: [] });
        fields[field].get(canonical).sources.push({
          kind, ledgerId: row.ledgerId ?? null, period: row.period ?? null,
          batchId: row.batchId ?? null, store: row.store ?? "",
          sourceSheet: row.sourceSheet ?? "", sourceRow: row.sourceRow ?? null,
          ...(kind === "erp" ? { warehouseSku: row.warehouseSku, evidenceRef: row.source?.evidenceRef, batchId: row.source?.batchId } : {}),
        });
      }
    }
  }
  return index;
}

export function projectReferenceIdentity(catalogSku, evidence) {
  const result = {};
  for (const field of ["platformSkc", "attribute"]) {
    const existing = text(catalogSku?.[field]);
    const candidates = [...(evidence?.[field]?.values() ?? [])]
      .toSorted((a, b) => a.value.localeCompare(b.value));
    const erpCandidates = candidates.filter(item => item.sources.some(source => source.kind === "erp"));
    const preferred = erpCandidates.length ? erpCandidates : candidates;
    const unique = preferred.length === 1 ? preferred[0] : null;
    result[field] = existing || unique?.value || "";
    result[`${field}Source`] = existing ? "catalog" : unique?.sources.some(source => source.kind === "erp") ? "erp" : unique?.sources.some(source => source.kind === "ledger") ? "ledger" : unique ? "profit" : null;
    const existingKey = existing && field === "platformSkc" ? canonicalPlatformSkc(existing) : existing;
    result[`${field}Conflict`] = candidates.length > 1 || Boolean(existing && candidates.some(item => (field === "platformSkc" ? canonicalPlatformSkc(item.value) : item.value) !== existingKey));
    result[`${field}Evidence`] = candidates;
  }
  return result;
}
