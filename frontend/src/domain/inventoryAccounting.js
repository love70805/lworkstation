import Decimal from 'decimal.js';
import { canonicalPlatformSku, canonicalPlatformSkc, canonicalWarehouseSku } from './identifiers';
import { normalizePurchaseEvidenceRecord } from './erpPurchaseEvidence';
import { detectPurchaseCostAnomalies, normalizedResolution } from './erpCostResolution';
import { purchaseOrderSummary } from './erpPurchaseSelection';
import { manualSnapshot, storeSkuKey } from './manualCostOverride';

export const WEIGHTED_ACCOUNTING = 'weighted';
export const LOWEST_ACCOUNTING = 'historical_lowest';
export const accountingMode = value => value === LOWEST_ACCOUNTING ? LOWEST_ACCOUNTING : WEIGHTED_ACCOUNTING;
export const accountingSettingKey = workspaceId => `inventory-accounting:${workspaceId}`;
export const costEvaluationPeriod = ledger => ledger?.accountingMode === LOWEST_ACCOUNTING ? null : ledger?.period;
export function accountingApprovals(rows = [], mode = WEIGHTED_ACCOUNTING) {
  const primary = rows.filter(row => accountingMode(row.accountingMode) === WEIGHTED_ACCOUNTING);
  if (mode !== LOWEST_ACCOUNTING) return primary;
  const own = rows.filter(row => row.accountingMode === LOWEST_ACCOUNTING);
  const scopes = new Set(own.filter(row => manualSnapshot(row)?.kind === 'manual_override').map(row => storeSkuKey(manualSnapshot(row).store, row.platformSku)));
  return [...primary.filter(row => !scopes.has(storeSkuKey(manualSnapshot(row)?.store, row.platformSku))), ...own];
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
export function historicalLowestCosts(rows = []) {
  const best = new Map();
  const latest = new Map();
  for (const cost of rows) {
    if (cost?.evidenceComplete !== true || !cost.platformSku || !cost.platformSkc || !cost.warehouseSku) continue;
    const key = JSON.stringify([canonicalPlatformSku(cost.platformSku), canonicalPlatformSkc(cost.platformSkc), canonicalWarehouseSku(cost.warehouseSku)]);
    const previous = latest.get(key);
    if (!previous || String(cost.publishedAt ?? '') >= String(previous.publishedAt ?? '')) latest.set(key, cost);
  }
  for (const cost of latest.values()) {
    if (!cost.platformSku || !cost.platformSkc || !cost.warehouseSku || cost.evidenceComplete !== true) continue;
    const source = cost.purchaseRecords ?? cost.costDecision?.purchaseRecords ?? [];
    const records = source.map((record, index) => {
      const reasons = record.exclusionReasons ?? [];
      return normalizePurchaseEvidenceRecord({ ...record,
        eligible: record.eligible !== false || reasons.length > 0 && reasons.every(reason => monthExclusions.has(reason)),
        exclusionReasons: reasons.filter(reason => !monthExclusions.has(reason)),
      }, index, cost.warehouseSku);
    }).filter(record => record.canonicalWarehouseSku === canonicalWarehouseSku(cost.warehouseSku) && record.eligible && !record.exclusionReasons.length);
    const anomalies = new Map(detectPurchaseCostAnomalies(records, records).anomalies.map(item => [item.recordId, item]));
    const resolutions = cost.costDecision?.resolutions ?? cost.resolutions ?? [];
    for (const record of records) {
      const resolution = resolutions.map(item => normalizedResolution(item, cost.warehouseSku, record)).find(Boolean);
      if (anomalies.has(record.recordId) && !resolution) continue;
      const value = new Decimal(resolution?.resolvedUnitPrice ?? record.unitPrice);
      if (!value.isFinite() || !value.gt(0)) continue;
      const unitCost = value.toDecimalPlaces(4, Decimal.ROUND_DOWN).toNumber();
      if (!(unitCost > 0)) continue;
      const key = JSON.stringify([canonicalPlatformSku(cost.platformSku), canonicalPlatformSkc(cost.platformSkc)]);
      const previous = best.get(key);
      if (previous && (previous.unitCost < unitCost || previous.unitCost === unitCost && String(previous.publishedAt ?? '') >= String(cost.publishedAt ?? ''))) continue;
      const selected = { ...record, effectiveUnitPrice: value.toNumber(), resolution };
      const decision = { resolutionStatus: 'resolved', resolutionVersion: 'inventory-lowest@1', evidenceComplete: true,
        purchaseRecords: [record], selectedRecords: [selected], selectedRecordIds: [record.recordId], resolutions: resolution ? [resolution] : [],
        unitCost, formalUnitCost: unitCost, unresolvedAnomalyCount: 0 };
      best.set(key, { ...cost, id: `LOWEST:${cost.id}:${record.recordId}`, unitCost, accountingMode: LOWEST_ACCOUNTING,
        purchaseRecords: [record], selectedRecordIds: [record.recordId], costDecision: decision,
        resolutionStatus: 'resolved', unresolvedAnomalyCount: 0, orderNumber: purchaseOrderSummary([selected]), evidenceComplete: true });
    }
  }
  return [...best.values()];
}
