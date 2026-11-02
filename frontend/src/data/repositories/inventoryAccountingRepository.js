import { db } from '../db/clientDatabase';
import { accountingMode, accountingSettingKey, historicalLowestCosts, LOWEST_ACCOUNTING } from '../../domain/inventoryAccounting';
import { cachedDerived, sourceRevision } from '../db/derivedCache';
import { canonicalPlatformSku, canonicalPlatformSkc } from '../../domain/identifiers';
import { validateErpCostBatchEnvelope } from '../../domain/erpCostBatchEnvelope';

export async function readAccountingMode(workspaceId) {
  return accountingMode((await db.settings.get(accountingSettingKey(workspaceId)))?.value);
}
export const accountingRateKey = ledger => `inventory-rate:${ledger.workspaceId}:${ledger.id}`;
export async function projectAccountingLedger(ledger, mode) {
  const value = mode === LOWEST_ACCOUNTING ? (await db.settings.get(accountingRateKey(ledger)))?.value : undefined;
  return { ...ledger, accountingMode: mode, ...(Number.isFinite(value) && value >= 0 ? { warehouseRate: value } : {}) };
}
export async function toggleAccountingMode(workspaceId) {
  if (!workspaceId) throw new Error('工作区尚未就绪。');
  return db.transaction('rw', db.settings, async () => {
    const mode = await readAccountingMode(workspaceId) === LOWEST_ACCOUNTING ? 'weighted' : LOWEST_ACCOUNTING;
    await db.settings.put({ key: accountingSettingKey(workspaceId), value: mode });
    return mode;
  });
}
export async function readHistoricalLowestCosts(workspaceId) {
  return cachedDerived({ scope: [workspaceId], formula: 'inventory-lowest@1', revision: sourceRevision(), persist: false, compute: async () => {
    const batches = await db.erpCostBatches.where('workspaceId').equals(workspaceId).toArray();
    const published = new Set(batches.filter(batch => batch.status === 'published').map(batch => batch.id));
    const rows = await db.erpCostRows.filter(row => published.has(row.batchId) && (!row.workspaceId || row.workspaceId === workspaceId)).toArray();
    const inboxes = await db.erpCostInbox.where('workspaceId').equals(workspaceId).toArray();
    for (const inbox of inboxes) {
      if (['rejected','voided'].includes(inbox.status)) continue;
      const request = await db.erpCostRequests.get(inbox.requestId);
      if (!request || request.workspaceId !== workspaceId || request.ledgerId !== inbox.ledgerId || !request.expectedSkus?.length) continue;
      try {
        const batch = validateErpCostBatchEnvelope(inbox.envelope?.batch, { expectedWorkspaceId: workspaceId, expectedLedgerId: inbox.ledgerId,
          expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus, expectedHistoryMappings: request.historyMappings ?? [] });
        const expected = new Set(request.expectedSkus.map(item => JSON.stringify([canonicalPlatformSku(item.platformSku),canonicalPlatformSkc(item.platformSkc)])));
        for (const row of batch.rows) if (!row.mappingFallback && expected.has(JSON.stringify([canonicalPlatformSku(row.platformSku),canonicalPlatformSkc(row.platformSkc)]))) {
          rows.push({ ...row, id: `${inbox.id}:${row.platformSku}`, resolutions: inbox.costResolutions ?? [], publishedAt: inbox.receivedAt });
        }
      } catch { /* Unverified or incompatible receipts cannot supply a minimum. */ }
    }
    return historicalLowestCosts(rows);
  } });
}
export async function accountingCosts(ledger, costs, mode, salesRows = []) {
  if (mode !== LOWEST_ACCOUNTING) return costs;
  const expected = new Set(salesRows.map(row => JSON.stringify([canonicalPlatformSku(row.platformSku), canonicalPlatformSkc(row.platformSkc)])));
  return (await readHistoricalLowestCosts(ledger.workspaceId)).filter(cost => expected.has(JSON.stringify([canonicalPlatformSku(cost.platformSku), canonicalPlatformSkc(cost.platformSkc)])));
}
export async function readAccountingSupplement(ledgerId, kind, mode = 'weighted') {
  const batches = await db.monthlySupplementBatches.where('[ledgerId+kind+status]').equals([ledgerId,kind,'adopted']).toArray();
  return batches.find(batch => accountingMode(batch.accountingMode) === mode)
    ?? (mode === LOWEST_ACCOUNTING ? batches.find(batch => accountingMode(batch.accountingMode) === 'weighted') : null) ?? null;
}
