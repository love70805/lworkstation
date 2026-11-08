import { operatingLedger, accountingMode, accountingApprovals } from '../../domain/inventoryAccounting';
import { accountingCosts, readAccountingMode, readAccountingSupplement, projectAccountingLedger } from './inventoryAccountingRepository';
import Dexie from 'dexie';
import { db } from "../db/clientDatabase";
import { readLedgerSalesRows } from './ledgerReadCache';
import { cachedDerived, sourceRevision, assertSourceRevision, retrySourceRead, observeSourceRevision } from '../db/derivedCache';
import { makeId } from "../db/utils";
import { getActiveMemberContext } from "./selectionRepository";
import { getLatestLedgerCosts } from "./profitRepository";
import { normalizeSupplementCandidate } from "../../domain/monthlySupplements";
import { orderSupplementPresentation } from '../../domain/supplementPresentation';
import { calculateFormalLedgerRows, comparableProfitLines } from "../../domain/ledgerProfit";
import { PROFIT_FORMULA_VERSION } from "../../domain/profitCalculations";
import { REPORT_FORMULA_VERSION, REPORT_TEMPLATE_VERSION, buildReportProducts, canonicalJson, displayMoney, exact, legacyReportLine, reportTotals, sha256 } from "../../domain/profitReports";
import { buildProfitReportWorkbook, bytesToBase64 } from "../../lib/profitReportWorkbook";
import { readLedgerReportHeaders } from './ledgerOverviewRepository';
import { dispatchRegistrantNames } from '../../domain/profitReportPresentation';
import { canonicalReportSourceState } from '../../domain/reportSourceState';
import { runDerivedComputation } from './derivedComputationService';

const tables = () => [db.settings,db.ledgers,db.salesRows,db.erpCostRequests,db.erpCostInbox,db.erpCostBatches,db.erpCostRows,db.costApprovals,db.profitLines,db.auditEvents,db.monthlySupplementBatches,db.monthlySupplementRows,db.profitReports,db.profitReportLines];
async function scope(ledgerId,write=false) {
  const member=await getActiveMemberContext(),ledger=operatingLedger(await db.ledgers.get(ledgerId));
  if(!ledger || ledger.workspaceId!==member.workspaceId || (write&&!['admin','finance'].includes(member.role)))throw new Error("当前成员无此账本的财务权限。");
  return {ledger,member};
}
const adopted=readAccountingSupplement;
async function sourceContext(ledgerId,write=false,forReport=false,{freshnessOnly=false}={}){
  const {ledger,member}=await scope(ledgerId,write);
  const mode=await readAccountingMode(ledger.workspaceId);
  Object.assign(ledger, await projectAccountingLedger(ledger, mode));
  const [salesRows,erpCosts,approvals,dispatch,deduction,reports]=await Promise.all([freshnessOnly?readLedgerSalesRows(ledger.workspaceId,ledgerId,{strict:true,cooperative:true,observe:false}):db.salesRows.where('ledgerId').equals(ledgerId).toArray(),getLatestLedgerCosts(ledgerId),db.costApprovals.where('ledgerId').equals(ledgerId).toArray(),adopted(ledgerId,'dispatch',mode),adopted(ledgerId,'deduction',mode),freshnessOnly?[]:db.profitReports.where('ledgerId').equals(ledgerId).toArray()]);
  if(salesRows.some(row=>row.workspaceId!==ledger.workspaceId))throw new Error("台账存在跨工作区来源记录，请恢复完整备份后再核算。");
  return {ledger:{...ledger,accountingMode:mode},member,salesRows,erpCosts:forReport?await accountingCosts(ledger,erpCosts,mode,salesRows):erpCosts,approvals:accountingApprovals(approvals,mode),dispatch,deduction,reports:reports.filter(report=>accountingMode(report.accountingMode)===mode)};
}
const localAudit = (context,action,objectId,after,before=null) => db.auditEvents.add({workspaceId:context.ledger.workspaceId,objectType:'local_profit_report',objectId,action,actorId:context.member.memberId,createdAt:new Date().toISOString(),localOnly:true,syncState:'local_only',before,after});

export async function readMonthlyReportState(ledgerId){
  return retrySourceRead(() => readMonthlyReportStateOnce(ledgerId));
}
async function readMonthlyReportStateOnce(ledgerId){
    await observeSourceRevision();
    const revision = sourceRevision();
    const {ledger}=await scope(ledgerId);
    ledger.accountingMode=await readAccountingMode(ledger.workspaceId);
    Object.assign(ledger, await projectAccountingLedger(ledger, ledger.accountingMode));
    // The source editor needs stores and adopted batches, not ERP cost rows or
    // a complete calculation context. Keep those reads for actual previews.
    const [salesRows,dispatch,deduction,reports]=await Promise.all([readLedgerSalesRows(ledger.workspaceId,ledgerId,{strict:true}),adopted(ledgerId,'dispatch',ledger.accountingMode),adopted(ledgerId,'deduction',ledger.accountingMode),readLedgerReportHeaders(ledger,revision)]);
    if(salesRows.some(row=>row.workspaceId!==ledger.workspaceId))throw new Error("台账存在跨工作区来源记录，请恢复完整备份后再核算。");
    const context={ledger,salesRows,dispatch,deduction,reports};
    const batches=await db.monthlySupplementBatches.where('ledgerId').equals(ledgerId).toArray();
    const adoptedRows=orderSupplementPresentation(await db.monthlySupplementRows.where('ledgerId').equals(ledgerId).filter(row=>[context.dispatch?.id,context.deduction?.id].includes(row.batchId)).toArray());
    assertSourceRevision(revision);
    return {ledger:context.ledger,stores:[...new Set(context.salesRows.map(row=>row.store))],dispatch:context.dispatch,deduction:context.deduction,batches,adoptedRows,reports:context.reports.filter(report=>accountingMode(report.accountingMode)===ledger.accountingMode).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt))};
}
export async function readSavedProfitReport(reportId){
  return db.transaction('r',tables(),async()=>{const report=await db.profitReports.get(reportId);if(!report)throw new Error("报告不存在。");await scope(report.ledgerId);return report;});
}
export async function readProfitReportDownload(reportId) {
  const current=await readSavedProfitReport(reportId);
  if(current.operationWorkflow===2){
    const lines=(await db.profitReportLines.where('reportId').equals(current.id).toArray()).toSorted((a,b)=>a.ordinal-b.ordinal);
    const {payloadHash,...header}=current;
    if(lines.length!==current.lineCount||lines.some((row,index)=>row.ordinal!==index||row.workspaceId!==current.workspaceId||row.ledgerId!==current.ledgerId)||!payloadHash||await sha256(canonicalJson({report:header,lines}))!==payloadHash)throw new Error('历史报告来源校验失败，请检查备份。');
    return {report:current,dispatchRows:lines.filter(row=>row.lineKind==='dispatch'),deductionRows:lines.filter(row=>row.lineKind==='deduction')};
  }
  const snapshot = await db.transaction('r', tables(), async () => {
    const report = await db.profitReports.get(reportId);
    if (!report) throw new Error('报告不存在。');
    await scope(report.ledgerId);
    const base = report.kind === 'financial' ? await db.profitReports.get(report.baseReportId) : report;
    if (!base || base.kind !== 'pre_deduction' || base.workspaceId !== report.workspaceId || base.ledgerId !== report.ledgerId || base.period !== report.period) throw new Error('报告冻结来源缺失，请检查完整报告备份。');
    const lines = (await db.profitReportLines.where('reportId').equals(base.id).toArray()).toSorted((a,b) => a.ordinal-b.ordinal);
    const deductionLines=report.kind==='financial'?(await db.profitReportLines.where('reportId').equals(report.id).toArray()).toSorted((a,b)=>a.ordinal-b.ordinal):[];
    return { report, base, lines, deductionLines };
  });
  const { report, base, lines } = snapshot, { payloadHash, ...header } = base;
  if (lines.length !== base.lineCount || lines.some((line,i) => line.ordinal !== i || line.workspaceId !== base.workspaceId || line.ledgerId !== base.ledgerId) || !payloadHash || await sha256(canonicalJson({ report:header, lines })) !== payloadHash) throw new Error('报告冻结来源校验失败，未修改原始报告。');
  if(report.kind==='financial'){
    const {payloadHash:reportHash,...reportHeader}=report;
    if(snapshot.deductionLines.length!==report.lineCount||snapshot.deductionLines.some((line,i)=>line.ordinal!==i||line.lineKind!=='deduction'||line.workspaceId!==report.workspaceId||line.ledgerId!==report.ledgerId)||!reportHash||await sha256(canonicalJson({report:reportHeader,lines:snapshot.deductionLines}))!==reportHash)throw new Error('报告冻结扣款校验失败，未修改原始报告。');
  }
  return { report, dispatchRows: lines.filter(line => line.lineKind === 'dispatch'), ...(report.kind==='financial'?{deductionRows:snapshot.deductionLines}:{}) };
}
export async function previewMonthlySupplement(input){
  return db.transaction('r',tables(),async()=>{
    const context=await sourceContext(input.ledgerId,true);
    const candidate=normalizeSupplementCandidate(input,{ledger:context.ledger,stores:[...new Set(context.salesRows.map(row=>row.store))]});
    return {candidate,expectedBatchId:context[input.kind]?.id??null,inputSignature:canonicalJson(candidate),accountingMode:context.ledger.accountingMode};
  });
}
export async function adoptMonthlySupplement(input,{expectedBatchId,inputSignature,accountingMode:expectedMode='weighted'}={}){
  return db.transaction('rw',tables(),async()=>{
    const context=await sourceContext(input.ledgerId,true);
    const candidate=normalizeSupplementCandidate(input,{ledger:context.ledger,stores:[...new Set(context.salesRows.map(row=>row.store))]});
    const signature=canonicalJson(candidate);
    if(expectedMode!==context.ledger.accountingMode)throw new Error('核算上下文已变化，请重新预览。');
    if(candidate.conflicts.length&&!candidate.reviewedCrossFileConflicts)throw new Error('跨文件相似业务记录尚未核对，请检查来源后重新预览。');
    if(signature!==inputSignature)throw new Error("采用预览已变化，请重新预览。");
    const previous=context[input.kind];
    if(previous?.inputSignature===signature&&accountingMode(previous.accountingMode)===context.ledger.accountingMode)return previous;
    if((previous?.id??null)!==expectedBatchId)throw new Error("该月份已有新的采用版本，请刷新后核对完整候选集合。");
    const prior=await db.monthlySupplementBatches.where('ledgerId').equals(input.ledgerId).filter(row=>row.kind===input.kind&&accountingMode(row.accountingMode)===context.ledger.accountingMode).toArray();
    const id=makeId('SUPPLEMENT'),createdAt=new Date().toISOString();
    const {rows,...header}=candidate;
    const batch={...header,id,...(context.ledger.accountingMode==='historical_lowest'?{accountingMode:context.ledger.accountingMode}:{}),workspaceId:context.ledger.workspaceId,ledgerId:context.ledger.id,rowCount:rows.length,revision:Math.max(0,...prior.map(row=>row.revision))+1,status:'adopted',inputSignature:signature,replacesBatchId:previous?.id??null,createdAt,createdBy:context.member.memberId};
    if(previous&&accountingMode(previous.accountingMode)===context.ledger.accountingMode)await db.monthlySupplementBatches.update(previous.id,{status:'superseded'});
    await db.monthlySupplementBatches.add(batch);
    if(rows.length)await db.monthlySupplementRows.bulkAdd(rows.map((row,index)=>({...row,id:`${id}:${index}`,batchId:id,workspaceId:context.ledger.workspaceId,ledgerId:context.ledger.id})));
    await localAudit(context,'supplement_adopted',id,{kind:input.kind,revision:batch.revision,rowCount:rows.length,replacesBatchId:batch.replacesBatchId});
    return batch;
  });
}

// Independent of export revision, ledger status and report projections. Include
// adopted deductions even for a pre-deduction report so newly received sources
// tell the user to export again. Historical reports are never backfilled.
async function reportSourceInput(context) {
  const { ledger, salesRows, erpCosts, approvals, dispatch, deduction } = context;
  const rows = await db.monthlySupplementRows.where('ledgerId').equals(ledger.id)
    .filter(row => [dispatch?.id, deduction?.id].filter(Boolean).includes(row.batchId)).toArray();
  return { ledger, salesRows, erpCosts, approvals, dispatch, deduction, supplementRows: rows };
}
async function reportSourceState(context) {
  return canonicalReportSourceState(await reportSourceInput(context));
}

export async function readProfitReportFreshness(reportId) {
  return retrySourceRead(async () => {
    // Every live consumer observes edits even when it reuses a shared result.
    await observeSourceRevision();
    await Promise.all(tables().map(table => table.count()));
    const revision = sourceRevision();
    const member = await getActiveMemberContext();
    return cachedDerived({ scope: [member.workspaceId, reportId], formula: 'report-freshness@1', revision, persist: false,
      compute: async () => {
        const snapshot = await db.transaction('r', tables(), async () => {
          const report = await db.profitReports.get(reportId);
          if (!report) throw new Error('报告不存在。');
          const { ledger } = await scope(report.ledgerId);
          const mode = await readAccountingMode(ledger.workspaceId);
          if (report.workspaceId !== ledger.workspaceId || accountingMode(report.accountingMode) !== mode) throw new Error('报告不属于当前核算范围。');
          // Old reports need no full source read; leave their bytes untouched.
          if (!report.sourceStateFingerprint) return null;
          const context = await sourceContext(report.ledgerId, false, true, { freshnessOnly: true });
          return { expected: report.sourceStateFingerprint, input: await reportSourceInput(context) };
        });
        if (!snapshot) return { reportId, status: 'unknown', sourceRevision: revision };
        const fingerprint = await runDerivedComputation('report-source-fingerprint', snapshot.input);
        assertSourceRevision(revision);
        return { reportId, status: fingerprint === snapshot.expected ? 'current' : 'changed', sourceRevision: revision };
      },
    });
  });
}

async function reportDraft(input,write=false,source=null){
  const context=source??await sourceContext(input.ledgerId,write,true);
  const {ledger,reports,dispatch,deduction}=context;
  if(!['pre_deduction','financial'].includes(input.kind))throw new Error('报告类型无效。');
  if(input.expectedLegacyLines?.some(line=>!line.finalizable))throw new Error('仍有平台 SKU 缺少正式成本。');
  if(input.expectedLegacyLines&&input.legacyFormulaVersion===PROFIT_FORMULA_VERSION&&canonicalJson(comparableProfitLines(input.expectedLegacyLines))!==canonicalJson(comparableProfitLines(calculateFormalLedgerRows(context))))throw new Error('成本或台账已变化，请刷新后重新导出。');
  const products=buildReportProducts(context);
  const dispatchRows=dispatch?orderSupplementPresentation(await db.monthlySupplementRows.where('batchId').equals(dispatch.id).toArray(),{rememberAdoptedOrdinal:true}):[];
  if(input.kind==='financial'){
    if(!deduction)throw new Error('扣款尚未取得，请登记扣款或明确录入零。');
    if([...new Set(products.map(row=>row.store))].some(store=>!deduction.coveredStores.includes(store)))throw new Error('部分店铺扣款尚未取得，可先导出未扣款报告。');
  }
  const deductionRows=input.kind==='financial'?await db.monthlySupplementRows.where('batchId').equals(deduction.id).toArray():[];
  const rate=exact(ledger.warehouseRate??'0.7',{nonnegative:true});
  const totalsExact=reportTotals(products,dispatch?.adoptedQuantityExact??'0',rate,deductionRows);
  const sameKind=reports.filter(report=>report.kind===input.kind);
  const revision=Math.max(0,...sameKind.map(report=>report.revision))+1;
  const fingerprint=canonicalJson({kind:input.kind,ledger,salesRows:context.salesRows,erpCosts:context.erpCosts,approvals:context.approvals,dispatch,dispatchRows,deduction:input.kind==='financial'?deduction:null,deductionRows,revision});
  const report={workspaceId:ledger.workspaceId,ledgerId:ledger.id,period:ledger.period,kind:input.kind,revision,operationWorkflow:2,accountingMode:ledger.accountingMode,baseReportId:null,supersedesReportId:sameKind.sort((a,b)=>b.revision-a.revision)[0]?.id??null,formulaVersion:REPORT_FORMULA_VERSION,templateVersion:REPORT_TEMPLATE_VERSION,warehouseRateExact:rate,adoptedBatchIds:[...(dispatch?[dispatch.id]:[]),...(input.kind==='financial'?[deduction.id]:[])],dispatchState:dispatch?'recorded':'not_recorded',registrantNames:dispatchRegistrantNames(dispatchRows),totalsExact,displayTotals:{profit:displayMoney(totalsExact.profitExact),preDeduction:displayMoney(totalsExact.preDeductionExact)},createdBy:context.member.memberId};
  const sourceState = await reportSourceState(context);
  return {context,report,products,dispatchRows,deductionRows,fingerprint,sourceState};
}
export async function previewProfitReport(input){
  return db.transaction('r',tables(),async()=>{const draft=await Dexie.waitFor(reportDraft(input,true));return {report:draft.report,fingerprint:draft.fingerprint};});
}
async function buildSavedReport(draft,createdAt){
  const workbook=buildProfitReportWorkbook({report:draft.report,products:draft.products,dispatchRows:draft.dispatchRows,deductionRows:draft.deductionRows});
  const sourceFingerprint=await sha256(draft.fingerprint),fileSha256=await sha256(workbook.bytes);
  const sourceStateFingerprint=await sha256(draft.sourceState);
  const id=makeId('PROFIT-REPORT');
  const report={...draft.report,id,createdAt,sourceFingerprint,sourceStateFingerprint,fileSha256,fileName:workbook.fileName,fileBase64:bytesToBase64(workbook.bytes)};
  const lines=([...draft.products,...draft.dispatchRows,...draft.deductionRows]).map((line,ordinal)=>{const {id:_id,reportId:_reportId,...data}=line;return {...data,id:`${id}:${ordinal}`,lineKind:line.lineKind??line.kind,ordinal,reportId:id,workspaceId:report.workspaceId,ledgerId:report.ledgerId};});
  report.lineCount=lines.length;
  report.payloadHash=await sha256(canonicalJson({report,lines}));
  return {report,lines};
}
export async function saveProfitReport(input,{expectedFingerprint}={}){
  const draft=await db.transaction('r',tables(),async()=>{ return await Dexie.waitFor(reportDraft(input,true)); });
  if(!expectedFingerprint||draft.fingerprint!==expectedFingerprint)throw new Error("报告预览已过期，请重新核对。");
  // Build the file and hashes before writing; commit its source lines and
  // audit together after confirming that the current inputs still match.
  const createdAt=new Date().toISOString();
  const saved=await buildSavedReport(draft,createdAt);
  const {report}=saved;
  return db.transaction('rw',tables(),async()=>{
    const current=await Dexie.waitFor(reportDraft(input,true));
    if(current.fingerprint!==draft.fingerprint)throw new Error("保存期间账本或采用来源已变化，请刷新后重试。");
    for(const item of [saved]){
      await db.profitReports.add(item.report);
      if(item.lines.length)await db.profitReportLines.bulkAdd(item.lines);
      await localAudit(current.context,'report_saved',item.report.id,{kind:item.report.kind,revision:item.report.revision,baseReportId:item.report.baseReportId,fileSha256:item.report.fileSha256});
    }
    if (report.accountingMode === 'weighted') {
      // Compatibility/reference projection of the latest ordinary inventory.
      // The report's own persisted file and lines remain immutable revisions.
      await db.profitLines.where('ledgerId').equals(report.ledgerId).delete();
      await db.profitLines.bulkAdd(draft.products.map(row=>({...legacyReportLine(row),workspaceId:report.workspaceId,ledgerId:report.ledgerId,period:report.period,calculatedAt:createdAt,formulaVersion:REPORT_FORMULA_VERSION})));
      const totals=report.totalsExact;
      await db.ledgers.put({...current.context.ledger,status:'ready',latestInventoryReportId:report.id,
        profitSummary:{revenue:Number(displayMoney(totals.revenueExact)),quantity:Number(totals.quantityExact),purchaseCost:Number(displayMoney(totals.purchaseCostExact)),warehouseCost:Number(displayMoney(totals.warehouseCostExact)),penalty:0,profit:Number(displayMoney(totals.productProfitExact)),missingSkuCount:0},updatedAt:createdAt});
    }
    return report;
  });
}
