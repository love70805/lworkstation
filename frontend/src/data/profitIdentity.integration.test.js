import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, DEFAULT_WORKSPACE_ID, setActiveMemberContext, previewSalesImports, saveSalesImports, saveErpCostRequest, receiveErpCostInboxEnvelope, getLatestLedgerCosts, getLedgerSnapshot, saveManualCostOverride, revokeManualCostOverride } from './database';
import { withVerifiedLedgerCostSummaries } from './repositories/profitRepository';
import { validateSalesRows } from '../lib/salesImport';
import { buildErpCostRequest } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';
import { createSalesSourceCoverage } from '../domain/selectionSalesLabels';
import { previewProfitReport, saveProfitReport, readSavedProfitReport } from './repositories/profitReportRepository';
import { adoptZeroDispatch } from '../testFixtures/reportWorkflow';

const period='2026-08',mapping={platformSku:'SKU',platformSkc:'SKC',quantity:'数量',amount:'金额'};
async function importSales(skcs=['SKC-A'],{store='甲',replace=false}={}) {
  const validated=validateSalesRows(skcs.map(SKC=>({SKU:'SHARED',SKC,数量:'1',金额:'100'})),mapping,{defaultStore:store});
  const id=crypto.randomUUID();
  const item={itemId:id,fileName:`${id}.csv`,fileHash:id,storeName:store,mapping,rows:validated.rows,summary:{sourceRowCount:skcs.length,errorCount:validated.errors.length,ignoredCount:validated.ignored.length},
    ...(replace?{importMode:'replace_store_month',sourceCoverage:createSalesSourceCoverage({period,storeName:store})}:{})};
  const input={period,items:[item]},preview=await previewSalesImports(input);
  return saveSalesImports({...input,preview,overwriteSignature:preview.targetSignature});
}
async function seed() {
  const imported=await importSales(),ledger=await db.ledgers.get(imported.ledgerId);
  const expectedSkus=[{platformSku:'SHARED',platformSkc:'SKC-A'}],requestedAt='2026-10-12T00:00:00Z';
  const request=buildErpCostRequest({id:'IDENTITY-REQUEST',workspaceId:ledger.workspaceId,ledgerId:ledger.id,ledgerPeriod:period,platformSkcs:['SKC-A'],expectedSkus,requestedAt,requestedBy:'finance'});
  await saveErpCostRequest(request);
  const batch=buildErpCostBatchEnvelope({batchId:'IDENTITY-BATCH',workspaceId:ledger.workspaceId,ledgerId:ledger.id,requestId:request.id,platformSkcs:request.platformSkcs,expectedSkus,generatedAt:requestedAt,
    results:[{warehouseSku:'WH',mappings:expectedSkus,previewUnitCost:5}],warehouseEvidence:[{warehouseSku:'WH',evidenceComplete:true,purchaseRecords:[{recordId:'R',purchaseDate:'2026-08-01',quantity:10,unitPrice:5}]}]});
  const receipt=await receiveErpCostInboxEnvelope({envelope:buildErpCostInboxEnvelope({batch,deliveryId:'IDENTITY-DELIVERY',sentAt:requestedAt})});
  expect(receipt.adoptionError).toBeUndefined();expect(receipt.adoption.summary.adoptedCount).toBe(1);
  await adoptZeroDispatch(ledger.id);
  return ledger;
}
const reportInput=ledger=>({ledgerId:ledger.id,kind:'pre_deduction'});
async function saveReport(ledger) {const input=reportInput(ledger),preview=await previewProfitReport(input);return saveProfitReport(input,{expectedFingerprint:preview.fingerprint});}
beforeEach(async()=>{await db.delete();await db.open();await setActiveMemberContext({workspaceId:DEFAULT_WORKSPACE_ID,memberId:'finance',role:'finance'});});
afterEach(async()=>{vi.restoreAllMocks();await db.delete();});

it.each([false,true])('blocks conflicting SKCs after an import (replace=%s) at coverage and report write boundaries, then recovers after correction',async replace=>{
  const ledger=await seed();
  const manual=await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'SHARED',unitCost:0,reason:'归属冲突前的有效零值'});
  const input=reportInput(ledger),preview=await previewProfitReport(input);
  const originalCosts=await getLatestLedgerCosts(ledger.id);
  await importSales(replace?['SKC-A','SKC-B']:['SKC-B'],{replace});
  expect(await db.ledgers.get(ledger.id)).toMatchObject({status:'cost_pending',costSummary:{missingCount:1,identityIssues:[{code:'ledger_sku_skc_conflict'}]}});
  await expect(previewProfitReport(input)).rejects.toThrow('对应多个平台 SKC');
  await expect(saveProfitReport(input,{expectedFingerprint:preview.fingerprint})).rejects.toThrow('对应多个平台 SKC');
  expect(await db.profitReports.count()).toBe(0);
  expect(await getLatestLedgerCosts(ledger.id)).toEqual(originalCosts);
  expect(await db.costApprovals.get(manual.id)).toEqual(manual);
  expect(new Set((await db.salesRows.toArray()).map(row=>row.platformSkc)).size).toBe(2);
  await importSales(['SKC-A'],{replace:true});
  expect((await db.ledgers.get(ledger.id)).status).toBe('ready');
  await revokeManualCostOverride({ledgerId:ledger.id,approvalId:manual.id});
  expect((await saveReport(ledger)).totalsExact.purchaseCostExact).toBe('5');
});

it('blocks a unique changed parent against old ERP evidence while manual zero/tiny costs remain scoped and revocable',async()=>{
  const ledger=await seed();
  await importSales(['SKC-B'],{replace:true});
  expect((await db.ledgers.get(ledger.id)).costSummary).toMatchObject({missingCount:1,identityIssues:[{code:'erp_cost_skc_mismatch',erpPlatformSkc:'SKC-A'}]});
  await expect(previewProfitReport(reportInput(ledger))).rejects.toThrow('不一致');
  const zero=await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'SHARED',unitCost:0,reason:'真实零成本'});
  expect((await previewProfitReport(reportInput(ledger))).report.totalsExact.purchaseCostExact).toBe('0');
  await revokeManualCostOverride({ledgerId:ledger.id,approvalId:zero.id});
  await expect(previewProfitReport(reportInput(ledger))).rejects.toThrow('不一致');
  await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'SHARED',unitCost:0.0000001,reason:'真实微小成本'});
  expect((await saveReport(ledger)).totalsExact.purchaseCostExact).toBe('0.0000001');
  expect((await getLatestLedgerCosts(ledger.id))[0]).toMatchObject({platformSkc:'SKC-A',unitCost:5});
});

it('keeps a shared SKU under the same SKC valid across stores, with independent manual values and frozen reports',async()=>{
  const ledger=await seed();await importSales(['skc-a'],{store:'乙'});
  await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'SHARED',unitCost:0,reason:'店铺零成本'});
  expect((await db.ledgers.get(ledger.id)).costSummary).toMatchObject({expectedCount:2,formalMatchedCount:2,manualOverrideCount:1,missingCount:0});
  const report=await saveReport(ledger),savedLedger=await db.ledgers.get(ledger.id);
  expect(report.totalsExact.purchaseCostExact).toBe('5');
  await expect(importSales(['SKC-B'])).rejects.toThrow('已定稿');
  expect((await getLedgerSnapshot(ledger.id)).ledger).toEqual(savedLedger);
  expect(await withVerifiedLedgerCostSummaries([savedLedger])).toEqual([savedLedger]);
  expect(await readSavedProfitReport(report.id)).toEqual(report);
});

it('projects an old ready summary immediately without writes and reuses financial-revision cache across catalog edits',async()=>{
  const ledger=await seed();await importSales(['SKC-B']);
  const raw={...await db.ledgers.get(ledger.id),status:'ready',costSummary:{missingCount:0,formalMatchedCount:1}};
  await db.ledgers.put(raw);
  const oldAuditCount=await db.auditEvents.count();
  const snapshot=await getLedgerSnapshot(ledger.id);
  expect(snapshot.ledger).toMatchObject({status:'cost_pending',costSummary:{missingCount:1}});
  const reads=vi.spyOn(db.salesRows,'where');
  const projected=await withVerifiedLedgerCostSummaries([raw]);
  expect(projected[0]).toMatchObject({status:'cost_pending',costSummary:{identityIssues:[{code:'ledger_sku_skc_conflict'}]}});
  const count=reads.mock.calls.length;
  expect(await withVerifiedLedgerCostSummaries([raw])).toEqual(projected);
  await db.products.put({id:'catalog-only',workspaceId:ledger.workspaceId,name:'合成目录编辑'});
  expect(await withVerifiedLedgerCostSummaries([raw])).toEqual(projected);
  expect(reads.mock.calls.length).toBe(count);
  expect(await db.ledgers.get(ledger.id)).toEqual(raw);expect(await db.auditEvents.count()).toBe(oldAuditCount);
  const changed=(await db.salesRows.where('ledgerId').equals(ledger.id).toArray()).find(row=>row.platformSkc==='SKC-B');
  const rowCount=await db.salesRows.count();
  await db.salesRows.update(changed.id,{platformSkc:'SKC-A'});
  expect(await db.salesRows.count()).toBe(rowCount);
  expect((await withVerifiedLedgerCostSummaries([raw]))[0]).toMatchObject({status:'ready',costSummary:{missingCount:0,identityIssues:[]}});
  expect(reads.mock.calls.length).toBeGreaterThan(count);
  const summaryOnly={id:'summary-only',workspaceId:ledger.workspaceId,period:'2026-07',status:'ready',costSummary:{missingCount:0}};
  expect(await withVerifiedLedgerCostSummaries([summaryOnly])).toEqual([summaryOnly]);
});

it('includes historical sales scoped by their persisted ledger without rewriting missing workspace IDs',async()=>{
  const ledger=await seed();await importSales(['SKC-B']);
  const raw={...await db.ledgers.get(ledger.id),status:'ready',costSummary:{missingCount:0}};
  await db.ledgers.put(raw);
  await db.salesRows.where('ledgerId').equals(ledger.id).modify(row=>{delete row.workspaceId;});
  const before=await db.salesRows.toArray();
  expect((await withVerifiedLedgerCostSummaries([raw]))[0]).toMatchObject({status:'cost_pending',costSummary:{identityIssues:[{code:'ledger_sku_skc_conflict'}]}});
  expect((await getLedgerSnapshot(ledger.id)).ledger).toMatchObject({status:'cost_pending',costSummary:{identityIssues:[{code:'ledger_sku_skc_conflict'}]}});
  expect(await db.salesRows.toArray()).toEqual(before);
  expect(await db.ledgers.get(ledger.id)).toEqual(raw);
});

it('keeps the existing eligibility of historical sales and ERP rows without stored SKC evidence',async()=>{
  const ledger=await seed();
  await db.salesRows.where('ledgerId').equals(ledger.id).modify(row=>{delete row.platformSkc;});
  await db.erpCostRows.where('ledgerId').equals(ledger.id).modify(row=>{delete row.platformSkc;});
  const raw={...await db.ledgers.get(ledger.id),costSummary:{missingCount:0}};
  await db.ledgers.put(raw);
  const before=await db.salesRows.toArray(),costs=await db.erpCostRows.toArray();
  expect((await withVerifiedLedgerCostSummaries([raw]))[0]).toMatchObject({status:'ready',costSummary:{missingCount:0,identityIssues:[]}});
  expect((await getLedgerSnapshot(ledger.id)).ledger.status).toBe('ready');
  expect(await db.salesRows.toArray()).toEqual(before);
  expect(await db.erpCostRows.toArray()).toEqual(costs);
});

it('rejects foreign ledger or source scope and never infers ownership from an unverified summary',async()=>{
  const ledger=await seed(),raw={...await db.ledgers.get(ledger.id),costSummary:{missingCount:0}};
  await expect(withVerifiedLedgerCostSummaries([{...raw,workspaceId:'foreign'}])).rejects.toThrow('不属于当前工作区');
  const sale=await db.salesRows.where('ledgerId').equals(ledger.id).first();
  await db.salesRows.update(sale.id,{workspaceId:'foreign'});
  expect(await db.salesRows.where('ledgerId').equals(ledger.id).toArray()).toEqual([expect.objectContaining({workspaceId:'foreign'})]);
  await expect(withVerifiedLedgerCostSummaries([raw])).rejects.toThrow('跨工作区来源');
  await db.salesRows.where('ledgerId').equals(ledger.id).modify(row=>{delete row.workspaceId;});
  await db.ledgers.update(ledger.id,{workspaceId:'foreign'});
  await expect(withVerifiedLedgerCostSummaries([raw])).rejects.toThrow('缺少销售行所属工作区');
});
