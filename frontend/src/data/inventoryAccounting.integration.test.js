import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { liveQuery } from 'dexie';
import { db } from './db/clientDatabase';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { getLedgerSnapshot, getProfitPageCostEvidence, saveManualCostOverride, revokeManualCostOverride, updateLedgerWarehouseRate } from './repositories/profitRepository';
import { readAccountingMode, toggleAccountingMode, readHistoricalLowestCosts } from './repositories/inventoryAccountingRepository';
import { readCachedReportProducts } from './repositories/derivedComputationService';
import { previewProfitReport, saveProfitReport, readMonthlyReportState, readProfitReportDownload, previewMonthlySupplement, adoptMonthlySupplement } from './repositories/profitReportRepository';
import { createWorkspaceBackupPayload, restoreWorkspaceBackupPayload } from './repositories/workspaceRepository';
import { calculateWarehouseCostDecision } from '../domain/erpCostResolution';
import { buildReportProducts } from '../domain/profitReports';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { packProfitSearch, unpackProfitSearch } from '../domain/profitPageProjection';
import { readLedgerScopeRows } from './repositories/ledgerReadCache';

it('round-trips the complete searchable purchase numbers in a large cached month', async () => {
  const text = '采购单 / 中文 "订单" 2026-10-11 \n'.repeat(7000);
  const input = { resolutionIndex: { publishedIds: ['B'], resolutions: [] },
    costs: [{ id: 17, purchaseSearchText: text }, { id: 18 }, { id: 19, purchaseSearchText: '尾号' }] };
  const packed = await packProfitSearch(input);
  expect(packed.searchBytes.byteLength).toBeLessThan(text.length);
  expect(await unpackProfitSearch(structuredClone(packed))).toEqual(input);
});

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
it('refreshes cached sales and navigation after a same-count edit and refuses a foreign month switch',async()=>{
  const row=await db.salesRows.where('ledgerId').equals('L').first();
  const before=await getLedgerSnapshot('L',{profitPage:true});
  expect((await readCachedReportProducts({snapshot:before}))[0].revenueExact).toBe('40');
  expect(await readLedgerScopeRows('W','L')).toEqual([{store:'甲',supplierNumber:'SUP'}]);
  await db.salesRows.update(row.id,{amount:43,supplierNumber:'NEW'});
  const after=await getLedgerSnapshot('L',{profitPage:true});
  expect((await readCachedReportProducts({snapshot:after}))[0].revenueExact).toBe('43');
  expect(await readLedgerScopeRows('W','L')).toEqual([{store:'甲',supplierNumber:'NEW'}]);
  await db.salesRows.add({...row,id:undefined,workspaceId:'other',store:'外部'});
  expect(await readLedgerScopeRows('W','L')).toEqual([{store:'甲',supplierNumber:'NEW'}]);
  await expect(readLedgerScopeRows('W','L',{strict:true})).rejects.toThrow('跨工作区');
});
it.each(['weighted', 'historical_lowest'])('opens a %s profit projection and fetches the selected original only for its owning scope', async mode => {
  if (mode === 'historical_lowest') await toggleAccountingMode('W');
  const original = await getLedgerSnapshot('L');
  const page = await getLedgerSnapshot('L', { profitPage: true });
  const fields = rows => rows.map(({ quantityExact, revenueExact, unitCostExact, purchaseCostExact, warehouseCostExact, profitExact, costSourceRecordId }) =>
    ({ quantityExact, revenueExact, unitCostExact, purchaseCostExact, warehouseCostExact, profitExact, costSourceRecordId }));
  expect(fields(await readCachedReportProducts({ snapshot: page }))).toEqual(fields(lines(original)));
  expect(page.ledger.costSummary).toEqual(original.ledger.costSummary);
  const [cost] = page.costs;
  expect(cost.purchaseRecords).toBeUndefined();
  expect(cost.costDecision?.purchaseRecords).toBeUndefined();
  const scope = { workspaceId: 'W', ledgerId: 'L', mode, id: cost.id, batchId: cost.batchId, platformSku: 'SKU', selection: cost };
  const evidence = await getProfitPageCostEvidence(scope);
  expect(evidence.purchaseRecords).toEqual(original.costs[0].purchaseRecords);
  if (mode === 'historical_lowest') {
    expect(evidence.costDecision.selectedRecordIds).toEqual(['later']);
    expect(evidence.purchaseReview.costDecision.selectedRecordIds).toEqual(['c','b','a']);
    expect(evidence.purchaseReview.costDecision.baseline.sampleCount).toBe(4);
  }
  expect(await getProfitPageCostEvidence({ ...scope, platformSku: 'OTHER' })).toBeNull();
  expect(await getProfitPageCostEvidence({ ...scope, workspaceId: 'OTHER' })).toBeNull();
  await db.erpCostBatches.update('B', { status: 'voided' });
  expect(await getProfitPageCostEvidence(scope)).toBeNull();
  expect((await getLedgerSnapshot('L', { profitPage: true })).costs).toEqual([]);
});

it('rejects later or unverified purchases and gives the same manual cost in a projected month', async () => {
  const source = await db.erpCostRows.toCollection().first();
  const future = { ...source.purchaseRecords[0], recordId: 'future', purchaseDate: '2027-01-01' };
  await db.erpCostRows.update(source.id, { purchaseRecords: [...source.purchaseRecords, future], selectedRecordIds: [future.recordId],
    costDecision: { ...source.costDecision, selectedRecords: [future], selectedRecordIds: [future.recordId] } });
  const before = await getLedgerSnapshot('L', { profitPage: true });
  expect((await readCachedReportProducts({ snapshot: before }))[0].unitCostExact).toBeNull();
  await saveManualCostOverride({ledgerId:'L', store:'甲', platformSku:'SKU', unitCost:0, reason:'synthetic test'});
  const after = await getLedgerSnapshot('L', { profitPage: true });
  expect((await readCachedReportProducts({ snapshot: after }))[0]).toMatchObject({unitCostExact:'0', costSource:'manual_override'});
});
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

const manualScope = { ledgerId: 'L', store: '甲', platformSku: 'SKU', reason: '本月实价' };

async function currentPrice(amount, source) {
  const original = lines(await getLedgerSnapshot('L'))[0];
  expect(original).toMatchObject({ unitCostExact: amount, costSource: source });
  const page = await getLedgerSnapshot('L', { profitPage: true });
  expect((await readCachedReportProducts({ snapshot: page }))[0]).toMatchObject({
    unitCostExact: amount, costSource: source, costSourceRecordId: original.costSourceRecordId,
  });
}

it('uses one manual approval through both editors, cost selection, report export and revocation', async () => {
  const first = await saveManualCostOverride({ ...manualScope, unitCost: 0 });
  const frozen = await exportReport();
  await toggleAccountingMode('W');
  const next = await saveManualCostOverride({ ...manualScope, unitCost: 3 });
  expect(next.accountingMode).toBeUndefined();
  expect(await db.costApprovals.get(first.id)).toMatchObject({ status: 'revoked' });
  expect((await db.costApprovals.toArray()).filter(row => row.status === 'approved')).toEqual([next]);
  await currentPrice('2', 'erp');
  expect((await exportReport()).totalsExact.purchaseCostExact).toBe('4');
  await toggleAccountingMode('W');
  await currentPrice('3', 'manual_override');
  expect((await exportReport()).totalsExact.purchaseCostExact).toBe('6');
  await expect(revokeManualCostOverride({ ledgerId: 'L', approvalId: first.id })).rejects.toThrow();
  await revokeManualCostOverride({ ledgerId: 'L', approvalId: next.id });
  await currentPrice('9', 'erp');
  await toggleAccountingMode('W');
  await currentPrice('2', 'erp');
  expect((await readProfitReportDownload(frozen.id)).report.fileBase64).toBe(frozen.fileBase64);
});

it('carries a lone legacy lowest-mode approval into both calculations and honors a linked revocation in its original scope', async () => {
  const saved = await saveManualCostOverride({ ...manualScope, unitCost: 0.0000002 });
  await db.costApprovals.update(saved.id, { accountingMode: 'historical_lowest' });
  await currentPrice('0.0000002', 'manual_override');
  await db.costApprovals.put({ ...saved, id: 'OTHER-STORE-REVOCATION', status: 'revoked', accountingMode: 'historical_lowest',
    sourceApprovalId: saved.id, referenceCost: { ...saved.referenceCost, store: '乙' } });
  await toggleAccountingMode('W');
  await currentPrice('0', 'manual_override');
  await db.costApprovals.update(saved.id, { accountingMode: 'weighted' });
  await db.costApprovals.put({ ...saved, id: 'OLD-REVOCATION', status: 'revoked', accountingMode: 'historical_lowest', sourceApprovalId: saved.id });
  await currentPrice('2', 'erp');
  await toggleAccountingMode('W');
  await currentPrice('9', 'erp');
  expect((await db.costApprovals.get(saved.id)).status).toBe('approved');
});

it('does not choose between legacy conflicting amounts and replaces both after one explicit correction', async () => {
  const normal = await saveManualCostOverride({ ...manualScope, unitCost: 8 });
  const alternate = { ...normal, id: 'OLD-LOW', accountingMode: 'historical_lowest', approvedAmount: 3,
    approvedAt: '2026-12-01T00:00:00Z', referenceCost: { ...normal.referenceCost, unitCost: 3 } };
  await db.costApprovals.add(alternate);
  await currentPrice('9', 'erp');
  for (const approval of (await getLedgerSnapshot('L')).approvals) expect(approval.manualCostConflict.toSorted()).toEqual([3,8]);
  await toggleAccountingMode('W');
  await currentPrice('2', 'erp');
  expect(await db.costApprovals.get(normal.id)).toEqual(normal);
  expect(await db.costApprovals.get(alternate.id)).toEqual(alternate);
  const confirmed = await saveManualCostOverride({ ...manualScope, unitCost: 1 });
  await currentPrice('1', 'manual_override');
  await toggleAccountingMode('W');
  await currentPrice('1', 'manual_override');
  expect((await db.costApprovals.toArray()).filter(row => row.status === 'approved')).toEqual([confirmed]);
  const revocations = (await db.auditEvents.toArray()).filter(row => row.action === 'manual_override_revoked');
  expect(revocations.map(row => row.objectId).sort()).toEqual([normal.id,alternate.id].sort());
});

it('updates ordinary coverage when the only manual cost is saved or revoked in lowest mode', async () => {
  await db.erpCostRows.clear();
  await toggleAccountingMode('W');
  const [first, second] = await Promise.all([7, 8].map(unitCost => saveManualCostOverride({ ...manualScope, unitCost })));
  const active = (await db.costApprovals.toArray()).filter(row => row.status === 'approved');
  expect(active).toHaveLength(1);
  expect([first.id, second.id]).toContain(active[0].id);
  expect((await db.ledgers.get('L')).costSummary).toMatchObject({ manualOverrideCount: 1, missingCount: 0 });
  await toggleAccountingMode('W'); await currentPrice(String(active[0].approvedAmount), 'manual_override');
  await toggleAccountingMode('W');
  await revokeManualCostOverride({ ledgerId: 'L', approvalId: active[0].id });
  expect((await db.ledgers.get('L')).costSummary).toMatchObject({ manualOverrideCount: 0, missingCount: 1 });
  for (let i = 0; i < 2; i++) {
    const page = await getLedgerSnapshot('L', { profitPage: true });
    expect((await readCachedReportProducts({ snapshot: page }))[0].unitCostExact).toBeNull();
    await toggleAccountingMode('W');
  }
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

it('does not use raw prices from a source-wide incomplete receipt', async () => {
  await db.erpCostRows.clear(); await db.erpCostBatches.clear();
  const expectedSkus = [{ platformSku: 'SKU', platformSkc: 'SKC' }];
  await db.erpCostRequests.put({ id: 'INCOMPLETE-R', workspaceId: 'W', ledgerId: 'L', ledgerPeriod: '2026-08', platformSkcs: [{ platformSkc: 'SKC' }], expectedSkus });
  const batch = buildErpCostBatchEnvelope({ workspaceId: 'W', ledgerId: 'L', requestId: 'INCOMPLETE-R', batchId: 'INCOMPLETE-B', platformSkcs: ['SKC'], expectedSkus,
    sourceMeta: { completenessScope: 'source', sourceWarnings: ['QA: history page was not read completely'] },
    warehouseEvidence: [{ warehouseSku: 'WH', evidenceComplete: true, purchaseRecords: [{ recordId: 'PARTIAL', warehouseSku: 'WH', quantity: 2, unitPrice: 1, purchaseDate: '2026-01-01' }], excludedRecords: [], sourceWarnings: [] }],
    results: [{ warehouseSku: 'WH', previewUnitCost: 1, unitCost: 1, selectedRecordIds: ['PARTIAL'], mappings: [{ platformSku: 'SKU', platformSkc: 'SKC' }] }] });
  await db.erpCostInbox.put({ id: 'INCOMPLETE-I', workspaceId: 'W', ledgerId: 'L', requestId: 'INCOMPLETE-R', batchId: 'INCOMPLETE-B', status: 'pending', receivedAt: '2026-11-03T00:00:00Z', envelope: { batch } });
  expect(await readHistoricalLowestCosts('W')).toEqual([]);
});
it('applies the source-wide completeness boundary to previously published evidence too', async () => {
  await db.erpCostBatches.update('B', { sourceContract: { formatVersion: 2, generatedAt: '2026-11-02T00:00:00Z',
    sourceMeta: { completenessScope: 'source', sourceWarnings: ['unread history'] } } });
  expect(await readHistoricalLowestCosts('W')).toEqual([]);
});
it('keeps unrelated complete targets and reads a shared request once for all its receipts', async () => {
  await db.erpCostRows.clear(); await db.erpCostBatches.clear();
  const expectedSkus = [{ platformSku: 'SKU', platformSkc: 'SKC' }, { platformSku: 'OTHER', platformSkc: 'SKC' }];
  await db.erpCostRequests.put({ id: 'SHARED-R', workspaceId: 'W', ledgerId: 'L', ledgerPeriod: '2026-08', platformSkcs: [{ platformSkc: 'SKC' }], expectedSkus });
  for (const [batchId, generatedAt, price] of [['A', '2026-11-02T00:00:00Z', 1], ['B', '2026-11-03T00:00:00Z', 3]]) {
    const batch = buildErpCostBatchEnvelope({ workspaceId: 'W', ledgerId: 'L', requestId: 'SHARED-R', batchId, generatedAt, platformSkcs: ['SKC'], expectedSkus,
      sourceMeta: { completenessScope: 'target', sourceWarnings: [], mappingFailures: [{ platformSku: 'OTHER', message: 'unrelated mapping failure' }] },
      warehouseEvidence: expectedSkus.map((row, i) => ({ warehouseSku: `WH-${i}`, evidenceComplete: true, sourceWarnings: [], excludedRecords: [],
        purchaseRecords: [{ recordId: `${batchId}-${i}`, warehouseSku: `WH-${i}`, quantity: 1, unitPrice: price, purchaseDate: '2026-01-01' }] })),
      results: expectedSkus.map((row, i) => ({ warehouseSku: `WH-${i}`, unitCost: price, selectedRecordIds: [`${batchId}-${i}`], mappings: [row] })) });
    await db.erpCostInbox.put({ id: `I-${batchId}`, workspaceId: 'W', ledgerId: 'L', requestId: 'SHARED-R', batchId, status: 'pending', receivedAt: generatedAt, envelope: { batch } });
  }
  const requestReads = vi.spyOn(db.erpCostRequests, 'get');
  try {
    expect(await readHistoricalLowestCosts('W')).toEqual([expect.objectContaining({ platformSku: 'SKU', unitCost: 3 })]);
    expect(requestReads).toHaveBeenCalledTimes(1);
  } finally { requestReads.mockRestore(); }
});

it('prefers newer captured evidence over a previously adopted row with a later publication time', async () => {
  const expectedSkus = [{ platformSku: 'SKU', platformSkc: 'SKC' }];
  await db.erpCostRows.toCollection().modify({ sourceOrder: [Date.parse('2026-10-01'), Date.parse('2026-11-01'), 'OLDER-SNAPSHOT'], publishedAt: '2026-11-04T12:00:00Z' });
  await db.erpCostRequests.put({ id: 'FRESH-R', workspaceId: 'W', ledgerId: 'L', requestedAt: '2026-11-02T00:00:00Z', ledgerPeriod: '2026-08', platformSkcs: [{ platformSkc: 'SKC' }], expectedSkus });
  const batch = buildErpCostBatchEnvelope({ workspaceId: 'W', ledgerId: 'L', requestId: 'FRESH-R', batchId: 'FRESH-B', generatedAt: '2026-11-03T00:00:00Z', platformSkcs: ['SKC'], expectedSkus,
    warehouseEvidence: [{ warehouseSku: 'WH', evidenceComplete: true, purchaseRecords: [{ recordId: 'FRESH-PRICE', warehouseSku: 'WH', quantity: 2, unitPrice: 3, purchaseDate: '2026-01-01' }], excludedRecords: [], sourceWarnings: [] }],
    results: [{ warehouseSku: 'WH', previewUnitCost: 3, unitCost: 3, selectedRecordIds: ['FRESH-PRICE'], mappings: [{ platformSku: 'SKU', platformSkc: 'SKC' }] }] });
  await db.erpCostInbox.put({ id: 'FRESH-I', workspaceId: 'W', ledgerId: 'L', requestId: 'FRESH-R', batchId: 'FRESH-B', status: 'pending', receivedAt: '2026-11-03T00:01:00Z', envelope: { batch } });
  expect((await readHistoricalLowestCosts('W'))[0].unitCost).toBe(3);
});

it.each(['foreign-batch','foreign-row'])('never substitutes another workspace cost through a shared ledger key: %s', async kind => {
  const original = (await db.erpCostRows.toArray())[0];
  const decision = calculateWarehouseCostDecision({ warehouseSku: 'WH', period: '2026-08', purchaseRecords: [
    { recordId: 'FOREIGN-PRICE', warehouseSku: 'WH', quantity: 2, unitPrice: 7, purchaseDate: '2026-07-01' },
  ] });
  await db.erpCostBatches.put({ id: 'OTHER-WORKSPACE-BATCH', workspaceId: kind === 'foreign-batch' ? 'OTHER' : 'W', ledgerId: 'L', status: 'published' });
  const { id, ...base } = original;
  await db.erpCostRows.add({ ...base, batchId: 'OTHER-WORKSPACE-BATCH', workspaceId: kind === 'foreign-row' ? 'OTHER' : 'W', unitCost: 7,
    purchaseRecords: decision.purchaseRecords, selectedRecordIds: decision.selectedRecordIds, costDecision: decision, publishedAt: '2026-11-04T12:00:00Z' });
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('9');
});

it('retains owned legacy cost rows without workspace fields and keeps explicit voiding effective', async () => {
  await db.erpCostBatches.update('B', { workspaceId: undefined });
  await db.erpCostRows.toCollection().modify({ workspaceId: undefined });
  expect(lines(await getLedgerSnapshot('L'))[0].unitCostExact).toBe('9');
  const { id, ...row } = (await db.erpCostRows.toArray())[0];
  await db.erpCostBatches.put({ id: 'VOIDED', ledgerId: 'L', workspaceId: 'W', status: 'voided' });
  await db.erpCostRows.add({ ...row, batchId: 'VOIDED', workspaceId: 'W', publishedAt: '2026-11-04T12:00:00Z' });
  expect((await getLedgerSnapshot('L')).costs).toEqual([]);
});

it('rejects a manual cost draft after its accounting context changes', async () => {
  await toggleAccountingMode('W');
  const before = await db.costApprovals.toArray();
  await expect(saveManualCostOverride({ ledgerId: 'L', store: '甲', platformSku: 'SKU', unitCost: 3, reason: '旧页面草稿', expectedAccountingMode: 'weighted' })).rejects.toThrow('上下文已变化');
  expect(await db.costApprovals.toArray()).toEqual(before);
});

it('rejects a stale preview across modes and shares the newest adopted deduction',async()=>{
  const source=amount=>({ledgerId:'L',workspaceId:'W',period:'2026-08',kind:'deduction',mode:'manual',rows:[{kind:'deduction',manual:true,store:'甲',signedAmountExact:String(amount)}]});
  const primary=source(5);await adoptMonthlySupplement(primary,await previewMonthlySupplement(primary));
  const stale=await previewMonthlySupplement(source(8));
  await toggleAccountingMode('W');
  await expect(adoptMonthlySupplement(source(8),stale)).rejects.toThrow('上下文已变化');
  const own=source(10);await adoptMonthlySupplement(own,await previewMonthlySupplement(own));
  expect((await readMonthlyReportState('L')).deduction.signedAmountExact).toBe('10');
  const backup=await createWorkspaceBackupPayload();await restoreWorkspaceBackupPayload(backup);
  await toggleAccountingMode('W');
  expect((await readMonthlyReportState('L')).deduction.signedAmountExact).toBe('10');
});

it('uses the latest explicit warehouse-rate edit in a legacy split ledger and shares the next edit', async () => {
  const setting = {key:'inventory-rate:W:L',value:'0.4',updatedAt:'2026-10-02T00:00:00Z'};
  await db.settings.put(setting);
  await db.ledgers.update('L',{updatedAt:'2026-10-10T00:00:00Z'});
  expect((await getLedgerSnapshot('L')).ledger.warehouseRate).toBe(0.4);
  await db.auditEvents.add({workspaceId:'W',objectType:'monthly_ledger',objectId:'L',action:'warehouse_rate_updated',
    after:{warehouseRate:0.7},createdAt:'2026-10-03T00:00:00Z'});
  await toggleAccountingMode('W');
  expect((await getLedgerSnapshot('L')).ledger.warehouseRate).toBe(0.7);
  await updateLedgerWarehouseRate('L',0);
  await toggleAccountingMode('W');
  expect(await db.settings.get(setting.key)).toBeUndefined();
  expect((await getLedgerSnapshot('L')).ledger.warehouseRate).toBe(0);
});

it('uses the most recent ordinary deduction after a prior identical adoption in lowest mode', async () => {
  const source = amount => ({ ledgerId: 'L', workspaceId: 'W', period: '2026-08', kind: 'deduction', mode: 'manual', rows: [{ kind: 'deduction', manual: true, store: '甲', signedAmountExact: String(amount) }] });
  await adoptMonthlySupplement(source(5), await previewMonthlySupplement(source(5)));
  await toggleAccountingMode('W');
  await adoptMonthlySupplement(source(5), await previewMonthlySupplement(source(5)));
  await toggleAccountingMode('W');
  await adoptMonthlySupplement(source(8), await previewMonthlySupplement(source(8)));
  await toggleAccountingMode('W');
  expect((await readMonthlyReportState('L')).deduction.signedAmountExact).toBe('8');
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
  expect((await db.ledgers.get('L')).warehouseRate).toBe(1);
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
  expect((await getLedgerSnapshot('L')).ledger.warehouseRate).toBe(1);
});
