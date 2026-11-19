import Decimal from 'decimal.js';
import { canonicalPlatformSku, canonicalPlatformSkc, canonicalWarehouseSku } from './identifiers';
import { normalizePurchaseEvidenceRecord } from './erpPurchaseEvidence';
import { normalizedResolution } from './erpCostResolution';
import { purchaseOrderSummary } from './erpPurchaseSelection';
import { manualSnapshot, storeIdentity, validManualOverride } from './manualCostOverride';
import { compareErpSourceOrder } from './erpAutomaticAdoption';

export const WEIGHTED_ACCOUNTING = 'weighted';
export const LOWEST_ACCOUNTING = 'historical_lowest';
export const accountingMode = value => value === LOWEST_ACCOUNTING ? LOWEST_ACCOUNTING : WEIGHTED_ACCOUNTING;
export const accountingSettingKey = workspaceId => `inventory-accounting:${workspaceId}`;
export const costEvaluationPeriod = ledger => ledger?.accountingMode === LOWEST_ACCOUNTING ? null : ledger?.period;
export function accountingApprovals(rows = [], mode = WEIGHTED_ACCOUNTING) {
  if (!rows.some(row => row.accountingMode === LOWEST_ACCOUNTING)) return rows;
  const visible = rows.filter(row => manualSnapshot(row)?.kind === 'manual_override'
    || mode === LOWEST_ACCOUNTING || accountingMode(row.accountingMode) === WEIGHTED_ACCOUNTING);
  // Earlier builds revoked an inherited approval by writing a separate record.
  // Match the link within the same owning scope before honoring that revocation.
  const groups = new Map();
  for (const row of visible) {
    const snapshot = manualSnapshot(row);
    if (snapshot?.kind !== 'manual_override' || !String(row.platformSku ?? '').trim()) continue;
    const scope = { workspaceId: row.workspaceId, ledgerId: row.ledgerId, store: snapshot.store, platformSku: row.platformSku };
    const key = JSON.stringify([scope.workspaceId, scope.ledgerId, storeIdentity(scope.store), canonicalPlatformSku(scope.platformSku)]);
    const group = groups.get(key) ?? { active: [], revokedIds: new Set() };
    if (row.status === 'revoked' && row.sourceApprovalId && row.accountingMode === LOWEST_ACCOUNTING) group.revokedIds.add(row.sourceApprovalId);
    else if (validManualOverride(row, scope)) group.active.push(row);
    groups.set(key, group);
  }
  const projected = new Map();
  for (const { active, revokedIds } of groups.values()) {
    const latestByMode = new Map();
    for (const row of active) {
      if (revokedIds.has(row.id)) { projected.set(row, { ...row, status: 'revoked' }); continue; }
      const sourceMode = accountingMode(row.accountingMode), previous = latestByMode.get(sourceMode);
      if (!previous || String(row.approvedAt) > String(previous.approvedAt)) latestByMode.set(sourceMode, row);
    }
    const amounts = [...new Set([...latestByMode.values()].map(row => Number(row.approvedAmount)))];
    if (amounts.length > 1) {
      // Two previously independent decisions have no confirmed common price.
      // Keep the receipts on disk and allow an ordinary correction to settle it.
      for (const row of active) if (!revokedIds.has(row.id)) projected.set(row, { ...row, status: 'needs_confirmation', manualCostConflict: amounts });
    }
  }
  return projected.size ? visible.map(row => projected.get(row) ?? row) : visible;
}

// Daily ledgers remain editable. Historical files and their source snapshots
// keep their original bytes; no migration rewrites the old ledger on read.
export function operatingLedger(ledger) {
  if (!ledger) return ledger;
  const status = ['finalized', 'locked'].includes(ledger.status)
    ? ledger.costSummary?.missingCount ? 'cost_pending' : ledger.costSummary?.expectedCount ? 'ready' : 'draft' : ledger.status;
  return { ...ledger, status, operationWorkflow: 2 };
}

const monthExclusions = new Set(['current_month', 'on_or_after_ledger_period', 'after_ledger_period']);
const timestamp = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
function evidenceOrder(cost) {
  // The history snapshot is generated before transport/adoption. A delayed
  // receipt or publication cannot make an older ERP history newer.
  return [timestamp(cost.sourceGeneratedAt) || timestamp(cost.sourceOrder?.[1]) || timestamp(cost.generatedAt) || timestamp(cost.publishedAt),
    timestamp(cost.sourceOrder?.[0]), cost.sourceEnvelopeBatchId ?? cost.sourceOrder?.[2] ?? cost.batchId ?? ''];
}
function compareEvidence(left, right) {
  return compareErpSourceOrder(evidenceOrder(left), evidenceOrder(right))
    // For the same immutable snapshot, keep its formally recorded corrections.
    || Number(left.evidenceOrigin === 'published') - Number(right.evidenceOrigin === 'published')
    || timestamp(left.publishedAt) - timestamp(right.publishedAt);
}
export function createHistoricalLowestAccumulator() {
  const latest = new Map();
  function add(cost) {
    if (cost?.evidenceComplete !== true || !cost.platformSku || !cost.platformSkc || !cost.warehouseSku) return;
    const key = JSON.stringify([canonicalPlatformSku(cost.platformSku), canonicalPlatformSkc(cost.platformSkc), canonicalWarehouseSku(cost.warehouseSku)]);
    const previous = latest.get(key);
    if (previous && compareEvidence(cost, previous.order) < 0) return;
    const { sourceGeneratedAt, sourceOrder, generatedAt, publishedAt, sourceEnvelopeBatchId, batchId, evidenceOrigin } = cost;
    latest.set(key, { order: { sourceGeneratedAt, sourceOrder, generatedAt, publishedAt, sourceEnvelopeBatchId, batchId, evidenceOrigin },
      minimum: lowestPurchaseForWarehouse(cost) });
  }
  function values() {
    const best = new Map();
    for (const { order, minimum } of latest.values()) {
      if (!minimum) continue;
      const key = JSON.stringify([minimum.canonicalPlatformSku, minimum.canonicalPlatformSkc]);
      const previous = best.get(key);
      if (!previous || previous.unitCost > minimum.unitCost || previous.unitCost === minimum.unitCost && compareEvidence(previous, order) < 0) best.set(key, minimum);
    }
    return [...best.values()];
  }
  return { add, values };
}

export function historicalLowestCosts(rows = []) {
  const accumulator = createHistoricalLowestAccumulator();
  for (const row of rows) accumulator.add(row);
  return accumulator.values();
}

function lowestPurchaseForWarehouse(cost) {
  let best = null;
  const source = [...(cost.purchaseRecords ?? cost.costDecision?.purchaseRecords ?? []), ...(cost.excludedRecords ?? [])];
  const records = source.map((record, index) => {
    const reasons = record.exclusionReasons ?? [];
    return normalizePurchaseEvidenceRecord({ ...record,
      eligible: record.eligible !== false || reasons.length > 0 && reasons.every(reason => monthExclusions.has(reason)),
      exclusionReasons: reasons.filter(reason => !monthExclusions.has(reason)),
    }, index, cost.warehouseSku);
  }).filter(record => record.canonicalWarehouseSku === canonicalWarehouseSku(cost.warehouseSku) && record.eligible && !record.exclusionReasons.length);
  const resolutions = cost.costDecision?.resolutions ?? cost.resolutions ?? [];
  for (const record of records) {
    const resolution = resolutions.map(item => normalizedResolution(item, cost.warehouseSku, record)).find(Boolean);
    if (record.unitPrice == null && !resolution) continue;
    const value = new Decimal(resolution?.resolvedUnitPrice ?? record.unitPrice);
    if (!value.isFinite() || value.lt(0) || value.isZero() && resolution?.action !== 'ignore_anomaly') continue;
    const unitCost = value.toNumber();
    if (!(unitCost >= 0)) continue;
    if (best && (best.unitCost < unitCost || best.unitCost === unitCost && compareEvidence(best, cost) >= 0)) continue;
    const selected = { ...record, effectiveUnitPrice: value.toNumber(), resolution };
    const decision = { resolutionStatus: 'resolved', resolutionVersion: 'inventory-lowest@2', evidenceComplete: true,
      purchaseRecords: [record], selectedRecords: [selected], selectedRecordIds: [record.recordId], resolutions: resolution ? [resolution] : [],
      unitCost, formalUnitCost: unitCost, unresolvedAnomalyCount: 0 };
    best = { id: `LOWEST:${cost.id}:${record.recordId}`, workspaceId: cost.workspaceId, ledgerId: cost.ledgerId,
      sourceInboxId: cost.sourceInboxId, sourceCostRowId: cost.evidenceOrigin === 'published' ? cost.id : undefined,
      batchId: cost.batchId, sourceEnvelopeBatchId: cost.sourceEnvelopeBatchId, publishedAt: cost.publishedAt,
      sourceGeneratedAt: cost.sourceGeneratedAt, sourceOrder: cost.sourceOrder, evidenceOrigin: cost.evidenceOrigin,
      platformSku: cost.platformSku, canonicalPlatformSku: canonicalPlatformSku(cost.platformSku),
      platformSkc: cost.platformSkc, canonicalPlatformSkc: canonicalPlatformSkc(cost.platformSkc),
      warehouseSku: cost.warehouseSku, canonicalWarehouseSku: canonicalWarehouseSku(cost.warehouseSku), currency: cost.currency ?? 'CNY',
      unitCost, accountingMode: LOWEST_ACCOUNTING,
      purchaseRecords: [record], selectedRecordIds: [record.recordId], costDecision: decision,
      resolutionStatus: 'resolved', unresolvedAnomalyCount: 0, ...purchaseOrderSummary([selected]), evidenceComplete: true };
  }
  return best;
}
