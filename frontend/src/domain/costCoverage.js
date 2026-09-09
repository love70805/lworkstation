import { canonicalPlatformSku } from "./identifiers";
import { manualSnapshot, selectManualOverride, storeSkuKey } from "./manualCostOverride";

function validAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function formalErpCost(item) {
  return validAmount(item?.unitCost)
    && (item?.resolutionStatus === "resolved" || (item?.resolutionStatus == null && Boolean(item?.publishedAt)))
    && Number(item?.unresolvedAnomalyCount ?? 0) === 0;
}

function collectSkus(items, predicate = () => true) {
  return new Set((items ?? [])
    .filter(predicate)
    .map((item) => canonicalPlatformSku(item.platformSku ?? item.sku))
    .filter(Boolean));
}

export function calculateLedgerCostCoverage({ salesRows = [], erpCosts = [], approvals = [], workspaceId, ledgerId }) {
  const expectedRows = new Map(salesRows.map((row) => [storeSkuKey(row.store, row.platformSku ?? row.sku), row]));
  const expectedSkus = new Set(expectedRows.keys());
  const erpSkus = collectSkus(erpCosts, formalErpCost);
  const approvedSkus = collectSkus(approvals, (item) => (
    manualSnapshot(item)?.kind !== "manual_override" && item.status === "approved" && validAmount(item.approvedAmount ?? item.unitCost)
  ));

  const matchedErpSkus = new Set([...expectedRows].filter(([, row]) => erpSkus.has(canonicalPlatformSku(row.platformSku ?? row.sku))).map(([key]) => key));
  const manualKeys = new Set([...expectedRows].filter(([, row]) => selectManualOverride(approvals, { workspaceId: row.workspaceId ?? workspaceId, ledgerId: row.ledgerId ?? ledgerId, store: row.store, platformSku: row.platformSku ?? row.sku })).map(([key]) => key));
  const matchedApprovalSkus = new Set([...expectedRows].filter(([key, row]) => approvedSkus.has(canonicalPlatformSku(row.platformSku ?? row.sku)) && !matchedErpSkus.has(key) && !manualKeys.has(key)).map(([key]) => key));
  // Reviewed 1688 values remain a traceable fallback reference. They do not
  // satisfy ERP coverage and cannot make a formal monthly profit finalizable.
  const formalSkus = new Set([...matchedErpSkus, ...manualKeys]);
  const unresolvedKeys = [...expectedSkus].filter((key) => !formalSkus.has(key));
  const unresolvedSkus = [...new Set(unresolvedKeys.map((key) => canonicalPlatformSku(expectedRows.get(key).platformSku ?? expectedRows.get(key).sku)))];

  return {
    expectedCount: expectedSkus.size,
    erpMatchedCount: matchedErpSkus.size,
    approvedFallbackCount: matchedApprovalSkus.size,
    formalMatchedCount: formalSkus.size,
    manualOverrideCount: manualKeys.size,
    missingCount: unresolvedKeys.length,
    unresolvedStoreSkus: unresolvedKeys,
    unresolvedSkus,
  };
}

export function ledgerStatusFromCoverage(coverage) {
  if (!coverage.expectedCount) return "draft";
  if (coverage.missingCount === 0) return "ready";
  if (coverage.approvedFallbackCount > 0) return "approval_pending";
  return "cost_pending";
}
