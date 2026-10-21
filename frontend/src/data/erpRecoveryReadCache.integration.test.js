import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { db } from './db/clientDatabase';
import { clearDerivedMemory, tableRevisionReader, derivedCacheDb, invalidateDerivedCache } from './db/derivedCache';
import { clearErpRecoveryMemory } from './repositories/erpRecoveryReadCache';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { saveErpCostRequest, receiveErpCostInboxEnvelope, recoverErpCostInboxAdoptions, saveManualCostOverride } from './repositories/profitRepository';
import { buildErpCostRequest } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';
import * as contract from '../domain/erpInboxContract';

const workspaceId = 'W-RECOVERY', ledgerId = 'L-RECOVERY';
const recover = () => recoverErpCostInboxAdoptions({ workspaceId });
let receipts;
beforeEach(async () => {
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  clearDerivedMemory(); clearErpRecoveryMemory(); await derivedCacheDb.delete(); await derivedCacheDb.open(); await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId, memberId: 'finance', role: 'finance' });
  await db.ledgers.put({ id: ledgerId, workspaceId, period: '2026-09', status: 'cost_pending', warehouseRate: 0.7 });
  receipts = [];
  for (const group of ['A', 'B']) {
    const expectedSkus = ['NORMAL', 'ANOMALY'].map(kind => ({ platformSku: `${group}-${kind}`, platformSkc: `SKC-${group}`, store: '甲' }));
    await db.salesRows.bulkAdd(expectedSkus.map(row => ({ ...row, workspaceId, ledgerId, quantity: 1, amount: 20 })));
    const request = buildErpCostRequest({ id: `REQ-${group}`, workspaceId, ledgerId, ledgerPeriod: '2026-09',
      platformSkcs: [`SKC-${group}`], expectedSkus, requestedAt: '2026-10-01T00:00:00Z', requestedBy: 'finance' });
    await saveErpCostRequest(request);
    const batch = buildErpCostBatchEnvelope({ batchId: `BATCH-${group}`, workspaceId, ledgerId, requestId: request.id,
      platformSkcs: request.platformSkcs, expectedSkus, generatedAt: '2026-10-01T00:00:00Z',
      results: expectedSkus.map((row, i) => ({ warehouseSku: `WH-${row.platformSku}`, mappings: [row], previewUnitCost: i ? 1 : 5 })),
      warehouseEvidence: expectedSkus.map((row, i) => ({ warehouseSku: `WH-${row.platformSku}`, evidenceComplete: true,
        purchaseRecords: [{ recordId: `RECORD-${row.platformSku}`, purchaseDate: '2026-09-01', quantity: 1, unitPrice: i ? 1 : 5 }] })) });
    receipts.push(await receiveErpCostInboxEnvelope({ envelope: buildErpCostInboxEnvelope({ batch, deliveryId: `DELIVERY-${group}` }) }));
  }
  await recover(); await recover();
});
afterEach(async () => { vi.restoreAllMocks(); clearDerivedMemory(); clearErpRecoveryMemory(); await db.delete(); await derivedCacheDb.delete(); vi.unstubAllGlobals(); });

it('reuses bounded signatures after restart but reads adoption state from current receipts', async () => {
  const validate = vi.spyOn(contract, 'validateErpCostInboxEnvelope');
  expect((await derivedCacheDb.revisions.where('key').startsWith('erp-recovery:').toArray()).length).toBe(1);
  clearErpRecoveryMemory(); clearDerivedMemory();
  db.close(); derivedCacheDb.close(); await db.open(); await derivedCacheDb.open();
  invalidateDerivedCache();
  expect((await recover()).every(result => result.adoption.summary.anomalyCount === 1)).toBe(true);
  expect(validate).not.toHaveBeenCalled();
  const inbox = await db.erpCostInbox.get(receipts[1].id);
  await db.erpCostInbox.update(inbox.id, { adoption: { ...inbox.adoption, summary: { ...inbox.adoption.summary, anomalyCount: 999 } } });
  expect((await recover()).find(result => result.id === inbox.id).adoption.summary.anomalyCount).toBe(1);
  expect(validate).toHaveBeenCalledTimes(1);
});

it('rechecks the edited SKU receipt without revalidating unrelated pending evidence', async () => {
  const validate = vi.spyOn(contract, 'validateErpCostInboxEnvelope');
  await saveManualCostOverride({ ledgerId, store: '甲', platformSku: 'A-NORMAL', unitCost: 0, reason: '真实零值' });
  const result = await recover();
  expect(result.find(row => row.id === receipts[0].id).adoption.summary.manualEffectiveCount).toBe(1);
  expect(validate).toHaveBeenCalledTimes(1);
  expect(validate.mock.calls[0][0].batch.batchId).toBe('BATCH-A');
  validate.mockClear(); await recover();
  expect(validate).toHaveBeenCalledTimes(1); // Verify the one newly persisted state once.
  validate.mockClear(); await recover(); expect(validate).not.toHaveBeenCalled();
});

it('reads an oversized ledger once per sweep without keeping it in the bounded cache', async () => {
  await db.erpCostRows.add({ workspaceId, ledgerId, platformSku: 'UNRELATED', canonicalPlatformSku: 'UNRELATED', diagnosticPadding: 'x'.repeat(9 * 1024 * 1024) });
  const seen = [];
  const reading = row => { seen.push(row.platformSku); return row; };
  db.erpCostRows.hook('reading', reading);
  try {
    await recover();
    expect(seen.filter(sku => sku === 'UNRELATED')).toHaveLength(1);
    seen.length = 0;
    // A new source revision starts a fresh sweep and never reuses stale rows.
    await db.costApprovals.put({ id: 'UNRELATED-APPROVAL', workspaceId, ledgerId, platformSku: 'UNRELATED', approvedAmount: 0 });
    await recover();
    expect(seen.filter(sku => sku === 'UNRELATED')).toHaveLength(1);
  } finally { db.erpCostRows.hook('reading').unsubscribe(reading); }
});

it('invalidates same-count source edits and does not hide forged raw evidence', async () => {
  const inbox = await db.erpCostInbox.get(receipts[1].id);
  inbox.envelope.batch.summary.outputRowCount = 999;
  await db.erpCostInbox.put(inbox);
  const result = await recover();
  expect(result.find(row => row.id === inbox.id).error).toContain('输出行数');
  expect(await db.erpCostRows.count()).toBe(2);
  expect((await recover()).find(row => row.id === inbox.id).error).toContain('输出行数');
});

it('invalidates a same-count SKU parent edit while preserving other receipt results', async () => {
  await db.salesRows.where('platformSku').equals('B-ANOMALY').modify({ platformSkc: 'OTHER-PARENT' });
  const result = await recover();
  expect(result.find(row => row.id === receipts[1].id).adoption.items.find(row => row.platformSku === 'B-ANOMALY').state).toBe('evidence_incomplete');
  expect(await db.erpCostRows.count()).toBe(2);
});

it('invalidates table read caches on abort and still enforces role and finalization changes', async () => {
  const salesClock = tableRevisionReader('salesRows'), before = salesClock();
  await expect(db.transaction('rw', db.salesRows, async () => {
    await db.salesRows.where('platformSku').equals('A-ANOMALY').modify({ platformSkc: 'ROLLED-BACK' });
    throw new Error('synthetic rollback');
  })).rejects.toThrow('synthetic rollback');
  expect(salesClock()).not.toBe(before);
  expect((await recover())[0].adoption.items.find(row => row.platformSku === 'A-ANOMALY').state).toBe('anomaly_pending');
  await db.ledgers.update(ledgerId, { status: 'finalized' });
  expect((await recover())[0].adoption.summary.protectedCount).toBe(1);
  await setActiveMemberContext({ workspaceId, memberId: 'viewer', role: 'viewer' });
  expect((await recover()).every(row => row.error.includes('财务写权限'))).toBe(true);
  await setActiveMemberContext({ workspaceId: 'OTHER', memberId: 'finance', role: 'finance' });
  await expect(recover()).rejects.toThrow('当前工作区');
});
