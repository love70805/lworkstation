import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Modal, Panel, useToast } from "../components/UI";
import { readMonthlyReportState, readSavedProfitReport, previewMonthlySupplement, adoptMonthlySupplement, previewProfitReport, saveProfitReport } from "../data/repositories/profitReportRepository";
import { inspectSupplementSource, suggestSupplementMapping, supplementFields, supplementHeaders, supplementMarkers, suggestSupplementStore, supplementRowIdentity, supplementRowLabel, normalizeSupplementCandidate } from "../domain/monthlySupplements";
import { readSupplementWorkbook } from "../lib/monthlySupplementImport";
import { downloadReportFile } from "../lib/profitReportWorkbook";
import { displayMoney, exactSum } from "../domain/profitReports";
import { currentLedgerResult, reportReadiness } from "../domain/ledgerWorkflow";

const fieldLabels={owner:'登记人',date:'日期',store:'实际店铺',platformSkc:'SKC',supplierNumber:'供方货号',businessId:'业务单号',order1688:'1688单号',quantity:'数量',amount:'采用金额列'};
const ALL_MARKERS='__all_source_records__';
function missingSourceFields(source,kind) {
  return [kind==='dispatch'?'owner':'supplierNumber',kind==='dispatch'?'quantity':'amount'].filter(field=>!(Number(source.mapping[field])>=0));
}
function buildSupplementDraft({state,kind,current,mode,sources,selection,matchMode,retaining,quantity,amounts,zeroStores,reviewed,excludedRows}) {
  const input={kind,ledgerId:state.ledger.id,workspaceId:state.ledger.workspaceId,period:state.ledger.period,mode,rows:[],sources:[],reviewedCrossFileConflicts:reviewed};
  const stats={addedRows:[],retainedCount:0,skipped:0,duplicates:0,sourceCount:0};
  try {
    if(mode==='manual') {
      if(kind==='dispatch') {if(!String(quantity).trim())return {ready:false,stats};input.adoptedQuantityExact=quantity;}
      else {input.rows=state.stores.filter(store=>String(amounts[store]??'').trim()!=='').map(store=>({kind,manual:true,store,signedAmountExact:amounts[store],sourceName:'人工录入',businessId:'',sourceRow:1}));if(!input.rows.length)return {ready:false,stats};}
    } else {
      if(!selection&&!zeroStores.length)return {ready:false,stats};
      const retained=retaining&&current?state.adoptedRows.filter(row=>row.kind===kind):[];
      // Preserve a previously explicit manual aggregate when adding source files.
      if(retaining&&current?.mode==='manual'&&kind==='dispatch'&&!retained.length)retained.push({kind,manual:true,store:'',quantityExact:current.adoptedQuantityExact,sourceName:'此前手工总代发',sourceRow:1});
      input.rows=[...retained];input.sources=retaining&&current?[...(current.sources??[])]:[];stats.retainedCount=retained.length;
      const priorKeys=new Set(retained.map(supplementRowIdentity)),seen=new Set(priorKeys);
      for(const source of sources) {
        const missing=missingSourceFields(source,kind);
        if(missing.length)throw new Error(`${source.fileName} / ${source.sheetName}：未识别${missing.map(field=>fieldLabels[field]).join('、')}列，请展开此来源的高级设置。`);
        const includeAll=selection===ALL_MARKERS;
        const matches=supplementMarkers(source,kind).some(marker=>kind==='deduction'&&matchMode==='contains'?marker.includes(selection.trim()):marker===selection);
        if(!selection||(!includeAll&&!matches))continue;
        stats.sourceCount++;
        const parsed=inspectSupplementSource(source,{kind,headerRow:source.headerRow,mapping:source.mapping,ownerMarker:includeAll?'':selection,includeAll,matchMode,store:source.store,stores:state.stores});
        stats.skipped+=parsed.ignored.filter(row=>row.reason==='missing_quantity').length;
        if(parsed.errors.length)throw new Error(`${source.fileName} / ${source.sheetName}：${parsed.errors.length} 条异常，${parsed.errors.slice(0,10).map(supplementRowLabel).join('；')}${parsed.errors.length>10?'等':''}。${parsed.errors[0].message}`);
        const removed=[];
        for(const row of parsed.rows) {
          const key=supplementRowIdentity(row);
          if(excludedRows.includes(key)){removed.push({sourceRow:row.sourceRow,recordRow:row.recordRow,businessId:row.businessId});continue;}
          if(seen.has(key)){stats.duplicates++;continue;}
          seen.add(key);input.rows.push(row);stats.addedRows.push(row);
        }
        if(removed.length||stats.addedRows.some(row=>row.fileHash===source.fileHash&&row.sourceSheet===source.sheetName)||parsed.ignored.some(row=>row.reason==='missing_quantity'))input.sources.push({...parsed.source,excludedRows:removed});
      }
      if(kind==='deduction')for(const store of zeroStores){
        if(input.rows.some(row=>row.store===store))throw new Error(`${store} 已有来源金额，不能同时标记无扣款。`);
        const row={kind,manual:true,store,signedAmountExact:'0',sourceName:'明确零扣款',sourceRow:1,businessId:''};input.rows.push(row);stats.addedRows.push(row);
      }
      if(!stats.addedRows.length) {
        const error=stats.duplicates?'所选记录已在当前来源中，不会重复计数。':`所选${kind==='dispatch'?'登记人':'货号'}没有有效记录${stats.skipped?`，已跳过 ${stats.skipped} 条无数量记录`:''}。请调整筛选或来源。`;
        return {ready:false,error,stats};
      }
      const normalized=normalizeSupplementCandidate(input,{ledger:state.ledger,stores:state.stores});
      // Previously reviewed overlaps entirely inside retained rows need no new decision.
      if(current?.reviewedCrossFileConflicts&&normalized.conflicts.every(row=>priorKeys.has(supplementRowIdentity(row))&&priorKeys.has(supplementRowIdentity({fileHash:row.previousFileHash,sourceSheet:row.previousSourceSheet,sourceRow:row.previousSourceRow}))))input.reviewedCrossFileConflicts=true;
    }
    return {ready:true,input,stats};
  } catch(failure) {return {ready:false,error:failure.message,stats};}
}

export function SupplementEditor({ state, kind, onClose }) {
  const {notify}=useToast(),current=state[kind];
  const [selection,setSelection]=useState(''),[search,setSearch]=useState(''),[matchMode,setMatchMode]=useState('exact'),[reviewed,setReviewed]=useState(false),[excludedRows,setExcludedRows]=useState([]);
  const [mode,setMode]=useState('files'),[sources,setSources]=useState([]),[retaining,setRetaining]=useState(true),[quantity,setQuantity]=useState(current?.adoptedQuantityExact??''),[amounts,setAmounts]=useState({}),[zeroStores,setZeroStores]=useState([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[previewPending,setPreviewPending]=useState(false),[preview,setPreview]=useState(null),[retry,setRetry]=useState(0);
  const markers=useMemo(()=>[...new Set(sources.flatMap(source=>supplementMarkers(source,kind)))].sort((a,b)=>a.localeCompare(b,'zh-CN')),[sources,kind]);
  const draft=useMemo(()=>buildSupplementDraft({state,kind,current,mode,sources,selection,matchMode,retaining,quantity,amounts,zeroStores,reviewed,excludedRows}),[state,kind,current,mode,sources,selection,matchMode,retaining,quantity,amounts,zeroStores,reviewed,excludedRows]);
  const activePreview=preview?.draft===draft?preview:null;
  const finalCandidate=activePreview?.candidate;
  useEffect(()=>{
    let cancelled=false;
    setPreview(null);setError('');
    if(!draft.ready){setPreviewPending(false);return ()=>{cancelled=true;};}
    setPreviewPending(true);
    previewMonthlySupplement(draft.input).then(check=>{if(!cancelled)setPreview({draft,input:draft.input,...check});}).catch(failure=>{if(!cancelled)setError(failure.message);}).finally(()=>{if(!cancelled)setPreviewPending(false);});
    return ()=>{cancelled=true;};
  },[draft,retry]);
  function invalidate(){setPreview(null);setError('');setReviewed(false);setExcludedRows([]);}
  function patch(index,value){invalidate();setSources(items=>items.map((item,i)=>i===index?{...item,...value}:item));}
  async function upload(files){
    if(!files?.length)return;
    setBusy(true);setError('');setNotice('');
    try {
      const loaded=(await Promise.all([...files].map(file=>readSupplementWorkbook(file,kind)))).flat();
      const keys=new Set(sources.map(item=>`${item.fileHash}/${item.sheetName}`));
      const added=loaded.filter(source=>{const key=`${source.fileHash}/${source.sheetName}`;if(keys.has(key))return false;keys.add(key);return true;}).map(source=>({...source,headerRow:source.headerRow??1,mapping:suggestSupplementMapping(supplementHeaders(source,source.headerRow??1)),store:suggestSupplementStore(source.sheetName,state.stores)}));
      if(added.length){invalidate();setSources(previous=>[...previous,...added]);}
      if(added.length<loaded.length)setNotice('重复文件/工作表已跳过，不会重复计数。');
      if(!loaded.length)setNotice('文件没有有效工作表，请检查来源。');
    }catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function adopt(){
    if(!activePreview||busy||previewPending)return;
    setBusy(true);setError('');
    try{await adoptMonthlySupplement(activePreview.input,activePreview);notify(`${state.ledger.period} ${kind==='dispatch'?'代发':'扣款'}已导入${draft.stats.skipped?`，已跳过 ${draft.stats.skipped} 条无数量记录`:''}`);onClose();}
    catch(failure){setError(failure.message);setPreview(null);}finally{setBusy(false);}
  }
  const label=kind==='dispatch'?'登记人':'供方货号 / 标记',unit=kind==='dispatch'?'件':'元';
  const oldTotal=current?.adoptedQuantityExact??current?.signedAmountExact;
  const finalTotal=finalCandidate?.adoptedQuantityExact??finalCandidate?.signedAmountExact;
  const blocked=Boolean(finalCandidate?.conflicts?.length&&!finalCandidate.reviewedCrossFileConflicts);
  const priorKeys=new Set(state.adoptedRows.filter(row=>row.kind===kind).map(supplementRowIdentity));
  const visibleConflicts=(finalCandidate?.conflicts??[]).filter(row=>!(current?.reviewedCrossFileConflicts&&retaining&&priorKeys.has(supplementRowIdentity(row))&&priorKeys.has(supplementRowIdentity({fileHash:row.previousFileHash,sourceSheet:row.previousSourceSheet,sourceRow:row.previousSourceRow}))));
  return <Modal open size="large" className="report-import" title={`${state.ledger.period} · ${kind==='dispatch'?'代发':'扣款'}来源`} description="本工作区整月全部店铺，收到或录入日期不改变账本月份。" onClose={()=>!busy&&onClose()} footer={<>
    {current&&finalCandidate?<p className="report-replacement">整月 {oldTotal} → {finalTotal} {unit}；导入后更新 r{current.revision}，旧版本保留。{mode==='files'&&retaining?'已有来源保留。':'全部已有来源将被本次内容替换。'}</p>:null}
    <Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" loading={busy} disabled={busy||previewPending||!activePreview||blocked} onClick={adopt}>{current?'导入并更新本月来源':'导入本月来源'}</Button>
  </>}>
    <label className="report-mode">来源方式<select disabled={busy} value={mode} onChange={event=>{invalidate();setMode(event.target.value);}}><option value="files">导入来源表</option><option value="manual">手工录入{kind==='dispatch'?'总代发件数':'各店扣款'}</option></select></label>
    {mode==='files'?<>
      <label className="report-upload">选择文件<input type="file" multiple accept={kind==='dispatch'?'.xlsx,.csv':'.xlsx'} disabled={busy} onChange={event=>{void upload(event.target.files);event.target.value='';}} /></label>
      {sources.length?<div className="report-selection">
        {kind==='dispatch'?<><label>搜索登记人<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索源表姓名" disabled={busy}/></label><label>登记人<select aria-label="登记人" value={selection} disabled={busy} onChange={event=>{invalidate();setSelection(event.target.value);}}><option value="">请选择登记人</option><option value={ALL_MARKERS}>全部登记人（所有有效记录）</option>{markers.filter(marker=>marker===selection||marker.includes(search.trim())).map(marker=><option key={marker}>{marker}</option>)}</select></label></>:<><label>{label}<input aria-label="供方货号或标记" list="supplier-markers" value={selection===ALL_MARKERS?'':selection} disabled={busy} onChange={event=>{invalidate();setSelection(event.target.value);}}/><datalist id="supplier-markers">{markers.map(marker=><option key={marker} value={marker}/>)}</datalist></label><label>货号匹配方式<select aria-label="货号匹配方式" value={matchMode} disabled={busy} onChange={event=>{invalidate();setMatchMode(event.target.value);}}><option value="exact">货号完整匹配</option><option value="contains">包含此标记</option></select></label><Button disabled={busy||selection===ALL_MARKERS} onClick={()=>{invalidate();setSelection(ALL_MARKERS);}}>采用全部货号</Button></>}
        <p>{selection?`当前筛选：${selection===ALL_MARKERS?'全部记录':selection} · ${draft.stats.sourceCount} 个来源`:'先选择筛选范围，预览会自动更新'}。{kind==='dispatch'?'不发、退款等仅作备注，按有数量记录计入。':'保留源金额正负，分摊金额优先。'}</p>
      </div>:null}
      {current?<label className="report-mode">已有来源处理<select aria-label="已有来源处理" disabled={busy} value={retaining?'append':'replace'} onChange={event=>{invalidate();setRetaining(event.target.value==='append');}}><option value="append">保留已有来源，加入本次筛选</option><option value="replace">以本次筛选替换全部已有来源</option></select></label>:null}
      <div className="report-source-list">{sources.map((source,index)=>{
        const missing=missingSourceFields(source,kind);
        return <div className="report-source" key={`${source.fileHash}/${source.sheetName}`}><div className="report-source-heading"><strong>{source.fileName} / {source.sheetName}</strong><Button disabled={busy} onClick={()=>{invalidate();setSources(items=>items.filter((_,i)=>i!==index));}}>移除此来源</Button></div>
          <p>{source.cells.length} 条表格记录 · {missing.length?`未识别${missing.map(field=>fieldLabels[field]).join('、')}列，请展开高级设置修复。`:`已识别${kind==='dispatch'?'登记人、数量':'供方货号、金额'}${kind==='deduction'?`（${supplementHeaders(source,source.headerRow)[Number(source.mapping.amount)]}）`:''}`}</p>
          {kind==='deduction'?<label>无店铺列时使用的实际店铺<select disabled={busy} value={source.store} onChange={event=>patch(index,{store:event.target.value})}><option value="">请选择实际店铺</option>{state.stores.map(store=><option key={store}>{store}</option>)}</select></label>:null}
          <details><summary>高级设置 · 表头与字段映射</summary><label>表头行（{source.sourceFormat==='csv'?'CSV 物理行':'工作表行'}）<input disabled={busy} type="number" min="1" max={source.sourceRows?.at(-1)??source.cells.length} value={source.headerRow} onChange={event=>patch(index,{headerRow:Number(event.target.value),mapping:suggestSupplementMapping(supplementHeaders(source,Number(event.target.value)))})}/></label>
            <div className="report-mapping">{Object.keys(supplementFields).filter(field=>kind==='dispatch'?field!=='amount':field!=='quantity').map(field=><label key={field}>{fieldLabels[field]}<select disabled={busy} value={source.mapping[field]} onChange={event=>patch(index,{mapping:{...source.mapping,[field]:event.target.value}})}><option value="-1">未映射</option>{supplementHeaders(source,source.headerRow).map((header,column)=><option key={column} value={column}>{column+1} · {String(header)}</option>)}</select></label>)}</div>
          </details>
        </div>;
      })}</div>
    </>:kind==='dispatch'?<label className="form-field">采用总代发件数<input className="text-input" type="number" min="0" step="1" disabled={busy} value={quantity} onChange={event=>{invalidate();setQuantity(event.target.value);}}/></label>:state.stores.map(store=><label className="form-field" key={store}>{store} 扣款金额（保留正负，真实零填 0，未取得留空）<input className="text-input" type="number" step="any" disabled={busy} value={amounts[store]??''} onChange={event=>{invalidate();setAmounts(previous=>({...previous,[store]:event.target.value}));}}/></label>)}
    {kind==='deduction'&&mode==='files'?<details><summary>没有扣款来源的店铺：明确真实零值</summary>{state.stores.map(store=><label key={store}><input type="checkbox" disabled={busy} checked={zeroStores.includes(store)} onChange={event=>{invalidate();setZeroStores(previous=>event.target.checked?[...previous,store]:previous.filter(name=>name!==store));}}/>{store} 本月扣款为 0</label>)}</details>:null}
    {notice?<p role="status">{notice}</p>:null}
    {draft.stats.skipped?<p role="status">已跳过 {draft.stats.skipped} 条无数量记录，来源位置已保留。</p>:null}
    {draft.stats.duplicates?<p>已有 {draft.stats.duplicates} 条重复源记录已跳过。</p>:null}
    {previewPending?<p role="status">正在更新预览…</p>:null}
    {finalCandidate?<Panel className="report-adoption-preview"><strong>{state.ledger.period} 整月导入预览</strong>
      {mode==='files'?<p>本次筛选新增 {draft.stats.addedRows.length} 行 / {exactSum(draft.stats.addedRows,kind==='dispatch'?'quantityExact':'signedAmountExact')} {unit}；保留已有 {draft.stats.retainedCount} 行{current&&retaining?`（原采用 ${oldTotal} ${unit}）`:''}。</p>:null}
      <p className="report-final-total">最终整月：{kind==='dispatch'?`采用 ${finalTotal} 件`:`有符号扣款合计 ${finalTotal} 元`} · 共 {finalCandidate.rows.length} 行</p>
      {finalCandidate.missingStores.length?<p>尚未取得扣款：{finalCandidate.missingStores.join('、')}。</p>:null}
      <div className="report-preview-rows"><table><thead><tr><th>来源 / 位置</th><th>店铺 / {label}</th><th>单号 / SKC</th><th>{kind==='dispatch'?'件数':'金额'}</th><th>来源说明 / 备注</th></tr></thead><tbody>{finalCandidate.rows.slice(0,100).map((row,index)=><tr key={index}><td>{row.sourceName} / {row.sourceSheet}<br/>{supplementRowLabel(row)}</td><td>{row.store} / {row.ownerMarker}</td><td>{row.businessId} / {row.platformSkc}</td><td>{row.quantityExact??row.signedAmountExact}</td><td>{row.inheritedFrom?`登记人沿用${row.sourceFormat==='csv'?'CSV 物理':'来源'}第 ${row.inheritedFrom} 行；`:''}{row.amountHeader}{(row.remarks??[]).map(note=>`${note.header||`第${note.column}列`}：${note.value}`).join('；')}</td></tr>)}</tbody></table></div>
      {finalCandidate.rows.length>100?<p>预览前 100 行，导入包含全部 {finalCandidate.rows.length} 行。</p>:null}
    </Panel>:null}
    {visibleConflicts.length?<Panel className="report-conflicts"><strong>跨文件相似记录 · {visibleConflicts.length} 条</strong><p>核对后可排除重复行，或保留合法分摊；预览自动更新。</p><ul>{visibleConflicts.map((row,index)=><li key={index}><span>{row.previousSourceName} / {supplementRowLabel({sourceSheet:row.previousSourceSheet,sourceRow:row.previousSourceRow,recordRow:row.previousRecordRow,sourceFormat:row.previousSourceFormat,businessId:row.businessId})} 与 {row.sourceName} / {supplementRowLabel(row)} · {row.platformSkc}</span><Button disabled={busy} onClick={()=>{setPreview(null);setReviewed(false);setExcludedRows(previous=>[...previous,supplementRowIdentity(row)]);}}>排除此条</Button></li>)}</ul>{blocked?<Button disabled={busy} onClick={()=>{setPreview(null);setReviewed(true);}}>保留全部记录</Button>:<p role="status">已核对并保留全部记录。</p>}</Panel>:null}
    {draft.error||error?<p role="alert">{draft.error||error}</p>:null}
    {error&&draft.ready?<Button disabled={busy||previewPending} onClick={()=>setRetry(value=>value+1)}>重新读取预览</Button>:null}
  </Modal>;
}

export default function MonthlyReportManager({ ledgerId, missingCostCount, onOpenCosts }) {
  const {notify}=useToast();
  const [retry, setRetry] = useState(0);
  const state=useLiveQuery(async()=>{try{return {ledgerId,data:await readMonthlyReportState(ledgerId)};}catch(error){return {ledgerId,error:error.message};}},[ledgerId,retry]);
  const [editor,setEditor]=useState(null),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!state||state.ledgerId!==ledgerId)return <Panel>正在读取本月报告...</Panel>;
  if(state.error)return <Panel><p role="alert">{state.error}</p><Button onClick={() => setRetry(value => value + 1)}>重新读取报告</Button></Panel>;
  const data=state.data,locked=['finalized','locked'].includes(data.ledger.status);
  const missing = locked ? 0 : missingCostCount === undefined ? data.ledger.costSummary?.missingCount : missingCostCount;
  const readiness = reportReadiness({ ...data, missingCount: missing });
  const current = currentLedgerResult(data.ledger, data.reports, data.deduction);
  async function download(reportId) { try { await downloadReportFile(await readSavedProfitReport(reportId)); } catch (failure) { setError(failure.message); } }
  async function prepare(kind){setBusy(true);setError('');try{const input={ledgerId,kind,baseReportId:kind==='financial'?data.ledger.currentBaseReportId:null};setPreview({input,...await previewProfitReport(input)});}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function save(){setBusy(true);setError('');try{const report=await saveProfitReport(preview.input,{expectedFingerprint:preview.fingerprint});await downloadReportFile(report);setPreview(null);notify('报告已保存并开始下载，可从历史报告重下载。');}catch(e){setError(e.message);setPreview(null);}finally{setBusy(false);}}
  return <Panel className="monthly-report-manager" id="monthly-reports"><h2>本月报告 · {data.ledger.period}</h2><p>未扣款报告先留存商品与代发基础，后收到的扣款仍归入这个账本月份。下载使用简化表格，原始审计存档保持不变。</p>
    <div className="report-sources-summary"><div><strong>代发</strong><p>{data.dispatch?`已采用 ${data.dispatch.adoptedQuantityExact} 件 · r${data.dispatch.revision}`:'尚未采用（真实零需明确填写）'}</p><Button disabled={locked} onClick={()=>setEditor('dispatch')}>登记代发</Button></div><div><strong>独立扣款</strong><p>{data.deduction?`已采用 ${data.deduction.signedAmountExact} 元 · r${data.deduction.revision}${data.deduction.missingStores.length?' · 部分店铺待取得':''}`:'尚未取得'}</p><Button disabled={data.ledger.status==='locked'} onClick={()=>setEditor('deduction')}>登记扣款</Button></div></div>
    <div className="report-readiness" aria-label="整月报告准备情况">
      <div><strong>商品成本</strong><span>{locked ? '已随基础保存' : missing == null ? '正在核对整月成本' : missing ? `整月 ${missing} 条待补` : '整月已齐'}</span>{!locked && missing > 0 && onOpenCosts ? <Button onClick={onOpenCosts}>补齐成本</Button> : null}</div>
      <div><strong>代发</strong><span>{data.dispatch || readiness.baseSaved ? '已登记' : '待登记，真实零填 0'}</span></div>
      <div><strong>扣款</strong><span>{!data.deduction ? '等待来源，可先保存未扣款报告' : readiness.missingStores.length ? `待取得：${readiness.missingStores.join('、')}` : '各店已齐'}</span></div>
    </div>
    <div className="profit-toolbar"><Button disabled={busy||!readiness.baseReady} onClick={()=>prepare('pre_deduction')}>预览未扣款报告并定稿</Button><Button disabled={busy||!readiness.financialReady||current.state === 'unavailable'} onClick={()=>prepare('financial')}>预览财务对账报告</Button></div>
    {current.report ? <div className="report-current"><div><strong>{current.label}</strong><span>{current.state === 'deduction_pending' ? '当前金额为未扣款基础 · ' : ''}¥{displayMoney(current.profit)}</span></div><Button onClick={() => download(current.report.id)}>下载{current.report.kind === 'financial' ? '当前财务报告' : '未扣款报告'}</Button></div> : locked ? <p role="status">{current.label}{current.state === 'legacy' ? '，生成新格式报告需先重开本月基础。' : ''}</p> : null}
    {data.ledger.reportReopenReason&&!locked?<p>基础已显式重开：{data.ledger.reportReopenReason}。本次将生成新修订，旧文件保持不变。</p>:null}
    {data.reports.length?<details><summary>历史报告（{data.reports.length}）</summary>{data.reports.map(report=><div className="report-history-row" key={report.id}><span>{report.kind==='financial'?'财务对账':'未扣款'} · r{report.revision} · {report.createdAt.slice(0,10)} · ¥{report.displayTotals.profit}</span><Button onClick={async()=>{try{await downloadReportFile(await readSavedProfitReport(report.id));}catch(e){setError(e.message);}}}>下载报告</Button></div>)}</details>:null}
    {editor?<SupplementEditor key={`${ledgerId}/${editor}`} state={data} kind={editor} onClose={()=>setEditor(null)} />:null}
    <Modal open={Boolean(preview)} title={preview?.report.kind==='financial'?'保存财务对账报告':'保存未扣款报告并定稿'} onClose={()=>!busy&&setPreview(null)} footer={<><Button disabled={busy} onClick={()=>setPreview(null)}>取消</Button><Button disabled={busy} loading={busy} onClick={save}>保存并下载</Button></>}>
      {preview?<><p>{preview.report.period} · 整月全部店铺 · r{preview.report.revision}</p><p>商品利润 {displayMoney(preview.report.totalsExact.productProfitExact)} 元 + 代发 {displayMoney(preview.report.totalsExact.dispatchAmountExact)} 元{preview.report.kind==='financial'?` − 扣款 ${displayMoney(preview.report.totalsExact.deductionExact)} 元`:''}</p><strong>合计 {preview.report.displayTotals.profit} 元</strong><p>{preview.report.kind==='financial'?'商品及代发沿用已保存基础，仅加入当前采用扣款。':'保存后商品、销售、费率和代发冻结；更改需显式重开。'}</p></>:null}
    </Modal>{error?<p role="alert">{error}</p>:null}
  </Panel>;
}
