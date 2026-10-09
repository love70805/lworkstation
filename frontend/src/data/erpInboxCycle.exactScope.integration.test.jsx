import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { runErpInboxCycle } from '../App';
import { db, DEFAULT_WORKSPACE_ID, createOrGetMonthlyLedger, setActiveMemberContext, saveErpCostRequest, getLatestLedgerCosts, listErpCostInbox, getLedgerSnapshot } from './database';
import { buildErpCostRequest } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';
import { resolveFormalCostDecision } from '../domain/costPolicy';

beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: DEFAULT_WORKSPACE_ID, memberId: 'finance', role: 'finance' });
});
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

async function delivery() {
  const ledger = await createOrGetMonthlyLedger({ period: '2026-09' });
  const expectedSkus = [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }, { platformSku: 'SKU-B', platformSkc: 'SKC-B' }];
  await db.salesRows.bulkAdd(expectedSkus.map(row => ({ ...row, workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: '甲店', quantity: 2, amount: 100 })));
  const request = buildErpCostRequest({ id: 'REQ-EXACT', workspaceId: ledger.workspaceId, ledgerId: ledger.id, ledgerPeriod: ledger.period, platformSkcs: expectedSkus.map(row => row.platformSkc), expectedSkus, requestedAt: '2026-10-09T02:00:00Z', requestedBy: 'finance' });
  await saveErpCostRequest(request);
  const batch = buildErpCostBatchEnvelope({ batchId: 'B-EXACT', workspaceId: ledger.workspaceId, ledgerId: ledger.id, requestId: request.id, platformSkcs: request.platformSkcs, expectedSkus,
    results: expectedSkus.map((row, index) => ({ warehouseSku: `WH-${index}`, mappings: [row], previewUnitCost: index ? 8 : 5 })),
    warehouseEvidence: expectedSkus.map((_row, index) => ({ warehouseSku: `WH-${index}`, evidenceComplete: true, purchaseRecords: [{ recordId: `PURCHASE-${index}`, purchaseDate: '2026-09-01', quantity: 2, unitPrice: index ? 8 : 5 }] })),
  });
  const envelope = buildErpCostInboxEnvelope({ batch, deliveryId: 'D-EXACT' });
  // The actual desktop cost-results endpoint adds this policy after binding
  // the return to its registered request. The receiver must read that request.
  envelope.batch.sourceMeta.platformScopePolicy = 'ledger_platform_pair';
  return { ledger, request, envelope };
}

it('receives the actual precise-scope transport envelope through the application poller, adopts it and enters profit without recollection', async () => {
  const { ledger, envelope } = await delivery();
  const acknowledge = vi.fn(), emit = vi.fn();
  const options = { pollRecords: async () => [{ deliveryId: envelope.deliveryId, envelope }], acknowledge, emit, recoverDrafts: async () => ({ recovered: 0 }) };
  const result = await runErpInboxCycle(options);
  expect(result.failures.map(error => error.message)).toEqual([]);
  expect(result.received).toBe(1);
  expect(acknowledge).toHaveBeenCalledWith('D-EXACT', { workspaceId: ledger.workspaceId });
  expect((await listErpCostInbox({ statuses: ['applied'] }))[0].adoption.summary.adoptedCount).toBe(2);
  expect((await getLatestLedgerCosts(ledger.id)).map(row => row.unitCost).toSorted()).toEqual([5, 8]);
  const snapshot = await getLedgerSnapshot(ledger.id);
  for (const cost of snapshot.costs) expect(resolveFormalCostDecision({ workspaceId: ledger.workspaceId, ledgerId: ledger.id, period: ledger.period, store: '甲店', platformSku: cost.platformSku, erpCost: cost }).eligibleForExactProfit).toBe(true);
  const before = { rows: await db.erpCostRows.count(), batches: await db.erpCostBatches.count(), audits: await db.auditEvents.count() };
  await runErpInboxCycle(options);
  expect({ rows: await db.erpCostRows.count(), batches: await db.erpCostBatches.count(), audits: await db.auditEvents.count() }).toEqual(before);
});

it('still rejects a return outside the locally registered pair before saving or acknowledging it', async () => {
  const { envelope } = await delivery();
  envelope.batch.rows[0].platformSku = 'SKU-OUTSIDE';
  const acknowledge = vi.fn();
  const result = await runErpInboxCycle({ pollRecords: async () => [{ deliveryId: envelope.deliveryId, envelope }], acknowledge, emit: vi.fn(), recoverDrafts: async () => ({ recovered: 0 }) });
  expect(result.received).toBe(0);
  expect(result.failures[0].message).toContain('账本范围角色与已登记请求不一致');
  expect(acknowledge).not.toHaveBeenCalled();
  expect(await db.erpCostInbox.count()).toBe(0);
  expect(await db.erpCostRows.count()).toBe(0);
});

it('does not accept a precise-scope return without its registered local request', async () => {
  const { envelope } = await delivery();
  await db.erpCostRequests.clear();
  const acknowledge = vi.fn();
  const result = await runErpInboxCycle({ pollRecords: async () => [{ deliveryId: envelope.deliveryId, envelope }], acknowledge, emit: vi.fn(), recoverDrafts: async () => ({ recovered: 0 }) });
  expect(result.received).toBe(0);
  expect(result.failures[0].message).toContain('精确采集缺少已登记的平台 SKU/SKC 范围');
  expect(acknowledge).not.toHaveBeenCalled();
  expect(await db.erpCostInbox.count()).toBe(0);
});
