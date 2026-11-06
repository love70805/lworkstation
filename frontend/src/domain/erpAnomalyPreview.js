import { canonicalPlatformSkc } from './identifiers';
import { legacyExpectedSkusForRequest } from './erpAutomaticAdoption';
import { validateErpCostInboxEnvelope } from './erpInboxContract';
import { reconcileErpCostRows } from './erpCosts';
import { upsertCostResolution } from './erpCostResolution';

export function readAdoptionEvidence(inbox, ledger, request, ownedSales) {
  const legacyScope = request.expectedSkus?.length ? null : legacyExpectedSkusForRequest({ request, salesRows: ownedSales, workspaceId: ledger.workspaceId });
  if (legacyScope?.reason) return { reason: legacyScope.reason };
  const expectedSkus = legacyScope?.expectedSkus ?? request.expectedSkus;
  const validated = validateErpCostInboxEnvelope(inbox.envelope, { expectedWorkspaceId: ledger.workspaceId, expectedLedgerId: ledger.id, expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus, expectedHistoryMappings: request.historyMappings ?? [] });
  const batch = validated.batch;
  if (batch.batchId !== inbox.batchId || batch.requestId !== inbox.requestId) throw new Error('ERP 收件记录与原始封装不一致。');
  const queried = new Set(batch.query.platformSkcs.map(row => canonicalPlatformSkc(row.platformSkc)));
  return { validated, batch, expected: expectedSkus.filter(row => queried.has(canonicalPlatformSkc(row.platformSkc))) };
}

export const ignorableErpPriceAnomaly = item => item.status === 'pending' && Number.isFinite(item.originalUnitPrice) && item.originalUnitPrice >= 0;

export function previewPendingErpCostAnomalies({ ledger, receipts, sales }) {
  const pending = [];
  for (const { inbox, request, resolutions } of receipts) {
    const { validated, expected, reason } = readAdoptionEvidence(inbox, ledger, request, sales);
    if (reason) continue;
    const preview = reconcileErpCostRows({ workspaceId: ledger.workspaceId, period: ledger.period, expectedSkus: expected, costRows: validated.rows, resolutions: resolutions.reduce(upsertCostResolution, []) });
    for (const row of preview.matches) {
      for (const item of row.costDecision?.anomalies ?? []) {
        if (ignorableErpPriceAnomaly(item)) pending.push({ inboxId: inbox.id, warehouseSku: item.warehouseSku, platformSku: row.platformSku, originalUnitPrice: item.originalUnitPrice, reasons: item.reasons });
      }
    }
  }
  return pending;
}
