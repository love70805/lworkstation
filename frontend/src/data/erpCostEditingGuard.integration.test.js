import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db, DEFAULT_WORKSPACE_ID, createOrGetMonthlyLedger, setActiveMemberContext, saveErpCostRequest,
  receiveErpCostInboxEnvelope, saveManualCostOverride, revokeManualCostOverride, processErpCostInboxAdoption } from './database';
import { saveRecoveredWarehouseCost } from './repositories/warehouseHistoryRecoveryRepository';
import { createCurrentProfitReport, saveProfitReport } from './repositories/profitReportRepository';
import { rejectErpCostInboxBatches, voidPublishedErpCostBatch, setErpCostAnomaliesIgnored } from './repositories/profitRepository';
import { buildErpCostRequest } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';
import { publishErpTaskState } from '../lib/erpCollectionTaskStore';
import { readReceiptStates } from './repositories/erpCostEditingGuard';
let ledger, receipt, task, manual, unavailable;
beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: DEFAULT_WORKSPACE_ID, memberId: 'finance', role: 'finance' });
  ledger = await createOrGetMonthlyLedger({ period: '2026-09' });
  const expectedSkus = [{ platformSku: 'S', platformSkc: 'C' }];
  await db.salesRows.add({ ...expectedSkus[0], workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: '合成店', quantity: 2, amount: 100 });
  const request = buildErpCostRequest({ id: 'R', workspaceId: ledger.workspaceId, ledgerId: ledger.id, ledgerPeriod: ledger.period, platformSkcs: ['C'], expectedSkus, requestedBy: 'finance', requestedAt: '2026-10-01T00:00:00Z' });
  await saveErpCostRequest(request);
  const batch = buildErpCostBatchEnvelope({ batchId: 'B', generatedAt: '2026-10-01T00:00:00Z', workspaceId: ledger.workspaceId, ledgerId: ledger.id, requestId: 'R', platformSkcs: ['C'], expectedSkus,
    results: [{ warehouseSku: 'WH', mappings: expectedSkus, previewUnitCost: 1 }],
    warehouseEvidence: [{ warehouseSku: 'WH', evidenceComplete: true, purchaseRecords: [{ recordId: 'P', purchaseDate: '2026-09-01', quantity: 2, unitPrice: 1 }] }] });
  receipt = await receiveErpCostInboxEnvelope({ envelope: buildErpCostInboxEnvelope({ batch, deliveryId: 'D', sentAt: '2026-10-01T00:00:00Z' }) });
  manual = await saveManualCostOverride({ ledgerId: ledger.id, store: '合成店', platformSku: 'S', unitCost: 3, reason: '采集前已确认' });
  task = { workspaceId: ledger.workspaceId, ledgerId: ledger.id, taskId: 'T', requestId: 'R', status: 'running', batches: [{ deliveryId: 'D' }, {}] };
  unavailable = false;
  vi.stubGlobal('window', { shopeersDesktopRuntime: { requestInbox: vi.fn(async () => {
    if (unavailable) throw new Error('offline');
    return { status: 200, body: { tasks: [task] } };
  }) } });
});
afterEach(async () => { vi.unstubAllGlobals(); await db.delete(); });
const save = () => saveManualCostOverride({ ledgerId: ledger.id, store: '合成店', platformSku: 'S', unitCost: 9, reason: '临时结果误改' });
it('invalidates an equal-count receipt change and never caches a rolled back edit', async () => {
  const states = () => readReceiptStates('ledgerId', ledger.id);
  const first = await states();
  expect(first.find(row => row.id === receipt.id)?.adoptionPending).toBeFalsy();
  await expect(db.transaction('rw', db.erpCostInbox, async () => {
    await db.erpCostInbox.update(receipt.id, {adoptionPending:true});
    expect((await states()).find(row => row.id === receipt.id)?.adoptionPending).toBe(true);
    throw new Error('rollback');
  })).rejects.toThrow('rollback');
  expect(await states()).toEqual(first);
  task.status = 'cost_complete'; task.batches = [{deliveryId:'D'}];
  await db.erpCostInbox.update(receipt.id, {adoptionPending:true});
  await expect(save()).rejects.toMatchObject({code:'ERP_COST_REVIEW_NOT_READY'});
  await db.erpCostInbox.update(receipt.id, {adoptionPending:false});
  await expect(save()).resolves.toMatchObject({approvedAmount:9});
});
it('rechecks a stale completed UI snapshot and rejects manual save, revoke, confirmation and ignore without writing', async () => {
  publishErpTaskState({ workspaceId: ledger.workspaceId, tasks: [{ ...task, status: 'completed', batches: [{ deliveryId: 'D' }] }] });
  const audit = await db.auditEvents.toArray(), original = await db.erpCostInbox.get(receipt.id);
  await expect(save()).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(revokeManualCostOverride({ ledgerId: ledger.id, approvalId: manual.id })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(setErpCostAnomaliesIgnored({ ledgerId: ledger.id })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(processErpCostInboxAdoption({ inboxId: receipt.id, resolutions: [{ recordId: 'P', action: 'confirm_true_price' }] })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(saveRecoveredWarehouseCost({ ledgerId: ledger.id })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(saveProfitReport({ ledgerId: ledger.id })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(createCurrentProfitReport({ ledgerId: ledger.id, kind: 'pre_deduction' })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(rejectErpCostInboxBatches({ ids: [receipt.id] })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await expect(voidPublishedErpCostBatch({ inboxId: receipt.id, reason: '测试撤回' })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  expect(await db.auditEvents.toArray()).toEqual(audit);
  expect(await db.costApprovals.get(manual.id)).toEqual(manual);
  expect(await db.erpCostInbox.get(receipt.id)).toEqual(original);
});
it('allows background adoption to finish while edits are blocked, and unlocks when cost evidence has settled', async () => {
  task.batches = [{ deliveryId: 'D' }]; task.status = 'cost_complete';
  await db.erpCostInbox.update(receipt.id, { adoptionPending: true });
  await expect(save()).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  await processErpCostInboxAdoption({ inboxId: receipt.id });
  await expect(save()).resolves.toMatchObject({ approvedAmount: 9 });
});
it('keeps paused costs protected and permits explicit stop without changing the prior manual record', async () => {
  task.status = 'paused'; await expect(save()).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  task.status = 'stopped';
  await expect(setErpCostAnomaliesIgnored({ ledgerId: ledger.id })).resolves.toBeDefined();
  expect(await db.costApprovals.get(manual.id)).toEqual(manual);
});
it('saves a previously unread SKU in a finished partial task and protects the manual amount when retry starts', async () => {
  const row = { workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: '合成店', platformSkc: 'UNREAD', platformSku: 'MISSING' };
  await db.salesRows.add({ ...row, amount: 8, quantity: 1 });
  task.status = 'partial'; task.batches = [{ status: 'delivered', deliveryId: 'D' }, { status: 'failed' }];
  await processErpCostInboxAdoption({ inboxId: receipt.id });
  const correction = await saveManualCostOverride({ ...row, unitCost: '0.003', reason: '核对单件采购成本' });
  expect(correction.approvedAmount).toBe(0.003);
  task.status = 'ready'; task.batches[1] = { status: 'pending' };
  await expect(saveManualCostOverride({ ...row, unitCost: 0, reason: '重试已启动' })).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  expect(await db.costApprovals.get(correction.id)).toEqual(correction);
});
it('fails closed on a task transport error and recovers on retry', async () => {
  task.batches = [{ deliveryId: 'D' }]; unavailable = true;
  await expect(save()).rejects.toMatchObject({ code: 'ERP_COST_REVIEW_NOT_READY' });
  unavailable = false; await expect(save()).resolves.toMatchObject({ approvedAmount: 9 });
});
