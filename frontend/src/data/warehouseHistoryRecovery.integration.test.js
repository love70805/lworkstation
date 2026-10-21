import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { db } from './db/clientDatabase';
import { DEFAULT_WORKSPACE_ID as workspaceId } from './db/constants';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { readErpHistoryMappings, saveErpCostRequest, receiveErpCostInboxEnvelope, saveManualCostOverride, revokeManualCostOverride, getLatestLedgerCosts } from './repositories/profitRepository';
import { previewRecoveredWarehouseCost, saveRecoveredWarehouseCost } from './repositories/warehouseHistoryRecoveryRepository';
import { buildErpCostRequest } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope, validateErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';
import { warehouseHistoryFixture } from '../testFixtures/warehouseHistory';
const ledgerId = 'RECOVERY-LEDGER', expectedSkus = [{ platformSku: 'SKU-A', platformSkc: 'SKC-A', store: '甲店' }];
const input = { ledgerId, store: '甲店', platformSku: 'SKU-A' };
let request, batch, receipt;
beforeEach(async () => {
  await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId, memberId: 'finance', role: 'finance' });
  await db.ledgers.put({ id: ledgerId, workspaceId, period: '2026-09', status: 'cost_pending', warehouseRate: 0.7 });
  await db.salesRows.bulkAdd(['甲店', '乙店'].map(store => ({ ...expectedSkus[0], store, workspaceId, ledgerId, quantity: 1, amount: 20 })));
  await db.erpCostBatches.put({ id: 'OLD-BATCH', workspaceId, ledgerId: 'OLD-LEDGER', status: 'published', publishedAt: '2026-09-01T00:00:00Z' });
  await db.erpCostRows.add({ batchId: 'OLD-BATCH', workspaceId, ledgerId: 'OLD-LEDGER', platformSku: 'SKU-A', canonicalPlatformSku: 'SKU-A',
    platformSkc: 'SKC-A', warehouseSku: 'WH-A', evidenceComplete: true, publishedAt: '2026-09-01T00:00:00Z' });
  const historyMappings = await readErpHistoryMappings({ ledgerId, expectedSkus });
  request = { ...buildErpCostRequest({ id: 'HISTORY-REQUEST', workspaceId, ledgerId, ledgerPeriod: '2026-09',
    platformSkcs: ['SKC-A'], expectedSkus, requestedBy: 'finance', requestedAt: '2026-10-21T00:00:00Z' }), historyMappings, historyRecoveryVersion: 1 };
  await saveErpCostRequest(request);
  batch = buildErpCostBatchEnvelope({ batchId: 'COLLECTED', workspaceId, ledgerId, requestId: request.id, platformSkcs: ['SKC-A'], expectedSkus,
    generatedAt: '2026-10-21T00:00:00Z', results: [{ warehouseSku: 'WH-A', mappings: expectedSkus, unitCost: 0.35 }],
    warehouseEvidence: warehouseHistoryFixture().warehouseEvidence.warehouses });
  batch.rows = batch.rows.map(row => ({ ...row, platformSku: null, platformSkc: null, catalogMappings: [], previewUnitCost: null, unitCost: null,
    sourceWarnings: ['evidence_only_warehouse_sku', 'mapping_failure:missing_platform_sku'] }));
  batch.historyMappings = historyMappings;
  batch.sourceMeta = { ...batch.sourceMeta, platformScopePolicy: 'ledger_platform_pair', sourceWarnings: [],
    mappingFailures: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A', message: 'current mapping missing' }] };
  const envelope = buildErpCostInboxEnvelope({ batch, deliveryId: 'HISTORY-DELIVERY' }, { expectedSkus, expectedHistoryMappings: historyMappings });
  receipt = await receiveErpCostInboxEnvelope({ envelope });
});
afterEach(async () => { await db.delete(); });
it('does not load historical receipt bodies when the target has no reliable historical mapping', async () => {
  await db.erpCostBatches.update('OLD-BATCH', { status: 'voided' });
  let reads = 0;
  const recordRead = row => { reads++; return row; };
  db.erpCostInbox.hook('reading').subscribe(recordRead);
  try { expect(await previewRecoveredWarehouseCost(input)).toBeNull(); }
  finally { db.erpCostInbox.hook('reading').unsubscribe(recordRead); }
  expect(reads).toBe(0);
});
it('collects evidence through the usual inbox without adopting a historical mapping as formal ERP', async () => {
  expect(receipt.adoptionError).toBeUndefined();
  expect(await getLatestLedgerCosts(ledgerId)).toEqual([]);
  expect(await db.costApprovals.count()).toBe(0);
  const candidate = await previewRecoveredWarehouseCost(input);
  expect(candidate).toMatchObject({ unitCost: 0.35, warehouseSku: 'WH-A', selectedRecordIds: ['R2', 'R1'], inboxId: receipt.id });
  const saved = await saveRecoveredWarehouseCost({ ...input, inboxId: candidate.inboxId, expectedUnitCost: candidate.unitCost });
  expect(saved).toMatchObject({ approvedAmount: 0.35, referenceCost: { kind: 'manual_override', store: '甲店',
    historyEvidence: { sourceInboxId: receipt.id, selectedRecordIds: ['R2', 'R1'] } } });
  expect(await db.costApprovals.count()).toBe(1);
  expect(saved.referenceCost.historyEvidence.historicalMappingSources.every(source => source.sourceRecordId != null)).toBe(true);
  expect((await db.auditEvents.where('objectId').equals(saved.id).toArray()).some(row => row.action === 'manual_override_saved')).toBe(true);
  expect(await previewRecoveredWarehouseCost(input)).toBeNull();
  await revokeManualCostOverride({ ledgerId, approvalId: saved.id });
  expect((await previewRecoveredWarehouseCost(input)).unitCost).toBe(0.35);
});
it('rejects forged history provenance and unrelated evidence-only warehouses', () => {
  const forged = structuredClone(batch); forged.historyMappings[0].sourceRecordId = 'FORGED';
  expect(() => validateErpCostBatchEnvelope(forged, { expectedSkus, expectedHistoryMappings: request.historyMappings })).toThrow('历史仓库关联');
  const unrelated = structuredClone(batch); unrelated.rows[0].warehouseSku = 'FOREIGN-WAREHOUSE';
  expect(() => validateErpCostBatchEnvelope(unrelated, { expectedSkus, expectedHistoryMappings: request.historyMappings })).toThrow();
});
it.each(['voided-source', 'conflicting-source', 'changed-import', 'finalized', 'effective-manual'])('does not use stale suggestions after %s', async change => {
  const candidate = await previewRecoveredWarehouseCost(input);
  expect(candidate).not.toBeNull();
  if (change === 'voided-source') await db.erpCostBatches.update('OLD-BATCH', { status: 'voided' });
  if (change === 'conflicting-source') await db.erpCostRows.add({ batchId: 'OLD-BATCH', workspaceId, ledgerId: 'OLD-LEDGER', platformSku: 'SKU-A',
    canonicalPlatformSku: 'SKU-A', platformSkc: 'SKC-A', warehouseSku: 'WH-CONFLICT', evidenceComplete: true, publishedAt: '2026-09-02T00:00:00Z' });
  if (change === 'changed-import') { await db.erpCostRequests.update(request.id, { ledgerVersion: 'old-import' }); await db.importBatches.add({ id: 'NEW', ledgerId }); }
  if (change === 'finalized') await db.ledgers.update(ledgerId, { status: 'finalized' });
  if (change === 'effective-manual') await saveManualCostOverride({ ...input, unitCost: 0, reason: '真实零值' });
  expect(await previewRecoveredWarehouseCost(input)).toBeNull();
  await expect(saveRecoveredWarehouseCost({ ...input, inboxId: candidate.inboxId, expectedUnitCost: candidate.unitCost })).rejects.toThrow('已变化');
  expect(await db.costApprovals.count()).toBe(change === 'effective-manual' ? 1 : 0);
});
it('does not guess a conflicting parent or cross-workspace source', async () => {
  await db.salesRows.add({ ...input, workspaceId, platformSkc: 'SKC-OTHER', quantity: 1, amount: 20 });
  expect(await previewRecoveredWarehouseCost(input)).toBeNull();
  await setActiveMemberContext({ workspaceId: 'FOREIGN', memberId: 'finance', role: 'finance' });
  await expect(previewRecoveredWarehouseCost(input)).rejects.toThrow('权限');
});
it('can prepare future reads from previously confirmed historical evidence, but excludes revoked or foreign approvals', async () => {
  await db.erpCostBatches.update('OLD-BATCH', { status: 'voided' });
  const history = warehouseHistoryFixture(), warehouse = history.warehouseEvidence.warehouses[0];
  const approval = { id: 'CONFIRMED-HISTORY', workspaceId, ledgerId: 'PRIOR-MONTH', platformSku: 'SKU-A', approvedAmount: 0.35,
    currency: 'CNY', status: 'approved', approvedBy: 'finance', approvedAt: '2026-10-01T00:00:00Z', reason: '已核对历史仓库',
    referenceCost: { kind: 'manual_override', store: '甲店', historyEvidence: { format: history.format, formatVersion: 1,
      historicalMapping: { ...expectedSkus[0], warehouseSku: 'WH-A' }, warehouseEvidence: warehouse } } };
  await db.costApprovals.put(approval);
  expect(await readErpHistoryMappings({ ledgerId, expectedSkus })).toEqual([expect.objectContaining({
    warehouseSku: 'WH-A', sourceRecordId: 'approval:CONFIRMED-HISTORY', store: '甲店' })]);
  await db.costApprovals.update(approval.id, { status: 'revoked' });
  expect(await readErpHistoryMappings({ ledgerId, expectedSkus })).toEqual([]);
  await db.costApprovals.update(approval.id, { status: 'approved', workspaceId: 'FOREIGN' });
  expect(await readErpHistoryMappings({ ledgerId, expectedSkus })).toEqual([]);
});
