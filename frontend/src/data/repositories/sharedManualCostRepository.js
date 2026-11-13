import { db } from '../db/clientDatabase';
import { sourceRevision, assertSourceRevision, retrySourceRead } from '../db/derivedCache';
import { getActiveMemberContext } from './selectionRepository';
import { listErpCostAnomalyReview, saveManualCostOverrideGroup } from './profitRepository';
import { assertLedgerCostEditingReady, assertCachedLedgerCostEditingReady } from './erpCostEditingGuard';
import { canonicalPlatformSku, canonicalWarehouseSku } from '../../domain/identifiers';
import { selectManualOverride, storeSkuKey } from '../../domain/manualCostOverride';
import { buildLedgerSkuIdentityIndex } from '../../domain/ledgerCostIdentity';
import { accountingApprovals } from '../../domain/inventoryAccounting';
import { readAccountingMode } from './inventoryAccountingRepository';
import { indexErpAnomalyEvidence } from '../../domain/erpAnomalyEvidence';
import { canonicalJson } from '../../domain/profitReports';

// Use the current complete ERP evidence group, never catalog names or an old mapping.
export async function previewSharedManualCost({ ledgerId, store, platformSku }) {
  return retrySourceRead(async () => {
    const revision = sourceRevision(), member = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!ledger || ledger.workspaceId !== member.workspaceId) return null;
    const review = await listErpCostAnomalyReview(ledgerId);
    const items = [...review.pending, ...review.ignored];
    const keys = new Set(items.filter(r => canonicalPlatformSku(r.platformSku) === canonicalPlatformSku(platformSku)).map(r => r.groupKey));
    if (keys.size !== 1) return null;
    const group = items.filter(r => keys.has(r.groupKey)), warehouseSku = group[0].warehouseSku;
    const receipt = await db.erpCostInbox.get(group[0].inboxId);
    const evidence = indexErpAnomalyEvidence(receipt?.envelope?.batch, ledger.period).get(canonicalWarehouseSku(warehouseSku));
    if (!evidence) return null;
    const skus = new Set(group.map(r => canonicalPlatformSku(r.platformSku)));
    const sales = await db.salesRows.where('ledgerId').equals(ledgerId).toArray();
    const identities = buildLedgerSkuIdentityIndex(sales), mode = await readAccountingMode(ledger.workspaceId);
    const approvals = accountingApprovals(await db.costApprovals.where('ledgerId').equals(ledgerId).toArray(), mode);
    const members = new Map();
    for (const row of sales) {
      if (!skus.has(canonicalPlatformSku(row.platformSku)) || identities.get(canonicalPlatformSku(row.platformSku))?.platformSkcs.size > 1) continue;
      const key = storeSkuKey(row.store, row.platformSku);
      const manual = selectManualOverride(approvals, { workspaceId: ledger.workspaceId, ledgerId, store: row.store, platformSku: row.platformSku });
      members.set(key, { store: row.store, platformSku: row.platformSku, manualId: manual?.id ?? null, unitCost: manual?.approvedAmount ?? null,
        included: key === storeSkuKey(store, platformSku) || !manual });
    }
    const rows = [...members.values()].sort((a,b) => storeSkuKey(a.store,a.platformSku).localeCompare(storeSkuKey(b.store,b.platformSku)));
    if (rows.length < 2 || !members.has(storeSkuKey(store, platformSku))) return null;
    assertSourceRevision(revision);
    return { warehouseSku, rows, accountingMode: mode, fingerprint: canonicalJson({ evidence: evidence.key, rows, mode }), revision };
  });
}

export async function saveSharedManualCost({ ledgerId, store, platformSku, unitCost, fingerprint, expectedAccountingMode }) {
  await assertLedgerCostEditingReady(ledgerId);
  const plan = await previewSharedManualCost({ ledgerId, store, platformSku });
  if (!plan || !fingerprint || plan.fingerprint !== fingerprint || expectedAccountingMode && plan.accountingMode !== expectedAccountingMode) throw new Error('关联范围、采购证据或人工成本已变化，请重新打开成本明细。');
  return db.transaction('rw', db.settings, db.ledgers, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const ledger = await db.ledgers.get(ledgerId);
    await assertCachedLedgerCostEditingReady(ledger);
    assertSourceRevision(plan.revision);
    return saveManualCostOverrideGroup({ ledgerId, targets: plan.rows.filter(r => r.included).map(({store,platformSku}) => ({store,platformSku})), unitCost,
      reason: `同仓成本批量更正：${plan.warehouseSku}；本月相同完整采购证据，保留其他已确认人工成本`, expectedAccountingMode: plan.accountingMode });
  });
}
