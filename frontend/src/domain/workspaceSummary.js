const PENDING_CAPTURE_STATUSES = new Set(["pending", "needs_review", "draft", "blocked"]);
const CLOSED_LEDGER_STATUSES = new Set(["finalized", "locked"]);

function timestampOf(record, fields) {
  for (const field of fields) {
    const value = record?.[field];
    if (value) return String(value);
  }
  return "";
}

function compareLatest(a, b, fields) {
  return timestampOf(b, fields).localeCompare(timestampOf(a, fields));
}

function hasCaptureBlocker(capture) {
  if (capture?.status === "blocked") return true;
  if (Number(capture?.validation?.blockingCount ?? 0) > 0) return true;
  if (Array.isArray(capture?.blockingIssues) && capture.blockingIssues.length > 0) return true;
  if (Array.isArray(capture?.validation?.blocking) && capture.validation.blocking.length > 0) return true;
  return false;
}

export function buildWorkspaceOperationalSummary({
  captures = [],
  products = [],
  platformSkus = [],
  ledgers = [],
  auditEvents = [],
  tableCounts = {},
} = {}) {
  const pendingCaptures = captures.filter((capture) => PENDING_CAPTURE_STATUSES.has(capture.status ?? "pending"));
  const activeProducts = products.filter((product) => product.status !== "deleted");
  const openLedgers = ledgers.filter((ledger) => !CLOSED_LEDGER_STATUSES.has(ledger.status));
  const finalizedLedgers = ledgers.filter((ledger) => CLOSED_LEDGER_STATUSES.has(ledger.status));
  const latestLedger = [...ledgers].sort((a, b) => compareLatest(a, b, ["updatedAt", "period"]))[0] ?? null;
  const latestOpenLedger = [...openLedgers].sort((a, b) => compareLatest(a, b, ["updatedAt", "period"]))[0] ?? null;
  const latestFinalizedLedger = [...finalizedLedgers].sort((a, b) => compareLatest(a, b, ["finalizedAt", "updatedAt", "period"]))[0] ?? null;
  const latestCapture = [...pendingCaptures].sort((a, b) => compareLatest(a, b, ["capturedAt", "updatedAt", "createdAt"]))[0] ?? null;
  const latestActivity = [...auditEvents].sort((a, b) => compareLatest(a, b, ["createdAt"]))[0] ?? null;

  return {
    productCount: activeProducts.length,
    platformSkuCount: platformSkus.filter((sku) => sku.status !== "deleted").length,
    pendingCaptureCount: pendingCaptures.length,
    blockedCaptureCount: pendingCaptures.filter(hasCaptureBlocker).length,
    openLedgerCount: openLedgers.length,
    finalizedLedgerCount: finalizedLedgers.length,
    readyLedgerCount: openLedgers.filter((ledger) => ledger.status === "ready").length,
    missingCostCount: openLedgers.reduce((sum, ledger) => sum + Number(ledger.costSummary?.missingCount ?? 0), 0),
    recordCount: Object.values(tableCounts).reduce((sum, count) => sum + Number(count ?? 0), 0),
    latestLedger,
    latestOpenLedger,
    latestFinalizedLedger,
    latestCaptureAt: timestampOf(latestCapture, ["capturedAt", "updatedAt", "createdAt"]) || null,
    latestActivityAt: timestampOf(latestActivity, ["createdAt"]) || null,
  };
}
