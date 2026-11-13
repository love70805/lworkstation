import { canonicalPlatformSkc, canonicalPlatformSku, canonicalWarehouseSku } from './identifiers';
import { compareErpSourceOrder, erpSourceOrder, legacyExpectedSkusForRequest } from './erpAutomaticAdoption';
import { validateErpCostInboxEnvelope } from './erpInboxContract';
import { reconcileErpCostRows } from './erpCosts';
import { upsertCostResolution } from './erpCostResolution';
import { indexErpAnomalyEvidence } from './erpAnomalyEvidence';

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
  return previewErpCostAnomalyReview({ ledger, receipts, sales }).pending;
}

export function previewErpCostAnomalyReview({ ledger, receipts, sales }) {
  const sources = [], latest = new Map();
  const ordered = receipts.toSorted((a, b) => compareErpSourceOrder(erpSourceOrder(b.request, b.inbox.envelope?.batch ?? {}), erpSourceOrder(a.request, a.inbox.envelope?.batch ?? {})));
  for (const { inbox, request, resolutions } of ordered) {
    // Explicitly scoped history already covered by a newer valid source is
    // not current work. Avoid re-parsing its full purchase history on the UI
    // read path; a financial write still validates its selected receipt.
    if (request.expectedSkus?.length && request.expectedSkus.every(row => latest.has(canonicalPlatformSku(row.platformSku)))) continue;
    let evidence;
    // Invalid receipts remain visible in collection diagnostics, but must not
    // authorize an ignore or prevent valid products from being reviewed.
    try { evidence = readAdoptionEvidence(inbox, ledger, request, sales); }
    catch { continue; }
    const { validated, batch, expected, reason } = evidence;
    if (reason) continue;
    const source = { inbox, request, resolutions, validated, batch, expected, order: erpSourceOrder(request, batch) };
    sources.push(source);
    for (const row of expected) {
      const sku = canonicalPlatformSku(row.platformSku), previous = latest.get(sku);
      if (!previous || compareErpSourceOrder(source.order, previous.order) > 0) latest.set(sku, source);
    }
  }
  const pending = [], ignored = [], groupKeys = new Map();
  // Current source is selected per SKU, so a partial recollection cannot hide
  // unrelated SKUs. Older evidence remains stored, but is not another task.
  for (const source of sources) {
    const expected = source.expected.filter(row => latest.get(canonicalPlatformSku(row.platformSku)) === source);
    if (!expected.length) continue;
    const { inbox, validated, resolutions, batch } = source;
    const evidence = indexErpAnomalyEvidence(batch, ledger.period);
    const preview = reconcileErpCostRows({ workspaceId: ledger.workspaceId, period: ledger.period, expectedSkus: expected, costRows: validated.rows, resolutions: resolutions.reduce(upsertCostResolution, []) });
    for (const row of preview.matches) {
      for (const item of row.costDecision?.anomalies ?? []) {
        if (!ignorableErpPriceAnomaly(item) && item.status !== 'ignored') continue;
        const pair = JSON.stringify([inbox.id, canonicalWarehouseSku(item.warehouseSku)]);
        const identity = evidence.get(canonicalWarehouseSku(item.warehouseSku))?.key ?? pair;
        if (!groupKeys.has(identity)) groupKeys.set(identity, pair);
        (item.status === 'ignored' ? ignored : pending).push({
          ...(item.status === 'ignored' ? item.resolution : {}),
          inboxId: inbox.id, warehouseSku: item.warehouseSku, platformSku: row.platformSku,
          originalUnitPrice: item.originalUnitPrice, reasons: item.reasons, groupKey: groupKeys.get(identity),
        });
      }
    }
  }
  const pendingKeys = new Set(pending.map(item => item.groupKey));
  return { pending, ignored: ignored.filter(item => !pendingKeys.has(item.groupKey)) };
}
