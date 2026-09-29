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
import { REPORT_FORMULA_VERSION, REPORT_TABLES, REPORT_TEMPLATE_VERSION, canonicalJson, sha256 } from "../domain/profitReports";
import { withCurrentLedgerResults } from './repositories/ledgerOverviewRepository';
import {inspectSupplementSource} from '../domain/monthlySupplements';
import * as XLSX from 'xlsx';
import {readSupplementWorkbook} from '../lib/monthlySupplementImport';
import {prepareReportDownload,base64ToBytes} from '../lib/profitReportWorkbook';
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
it('replaces a legacy shared-order source without changing source identities and exports every persisted association',async()=>{
 const purchase='0016371098004076071';
 const bytes=new TextEncoder().encode(`日期,登记人,店铺,SKC,订单号,数量,备注,1688单号\n8/1,人员,甲,S1,ANCHOR,,多行,${purchase}\n,,,S2,ORDER-A,15,"北转\n备注",\n,,,S3,ORDER-B,10,,\n,,,S4,ZERO,0,,`);
 const [source]=await readSupplementWorkbook({name:'synthetic-shared.csv',arrayBuffer:async()=>bytes.buffer},'dispatch');
 const parsed=inspectSupplementSource(source,{kind:'dispatch',ownerMarker:'人员'});
 expect(parsed.errors).toEqual([]);
 const input={...scope,kind:'dispatch',mode:'files',rows:parsed.rows,sources:[parsed.source]};
 const oldInput={...input,rows:parsed.rows.map(row=>({...row,order1688:'',inheritedIdentifiers:{}})),sources:input.sources.map(s=>({...s,parserVersion:'monthly-supplement@3'}))};
 const legacy=await adoptMonthlySupplement(oldInput,await previewMonthlySupplement(oldInput));
 const preview=await previewMonthlySupplement(input);
 expect(preview.candidate).toMatchObject({adoptedQuantityExact:'25',conflicts:[],rows:[{order1688:purchase},{order1688:purchase},{order1688:purchase}]});
 const corrected=await adoptMonthlySupplement(input,preview);
 expect(corrected).toMatchObject({revision:2,replacesBatchId:legacy.id,rowCount:3,adoptedQuantityExact:'25',parserVersion:'monthly-supplement@4'});
 const oldRows=await db.monthlySupplementRows.where('batchId').equals(legacy.id).toArray();
 expect(oldRows.every(row=>row.order1688==='')).toBe(true);
 expect((await db.monthlySupplementBatches.get(legacy.id)).status).toBe('superseded');
 db.close();await db.open();
 const rows=await db.monthlySupplementRows.where('batchId').equals(corrected.id).toArray();
 expect(rows.map(row=>[row.businessId,row.platformSkc,row.quantityExact,row.order1688,row.sourceRow,row.recordRow])).toEqual([
  ['ORDER-A','S2','15',purchase,3,3],['ORDER-B','S3','10',purchase,5,4],['ZERO','S4','0',purchase,6,5],
 ]);
 expect(rows.every(row=>row.inheritedIdentifiers.order1688===2)).toBe(true);
 const saved=await report();
 expect(saved.totalsExact.dispatchQuantityExact).toBe('25');
 for(const exportedBytes of [base64ToBytes(saved.fileBase64),await prepareReportDownload(saved)]){
  const exported=XLSX.read(exportedBytes,{type:'array'}),sheet=exported.Sheets['代发表'];
  expect(XLSX.utils.sheet_to_json(sheet,{header:1}).slice(1,4).map(row=>row.slice(0,4))).toEqual([
   ['S2','ORDER-A',15,purchase],['S3','ORDER-B',10,purchase],['S4','ZERO',0,purchase],
  ]);
  for(const cell of ['D2','D3','D4'])expect(sheet[cell]).toMatchObject({t:'s',v:purchase});
 }
 await expect(previewMonthlySupplement(input)).rejects.toThrow('重开');
 expect((await readSavedProfitReport(saved.id)).fileBase64).toBe(saved.fileBase64);
});
it('persists skipped CSV record locations outside calculation rows across reopen and backup restore',async()=>{
 const source={fileHash:'SYNTHETIC',fileName:'synthetic.csv',sheetName:'CSV',sourceFormat:'csv',headerRow:1,cells:[['登记人','店铺','订单号','数量'],['人员','甲','EMPTY',''],['','甲','VALID',2],['','甲','ZERO',0]],sourceRows:[1,2,4,5],recordRows:[1,2,3,4]};
 const parsed=inspectSupplementSource(source,{kind:'dispatch',ownerMarker:'人员'});
 const input={...scope,kind:'dispatch',mode:'files',rows:parsed.rows,sources:[parsed.source]};
 const preview=await previewMonthlySupplement(input),batch=await adoptMonthlySupplement(input,preview);
 expect(batch).toMatchObject({parserVersion:'monthly-supplement@4',rowCount:2,adoptedQuantityExact:'2',sources:[{ignored:[{reason:'missing_quantity',sourceRow:2,recordRow:2,businessId:'EMPTY'}]}]});
 expect(await db.monthlySupplementRows.where('batchId').equals(batch.id).toArray()).toMatchObject([{businessId:'VALID',quantityExact:'2',sourceRow:4,recordRow:3},{businessId:'ZERO',quantityExact:'0',sourceRow:5,recordRow:4}]);
 db.close();await db.open();expect((await db.monthlySupplementBatches.get(batch.id)).sources).toEqual(batch.sources);
 const backup=await createWorkspaceBackupPayload();await restoreWorkspaceBackupPayload(backup);
 expect((await db.monthlySupplementBatches.get(batch.id)).sources).toEqual(batch.sources);
 await expect(previewMonthlySupplement({...input,rows:[...input.rows,{...input.rows[0],recordRow:999}]})).rejects.toThrow('重复源行');
 const legacy={...batch,parserVersion:'monthly-supplement@2'};await db.monthlySupplementBatches.put(legacy);
 const saved=await report();expect(saved.totalsExact.dispatchQuantityExact).toBe('2');
 await expect(adoptMonthlySupplement(input,preview)).rejects.toThrow('重开');
 expect((await readSavedProfitReport(saved.id)).fileSha256).toBe(saved.fileSha256);
});
it('overview follows the current base and deduction batch while historical files remain immutable', async () => {
 await adopt('dispatch');
 const base = await report();
 const current = async () => (await withCurrentLedgerResults([await db.ledgers.get('L')]))[0].currentResult;
 expect((await current()).state).toBe('base');
 await adopt('deduction');
 const financial = await report('financial', base.id);
 expect(await current()).toMatchObject({ state: 'financial', profit: Number(financial.displayTotals.profit), report: { id: financial.id } });
 await adopt('deduction', { rows: [{ kind: 'deduction', manual: true, store: '甲', signedAmountExact: '20', sourceRow: 1 }, { kind: 'deduction', manual: true, store: '乙', signedAmountExact: '0', sourceRow: 1 }] });
 expect(await current()).toMatchObject({ state: 'deduction_pending', profit: Number(base.displayTotals.profit), report: { id: base.id } });
 const updated = await report('financial', base.id);
 expect((await current()).report.id).toBe(updated.id);
 await reopenLedgerForCostCorrection({ ledgerId: 'L', reason: '复核基础' });
 expect(await current()).toMatchObject({ state: 'reopened', profit: null });
 expect((await readSavedProfitReport(base.id)).fileBase64).toBe(base.fileBase64);
 expect((await readSavedProfitReport(financial.id)).fileBase64).toBe(financial.fileBase64);
});
it('keeps an archived template file and formula unchanged when generating a new financial report', async () => {
 await adopt('dispatch');const created=await report();
 // These manual rows contain no purchase evidence, so the old v2 export has
 // the same workbook bytes. Seed its saved header as a prior-template report.
 const {payloadHash:_hash,...header}=created;
 const legacy={...header,templateVersion:'profit-zebra@2-purchase-evidence'};
 const lines=await db.profitReportLines.where('reportId').equals(created.id).toArray();
 legacy.payloadHash=await sha256(canonicalJson({report:legacy,lines}));
 await db.profitReports.put(legacy);
 const stored=await readSavedProfitReport(created.id);
 expect(stored).toEqual(legacy);
 expect(stored.formulaVersion).toBe(REPORT_FORMULA_VERSION);
 expect((await withCurrentLedgerResults([await db.ledgers.get('L')]))[0].currentResult.state).toBe('base');
 await adopt('deduction');const financial=await report('financial',legacy.id);
 expect(financial.templateVersion).toBe(REPORT_TEMPLATE_VERSION);
 expect(financial.formulaVersion).toBe(legacy.formulaVersion);
 expect(financial.totalsExact.preDeductionExact).toBe(legacy.totalsExact.preDeductionExact);
 expect(await readSavedProfitReport(legacy.id)).toEqual(legacy);
 expect((await readSavedProfitReport(legacy.id)).fileBase64).toBe(created.fileBase64);
 await validateReportBackup((await createWorkspaceBackupPayload()).tables);
});
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
 await expect(adopt('dispatch',{...patch,rows:[...rows,{...rows[0],fileHash:'conflicting-file'}]})).rejects.toThrow('跨文件相似业务记录');
 const next=await adopt('dispatch',{...patch,rows:[...rows,{kind:'dispatch',fileHash:'file-b',sourceSheet:'页一',sourceRow:2,quantityExact:'5',businessId:'ORDER-C'}],sources:[...patch.sources,{fileHash:'file-b',sheetName:'页一'}]});
 expect(next.adoptedQuantityExact).toBe('35');expect(next.replacesBatchId).toBe(first.id);
 expect((await db.monthlySupplementBatches.get(first.id)).status).toBe('superseded');
 expect(await db.monthlySupplementRows.where('batchId').equals(first.id).count()).toBe(2);
 expect(await db.monthlySupplementRows.where('batchId').equals(next.id).count()).toBe(3);
 expect(await db.monthlySupplementBatches.where('[ledgerId+kind+status]').equals(['L','dispatch','adopted']).count()).toBe(1);
});
it('persists equal allocated rows and requires a signed preview after cross-file review',async()=>{
 const row={kind:'deduction',fileHash:'ONE',sourceSheet:'甲',sourceRow:2,store:'甲',businessId:'ORDER',platformSkc:'SKC',supplierNumber:'CODE',signedAmountExact:'0.899'};
 const input={...scope,kind:'deduction',mode:'files',rows:[row,{...row,sourceRow:3},{...row,fileHash:'TWO'}]};
 const first=await previewMonthlySupplement(input);
 expect(first.candidate.rows).toHaveLength(3);expect(first.candidate.conflicts).toHaveLength(1);
 await expect(adoptMonthlySupplement(input,first)).rejects.toThrow('尚未核对');
 const reviewed={...input,reviewedCrossFileConflicts:true};
 await expect(adoptMonthlySupplement(reviewed,first)).rejects.toThrow();
 const preview=await previewMonthlySupplement(reviewed),batch=await adoptMonthlySupplement(reviewed,preview);
 expect(batch.signedAmountExact).toBe('2.697');
 expect(await db.monthlySupplementRows.where('batchId').equals(batch.id).count()).toBe(3);
 expect((await adoptMonthlySupplement(reviewed,preview)).id).toBe(batch.id);
});
