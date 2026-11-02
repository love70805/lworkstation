import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { liveQuery } from 'dexie';
import { db } from './db/clientDatabase';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { getLedgerSnapshot, saveManualCostOverride, revokeManualCostOverride, updateLedgerWarehouseRate } from './repositories/profitRepository';
import { readAccountingMode, toggleAccountingMode, readHistoricalLowestCosts } from './repositories/inventoryAccountingRepository';
import { readCachedReportProducts } from './repositories/derivedComputationService';
import { previewProfitReport, saveProfitReport, readMonthlyReportState, readProfitReportDownload, previewMonthlySupplement, adoptMonthlySupplement } from './repositories/profitReportRepository';
import { createWorkspaceBackupPayload, restoreWorkspaceBackupPayload } from './repositories/workspaceRepository';
import { calculateWarehouseCostDecision } from '../domain/erpCostResolution';
import { buildReportProducts } from '../domain/profitReports';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';

beforeEach(async () => {
  const storage = new Map();
  vi.stubGlobal('localStorage', {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)});
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: 'W', memberId: 'finance', role: 'finance' });
  await db.ledgers.put({ id: 'L', workspaceId: 'W', period: '2026-08', status: 'ready', warehouseRate: 0.7 });
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', store: '甲', platformSku: 'SKU', platformSkc: 'SKC', supplierNumber: 'SUP', quantity: 2, amount: 40, penalty: 0 });
  const decision = calculateWarehouseCostDecision({ warehouseSku: 'WH', period: '2026-08', purchaseRecords: [
    ['old', '2024-01-10', 4], ['a', '2026-06-01', 8], ['b', '2026-07-01', 9], ['c', '2026-08-01', 10], ['later', '2027-01-01', 2],
  ].map(([recordId, purchaseDate, unitPrice]) => ({ recordId, purchaseDate, unitPrice, quantity: 2, warehouseSku: 'WH' })) });
  await db.erpCostBatches.put({ id: 'B', workspaceId: 'W', ledgerId: 'L', status: 'published' });
  await db.erpCostRows.add({ batchId: 'B', workspaceId: 'W', ledgerId: 'L', platformSku: 'SKU', canonicalPlatformSku: 'SKU', platformSkc: 'SKC', warehouseSku: 'WH', unitCost: decision.unitCost, currency: 'CNY', evidenceComplete: true, purchaseRecords: decision.purchaseRecords, selectedRecordIds: decision.selectedRecordIds, costDecision: decision, resolutionStatus: 'resolved', publishedAt: '2026-11-02T12:00:00Z' });
});
afterEach(async () => { await db.delete(); vi.unstubAllGlobals(); });
const lines = snapshot => buildReportProducts({ ledger: snapshot.ledger, salesRows: snapshot.rows, erpCosts: snapshot.costs, approvals: snapshot.approvals });
async function exportReport() { const input = { ledgerId: 'L', kind: 'pre_deduction' }, preview = await previewProfitReport(input); return saveProfitReport(input, { expectedFingerprint: preview.fingerprint }); }

it('reuses both computed results and purchase evidence across mode switches without another ERP read', async () => {
  const ordinary=await getLedgerSnapshot('L'),normalLines=await readCachedReportProducts({snapshot:ordinary});
  const lowest=await readHistoricalLowestCosts('W');
  const evidenceReads=vi.spyOn(db.erpCostInbox,'where');
  try {
    await toggleAccountingMode('W');
    const alternate=await getLedgerSnapshot('L');
    expect(lines(alternate)[0].unitCostExact).toBe('2');
    expect(await readHistoricalLowestCosts('W')).toBe(lowest);
    expect(evidenceReads).not.toHaveBeenCalled();
    await toggleAccountingMode('W');
    const restored=await getLedgerSnapshot('L');
    expect(restored.dataVersion).toBe(ordinary.dataVersion);
    expect(await readCachedReportProducts({snapshot:restored})).toBe(normalLines);
  } finally {evidenceReads.mockRestore();}
});

it('refreshes an already observed report history when an isolated export leaves the ordinary ledger untouched', async () => {
  await toggleAccountingMode('W');
  const states = [], errors = [];
  const subscription = liveQuery(() => readMonthlyReportState('L')).subscribe({ next: state => states.push(state), error: error => errors.push(error) });
  try {
    await vi.waitFor(() => expect(states.at(-1)?.reports).toHaveLength(0));
    const before = await db.ledgers.get('L');
    await exportReport();
    await vi.waitFor(() => expect(states.at(-1)?.reports).toHaveLength(1));
    expect(await db.ledgers.get('L')).toEqual(before);
    expect(errors).toEqual([]);
  } finally { subscription.unsubscribe(); }
});

it('switches every month by workspace while preserving official cost rows and restoring the original weighted result', async () => {
  const original = await db.erpCostRows.toArray();
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('9');
  await toggleAccountingMode('W');
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('2');
  await db.ledgers.put({ id: 'OTHER-MONTH', workspaceId: 'W', period: '2025-01', status: 'cost_pending', warehouseRate: 0.7 });
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'OTHER-MONTH', store: '乙', platformSku: 'SKU', platformSkc: 'SKC', quantity: 1, amount: 20 });
  expect(lines(await getLedgerSnapshot('OTHER-MONTH'))[0].unitCostExact).toBe('2');
  expect(await readAccountingMode('ANOTHER-WORKSPACE')).toBe('weighted');
  expect(await db.erpCostRows.toArray()).toEqual(original);
  await toggleAccountingMode('W');
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('9');
});

it('keeps explicit zero manual costs first in either system', async () => {
  await saveManualCostOverride({ ledgerId: 'L', store: '甲', platformSku: 'SKU', unitCost: 0, reason: '实际零成本' });
  await toggleAccountingMode('W');
  expect(lines(await getLedgerSnapshot('L'))[0]).toMatchObject({ unitCostExact: '0', costSource: 'manual_override' });
});

it('isolates manual edits and revocations without changing the original approvals or ledger', async () => {
  const primary=await saveManualCostOverride({ledgerId:'L',store:'甲',platformSku:'SKU',unitCost:0,reason:'原核算零成本'});
  const original=await db.costApprovals.get(primary.id), ledger=await db.ledgers.get('L');
  await toggleAccountingMode('W');
  const own=await saveManualCostOverride({ledgerId:'L',store:'甲',platformSku:'SKU',unitCost:3,reason:'当前盘点调整'});
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('3');
  expect(await db.costApprovals.get(primary.id)).toEqual(original);expect(await db.ledgers.get('L')).toEqual(ledger);
  await revokeManualCostOverride({ledgerId:'L',approvalId:own.id});
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('2');
  await toggleAccountingMode('W');expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('0');
  expect(await db.costApprovals.get(primary.id)).toEqual(original);
});

it('uses complete unadopted receipts independently of the ordinary monthly cutoff', async () => {
  await db.erpCostRows.clear();await db.erpCostBatches.clear();
  const expectedSkus=[{platformSku:'SKU',platformSkc:'SKC'}];
  await db.erpCostRequests.put({id:'R',workspaceId:'W',ledgerId:'L',ledgerPeriod:'2026-08',platformSkcs:[{platformSkc:'SKC'}],expectedSkus});
  await toggleAccountingMode('W');
  expect((await getLedgerSnapshot('L')).costs).toEqual([]);
  const batch=buildErpCostBatchEnvelope({workspaceId:'W',ledgerId:'L',requestId:'R',batchId:'RAW',platformSkcs:['SKC'],expectedSkus,
    warehouseEvidence:[{warehouseSku:'WH',evidenceComplete:true,purchaseRecords:[{recordId:'AFTER-MONTH',warehouseSku:'WH',quantity:2,unitPrice:3,purchaseDate:'2026-10-01'}],excludedRecords:[],sourceWarnings:[]}],
    results:[{warehouseSku:'WH',previewUnitCost:3,unitCost:3,selectedRecordIds:['AFTER-MONTH'],mappings:[{platformSku:'SKU',platformSkc:'SKC'}]}]});
  await db.erpCostInbox.put({id:'INBOX',workspaceId:'W',ledgerId:'L',requestId:'R',batchId:'RAW',status:'pending',receivedAt:'2026-11-02T12:00:00Z',envelope:{batch}});
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('3');
  expect(await db.erpCostRows.count()).toBe(0);
  await toggleAccountingMode('W');expect((await getLedgerSnapshot('L')).costs).toEqual([]);
});

it('rejects a manual cost draft after its accounting context changes', async () => {
  await toggleAccountingMode('W');
  const before = await db.costApprovals.toArray();
  await expect(saveManualCostOverride({ ledgerId: 'L', store: '甲', platformSku: 'SKU', unitCost: 3, reason: '旧页面草稿', expectedAccountingMode: 'weighted' })).rejects.toThrow('上下文已变化');
  expect(await db.costApprovals.toArray()).toEqual(before);
});

it('keeps source changes and export previews isolated between accounting contexts',async()=>{
  const source=amount=>({ledgerId:'L',workspaceId:'W',period:'2026-08',kind:'deduction',mode:'manual',rows:[{kind:'deduction',manual:true,store:'甲',signedAmountExact:String(amount)}]});
  const primary=source(5);await adoptMonthlySupplement(primary,await previewMonthlySupplement(primary));
  const stale=await previewMonthlySupplement(source(8));
  await toggleAccountingMode('W');
  await expect(adoptMonthlySupplement(source(8),stale)).rejects.toThrow('上下文已变化');
  const own=source(10);await adoptMonthlySupplement(own,await previewMonthlySupplement(own));
  expect((await readMonthlyReportState('L')).deduction.signedAmountExact).toBe('10');
  const backup=await createWorkspaceBackupPayload();await restoreWorkspaceBackupPayload(backup);
  await toggleAccountingMode('W');
  expect((await readMonthlyReportState('L')).deduction.signedAmountExact).toBe('5');
});

it('pins an explicitly adopted source even when it equals the ordinary baseline', async () => {
  const source = amount => ({ ledgerId: 'L', workspaceId: 'W', period: '2026-08', kind: 'deduction', mode: 'manual', rows: [{ kind: 'deduction', manual: true, store: '甲', signedAmountExact: String(amount) }] });
  await adoptMonthlySupplement(source(5), await previewMonthlySupplement(source(5)));
  await toggleAccountingMode('W');
  await adoptMonthlySupplement(source(5), await previewMonthlySupplement(source(5)));
  await toggleAccountingMode('W');
  await adoptMonthlySupplement(source(8), await previewMonthlySupplement(source(8)));
  await toggleAccountingMode('W');
  expect((await readMonthlyReportState('L')).deduction.signedAmountExact).toBe('5');
});

it('exports isolated revisions without finalizing, allows later edits, and preserves previous files through backup and restore', async () => {
  const normal = await exportReport(), original = normal.fileBase64;
  expect((await db.ledgers.get('L')).status).toBe('ready');
  expect(await db.profitLines.count()).toBe(1);
  const primaryLines=await db.profitLines.toArray();
  await toggleAccountingMode('W');
  const low = await exportReport();
  expect(low).toMatchObject({ accountingMode: 'historical_lowest', revision: 1 });
  expect(low.totalsExact.purchaseCostExact).toBe('4');
  expect(await db.profitLines.toArray()).toEqual(primaryLines);
  expect((await readMonthlyReportState('L')).reports.map(report => report.id)).toEqual([low.id]);
  await db.ledgers.update('L', { status: 'finalized' });
  await updateLedgerWarehouseRate('L', 1);
  expect((await db.ledgers.get('L')).warehouseRate).toBe(0.7);
  expect((await getLedgerSnapshot('L')).ledger.warehouseRate).toBe(1);
  const revised = await exportReport();
  expect(revised.revision).toBe(2);
  expect((await readProfitReportDownload(normal.id)).report.fileBase64).toBe(original);
  const backup = await createWorkspaceBackupPayload();
  await db.delete(); await db.open(); await restoreWorkspaceBackupPayload(backup);
  await setActiveMemberContext({ workspaceId: 'W', memberId: 'finance', role: 'finance' });
  expect((await readProfitReportDownload(normal.id)).report.fileBase64).toBe(original);
  expect((await readProfitReportDownload(revised.id)).report.fileSha256).toBe(revised.fileSha256);
  await toggleAccountingMode('W');
  expect((await getLedgerSnapshot('L')).ledger.warehouseRate).toBe(0.7);
});
