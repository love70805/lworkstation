import { db } from '../db/clientDatabase';
import { getActiveMemberContext } from './selectionRepository';
import { getLatestLedgerCosts, readErpHistoryMappings, saveManualCostOverride } from './profitRepository';
import { canonicalPlatformSku, canonicalPlatformSkc, canonicalWarehouseSku } from '../../domain/identifiers';
import { buildLedgerSkuIdentityIndex, resolveLedgerCostDecision } from '../../domain/ledgerCostIdentity';
import { selectManualOverride, storeIdentity } from '../../domain/manualCostOverride';
import { erpLedgerVersion } from '../../domain/erpLedgerVersion';
import { validateErpCostInboxEnvelope } from '../../domain/erpInboxContract';
import { planWarehouseHistoryCosts, WAREHOUSE_HISTORY_FORMAT } from '../../domain/erpWarehouseHistory';

const tables = () => [db.settings, db.ledgers, db.salesRows, db.erpCostBatches, db.erpCostRows, db.costApprovals,
  db.erpCostRequests, db.erpCostInbox, db.importBatches, db.auditEvents];
const samePair = (a, b) => canonicalPlatformSku(a.platformSku) === canonicalPlatformSku(b.platformSku)
  && canonicalPlatformSkc(a.platformSkc) === canonicalPlatformSkc(b.platformSkc);

async function readCandidate({ ledgerId, store, platformSku, inboxId = null }) {
  const member = await getActiveMemberContext(), ledger = await db.ledgers.get(ledgerId);
  if (!ledger || ledger.workspaceId !== member.workspaceId || !['admin', 'finance'].includes(member.role)) throw new Error('当前成员无此账本的财务权限。');
  if (['finalized', 'locked'].includes(ledger.status)) return null;
  const rows = await db.salesRows.where('ledgerId').equals(ledgerId).toArray();
  const target = rows.find(row => storeIdentity(row.store) === storeIdentity(store) && canonicalPlatformSku(row.platformSku) === canonicalPlatformSku(platformSku));
  if (!target) return null;
  const identity = buildLedgerSkuIdentityIndex(rows).get(canonicalPlatformSku(platformSku));
  if (identity?.platformSkcs.size !== 1) return null;
  const [costs, approvals] = await Promise.all([
    getLatestLedgerCosts(ledgerId), db.costApprovals.where('ledgerId').equals(ledgerId).toArray(),
  ]);
  const scope = { workspaceId: ledger.workspaceId, ledgerId, store, platformSku };
  const decision = resolveLedgerCostDecision({ ...scope, period: ledger.period, identity,
    manualOverride: selectManualOverride(approvals, scope), erpCost: costs.find(row => canonicalPlatformSku(row.platformSku) === canonicalPlatformSku(platformSku)) });
  if (decision.eligibleForExactProfit) return null;
  // Re-read current published identities so a subsequently voided or conflicting
  // source cannot be adopted merely because a request once carried it.
  const expectedSkus = [{ platformSku: target.platformSku, platformSkc: target.platformSkc }];
  const known = await readErpHistoryMappings({ ledgerId, expectedSkus });
  if (!known.length) return null;
  const [imports, inboxes] = await Promise.all([
    db.importBatches.where('ledgerId').equals(ledgerId).toArray(),
    inboxId ? db.erpCostInbox.bulkGet([inboxId]).then(rows => rows.filter(Boolean)) : db.erpCostInbox.where('ledgerId').equals(ledgerId).toArray(),
  ]);
  const sources = inboxes.filter(inbox => inbox.workspaceId === ledger.workspaceId && inbox.ledgerId === ledgerId && ['pending', 'loaded', 'applied'].includes(inbox.status)
    && (!inboxId || inbox.id === inboxId)).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  for (const inbox of sources) {
    const request = await db.erpCostRequests.get(inbox.requestId);
    if (!request || request.workspaceId !== ledger.workspaceId || request.ledgerId !== ledgerId || request.ledgerPeriod !== ledger.period
      || request.ledgerVersion != null && request.ledgerVersion !== erpLedgerVersion(imports)) continue;
    const registered = (request.historyMappings ?? []).filter(row => samePair(row, target));
    const verified = registered.filter(row => known.some(current => current.sourceRecordId === row.sourceRecordId && current.sourceBatchId === row.sourceBatchId
      && samePair(current, row) && canonicalWarehouseSku(current.warehouseSku) === canonicalWarehouseSku(row.warehouseSku)));
    if (!verified.length) continue;
    let batch;
    try {
      batch = validateErpCostInboxEnvelope(inbox.envelope, { expectedWorkspaceId: ledger.workspaceId, expectedLedgerId: ledgerId,
        expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus,
        expectedHistoryMappings: request.historyMappings ?? [] }).batch;
    } catch { continue; }
    for (const warehouse of batch.warehouseEvidence) {
      if (!verified.some(row => canonicalWarehouseSku(row.warehouseSku) === canonicalWarehouseSku(warehouse.warehouseSku))
        || warehouse.evidenceComplete !== true || warehouse.sourceWarnings.length) continue;
      const history = { format: WAREHOUSE_HISTORY_FORMAT, formatVersion: 1, generatedAt: batch.generatedAt, ledgerPeriod: ledger.period,
        warehouseSkus: [warehouse.warehouseSku], warehouseEvidence: { warehouses: [warehouse] },
        historicalMappings: verified, sourceMeta: { complete: true, detailFailureCount: 0 } };
      const targets = rows.filter(row => canonicalPlatformSku(row.platformSku) === canonicalPlatformSku(platformSku))
        .map(row => ({ store: row.store, platformSku: row.platformSku, platformSkc: row.platformSkc }));
      const plan = planWarehouseHistoryCosts({ history, period: ledger.period, targets, knownMappings: known });
      const candidate = plan.ready.find(row => storeIdentity(row.store) === storeIdentity(store));
      if (!candidate) continue;
      return { ...candidate, ledgerId, inboxId: inbox.id,
        reason: `确认历史仓库 ${candidate.warehouseSku} 的采购证据；按 ${ledger.period} 当月及以前最近三笔核价。历史关联不代表当前 ERP 映射。`,
        historyEvidence: { ...candidate.historyEvidence, sourceInboxId: inbox.id, sourceBatchId: inbox.batchId, sourceName: 'ERP 同批历史采购证据' } };
    }
  }
  return null;
}

export function previewRecoveredWarehouseCost(input) {
  return db.transaction('r', tables(), () => readCandidate(input));
}

export function saveRecoveredWarehouseCost({ expectedUnitCost, reason, ...input }) {
  return db.transaction('rw', tables(), async () => {
    const candidate = await readCandidate(input);
    if (!candidate || Number(expectedUnitCost) !== candidate.unitCost) throw new Error('历史核价来源或当前成本已变化，请重新核对。');
    return saveManualCostOverride({ ledgerId: input.ledgerId, store: candidate.store, platformSku: candidate.platformSku,
      unitCost: candidate.unitCost, reason: String(reason ?? '').trim() || candidate.reason, historyEvidence: candidate.historyEvidence });
  });
}
