import { canonicalPlatformSku } from "./identifiers";

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

export function calculateLedgerCostCoverage({ salesRows = [], erpCosts = [], approvals = [] }) {
  const expectedSkus = collectSkus(salesRows);
  const erpSkus = collectSkus(erpCosts, formalErpCost);
  const approvedSkus = collectSkus(approvals, (item) => (
    item.status === "approved" && validAmount(item.approvedAmount ?? item.unitCost)
  ));

  const matchedErpSkus = new Set([...erpSkus].filter((sku) => expectedSkus.has(sku)));
  const matchedApprovalSkus = new Set([...approvedSkus].filter((sku) => (
    expectedSkus.has(sku) && !matchedErpSkus.has(sku)
  )));
  // Reviewed 1688 values remain a traceable fallback reference. They do not
  // satisfy ERP coverage and cannot make a formal monthly profit finalizable.
  const formalSkus = matchedErpSkus;
  const unresolvedSkus = [...expectedSkus].filter((sku) => !matchedErpSkus.has(sku));

  return {
    expectedCount: expectedSkus.size,
    erpMatchedCount: matchedErpSkus.size,
    approvedFallbackCount: matchedApprovalSkus.size,
    formalMatchedCount: formalSkus.size,
    missingCount: unresolvedSkus.length,
    unresolvedSkus,
  };
}

export function ledgerStatusFromCoverage(coverage) {
  if (!coverage.expectedCount) return "draft";
  if (coverage.missingCount === 0) return "ready";
  if (coverage.approvedFallbackCount > 0) return "approval_pending";
  return "cost_pending";
}
