import { canonicalPlatformSku } from "./identifiers";
import { selectManualOverride, storeIdentity } from "./manualCostOverride";

// ERP rows are shared by a ledger SKU, while manual costs belong to a store.
// A manual exception therefore requires coverage of every selling store in
// this ledger, including stores hidden by the current page filter.
export function erpAdoptionReadiness({ ledger, salesRows = [], approvals = [], reconciliation } = {}) {
  const storesBySku = new Map();
  for (const row of salesRows) {
    if (row.workspaceId !== ledger?.workspaceId || row.ledgerId !== ledger?.id) continue;
    const sku = canonicalPlatformSku(row.platformSku ?? row.sku);
    const stores = storesBySku.get(sku) ?? new Set();
    stores.add(storeIdentity(row.store));
    storesBySku.set(sku, stores);
  }
  const matchedRows = [], manuallyCovered = [], blockedRows = [], missingRows = [];
  for (const row of reconciliation?.matches ?? []) {
    if (row.status === "matched") { matchedRows.push(row); continue; }
    const stores = [...(storesBySku.get(canonicalPlatformSku(row.platformSku)) ?? [])];
    const manual = stores.map(store => selectManualOverride(approvals, {
      workspaceId: ledger?.workspaceId, ledgerId: ledger?.id, store, platformSku: row.platformSku,
    }));
    if (stores.length && stores.every(Boolean) && manual.every(Boolean)) {
      manuallyCovered.push({ platformSku: row.platformSku, stores, approvalIds: manual.map(item => item.id), candidateStatus: row.status });
    } else if (row.status === "anomaly_pending") blockedRows.push(row);
    else missingRows.push(row);
  }
  return {
    matchedRows, manuallyCovered, blockedRows, missingRows,
    canAdopt: matchedRows.length > 0 && blockedRows.length === 0,
    summary: { erpAdoptableCount: matchedRows.length, manuallyCoveredCount: manuallyCovered.length, blockedAnomalyCount: blockedRows.length, remainingMissingCount: missingRows.length },
  };
}
