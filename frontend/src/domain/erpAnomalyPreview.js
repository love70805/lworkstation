import { canonicalPlatformSkc, canonicalPlatformSku, canonicalWarehouseSku } from './identifiers';
import { compareErpSourceOrder, erpSourceOrder, legacyExpectedSkusForRequest } from './erpAutomaticAdoption';
import { validateErpCostInboxEnvelope } from './erpInboxContract';
import { reconcileErpCostRows } from './erpCosts';
import { mayHavePurchaseAnomalies, upsertCostResolution } from './erpCostResolution';
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

export function newestAnomalyReceipts(receipts) {
  return receipts.toSorted((a, b) => compareErpSourceOrder(erpSourceOrder(b.request, b.inbox.envelope?.batch ?? {}), erpSourceOrder(a.request, a.inbox.envelope?.batch ?? {})));
}

// A covered query can be skipped. Only a successfully validated receipt can
// claim new SKUs, including those for which it returned no usable cost.
export function uncoveredAnomalySkus(inbox, request, covered) {
  if (!request.expectedSkus?.length || !Array.isArray(inbox.envelope?.batch?.query?.platformSkcs)) return null;
  try {
    const queried = new Set(inbox.envelope.batch.query.platformSkcs.map(row => canonicalPlatformSkc(row?.platformSkc ?? row)));
    return request.expectedSkus.filter(row => queried.has(canonicalPlatformSkc(row.platformSkc)))
      .map(row => canonicalPlatformSku(row.platformSku)).filter(sku => !covered.has(sku));
  } catch { return null; }
}

export function reviewErpAnomalyReceipt({ ledger, inbox, request, resolutions = [], sales = [], wanted = null, alreadyCovered = [] }) {
  let evidence;
  try { evidence = readAdoptionEvidence(inbox, ledger, request, sales); }
  catch { return null; }
  if (evidence.reason) return null;
  const include = wanted && new Set(wanted), covered = new Set(alreadyCovered);
  const expected = evidence.expected.filter(row => {
    const sku = canonicalPlatformSku(row.platformSku);
    return include ? include.has(sku) : !covered.has(sku);
  });
  if (!expected.length) return null;
  const possibleSkus = new Set(), possibleWarehouses = new Set(), checked = new WeakMap();
  for (const row of evidence.validated.rows) {
    const records = row.purchaseRecords;
    if (!records?.length) continue;
    if (!checked.has(records)) checked.set(records, mayHavePurchaseAnomalies(records));
    if (!checked.get(records)) continue;
    if (row.platformSku) possibleSkus.add(canonicalPlatformSku(row.platformSku));
    if (row.warehouseSku) possibleWarehouses.add(canonicalWarehouseSku(row.warehouseSku));
  }
  const candidates = expected.filter(row => possibleSkus.has(canonicalPlatformSku(row.platformSku))
    || (row.warehouseSku && possibleWarehouses.has(canonicalWarehouseSku(row.warehouseSku))));
  const skus = expected.map(row => canonicalPlatformSku(row.platformSku));
  if (!candidates.length) return { skus, items: [], identities: [] };
  const candidateSkus = new Set(candidates.map(row => canonicalPlatformSku(row.platformSku)));
  const candidateWarehouses = new Set(candidates.filter(row => row.warehouseSku).map(row => canonicalWarehouseSku(row.warehouseSku)));
  // Include every competing direct/warehouse mapping for the remaining SKUs so
  // duplicate rows and fallback selection follow the normal reconciliation order.
  const costRows = evidence.validated.rows.filter(row => (row.platformSku && candidateSkus.has(canonicalPlatformSku(row.platformSku)))
    || (row.warehouseSku && candidateWarehouses.has(canonicalWarehouseSku(row.warehouseSku))));
  const preview = reconcileErpCostRows({ workspaceId: ledger.workspaceId, period: ledger.period, expectedSkus: candidates,
    costRows, resolutions: resolutions.reduce(upsertCostResolution, []) });
  const items = [], warehouses = new Set();
  for (const row of preview.matches) for (const item of row.costDecision?.anomalies ?? []) {
    if (!ignorableErpPriceAnomaly(item) && item.status !== 'ignored') continue;
    warehouses.add(canonicalWarehouseSku(item.warehouseSku));
    items.push({ ...(item.status === 'ignored' ? item.resolution : {}), inboxId: inbox.id, warehouseSku: item.warehouseSku,
      platformSku: row.platformSku, originalUnitPrice: item.originalUnitPrice, reasons: item.reasons, ignored: item.status === 'ignored' });
  }
  const keys = warehouses.size ? indexErpAnomalyEvidence(evidence.batch, ledger.period, warehouses) : new Map();
  return { skus, items,
    identities: [...keys].map(([warehouse, entry]) => [warehouse, entry.key]) };
}

export function createAnomalyReview() {
  const covered = new Set(), groups = new Map(), pending = [], ignored = [];
  return { covered,
    append(receipt) {
      if (!receipt) return;
      for (const sku of receipt.skus) covered.add(sku);
      const identities = new Map(receipt.identities);
      for (const { ignored: wasIgnored, ...item } of receipt.items) {
        const warehouse = canonicalWarehouseSku(item.warehouseSku), pair = JSON.stringify([item.inboxId, warehouse]);
        const identity = identities.get(warehouse) ?? pair;
        if (!groups.has(identity)) groups.set(identity, pair);
        (wasIgnored ? ignored : pending).push({ ...item, groupKey: groups.get(identity),
          ...(identities.has(warehouse) ? { evidenceKey: identity } : {}) });
      }
    },
    result() {
      const pendingKeys = new Set(pending.map(item => item.groupKey));
      return { pending, ignored: ignored.filter(item => !pendingKeys.has(item.groupKey)) };
    },
  };
}

export function previewErpCostAnomalyReview({ ledger, receipts, sales }) {
  const review = createAnomalyReview();
  for (const receipt of newestAnomalyReceipts(receipts)) {
    const wanted = uncoveredAnomalySkus(receipt.inbox, receipt.request, review.covered);
    if (wanted?.length === 0) continue;
    review.append(reviewErpAnomalyReceipt({ ...receipt, ledger, sales, wanted, alreadyCovered: wanted ? [] : [...review.covered] }));
  }
  return review.result();
}
