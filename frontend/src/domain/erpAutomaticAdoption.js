import { canonicalPlatformSku, canonicalWarehouseSku } from './identifiers';

export const ERP_ADOPTION_VERSION = 'erp-auto-adoption@1';
export function erpSourceOrder(request, batch) {
  return [Date.parse(request.requestedAt ?? request.createdAt) || 0, Date.parse(batch.generatedAt) || 0, batch.batchId];
}
export function compareErpSourceOrder(left, right) {
  for (let i = 0; i < 3; i++) {
    const difference = i < 2 ? Number(left?.[i] ?? 0) - Number(right?.[i] ?? 0) : String(left?.[i] ?? '').localeCompare(String(right?.[i] ?? ''));
    if (difference) return difference;
  }
  return 0;
}
// Envelope validation establishes identity/counts/references first. This helper
// separates global collection failures from evidence defects with a known scope.
export function erpBatchAdoptionBoundary(batch) {
  const blockedSkus = new Set(), blockedWarehouses = new Set(), globalReasons = [];
  if (batch.sourceFormatVersion !== 2 || batch.formatVersion !== 2) globalReasons.push('legacy_evidence');
  if (batch.sourceMeta?.completenessScope === 'source') globalReasons.push('source_incomplete');
  if (batch.sourceMeta?.sourceWarnings?.length) globalReasons.push('source_warning');
  for (const failure of [...(batch.sourceMeta?.detailFailures ?? []), ...(batch.sourceMeta?.mappingFailures ?? [])]) {
    if (failure?.warehouseSku) blockedWarehouses.add(canonicalWarehouseSku(failure.warehouseSku));
    else if (failure?.platformSku) blockedSkus.add(canonicalPlatformSku(failure.platformSku));
    else globalReasons.push('unscoped_source_failure');
  }
  const expectedRows = batch.rows.filter(row => row.ledgerScopeRole === 'expected');
  const counts = new Map();
  for (const row of expectedRows) {
    const sku = canonicalPlatformSku(row.platformSku);
    counts.set(sku, (counts.get(sku) ?? 0) + 1);
    if (row.mappingFallback || row.sourceWarnings?.length) blockedSkus.add(sku);
  }
  for (const [sku, count] of counts) if (count > 1) blockedSkus.add(sku);
  return { globalReasons: [...new Set(globalReasons)], blockedSkus, blockedWarehouses };
}
export function summarizeErpAdoption(items) {
  const count = state => items.filter(item => item.state === state).length;
  const adoptedCount = count('adopted') + count('manual_effective');
  const remainingCount = items.length - adoptedCount - count('superseded');
  return { expectedCount: items.length, adoptedCount, manualEffectiveCount: count('manual_effective'), anomalyCount: count('anomaly_pending'), evidenceIncompleteCount: count('evidence_incomplete'), missingCount: count('missing'), protectedCount: count('ledger_protected'), supersededCount: count('superseded'), remainingCount };
}
