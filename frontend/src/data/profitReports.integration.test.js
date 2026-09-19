import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach,afterEach,expect,it,vi } from "vitest";
import { db, CLIENT_DATABASE_NAME, CLIENT_DATABASE_V11_STORES } from "./db/clientDatabase";
import { setActiveMemberContext } from "./repositories/selectionRepository";
import { previewMonthlySupplement,adoptMonthlySupplement,previewProfitReport,saveProfitReport,readSavedProfitReport } from "./repositories/profitReportRepository";
import { saveManualCostOverride,reopenLedgerForCostCorrection,deleteMonthlyLedger,finalizeMonthlyLedger } from "./repositories/profitRepository";
import { createWorkspaceBackupPayload,restoreWorkspaceBackupPayload,createWorkspaceCloudSeedPayload } from "./repositories/workspaceRepository";
import { validateReportBackup } from "../domain/profitReportBackup";
import { claimPendingSyncEnvelope } from "./syncOutbox";
import { REPORT_TABLES } from "../domain/profitReports";
const scope={workspaceId:"W",ledgerId:"L",period:"2026-08"};
async function adopt(kind,patch={}){const input={...scope,kind,mode:"manual",...(kind==='dispatch'?{adoptedQuantityExact:'100',rows:[]}:{rows:[{kind,manual:true,store:'甲',signedAmountExact:'0.0009',sourceRow:1},{kind,manual:true,store:'乙',signedAmountExact:'-0.0001',sourceRow:1}]}),...patch};const preview=await previewMonthlySupplement(input);return adoptMonthlySupplement(input,preview);}
async function report(kind='pre_deduction',baseReportId){const input={ledgerId:'L',kind,baseReportId};const preview=await previewProfitReport(input);return saveProfitReport(input,{expectedFingerprint:preview.fingerprint});}
beforeEach(async()=>{
 await db.delete();await db.open();await setActiveMemberContext({workspaceId:'W',memberId:'finance',role:'finance'});
 await db.ledgers.put({id:'L',workspaceId:'W',period:'2026-08',status:'cost_pending',warehouseRate:0.7});
 await db.salesRows.bulkAdd([{...scope,store:'甲',platformSkc:'SKC',platformSku:'SKU1',supplierNumber:'S',attribute:'红',quantity:0.5,quantityExact:'0.5',amount:0.009,amountExact:'0.009',penalty:0},{...scope,store:'乙',platformSkc:'SKC2',platformSku:'SKU2',supplierNumber:'S',attribute:'蓝',quantity:0.5,quantityExact:'0.5',amount:0.009,amountExact:'0.009',penalty:0}]);
 await saveManualCostOverride({ledgerId:'L',store:'甲',platformSku:'SKU1',unitCost:0,reason:'真实零成本'});
 await saveManualCostOverride({ledgerId:'L',store:'乙',platformSku:'SKU2',unitCost:0.0000001,reason:'微小成本'});
});
afterEach(async()=>{vi.restoreAllMocks();await db.delete();});
it('upgrades an actual v14 database without changing any old table row',async()=>{
 const before=await createWorkspaceBackupPayload();
 await db.delete();
 const legacy=new Dexie(CLIENT_DATABASE_NAME);
 legacy.version(14).stores(CLIENT_DATABASE_V11_STORES);
 await legacy.open();
 for(const table of legacy.tables)await table.bulkPut(before.tables[table.name]??[]);
 const originals=Object.fromEntries(await Promise.all(legacy.tables.map(async table=>[table.name,await table.toArray()])));
 legacy.close();await db.open();
 expect(db.verno).toBe(15);
 for(const [name,rows] of Object.entries(originals))expect(await db.table(name).toArray(),name).toEqual(rows);
 for(const name of REPORT_TABLES)expect(await db.table(name).count()).toBe(0);
});
it('restores a v14 backup without the four optional report tables',async()=>{
 const legacy=await createWorkspaceBackupPayload();legacy.databaseVersion=14;
 for(const name of REPORT_TABLES)delete legacy.tables[name];
 await adopt('dispatch');await report();
 await restoreWorkspaceBackupPayload(legacy);
 expect(await db.ledgers.get('L')).toEqual(legacy.tables.ledgers[0]);
 expect(await db.salesRows.toArray()).toEqual(legacy.tables.salesRows);
 for(const name of REPORT_TABLES)expect(await db.table(name).count()).toBe(0);
});
it('rejects damaged parent/child, scope, month and adopted uniqueness before mutating any table',async()=>{
 await adopt('dispatch');const base=await report();await adopt('deduction');await report('financial',base.id);
 const backup=await createWorkspaceBackupPayload();
 const corruptions=[
  tables=>{tables.monthlySupplementRows[0].batchId='missing';},
  tables=>{tables.profitReportLines[0].reportId='missing';},
  tables=>{tables.profitReports.find(row=>row.kind==='financial').baseReportId='missing';},
  tables=>{tables.monthlySupplementRows[0].workspaceId='foreign';},
  tables=>{tables.profitReportLines[0].ledgerId='foreign';},
  tables=>{tables.monthlySupplementBatches[0].period='2026-09';},
  tables=>{tables.profitReports[0].period='2026-09';},
  tables=>{tables.monthlySupplementBatches.push({...tables.monthlySupplementBatches.find(row=>row.kind==='dispatch'),id:'duplicate-adopted'});},
 ];
 for(const corrupt of corruptions){
  const bad=structuredClone(backup);corrupt(bad.tables);
  await expect(restoreWorkspaceBackupPayload(bad)).rejects.toThrow('校验失败');
  expect((await createWorkspaceBackupPayload()).tables).toEqual(backup.tables);
 }
});
it('requires explicit dispatch even via legacy finalize and rejects stale adoption/report previews',async()=>{
 for(const adoptedQuantityExact of [undefined,null,'','   ']){
  const absent={...scope,kind:'dispatch',mode:'manual',rows:[],adoptedQuantityExact};
  await expect(previewMonthlySupplement(absent)).rejects.toThrow('尚未填写');
  await expect(adoptMonthlySupplement(absent,{})).rejects.toThrow('尚未填写');
 }
 expect(await db.monthlySupplementBatches.count()).toBe(0);
 await expect(finalizeMonthlyLedger({ledgerId:'L'})).rejects.toThrow('代发');
 const input={...scope,kind:'dispatch',mode:'manual',adoptedQuantityExact:'0',rows:[]};const p=await previewMonthlySupplement(input);
 await adopt('dispatch');await expect(adoptMonthlySupplement(input,p)).rejects.toThrow('新的采用版本');
 const preview=await previewProfitReport({ledgerId:'L',kind:'pre_deduction'});
 await saveManualCostOverride({ledgerId:'L',store:'甲',platformSku:'SKU1',unitCost:0.0000002,reason:'替换'});
 await expect(saveProfitReport({ledgerId:'L',kind:'pre_deduction'},{expectedFingerprint:preview.fingerprint})).rejects.toThrow('过期');
 expect(await db.profitReports.count()).toBe(0);
});
it('freezes pre-deduction atomically, adds late signed deductions on the same August base, retains revisions',async()=>{
 await adopt('dispatch');const base=await report();
 expect(base.period).toBe('2026-08');expect(base.totalsExact).toMatchObject({revenueExact:'0.018',dispatchAmountExact:'70',preDeductionExact:'69.31799995'});
 expect((await db.ledgers.get('L')).status).toBe('finalized');
 await expect(adopt('dispatch',{adoptedQuantityExact:'1'})).rejects.toThrow('重开');
 await expect(saveManualCostOverride({ledgerId:'L',store:'甲',platformSku:'SKU1',unitCost:1,reason:'不能覆盖'})).rejects.toThrow('定稿');
 await expect(report('financial',base.id)).rejects.toThrow('尚未取得');
 await adopt('deduction');const financial=await report('financial',base.id);
 expect(financial.baseReportId).toBe(base.id);expect(financial.totalsExact.profitExact).toBe('69.31719995');
 expect((await db.profitReportLines.where('reportId').equals(financial.id).toArray()).every(row=>row.lineKind==='deduction')).toBe(true);
 // Later ERP evidence must not participate in a financial report based on a frozen base.
 await db.erpCostBatches.put({id:'LATER',workspaceId:'W',ledgerId:'L',status:'published'});
 await db.erpCostRows.add({batchId:'LATER',ledgerId:'L',platformSku:'SKU1',unitCost:999,publishedAt:new Date().toISOString(),resolutionStatus:'resolved'});
 await adopt('deduction',{rows:[{kind:'deduction',manual:true,store:'甲',signedAmountExact:'0',sourceRow:1},{kind:'deduction',manual:true,store:'乙',signedAmountExact:'0',sourceRow:1}]});
 const second=await report('financial',base.id);expect(second.revision).toBe(2);expect(second.totalsExact.profitExact).toBe(base.totalsExact.preDeductionExact);
 expect((await readSavedProfitReport(base.id)).fileBase64).toBe(base.fileBase64);
 await reopenLedgerForCostCorrection({ledgerId:'L',reason:'显式修改代发'});await adopt('dispatch',{adoptedQuantityExact:'101'});const revised=await report();expect(revised.revision).toBe(2);expect(revised.supersedesReportId).toBe(base.id);
 await reopenLedgerForCostCorrection({ledgerId:'L',reason:'人工确认删除'});await deleteMonthlyLedger('L');
 expect(await db.ledgers.get('L')).toBeUndefined();expect(await db.profitReports.where('ledgerId').equals('L').count()).toBe(0);
});
it('round-trips original report files and rejects corrupt references/files without altering current data',async()=>{
 await adopt('dispatch');const base=await report();await adopt('deduction');await report('financial',base.id);
 const backup=await createWorkspaceBackupPayload();await validateReportBackup(backup.tables);
 const bad=structuredClone(backup);bad.tables.profitReports[0].fileBase64='AAAA';
 await expect(restoreWorkspaceBackupPayload(bad)).rejects.toThrow('校验失败');expect(await db.profitReports.count()).toBe(2);
 await restoreWorkspaceBackupPayload(backup);expect((await readSavedProfitReport(base.id)).fileSha256).toBe(base.fileSha256);
 await expect(createWorkspaceCloudSeedPayload()).rejects.toThrow('本机报告');
 const envelope=await claimPendingSyncEnvelope({workspaceId:'W'});expect(envelope.events.some(event=>event.objectType==='local_profit_report')).toBe(false);
});
it.each(['finalized','locked'])('deletes a %s ledger and all report data without requiring reopening',async status=>{
 await adopt('dispatch');const base=await report();await adopt('deduction');await report('financial',base.id);
 await db.ledgers.update('L',{status});
 await db.ledgers.put({id:'OTHER',workspaceId:'W',period:'2026-09',status:'draft'});
 await deleteMonthlyLedger('L');
 expect(await db.ledgers.get('L')).toBeUndefined();
 expect(await db.ledgers.get('OTHER')).toMatchObject({status:'draft'});
 for(const name of [...REPORT_TABLES,'salesRows','costApprovals','profitLines'])expect(await db.table(name).where('ledgerId').equals('L').count(),name).toBe(0);
 const backup=await createWorkspaceBackupPayload();await validateReportBackup(backup.tables);
});
it('rolls back deletion of reports and costs when the deletion audit cannot be saved',async()=>{
 await adopt('dispatch');await report();
 const before=(await createWorkspaceBackupPayload()).tables;
 vi.spyOn(db.auditEvents,'add').mockRejectedValueOnce(new Error('disk failure'));
 await expect(deleteMonthlyLedger('L')).rejects.toThrow('disk failure');
 expect((await createWorkspaceBackupPayload()).tables).toEqual(before);
});
it('rolls back finalization when any snapshot write fails',async()=>{
 await adopt('dispatch');const input={ledgerId:'L',kind:'pre_deduction'},preview=await previewProfitReport(input);
 vi.spyOn(db.profitReportLines,'bulkAdd').mockRejectedValueOnce(new Error('disk failure'));
 await expect(saveProfitReport(input,{expectedFingerprint:preview.fingerprint})).rejects.toThrow('disk failure');
 expect(await db.profitReports.count()).toBe(0);expect((await db.ledgers.get('L')).status).not.toBe('finalized');
});
it('enforces workspace/store/month boundaries and incomplete deduction coverage',async()=>{
 await expect(adopt('deduction',{rows:[{kind:'deduction',manual:true,store:'外店',signedAmountExact:'0'}]})).rejects.toThrow('不在');
 await expect(adopt('dispatch',{period:'2026-09'})).rejects.toThrow('月份');
 await adopt('dispatch');const base=await report();await adopt('deduction',{rows:[{kind:'deduction',manual:true,store:'甲',signedAmountExact:'0'}]});
 await expect(report('financial',base.id)).rejects.toThrow('部分店铺');
 await setActiveMemberContext({workspaceId:'OTHER',memberId:'foreign',role:'finance'});await expect(readSavedProfitReport(base.id)).rejects.toThrow('权限');
});
it('adopts a complete multi-sheet/file candidate idempotently, rejects duplicates and preserves replaced sources',async()=>{
 const rows=[{kind:'dispatch',fileHash:'file-a',sourceSheet:'页一',sourceRow:2,quantityExact:'10',businessId:'ORDER-A'},
 {kind:'dispatch',fileHash:'file-a',sourceSheet:'页二',sourceRow:2,quantityExact:'20',businessId:'ORDER-B'}];
 const patch={mode:'files',adoptedQuantityExact:'100',rows,sources:[{fileHash:'file-a',sheetName:'页一'},{fileHash:'file-a',sheetName:'页二'}]};
 const first=await adopt('dispatch',patch),repeat=await adopt('dispatch',patch);
 expect(repeat.id).toBe(first.id);expect(await db.monthlySupplementBatches.count()).toBe(1);
 await expect(adopt('dispatch',{...patch,rows:[...rows,rows[0]]})).rejects.toThrow('重复源行');
 await expect(adopt('dispatch',{...patch,rows:[...rows,{...rows[0],fileHash:'conflicting-file'}]})).rejects.toThrow('冲突记录');
 const next=await adopt('dispatch',{...patch,rows:[...rows,{kind:'dispatch',fileHash:'file-b',sourceSheet:'页一',sourceRow:2,quantityExact:'5',businessId:'ORDER-C'}],sources:[...patch.sources,{fileHash:'file-b',sheetName:'页一'}]});
 expect(next.adoptedQuantityExact).toBe('100');expect(next.replacesBatchId).toBe(first.id);
 expect((await db.monthlySupplementBatches.get(first.id)).status).toBe('superseded');
 expect(await db.monthlySupplementRows.where('batchId').equals(first.id).count()).toBe(2);
 expect(await db.monthlySupplementRows.where('batchId').equals(next.id).count()).toBe(3);
 expect(await db.monthlySupplementBatches.where('[ledgerId+kind+status]').equals(['L','dispatch','adopted']).count()).toBe(1);
});
