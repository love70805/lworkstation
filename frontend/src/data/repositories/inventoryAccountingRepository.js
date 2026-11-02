import { db } from '../db/clientDatabase';
import Dexie from 'dexie';
import { accountingMode, accountingSettingKey, historicalLowestCosts, LOWEST_ACCOUNTING } from '../../domain/inventoryAccounting';
import { cachedDerived } from '../db/derivedCache';
import { inventoryEvidenceRevision, observeInventoryRevision } from '../db/inventoryRevisions';
import { canonicalPlatformSku, canonicalPlatformSkc, canonicalWarehouseSku } from '../../domain/identifiers';
import { validateErpCostBatchEnvelope } from '../../domain/erpCostBatchEnvelope';
import { erpSourceOrder, erpBatchAdoptionBoundary } from '../../domain/erpAutomaticAdoption';

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
  const compute = async () => {
    const batches = await db.erpCostBatches.where('workspaceId').equals(workspaceId).toArray();
    const published = new Map(batches.filter(batch => batch.status === 'published').map(batch => [batch.id,batch]));
    const sourceRows = await db.erpCostRows.filter(row => published.has(row.batchId) && (!row.workspaceId || row.workspaceId === workspaceId)).toArray();
    const requests = new Map();
    const readRequest = id => {
      if (!id) return Promise.resolve(null);
      if (!requests.has(id)) requests.set(id, db.erpCostRequests.get(id));
      return requests.get(id);
    };
    const allowed = (boundary,row) => row.platformSku && row.warehouseSku && !boundary.globalReasons.length
      && !boundary.blockedSkus.has(canonicalPlatformSku(row.platformSku))
      && !boundary.blockedWarehouses.has(canonicalWarehouseSku(row.warehouseSku));
    const rowsByBatch = new Map();
    for (const row of sourceRows) {
      if (!rowsByBatch.has(row.batchId)) rowsByBatch.set(row.batchId, []);
      rowsByBatch.get(row.batchId).push(row);
    }
    const rows = [];
    for (const [batchId, batchRows] of rowsByBatch) {
      const batch = published.get(batchId), contract = batch.sourceContract;
      const boundary = contract ? erpBatchAdoptionBoundary({ ...contract,
        sourceFormatVersion: contract.sourceFormatVersion ?? contract.formatVersion,
        rows: batchRows.map(row => ({ ...row, ledgerScopeRole: row.ledgerScopeRole ?? 'expected' })) }) : null;
      const sourceOrder = contract ? erpSourceOrder(await readRequest(batch.requestId) ?? {}, contract) : undefined;
      for (const row of batchRows) if (!boundary || allowed(boundary,row)) rows.push({ ...row,
        sourceGeneratedAt: contract?.generatedAt, sourceOrder: row.sourceOrder ?? sourceOrder, evidenceOrigin: 'published' });
    }
    const inboxes = await db.erpCostInbox.where('workspaceId').equals(workspaceId).toArray();
    for (const inbox of inboxes) {
      if (['rejected','voided'].includes(inbox.status)) continue;
      const request = await readRequest(inbox.requestId);
      if (!request || request.workspaceId !== workspaceId || request.ledgerId !== inbox.ledgerId || !request.expectedSkus?.length) continue;
      try {
        const batch = validateErpCostBatchEnvelope(inbox.envelope?.batch, { expectedWorkspaceId: workspaceId, expectedLedgerId: inbox.ledgerId,
          expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus, expectedHistoryMappings: request.historyMappings ?? [] });
        const boundary = erpBatchAdoptionBoundary({ ...batch.envelope, rows: batch.rows });
        const expected = new Set(request.expectedSkus.map(item => JSON.stringify([canonicalPlatformSku(item.platformSku),canonicalPlatformSkc(item.platformSkc)])));
        for (const row of batch.rows) if (!row.mappingFallback && allowed(boundary,row) && expected.has(JSON.stringify([canonicalPlatformSku(row.platformSku),canonicalPlatformSkc(row.platformSkc)]))) {
          rows.push({ ...row, id: `${inbox.id}:${row.platformSku}`, resolutions: inbox.costResolutions ?? [], publishedAt: inbox.receivedAt,
            sourceGeneratedAt: batch.envelope.generatedAt, sourceEnvelopeBatchId: batch.envelope.batchId,
            sourceOrder: erpSourceOrder(request,batch.envelope), evidenceOrigin: 'receipt' });
        }
      } catch { /* Unverified or incompatible receipts cannot supply a minimum. */ }
    }
    return historicalLowestCosts(rows);
  };
  // Transactions must read their own uncommitted state and must not wait on a
  // separate cache database. Only ordinary reads publish reusable projections.
  if (Dexie.currentTransaction) return compute();
  await observeInventoryRevision(true);
  return cachedDerived({ scope: [workspaceId], formula: 'inventory-lowest@3-source-evidence', revisionReader: inventoryEvidenceRevision, revision: inventoryEvidenceRevision(), compute });
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
