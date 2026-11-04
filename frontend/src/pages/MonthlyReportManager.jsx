import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Modal, Panel, useToast } from "../components/UI";
import { readMonthlyReportState, readProfitReportDownload, previewMonthlySupplement, adoptMonthlySupplement, previewProfitReport, saveProfitReport } from "../data/repositories/profitReportRepository";
import { inspectSupplementSource, suggestSupplementMapping, supplementFields, supplementHeaders, supplementMarkers, suggestSupplementStore, suggestDeductionStore, supplementRowIdentity, supplementRowLabel, normalizeSupplementCandidate, legacyUnassignedDispatchRows } from "../domain/monthlySupplements";
import { readSupplementWorkbook } from "../lib/monthlySupplementImport";
import { downloadReportFile } from "../lib/profitReportWorkbook";
import { Exact, displayMoney, exactSum } from "../domain/profitReports";
import { currentLedgerResult, reportReadiness, hasSavedFinancialReport } from "../domain/ledgerWorkflow";
import { includesSearch } from '../lib/textSearch';
import DispatchOrderDownload from './DispatchOrderDownload';
import SupplementSupplierPicker, { ALL_SUPPLEMENT_MARKERS } from '../components/SupplementSupplierPicker';
import { profitReportFileName } from '../domain/profitReportPresentation';

const fieldLabels={owner:'登记人',date:'日期',store:'实际店铺',platformSkc:'SKC',supplierNumber:'供方货号',businessId:'业务单号',order1688:'1688单号',quantity:'数量',amount:'采用金额列'};
const ALL_MARKERS=ALL_SUPPLEMENT_MARKERS;
function missingSourceFields(source,kind) {
  return [kind==='dispatch'?'owner':'supplierNumber',kind==='dispatch'?'quantity':'amount'].filter(field=>!(Number(source.mapping[field])>=0));
}
function sourceSelected(source,kind,selection) {
  if(Array.isArray(selection)?!selection.length:!selection)return false;
  if(selection===ALL_MARKERS)return true;
  if(!(Number(source.mapping[kind==='dispatch'?'owner':'supplierNumber'])>=0))return true;
  return supplementMarkers(source,kind).some(marker=>Array.isArray(selection)?selection.includes(marker):marker===selection);
}
function buildSupplementDraft({state,kind,current,mode,sources,selection,retaining,amounts,zeroStores,reviewed,excludedRows}) {
  const input={kind,ledgerId:state.ledger.id,workspaceId:state.ledger.workspaceId,period:state.ledger.period,mode,rows:[],sources:[],reviewedCrossFileConflicts:reviewed};
  const stats={addedRows:[],retainedCount:0,skipped:0,duplicates:0,sourceCount:0,unassigned:[],unmappedSources:[]};
  try {
    if(mode==='manual') {
      if(kind==='dispatch') { input.rows=state.stores.filter(store=>String(amounts[store]??'').trim()!=='').map(store=>({kind,manual:true,store,quantityExact:amounts[store],sourceName:'人工录入',sourceRow:1})); if(!input.rows.length)return {ready:false,stats}; input.adoptedQuantityExact=exactSum(input.rows,'quantityExact'); }
      else {input.rows=state.stores.filter(store=>String(amounts[store]??'').trim()!=='').map(store=>({kind,manual:true,store,signedAmountExact:amounts[store],sourceName:'人工录入',businessId:'',sourceRow:1}));if(!input.rows.length)return {ready:false,stats};}
    } else {
      const selectedCodes=Array.isArray(selection)?selection:null;
      const hasSelection=selectedCodes?selectedCodes.length>0:Boolean(selection);
      if(!hasSelection&&!zeroStores.length)return {ready:false,stats};
      const retained=retaining&&current?state.adoptedRows.filter(row=>row.kind===kind):[];
      // Preserve a previously explicit manual aggregate when adding source files.
      if(retaining&&current?.mode==='manual'&&kind==='dispatch'&&!retained.length)retained.push({kind,manual:true,store:'',quantityExact:current.adoptedQuantityExact,sourceName:'此前手工总代发',sourceRow:1});
      input.rows=[...retained];input.sources=retaining&&current?[...(current.sources??[])]:[];stats.retainedCount=retained.length;
      const priorKeys=new Set(retained.map(supplementRowIdentity)),seen=new Set(priorKeys);
      for(const source of sources) {
        const includeAll=selection===ALL_MARKERS;
        if(!sourceSelected(source,kind,selection))continue;
        const missing=missingSourceFields(source,kind);
        if(missing.length)throw new Error(`${source.fileName} / ${source.sheetName}：未识别${missing.map(field=>fieldLabels[field]).join('、')}列，请展开此来源的高级设置。`);
        stats.sourceCount++;
        const parsed=inspectSupplementSource(source,{kind,headerRow:source.headerRow,mapping:source.mapping,ownerMarker:includeAll||selectedCodes?'':selection,supplierNumbers:selectedCodes??undefined,includeAll,store:source.store,stores:state.stores});
        stats.skipped+=parsed.ignored.filter(row=>row.reason==='missing_quantity').length;
        stats.unassigned.push(...parsed.ignored.filter(row=>row.reason==='unassigned_owner').map(row=>({...row,sourceName:source.fileName})));
        if(parsed.errors.length){
          if(parsed.errors.every(row=>row.code==='missing_store')){stats.unmappedSources.push({fileHash:source.fileHash,sheetName:source.sheetName,fileName:source.fileName,rowCount:parsed.errors.length});continue;}
          throw new Error(`${source.fileName} / ${source.sheetName}：${parsed.errors.length} 条异常，${parsed.errors.slice(0,10).map(supplementRowLabel).join('；')}${parsed.errors.length>10?'等':''}。${parsed.errors[0].message}`);
        }
        const removed=[];
        for(const row of parsed.rows) {
          const key=supplementRowIdentity(row);
          if(excludedRows.includes(key)){removed.push({sourceRow:row.sourceRow,recordRow:row.recordRow,businessId:row.businessId});continue;}
          if(seen.has(key)){stats.duplicates++;continue;}
          seen.add(key);input.rows.push(row);stats.addedRows.push(row);
        }
        if(removed.length||stats.addedRows.some(row=>row.fileHash===source.fileHash&&row.sourceSheet===source.sheetName)||parsed.ignored.some(row=>['missing_quantity','unassigned_owner'].includes(row.reason)))input.sources.push({...parsed.source,excludedRows:removed});
      }
      if(stats.unmappedSources.length)return {ready:false,error:'涉及来源仍有未映射实际店铺，请先完成店铺选择。',stats};
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
  const [selection,setSelection]=useState(kind==='deduction'?[]:''),[search,setSearch]=useState(''),[reviewed,setReviewed]=useState(false),[excludedRows,setExcludedRows]=useState([]);
  const [mode,setMode]=useState('files'),[sources,setSources]=useState([]),[retaining,setRetaining]=useState(true),[amounts,setAmounts]=useState({}),[zeroStores,setZeroStores]=useState([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[previewPending,setPreviewPending]=useState(false),[preview,setPreview]=useState(null),[retry,setRetry]=useState(0);
  const [showAllSources,setShowAllSources]=useState(false),storeInputs=useRef(new Map());
  const markers=useMemo(()=>[...new Set(sources.flatMap(source=>supplementMarkers(source,kind)))].sort((a,b)=>a.localeCompare(b,'zh-CN')),[sources,kind]);
  const draft=useMemo(()=>buildSupplementDraft({state,kind,current,mode,sources,selection,retaining,amounts,zeroStores,reviewed,excludedRows}),[state,kind,current,mode,sources,selection,retaining,amounts,zeroStores,reviewed,excludedRows]);
  const activePreview=preview?.draft===draft?preview:null;
  const finalCandidate=activePreview?.candidate;
  const hasSelection=Array.isArray(selection)?selection.length>0:Boolean(selection);
  const selectedSources=sources.map((source,index)=>({source,index})).filter(({source})=>sourceSelected(source,kind,selection));
  const visibleSources=kind==='deduction'&&hasSelection&&!showAllSources?selectedSources:sources.map((source,index)=>({source,index}));
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
      const added=loaded.filter(source=>{const key=`${source.fileHash}/${source.sheetName}`;if(keys.has(key))return false;keys.add(key);return true;}).map(source=>({...source,headerRow:source.headerRow??1,mapping:suggestSupplementMapping(supplementHeaders(source,source.headerRow??1)),store:(kind==='deduction'?suggestDeductionStore:suggestSupplementStore)(source.sheetName,state.stores)}));
      if(added.length){
        invalidate();setSources(previous=>[...previous,...added]);
        const term=search.trim().normalize('NFKC');
        if(kind==='deduction'&&term&&selection!==ALL_MARKERS){
          const newMatches=added.flatMap(item=>supplementMarkers(item,kind)).filter(marker=>includesSearch(marker,term)&&!markers.includes(marker));
          setSelection(previous=>[...new Set([...previous,...newMatches])].sort((a,b)=>a.localeCompare(b,'zh-CN')));
        }
      }
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
  const label=kind==='dispatch'?'登记人':'供方货号',unit=kind==='dispatch'?'件':'元';
  const oldTotal=current?.adoptedQuantityExact??current?.signedAmountExact;
  const finalTotal=finalCandidate?.adoptedQuantityExact??finalCandidate?.signedAmountExact;
  const blocked=Boolean(finalCandidate?.conflicts?.length&&!finalCandidate.reviewedCrossFileConflicts);
  const priorKeys=new Set(state.adoptedRows.filter(row=>row.kind===kind).map(supplementRowIdentity));
  const visibleConflicts=(finalCandidate?.conflicts??[]).filter(row=>!(current?.reviewedCrossFileConflicts&&retaining&&priorKeys.has(supplementRowIdentity(row))&&priorKeys.has(supplementRowIdentity({fileHash:row.previousFileHash,sourceSheet:row.previousSourceSheet,sourceRow:row.previousSourceRow}))));
  return <Modal open size="large" className="report-import" title={`${state.ledger.period} · ${kind==='dispatch'?'代发':'扣款'}来源`} description="本工作区整月全部店铺，收到或录入日期不改变账本月份。" onClose={()=>!busy&&onClose()} footer={<>
    {current&&finalCandidate?<p className="report-replacement">整月 {oldTotal} → {finalTotal} {unit}；导入后更新 r{current.revision}，旧版本保留。{mode==='files'&&retaining?'已有来源保留。':'全部已有来源将被本次内容替换。'}</p>:null}
    <Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" loading={busy} disabled={busy||previewPending||!activePreview||blocked} onClick={adopt}>{current?'导入并更新本月来源':'导入本月来源'}</Button>
  </>}>
    <label className="report-mode">来源方式<select disabled={busy} value={mode} onChange={event=>{invalidate();setMode(event.target.value);}}><option value="files">导入来源表</option><option value="manual">手工录入{kind==='dispatch'?'各店代发件数':'各店扣款'}</option></select></label>
    {kind==='dispatch' && retaining && current ? <AdoptedDispatchNotice rows={state.adoptedRows} /> : null}
    {mode==='files'?<>
      <label className="report-upload">选择文件<input type="file" multiple accept={kind==='dispatch'?'.xlsx,.csv':'.xlsx'} disabled={busy} onChange={event=>{void upload(event.target.files);event.target.value='';}} /></label>
      {sources.length?<div className="report-selection">
        {kind==='deduction'?<SupplementSupplierPicker markers={markers} selection={selection} search={search} onSearch={setSearch} onChange={value=>{invalidate();setSelection(value);}} disabled={busy}/>:<>
          <label>搜索登记人<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索源表姓名" disabled={busy}/></label>
          <label>登记人<select aria-label="登记人" value={selection} disabled={busy} onChange={event=>{invalidate();setSelection(event.target.value);}}><option value="">请选择登记人</option><option value={ALL_MARKERS}>全部登记人（所有有效记录）</option>{markers.filter(marker=>marker===selection||includesSearch(marker,search)).map(marker=><option key={marker}>{marker}</option>)}</select></label>
        </>}
        <p>{(Array.isArray(selection)?selection.length:selection)?`当前筛选：${selection===ALL_MARKERS?'全部记录':Array.isArray(selection)?`已选 ${markers.filter(marker=>selection.includes(marker)).length} 个完整货号`:selection} · ${draft.stats.sourceCount} 个来源`:'先选择筛选范围，预览会自动更新'}。{kind==='dispatch'?'不发、退款等仅作备注，按有数量记录计入。':'保留源金额正负，分摊金额优先。'}</p>
      </div>:null}
      {draft.stats.unmappedSources.length?<Panel className="report-store-alert"><p role="alert">还有 {draft.stats.unmappedSources.length} 个涉及工作表、{draft.stats.unmappedSources.reduce((count,source)=>count+source.rowCount,0)} 条选中记录缺少实际店铺。选择下列来源的店铺后，整月预览自动更新。</p>{draft.stats.unmappedSources.map(source=><Button key={`${source.fileHash}/${source.sheetName}`} disabled={busy} onClick={()=>{const index=sources.findIndex(item=>item.fileHash===source.fileHash&&item.sheetName===source.sheetName),input=storeInputs.current.get(index);input?.scrollIntoView?.({block:'center'});input?.focus();}}>定位 {source.sheetName}（{source.rowCount} 条）</Button>)}</Panel>:null}
      {current?<label className="report-mode">已有来源处理<select aria-label="已有来源处理" disabled={busy} value={retaining?'append':'replace'} onChange={event=>{invalidate();setRetaining(event.target.value==='append');}}><option value="append">保留已有来源，加入本次筛选</option><option value="replace">以本次筛选替换全部已有来源</option></select></label>:null}
      {kind==='deduction'&&hasSelection?<div className="report-source-scope"><p>当前货号涉及 {selectedSources.length} / {sources.length} 个工作表。</p><label><input type="checkbox" disabled={busy} checked={showAllSources} onChange={event=>setShowAllSources(event.target.checked)}/>显示未涉及的工作表</label></div>:null}
      <div className="report-source-list">{visibleSources.map(({source,index})=>{
        const missing=missingSourceFields(source,kind);
        return <div className="report-source" key={`${source.fileHash}/${source.sheetName}`}><div className="report-source-heading"><strong>{source.fileName} / {source.sheetName}</strong><Button disabled={busy} onClick={()=>{invalidate();setSources(items=>items.filter((_,i)=>i!==index));}}>移除此来源</Button></div>
          <p>{source.cells.length} 条表格记录 · {missing.length?`未识别${missing.map(field=>fieldLabels[field]).join('、')}列，请展开高级设置修复。`:`已识别${kind==='dispatch'?'登记人、数量':'供方货号、金额'}${kind==='deduction'?`（${supplementHeaders(source,source.headerRow)[Number(source.mapping.amount)]}）`:''}`}</p>
          {<><label>店铺号（源记录为空时采用）<select aria-label={`${source.sheetName} 实际店铺`} ref={node=>{if(node)storeInputs.current.set(index,node);else storeInputs.current.delete(index);}} disabled={busy} value={source.store} onChange={event=>patch(index,{store:event.target.value})}><option value="">请选择实际店铺</option>{state.stores.map(store=><option key={store}>{store}</option>)}</select></label>{kind==='deduction'&&source.store&&suggestDeductionStore(source.sheetName,state.stores)===source.store?<p className="report-store-match">已识别工作表 {source.sheetName} 对应 {source.store}，可在上方修改。</p>:null}</>}
          <details><summary>高级设置 · 表头与字段映射</summary><label>表头行（{source.sourceFormat==='csv'?'CSV 物理行':'工作表行'}）<input disabled={busy} type="number" min="1" max={source.sourceRows?.at(-1)??source.cells.length} value={source.headerRow} onChange={event=>patch(index,{headerRow:Number(event.target.value),mapping:suggestSupplementMapping(supplementHeaders(source,Number(event.target.value)))})}/></label>
            <div className="report-mapping">{Object.keys(supplementFields).filter(field=>kind==='dispatch'?field!=='amount':field!=='quantity').map(field=><label key={field}>{fieldLabels[field]}<select disabled={busy} value={source.mapping[field]} onChange={event=>patch(index,{mapping:{...source.mapping,[field]:event.target.value}})}><option value="-1">未映射</option>{supplementHeaders(source,source.headerRow).map((header,column)=><option key={column} value={column}>{column+1} · {String(header)}</option>)}</select></label>)}</div>
          </details>
        </div>;
      })}</div>
    </>:kind==='dispatch'?state.stores.map(store=><label className="form-field" key={store}>{store} 代发件数<input className="text-input" aria-label={`${store} 代发件数`} type="number" min="0" step="1" placeholder="未登记可留空" disabled={busy} value={amounts[store]??''} onChange={event=>{invalidate();setAmounts(previous=>({...previous,[store]:event.target.value}));}}/></label>):state.stores.map(store=><label className="form-field" key={store}>{store} 扣款金额（保留正负，真实零填 0，未取得留空）<input className="text-input" type="number" step="any" disabled={busy} value={amounts[store]??''} onChange={event=>{invalidate();setAmounts(previous=>({...previous,[store]:event.target.value}));}}/></label>)}
    {kind==='deduction'&&mode==='files'?<details><summary>没有扣款来源的店铺：明确真实零值</summary>{state.stores.map(store=><label key={store}><input type="checkbox" disabled={busy} checked={zeroStores.includes(store)} onChange={event=>{invalidate();setZeroStores(previous=>event.target.checked?[...previous,store]:previous.filter(name=>name!==store));}}/>{store} 本月扣款为 0</label>)}</details>:null}
    {notice?<p role="status">{notice}</p>:null}
    {draft.stats.skipped?<p role="status">已跳过 {draft.stats.skipped} 条无数量记录，来源位置已保留。</p>:null}
    {draft.stats.unassigned.length?<Panel className="report-source-notice"><p role="status">来源表有 {draft.stats.unassigned.length} 条登记人不明记录，已排除，未计入任何登记人。可在原表补齐登记人后重新导入。</p><details><summary>查看未归属记录</summary>{draft.stats.unassigned.slice(0,100).map(row=><p key={`${row.sourceName}/${row.sourceSheet}/${row.sourceRow}`}>{row.sourceName} / {row.sourceSheet} · {supplementRowLabel(row)} · {row.rawQuantity || '无数量'} 件</p>)}{draft.stats.unassigned.length>100?<p>仅显示前 100 条，完整位置保留在来源记录中。</p>:null}</details></Panel>:null}
    {draft.stats.addedRows.some(row=>row.quantityFromText)?<p role="status">已将 {draft.stats.addedRows.filter(row=>row.quantityFromText).length} 条文本数量识别为有效数字，共 {exactSum(draft.stats.addedRows.filter(row=>row.quantityFromText),'quantityExact')} 件，已计入预览。</p>:null}
    {draft.stats.duplicates?<p>已有 {draft.stats.duplicates} 条重复源记录已跳过。</p>:null}
    {previewPending?<p role="status">正在更新预览…</p>:null}
    {finalCandidate?<Panel className="report-adoption-preview"><strong>{state.ledger.period} 整月导入预览</strong>
      {mode==='files'?<p>本次筛选新增 {draft.stats.addedRows.length} 行 / {exactSum(draft.stats.addedRows,kind==='dispatch'?'quantityExact':'signedAmountExact')} {unit}；保留已有 {draft.stats.retainedCount} 行{current&&retaining?`（原采用 ${oldTotal} ${unit}）`:''}。</p>:null}
      <p className="report-final-total">最终整月：{kind==='dispatch'?`采用 ${finalTotal} 件`:`有符号扣款合计 ${finalTotal} 元`} · 共 {finalCandidate.rows.length} 行</p>
      {kind==='dispatch'?<p className="report-dispatch-amount">代发金额 ¥{displayMoney(new Exact(finalTotal).times(state.ledger.warehouseRate??'0.7'))}（{finalTotal} 件 × 每件 {state.ledger.warehouseRate??'0.7'} 元），采用后立即计入整月利润汇总。</p>:null}
      {finalCandidate.missingStores.length?<p>尚未取得扣款：{finalCandidate.missingStores.join('、')}。</p>:null}
      <div className="report-preview-rows"><table><thead><tr><th>来源 / 位置</th><th>店铺 / {label}</th><th>单号 / SKC</th><th>{kind==='dispatch'?'件数':'金额'}</th><th>来源说明 / 备注</th></tr></thead><tbody>{finalCandidate.rows.slice(0,100).map((row,index)=><tr key={index}><td>{row.sourceName} / {row.sourceSheet}<br/>{supplementRowLabel(row)}</td><td>{row.store} / {row.ownerMarker}</td><td>{row.businessId} / {row.platformSkc}</td><td>{row.quantityExact??row.signedAmountExact}</td><td>{row.inheritedFrom?`登记人沿用${row.sourceFormat==='csv'?'CSV 物理':'来源'}第 ${row.inheritedFrom} 行；`:''}{row.amountHeader}{(row.remarks??[]).map(note=>`${note.header||`第${note.column}列`}：${note.value}`).join('；')}</td></tr>)}</tbody></table></div>
      {finalCandidate.rows.length>100?<p>预览前 100 行，导入包含全部 {finalCandidate.rows.length} 行。</p>:null}
    </Panel>:null}
    {visibleConflicts.length?<Panel className="report-conflicts"><strong>跨文件相似记录 · {visibleConflicts.length} 条</strong><p>核对后可排除重复行，或保留合法分摊；预览自动更新。</p><ul>{visibleConflicts.map((row,index)=><li key={index}><span>{row.previousSourceName} / {supplementRowLabel({sourceSheet:row.previousSourceSheet,sourceRow:row.previousSourceRow,recordRow:row.previousRecordRow,sourceFormat:row.previousSourceFormat,businessId:row.businessId})} 与 {row.sourceName} / {supplementRowLabel(row)} · {row.platformSkc}</span><Button disabled={busy} onClick={()=>{setPreview(null);setReviewed(false);setExcludedRows(previous=>[...previous,supplementRowIdentity(row)]);}}>排除此条</Button></li>)}</ul>{blocked?<Button disabled={busy} onClick={()=>{setPreview(null);setReviewed(true);}}>保留全部记录</Button>:<p role="status">已核对并保留全部记录。</p>}</Panel>:null}
    {(draft.error&&!draft.stats.unmappedSources.length)||error?<p role="alert">{error||draft.error}</p>:null}
    {error&&draft.ready?<Button disabled={busy||previewPending} onClick={()=>setRetry(value=>value+1)}>重新读取预览</Button>:null}
  </Modal>;
}

export function AdoptedDispatchNotice({ rows = [], locked = false }) {
  const inherited = legacyUnassignedDispatchRows(rows);
  return inherited.length ? <Panel className="report-source-notice"><p role="status">当前采用包含 {inherited.length} 条由上一登记人顺延归属的 XLSX 记录，共 {exactSum(inherited,'quantityExact')} 件，源表没有明确登记人归属。历史采用值保持不变。</p><p>请核对源表后重新导入；替换已有来源即可应用新的归属规则。</p><details><summary>查看原采用中的未明确归属行</summary>{inherited.slice(0,100).map(row=><p key={supplementRowIdentity(row)}>{row.sourceName} / {row.sourceSheet} · {supplementRowLabel(row)} · {row.quantityExact} 件</p>)}</details></Panel> : null;
}

export default function MonthlyReportManager({ ledgerId, workspaceId, missingCostCount, onOpenCosts, onState, editor, onEdit, compact = false }) {
  const {notify}=useToast();
  const [retry,setRetry]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[orderDownload,setOrderDownload]=useState(null);
  const exportingRef=useRef(false);
  const [exportStage,setExportStage]=useState('');
  const state=useLiveQuery(async()=>{try{return {ledgerId,workspaceId,data:await readMonthlyReportState(ledgerId)};}catch(error){return {ledgerId,workspaceId,error:error.message};}},[ledgerId,workspaceId,retry]);
  useEffect(()=>{onState?.(state);},[state,onState]);
  if(!state||state.ledgerId!==ledgerId)return <Panel>正在读取本月报告...</Panel>;
  if(state.error)return <Panel><p role="alert">{state.error}</p><Button onClick={()=>setRetry(value=>value+1)}>重新读取报告</Button></Panel>;
  const data=state.data;
  const missing=missingCostCount===undefined?data.ledger.costSummary?.missingCount:missingCostCount;
  const readiness=reportReadiness({...data,ledger:{...data.ledger,operationWorkflow:2},missingCount:missing});
  const nextKind=readiness.financialReady?'financial':'pre_deduction';
  async function download(reportId){setBusy(true);setError('');try{const saved=await readProfitReportDownload(reportId);await downloadReportFile(saved.report,{dispatchRows:saved.dispatchRows,deductionRows:saved.deductionRows});}catch(error){setError(error.message);}finally{setBusy(false);}}
  async function prepareOrderDownload(reportId){setBusy(true);setError('');try{setOrderDownload(await readProfitReportDownload(reportId));}catch(error){setError(error.message);}finally{setBusy(false);}}
  async function exportCurrent(){
    if(exportingRef.current)return;
    exportingRef.current=true;
    setBusy(true);setError('');
    try{
      const input={ledgerId,kind:nextKind};
      setExportStage('正在核对台账与成本…');
      const preview=await previewProfitReport(input);
      setExportStage('正在生成本次报告…');
      const report=await saveProfitReport(input,{expectedFingerprint:preview.fingerprint});
      setExportStage('正在生成 Excel 文件…');
      await downloadReportFile(report);
      notify('利润表已导出，数据仍可随时调整并重新核算。');
    }catch(error){setError(error.message);}finally{exportingRef.current=false;setBusy(false);setExportStage('');}
  }
  return <Panel className="monthly-report-manager" id="monthly-reports" tabIndex={-1}>
    {!compact ? <div className="report-heading"><h2>本月报告 · {data.ledger.period}</h2></div> : null}
    <div className="report-primary-actions"><p role="status">{missing==null?'正在核对成本':missing?'还有 '+missing+' 条店铺 SKU 待补成本':nextKind==='financial'?'本次包含各店扣款':'本次为未扣款利润'}</p>{missing>0&&onOpenCosts?<Button onClick={onOpenCosts}>补齐成本</Button>:null}<Button variant="primary" loading={busy} disabled={busy||!readiness.baseReady} onClick={exportCurrent}>{nextKind==='financial'?'导出利润表':'导出未扣款报告'}</Button></div>
    {exportStage ? <div className="erp-collection-meter" role="status"><span>{exportStage}</span><progress aria-label="报告导出进度" /></div> : null}
    <details open={compact ? undefined : true}><summary>代发、扣款与导出记录</summary>
    <p>按当前台账和成本直接导出，数据可随时更新。代发未录入时按 0 计；扣款未齐时导出未扣款报告。</p>
    <AdoptedDispatchNotice rows={data.adoptedRows} />
    <div className="report-sources-summary">
      <div><strong>代发</strong><p>{data.dispatch?'已登记 '+data.dispatch.adoptedQuantityExact+' 件 · ¥'+displayMoney(new Exact(data.dispatch.adoptedQuantityExact).times(data.ledger.warehouseRate??'0.7')):'未录入 · 本次按 0 计'}</p><Button disabled={busy} onClick={()=>onEdit('dispatch')}>{data.dispatch?'更新代发':'登记代发'}</Button></div>
      <div><strong>独立扣款</strong><p>{data.deduction?'已登记 ¥'+displayMoney(data.deduction.signedAmountExact):'未录入'}{readiness.missingStores.length?' · 部分店铺待取得':''}</p><Button disabled={busy} onClick={()=>onEdit('deduction')}>{data.deduction?'更新扣款':'登记扣款'}</Button></div>
    </div>

    {data.reports.length?<details><summary>历史导出（{data.reports.length}）</summary>{data.reports.map(report=><div className="report-history-row" key={report.id}><span>{report.kind==='financial'?'利润表':'未扣款报告'} · r{report.revision} · {report.createdAt.slice(0,10)} · ¥{report.displayTotals.profit}</span><Button disabled={busy} onClick={()=>download(report.id)}>下载此报告</Button><Button disabled={busy} onClick={()=>prepareOrderDownload(report.id)}>补齐代发单号</Button></div>)}</details>:null}
    </details>
    {orderDownload?<DispatchOrderDownload key={orderDownload.report.id} saved={orderDownload} onClose={()=>setOrderDownload(null)} />:null}
    {editor?<SupplementEditor key={ledgerId+'/'+editor} state={data} kind={editor} onClose={()=>onEdit(null)} />:null}
    {error?<p role="alert">{error}</p>:null}
  </Panel>;
}
