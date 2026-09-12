import { canonicalJson, exact, reportTotals, sha256 } from "./profitReports";
import { base64ToBytes } from "../lib/profitReportWorkbook";

export async function validateReportBackup(tables) {
  const fail=()=>{throw new Error("本机报告备份的引用、金额或文件校验失败；未修改现有数据。");};
  const index = rows => {const map=new Map();for(const row of rows??[]){if(!row.id||map.has(row.id))fail();map.set(row.id,row);}return map;};
  const ledgers=index(tables.ledgers),batches=index(tables.monthlySupplementBatches),reports=index(tables.profitReports);
  const supplementRows=[...index(tables.monthlySupplementRows).values()],reportLines=[...index(tables.profitReportLines).values()];
  const sameScope=(row,parent)=>parent&&row.workspaceId===parent.workspaceId&&row.ledgerId===(parent.ledgerId??parent.id);
  const adopted=new Set();
  for(const batch of batches.values()){
    const ledger=ledgers.get(batch.ledgerId);
    if(!sameScope(batch,ledger)||batch.period!==ledger.period||!['dispatch','deduction'].includes(batch.kind)||!['draft','adopted','superseded'].includes(batch.status))fail();
    const rows=supplementRows.filter(row=>row.batchId===batch.id);
    if(rows.length!==batch.rowCount)fail();
    if(batch.kind==='dispatch')exact(batch.adoptedQuantityExact,{nonnegative:true});
    if(batch.status==='adopted') {const key=canonicalJson([batch.workspaceId,batch.ledgerId,batch.kind]);if(adopted.has(key))fail();adopted.add(key);}
    if(batch.replacesBatchId&&!sameScope(batch,batches.get(batch.replacesBatchId)))fail();
  }
  for(const row of supplementRows){const batch=batches.get(row.batchId);if(!sameScope(row,batch)||row.kind!==batch.kind)fail();exact(row.kind==='dispatch'?row.quantityExact:row.signedAmountExact,{nonnegative:row.kind==='dispatch'});}
  for(const row of reportLines){if(!sameScope(row,reports.get(row.reportId))||!['product','dispatch','deduction'].includes(row.lineKind))fail();for(const key of Object.keys(row).filter(key=>key.endsWith('Exact')))exact(row[key]);}
  for(const report of reports.values()){
    const ledger=ledgers.get(report.ledgerId),base=report.baseReportId?reports.get(report.baseReportId):null;
    if(!sameScope(report,ledger)||report.period!==ledger.period||!['pre_deduction','financial'].includes(report.kind))fail();
    if(report.kind==='financial'&&(!sameScope(report,base)||base.kind!=='pre_deduction'||base.period!==report.period))fail();
    if(report.kind==='pre_deduction'&&base)fail();
    const kinds=new Set();
    for(const id of report.adoptedBatchIds??[]){const batch=batches.get(id);if(!sameScope(report,batch)||kinds.has(batch.kind))fail();kinds.add(batch.kind);}
    if(!kinds.has('dispatch')||(report.kind==='financial'&&!kinds.has('deduction')))fail();
    const lines=reportLines.filter(row=>row.reportId===report.id).sort((a,b)=>a.ordinal-b.ordinal);
    if(lines.length!==report.lineCount||lines.some((row,i)=>row.ordinal!==i))fail();
    const baseLines=base?reportLines.filter(row=>row.reportId===base.id).sort((a,b)=>a.ordinal-b.ordinal):lines;
    const products=baseLines.filter(row=>row.lineKind==='product');
    if(!products.length|| (base&&lines.some(row=>row.lineKind!=='deduction')))fail();
    const totals=reportTotals(products,report.totalsExact.dispatchQuantityExact,report.warehouseRateExact,lines.filter(row=>row.lineKind==='deduction'));
    if(canonicalJson(totals)!==canonicalJson(report.totalsExact))fail();
    const {payloadHash,...header}=report;
    if(await sha256(canonicalJson({report:header,lines}))!==payloadHash)fail();
    let bytes;try{bytes=base64ToBytes(report.fileBase64);}catch{fail();}
    if(bytes[0]!==80||bytes[1]!==75||await sha256(bytes)!==report.fileSha256)fail();
  }
  for(const ledger of ledgers.values())if(ledger.currentBaseReportId){const base=reports.get(ledger.currentBaseReportId);if(!base||base.kind!=='pre_deduction'||base.ledgerId!==ledger.id||base.workspaceId!==ledger.workspaceId)fail();}
}
