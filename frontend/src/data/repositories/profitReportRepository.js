import { db } from "../db/clientDatabase";
import { readLedgerSalesRows } from './ledgerReadCache';
import { cachedDerived, sourceRevision, assertSourceRevision } from '../db/derivedCache';
import { makeId } from "../db/utils";
import { getActiveMemberContext } from "./selectionRepository";
import { getLatestLedgerCosts } from "./profitRepository";
import { normalizeSupplementCandidate } from "../../domain/monthlySupplements";
import { calculateFormalLedgerRows, comparableProfitLines } from "../../domain/ledgerProfit";
import { PROFIT_FORMULA_VERSION } from "../../domain/profitCalculations";
import { REPORT_FORMULA_VERSION, REPORT_TEMPLATE_VERSION, buildReportProducts, canonicalJson, displayMoney, exact, legacyReportLine, reportTotals, sha256 } from "../../domain/profitReports";
import { buildProfitReportWorkbook, bytesToBase64 } from "../../lib/profitReportWorkbook";

const tables = () => [db.settings,db.ledgers,db.salesRows,db.erpCostBatches,db.erpCostRows,db.costApprovals,db.profitLines,db.auditEvents,db.monthlySupplementBatches,db.monthlySupplementRows,db.profitReports,db.profitReportLines];
async function scope(ledgerId,write=false) {
  const member=await getActiveMemberContext(),ledger=await db.ledgers.get(ledgerId);
  if(!ledger || ledger.workspaceId!==member.workspaceId || (write&&!['admin','finance'].includes(member.role)))throw new Error("当前成员无此账本的财务权限。");
  return {ledger,member};
}
async function adopted(ledgerId,kind){return (await db.monthlySupplementBatches.where('[ledgerId+kind+status]').equals([ledgerId,kind,'adopted']).toArray())[0]??null;}
async function sourceContext(ledgerId,write=false){
  const {ledger,member}=await scope(ledgerId,write);
  const [salesRows,erpCosts,approvals,dispatch,deduction,reports]=await Promise.all([db.salesRows.where('ledgerId').equals(ledgerId).toArray(),getLatestLedgerCosts(ledgerId),db.costApprovals.where('ledgerId').equals(ledgerId).toArray(),adopted(ledgerId,'dispatch'),adopted(ledgerId,'deduction'),db.profitReports.where('ledgerId').equals(ledgerId).toArray()]);
  if(salesRows.some(row=>row.workspaceId!==ledger.workspaceId))throw new Error("台账存在跨工作区来源记录，请恢复完整备份后再核算。");
  return {ledger,member,salesRows,erpCosts,approvals,dispatch,deduction,reports};
}
const localAudit = (context,action,objectId,after,before=null) => db.auditEvents.add({workspaceId:context.ledger.workspaceId,objectType:'local_profit_report',objectId,action,actorId:context.member.memberId,createdAt:new Date().toISOString(),localOnly:true,syncState:'local_only',before,after});

export async function readMonthlyReportState(ledgerId){
    const revision = sourceRevision();
    const {ledger}=await scope(ledgerId);
    // The source editor needs stores and adopted batches, not ERP cost rows or
    // a complete calculation context. Keep those reads for actual previews.
    const [salesRows,dispatch,deduction,reports]=await Promise.all([readLedgerSalesRows(ledger.workspaceId,ledgerId,{strict:true}),adopted(ledgerId,'dispatch'),adopted(ledgerId,'deduction'),cachedDerived({scope:[ledger.workspaceId,ledgerId],formula:'report-headers@1',revision,compute:async()=>(await db.profitReports.where('ledgerId').equals(ledgerId).toArray()).map(({fileBase64,...report})=>report)})]);
    if(salesRows.some(row=>row.workspaceId!==ledger.workspaceId))throw new Error("台账存在跨工作区来源记录，请恢复完整备份后再核算。");
    const context={ledger,salesRows,dispatch,deduction,reports};
    const batches=await db.monthlySupplementBatches.where('ledgerId').equals(ledgerId).toArray();
    const adoptedRows=await db.monthlySupplementRows.where('ledgerId').equals(ledgerId).filter(row=>[context.dispatch?.id,context.deduction?.id].includes(row.batchId)).toArray();
    assertSourceRevision(revision);
    return {ledger:context.ledger,stores:[...new Set(context.salesRows.map(row=>row.store))],dispatch:context.dispatch,deduction:context.deduction,batches,adoptedRows,reports:context.reports.toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt))};
}
export async function readSavedProfitReport(reportId){
  return db.transaction('r',tables(),async()=>{const report=await db.profitReports.get(reportId);if(!report)throw new Error("报告不存在。");await scope(report.ledgerId);return report;});
}
export async function previewMonthlySupplement(input){
  return db.transaction('r',tables(),async()=>{
    const context=await sourceContext(input.ledgerId,true);
    if(context.ledger.status==='locked'||(input.kind==='dispatch'&&context.ledger.status==='finalized'))throw new Error("已定稿基础不能改代发，请显式重开。");
    const candidate=normalizeSupplementCandidate(input,{ledger:context.ledger,stores:[...new Set(context.salesRows.map(row=>row.store))]});
    return {candidate,expectedBatchId:context[input.kind]?.id??null,inputSignature:canonicalJson(candidate)};
  });
}
export async function adoptMonthlySupplement(input,{expectedBatchId,inputSignature}={}){
  return db.transaction('rw',tables(),async()=>{
    const context=await sourceContext(input.ledgerId,true);
    if(context.ledger.status==='locked'||(input.kind==='dispatch'&&context.ledger.status==='finalized'))throw new Error("已定稿基础不能改代发，请显式重开。");
    const candidate=normalizeSupplementCandidate(input,{ledger:context.ledger,stores:[...new Set(context.salesRows.map(row=>row.store))]});
    const signature=canonicalJson(candidate);
    if(signature!==inputSignature)throw new Error("采用预览已变化，请重新预览。");
    const previous=context[input.kind];
    if(previous?.inputSignature===signature)return previous;
    if((previous?.id??null)!==expectedBatchId)throw new Error("该月份已有新的采用版本，请刷新后核对完整候选集合。");
    const prior=await db.monthlySupplementBatches.where('ledgerId').equals(input.ledgerId).filter(row=>row.kind===input.kind).toArray();
    const id=makeId('SUPPLEMENT'),createdAt=new Date().toISOString();
    const {rows,...header}=candidate;
    const batch={...header,id,workspaceId:context.ledger.workspaceId,ledgerId:context.ledger.id,rowCount:rows.length,revision:Math.max(0,...prior.map(row=>row.revision))+1,status:'adopted',inputSignature:signature,replacesBatchId:previous?.id??null,createdAt,createdBy:context.member.memberId};
    if(previous)await db.monthlySupplementBatches.update(previous.id,{status:'superseded'});
    await db.monthlySupplementBatches.add(batch);
    if(rows.length)await db.monthlySupplementRows.bulkAdd(rows.map((row,index)=>({...row,id:`${id}:${index}`,batchId:id,workspaceId:context.ledger.workspaceId,ledgerId:context.ledger.id})));
    await localAudit(context,'supplement_adopted',id,{kind:input.kind,revision:batch.revision,rowCount:rows.length,replacesBatchId:batch.replacesBatchId});
    return batch;
  });
}

async function reportDraft(input,write=false){
  const context=await sourceContext(input.ledgerId,write);
  const {ledger,reports,dispatch,deduction}=context;
  if(!['pre_deduction','financial'].includes(input.kind))throw new Error("报告类型无效。");
  if(ledger.status==='locked')throw new Error("账本已锁定，不能新生成报告。");
  let products,dispatchRows,base=null;
  if(input.kind==='pre_deduction'){
    if(ledger.status==='finalized')throw new Error("已有定稿基础，请重下载原报告；变更基础需显式重开。");
    if(input.expectedLegacyLines?.some(line=>!line.finalizable))throw new Error("仍有平台 SKU 缺少正式成本，账本不能定稿。");
    if(input.expectedLegacyLines && input.legacyFormulaVersion===PROFIT_FORMULA_VERSION && canonicalJson(comparableProfitLines(input.expectedLegacyLines))!==canonicalJson(comparableProfitLines(calculateFormalLedgerRows(context))))throw new Error("成本或台账已变化，请刷新核对后重新定稿。");
    if(!dispatch)throw new Error("请先采用本月代发件数，真实零件也需明确录入零。");
    products=buildReportProducts(context);
    dispatchRows=await db.monthlySupplementRows.where('batchId').equals(dispatch.id).toArray();
  }else{
    base=reports.find(report=>report.id===input.baseReportId&&report.kind==='pre_deduction');
    if(!base||base.workspaceId!==ledger.workspaceId||base.period!==ledger.period)throw new Error("请选择当前账本的未扣款基础报告。");
    if(!['finalized','locked'].includes(ledger.status)||ledger.currentBaseReportId!==base.id)throw new Error("基础已重开或替换，请使用当前已定稿的基础报告。");
    if(!deduction)throw new Error("扣款尚未取得，请采用扣款来源或明确录入零扣款。");
    const baseLines=await db.profitReportLines.where('reportId').equals(base.id).toArray();
    products=baseLines.filter(row=>row.lineKind==='product');dispatchRows=baseLines.filter(row=>row.lineKind==='dispatch');
    if(!products.length)throw new Error("未扣款基础快照缺失。");
    const stores=[...new Set(products.map(row=>row.store))];
    if(stores.some(store=>!deduction.coveredStores.includes(store)))throw new Error("部分店铺扣款尚未取得；真实零扣款请明确录入零。");
  }
  const deductionRows=input.kind==='financial'?await db.monthlySupplementRows.where('batchId').equals(deduction.id).toArray():[];
  const rate=base?.warehouseRateExact??exact(ledger.warehouseRate??'0.7',{nonnegative:true});
  const quantity=base?.totalsExact.dispatchQuantityExact??dispatch.adoptedQuantityExact;
  const totalsExact=reportTotals(products,quantity,rate,deductionRows);
  const revision=Math.max(0,...reports.filter(report=>report.kind===input.kind).map(report=>report.revision))+1;
  const fingerprint=canonicalJson(input.kind==='financial'?{kind:input.kind,ledgerId:ledger.id,currentBaseReportId:ledger.currentBaseReportId,status:ledger.status,baseId:base.id,baseHash:base.payloadHash,deduction, deductionRows,revision}:{kind:input.kind,ledger,salesRows:context.salesRows,erpCosts:context.erpCosts,approvals:context.approvals,dispatch,dispatchRows,revision});
  const report={workspaceId:ledger.workspaceId,ledgerId:ledger.id,period:ledger.period,kind:input.kind,revision,baseReportId:base?.id??null,supersedesReportId:reports.filter(report=>report.kind===input.kind).sort((a,b)=>b.revision-a.revision)[0]?.id??null,formulaVersion:REPORT_FORMULA_VERSION,templateVersion:REPORT_TEMPLATE_VERSION,warehouseRateExact:rate,adoptedBatchIds:[...(base?base.adoptedBatchIds:[dispatch.id]),...(input.kind==='financial'?[deduction.id]:[])],totalsExact,displayTotals:{profit:displayMoney(totalsExact.profitExact),preDeduction:displayMoney(totalsExact.preDeductionExact)},createdBy:context.member.memberId,reason:ledger.reportReopenReason??''};
  return {context,report,products,dispatchRows,deductionRows,fingerprint};
}
export async function previewProfitReport(input){
  return db.transaction('r',tables(),async()=>{const draft=await reportDraft(input,true);return {report:draft.report,fingerprint:draft.fingerprint};});
}
export async function saveProfitReport(input,{expectedFingerprint}={}){
  const draft=await db.transaction('r',tables(),()=>reportDraft(input,true));
  if(!expectedFingerprint||draft.fingerprint!==expectedFingerprint)throw new Error("报告预览已过期，请重新核对。");
  // Build and hash before the write transaction. Any generation failure leaves
  // neither a finalized ledger nor a half-saved immutable report.
  const workbook=buildProfitReportWorkbook({report:draft.report,products:draft.products,dispatchRows:draft.dispatchRows,deductionRows:draft.deductionRows});
  const sourceFingerprint=await sha256(draft.fingerprint),fileSha256=await sha256(workbook.bytes);
  const createdAt=new Date().toISOString(),id=makeId('PROFIT-REPORT');
  const report={...draft.report,id,createdAt,sourceFingerprint,fileSha256,fileName:workbook.fileName,fileBase64:bytesToBase64(workbook.bytes)};
  const lines=(input.kind==='financial'?draft.deductionRows:[...draft.products,...draft.dispatchRows]).map((line,ordinal)=>{const {id:_id,reportId:_reportId,...data}=line;return {...data,id:`${id}:${ordinal}`,lineKind:line.lineKind??line.kind,ordinal,reportId:id,workspaceId:report.workspaceId,ledgerId:report.ledgerId};});
  report.lineCount=lines.length;
  report.payloadHash=await sha256(canonicalJson({report,lines}));
  return db.transaction('rw',tables(),async()=>{
    const current=await reportDraft(input,true);
    if(current.fingerprint!==draft.fingerprint)throw new Error("保存期间账本或采用来源已变化，请刷新后重试。");
    await db.profitReports.add(report);
    if(lines.length)await db.profitReportLines.bulkAdd(lines);
    if(input.kind==='pre_deduction'){
      const totals=report.totalsExact;
      const profitSummary={revenue:Number(displayMoney(totals.revenueExact)),quantity:Number(totals.quantityExact),purchaseCost:Number(displayMoney(totals.purchaseCostExact)),warehouseCost:Number(displayMoney(totals.warehouseCostExact)),penalty:0,profit:Number(displayMoney(totals.preDeductionExact)),missingSkuCount:0};
      await db.profitLines.where('ledgerId').equals(report.ledgerId).delete();
      await db.profitLines.bulkAdd(draft.products.map(row=>({...legacyReportLine(row),workspaceId:report.workspaceId,ledgerId:report.ledgerId,period:report.period,finalizedAt:createdAt,finalizedBy:report.createdBy,formulaVersion:REPORT_FORMULA_VERSION})));
      await db.ledgers.put({...current.context.ledger,status:'finalized',currentBaseReportId:id,reportWorkflowVersion:1,profitSummary,formulaVersion:REPORT_FORMULA_VERSION,finalizedAt:createdAt,finalizedBy:report.createdBy,updatedAt:createdAt});
    }
    await localAudit(current.context,'report_saved',id,{kind:report.kind,revision:report.revision,baseReportId:report.baseReportId,fileSha256});
    return report;
  });
}
