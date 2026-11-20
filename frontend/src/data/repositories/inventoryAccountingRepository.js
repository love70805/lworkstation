import { db } from '../db/clientDatabase';
import Dexie from 'dexie';
import { accountingMode, accountingSettingKey, createHistoricalLowestAccumulator, LOWEST_ACCOUNTING } from '../../domain/inventoryAccounting';
import { cachedDerived } from '../db/derivedCache';
import { inventoryEvidenceRevision, observeInventoryRevision } from '../db/inventoryRevisions';
import { canonicalPlatformSku, canonicalPlatformSkc, canonicalWarehouseSku } from '../../domain/identifiers';
import { validateErpCostBatchEnvelope } from '../../domain/erpCostBatchEnvelope';
import { calculateWarehouseCostDecision } from '../../domain/erpCostResolution';
import { erpSourceOrder, erpBatchAdoptionBoundary } from '../../domain/erpAutomaticAdoption';

export async function readAccountingMode(workspaceId) {
  return accountingMode((await db.settings.get(accountingSettingKey(workspaceId)))?.value);
}
export const accountingRateKey = ledger => `inventory-rate:${ledger.workspaceId}:${ledger.id}`;
export async function projectAccountingLedger(ledger, mode) {
  const result = { ...ledger, accountingMode: mode };
  const legacy = await db.settings.get(accountingRateKey(ledger));
  if (legacy?.value == null || String(legacy.value).trim() === '') return result;
  const legacyRate = Number(legacy.value);
  if (!Number.isFinite(legacyRate) || legacyRate < 0 || legacyRate === Number(ledger.warehouseRate)) return result;
  // Other ledger edits also change updatedAt. Only a rate edit establishes
  // that the ordinary rate superseded the separate legacy minimum-mode rate.
  const events = await db.auditEvents.where('objectId').equals(ledger.id).filter(event =>
    event.workspaceId === ledger.workspaceId && event.objectType === 'monthly_ledger' && event.action === 'warehouse_rate_updated'
    && event.after?.warehouseRate != null && Number(event.after.warehouseRate) === Number(ledger.warehouseRate)).toArray();
  const latestOrdinary = events.reduce((latest, event) => Math.max(latest, Date.parse(event.createdAt) || 0), 0);
  if (!latestOrdinary || latestOrdinary < (Date.parse(legacy.updatedAt) || 0)) result.warehouseRate = legacyRate;
  return result;
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
    const published = new Map();
    await db.erpCostBatches.where('workspaceId').equals(workspaceId).each(batch => {
      if (batch.status !== 'published') return;
      const contract = batch.sourceContract;
      published.set(batch.id, { requestId: batch.requestId, contract: contract && { batchId: contract.batchId, generatedAt: contract.generatedAt,
        sourceMeta: contract.sourceMeta, sourceFormatVersion: contract.sourceFormatVersion ?? contract.formatVersion, formatVersion: contract.formatVersion } });
    });
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
    await db.erpCostRows.toCollection().each(row => {
      if (!published.has(row.batchId) || row.workspaceId && row.workspaceId !== workspaceId) return;
      if (!rowsByBatch.has(row.batchId)) rowsByBatch.set(row.batchId, []);
      const { platformSku, warehouseSku, mappingFallback, sourceWarnings } = row;
      rowsByBatch.get(row.batchId).push({ platformSku, warehouseSku, mappingFallback, sourceWarnings, ledgerScopeRole: row.ledgerScopeRole ?? 'expected' });
    });
    const minima = createHistoricalLowestAccumulator();
    for (const [batchId, headers] of rowsByBatch) {
      const batch = published.get(batchId), contract = batch.contract;
      const boundary = contract ? erpBatchAdoptionBoundary({ ...contract, rows: headers }) : null;
      const sourceOrder = contract ? erpSourceOrder(await readRequest(batch.requestId) ?? {}, contract) : undefined;
      await db.erpCostRows.where('batchId').equals(batchId).each(row => {
        if ((!row.workspaceId || row.workspaceId === workspaceId) && (!boundary || allowed(boundary,row))) minima.add({ ...row,
          sourceGeneratedAt: contract?.generatedAt, sourceOrder: row.sourceOrder ?? sourceOrder, evidenceOrigin: 'published' });
      });
    }
    const inboxIds = await db.erpCostInbox.where('workspaceId').equals(workspaceId).primaryKeys();
    for (const id of inboxIds) {
      const inbox = await db.erpCostInbox.get(id);
      if (!inbox || inbox.workspaceId !== workspaceId) continue;
      if (['rejected','voided'].includes(inbox.status)) continue;
      const request = await readRequest(inbox.requestId);
      if (!request || request.workspaceId !== workspaceId || request.ledgerId !== inbox.ledgerId || !request.expectedSkus?.length) continue;
      try {
        const batch = validateErpCostBatchEnvelope(inbox.envelope?.batch, { expectedWorkspaceId: workspaceId, expectedLedgerId: inbox.ledgerId,
          expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus, expectedHistoryMappings: request.historyMappings ?? [] });
        const boundary = erpBatchAdoptionBoundary({ ...batch.envelope, rows: batch.rows });
        const expected = new Set(request.expectedSkus.map(item => JSON.stringify([canonicalPlatformSku(item.platformSku),canonicalPlatformSkc(item.platformSkc)])));
        for (const row of batch.rows) if (!row.mappingFallback && allowed(boundary,row) && expected.has(JSON.stringify([canonicalPlatformSku(row.platformSku),canonicalPlatformSkc(row.platformSkc)]))) {
          minima.add({ ...row, id: `${inbox.id}:${row.platformSku}`, sourceInboxId: inbox.id, resolutions: inbox.costResolutions ?? [], publishedAt: inbox.receivedAt,
            sourceGeneratedAt: batch.envelope.generatedAt, sourceEnvelopeBatchId: batch.envelope.batchId,
            sourceOrder: erpSourceOrder(request,batch.envelope), evidenceOrigin: 'receipt' });
        }
      } catch { /* Unverified or incompatible receipts cannot supply a minimum. */ }
    }
    return minima.values();
  };
  // Transactions must read their own uncommitted state and must not wait on a
  // separate cache database. Only ordinary reads publish reusable projections.
  if (Dexie.currentTransaction) return compute();
  await observeInventoryRevision(true);
  return cachedDerived({ scope: [workspaceId], formula: 'inventory-lowest@6-source-decimals', revisionReader: inventoryEvidenceRevision, revision: inventoryEvidenceRevision(), compute });
}

// Retrieve the full history only when opening the selected minimum's details.
export async function readLowestPurchaseReview(workspaceId, minimum, period) {
  let source, resolutions;
  if (minimum.sourceInboxId) {
    const inbox = await db.erpCostInbox.get(minimum.sourceInboxId);
    if (!inbox || inbox.workspaceId !== workspaceId || inbox.batchId !== minimum.sourceEnvelopeBatchId || ['rejected','voided'].includes(inbox.status)) return null;
    const request = await db.erpCostRequests.get(inbox.requestId);
    if (!request || request.workspaceId !== workspaceId || request.ledgerId !== inbox.ledgerId) return null;
    const batch = validateErpCostBatchEnvelope(inbox.envelope?.batch, { expectedWorkspaceId: workspaceId, expectedLedgerId: inbox.ledgerId,
      expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus, expectedHistoryMappings: request.historyMappings ?? [] });
    source = batch.rows.find(row => row.canonicalPlatformSku === minimum.canonicalPlatformSku && row.canonicalWarehouseSku === minimum.canonicalWarehouseSku);
    resolutions = inbox.costResolutions;
  } else if (minimum.sourceCostRowId != null) {
    source = await db.erpCostRows.get(minimum.sourceCostRowId);
    if (!source || source.batchId !== minimum.batchId || source.workspaceId && source.workspaceId !== workspaceId) return null;
    resolutions = source.costDecision?.resolutions ?? source.resolutions;
  }
  if (!source || !source.warehouseSku || canonicalWarehouseSku(source.warehouseSku) !== minimum.canonicalWarehouseSku
    || canonicalPlatformSku(source.platformSku) !== minimum.canonicalPlatformSku) return null;
  return { excludedRecords: source.excludedRecords ?? [], costDecision: calculateWarehouseCostDecision({
    warehouseSku: source.warehouseSku, purchaseRecords: source.purchaseRecords ?? source.costDecision?.purchaseRecords, resolutions, evidenceComplete: source.evidenceComplete, period,
  }) };
}
export async function accountingCosts(ledger, costs, mode, salesRows = []) {
  if (mode !== LOWEST_ACCOUNTING) return costs;
  const expected = new Set(salesRows.map(row => JSON.stringify([canonicalPlatformSku(row.platformSku), canonicalPlatformSkc(row.platformSkc)])));
  return (await readHistoricalLowestCosts(ledger.workspaceId)).filter(cost => expected.has(JSON.stringify([canonicalPlatformSku(cost.platformSku), canonicalPlatformSkc(cost.platformSkc)])));
}
export async function readAccountingSupplement(ledger, kind) {
  const batches = await db.monthlySupplementBatches.where('[ledgerId+kind+status]').equals([ledger.id,kind,'adopted'])
    .filter(row => row.workspaceId === ledger.workspaceId && row.period === ledger.period).toArray();
  return batches.sort((a,b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
    || (b.revision ?? 0) - (a.revision ?? 0) || String(b.id).localeCompare(String(a.id)))[0] ?? null;
}
