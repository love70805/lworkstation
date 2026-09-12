import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Modal, Panel, useToast } from "../components/UI";
import { readMonthlyReportState, readSavedProfitReport, previewMonthlySupplement, adoptMonthlySupplement, previewProfitReport, saveProfitReport } from "../data/repositories/profitReportRepository";
import { inspectSupplementSource, suggestSupplementMapping, supplementFields, supplementHeaders } from "../domain/monthlySupplements";
import { readSupplementWorkbook } from "../lib/monthlySupplementImport";
import { downloadReportFile } from "../lib/profitReportWorkbook";
import { displayMoney } from "../domain/profitReports";

const fieldLabels={owner:'姓名',store:'实际店铺',platformSkc:'SKC',supplierNumber:'供方货号',businessId:'业务单号',order1688:'1688单号',quantity:'件数',amount:'扣款金额'};
export function SupplementEditor({ state, kind, onClose }) {
  const {notify}=useToast();
  const current=state[kind];
  const [mode,setMode]=useState('files'),[sources,setSources]=useState([]),[retaining,setRetaining]=useState(true),[quantity,setQuantity]=useState(current?.adoptedQuantityExact??''),[amounts,setAmounts]=useState({}),[zeroStores,setZeroStores]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(null);
  const patch=(index,value)=>{setSources(items=>items.map((item,i)=>i===index?{...item,...value}:item));setPreview(null);};
  async function upload(files){setBusy(true);setError('');try{
    const loaded=(await Promise.all([...files].map(file=>readSupplementWorkbook(file,kind)))).flat();
    setSources(previous=>{const keys=new Set(previous.map(item=>`${item.fileHash}/${item.sheetName}`));return [...previous,...loaded.filter(source=>!keys.has(`${source.fileHash}/${source.sheetName}`)).map(source=>({...source,enabled:false,headerRow:source.headerRow??1,mapping:suggestSupplementMapping(supplementHeaders(source,source.headerRow??1)),ownerMarker:'',ownerField:kind==='dispatch'?'owner':'supplierNumber',store:'',includeAll:false}))];});setPreview(null);
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  async function prepare(){setBusy(true);setError('');try{
    const input={kind,ledgerId:state.ledger.id,workspaceId:state.ledger.workspaceId,period:state.ledger.period,mode,rows:[],sources:[]};
    if(mode==='manual'){
      if(kind==='dispatch')input.adoptedQuantityExact=quantity;
      else input.rows=state.stores.filter(store=>String(amounts[store]??'').trim()!=='').map(store=>({kind,manual:true,store,signedAmountExact:amounts[store],sourceName:'人工录入',businessId:'',sourceRow:1}));
    }else{
      if(kind==='dispatch'&&current&&quantity.trim()==='')throw new Error("已有采用总数，请明确填写本次整月采用件数，不能因加入来源自动重算。");
      if(retaining&&current){input.rows=state.adoptedRows.filter(row=>row.kind===kind);input.sources=[...(current.sources??[])];}
      for(const source of sources.filter(item=>item.enabled)){
        const parsed=inspectSupplementSource(source,{kind,...source});
        if(parsed.errors.length)throw new Error(`${source.fileName} / ${source.sheetName}：${parsed.errors.length} 行异常，第 ${parsed.errors[0].sourceRow} 行 ${parsed.errors[0].message}`);
        if(!parsed.rows.length)throw new Error(`${source.sheetName} 无有效选中行，请检查本人标记、表头和映射。`);
        input.rows.push(...parsed.rows);input.sources.push(parsed.source);
      }
      if(kind==='dispatch'&&quantity.trim()!=='')input.adoptedQuantityExact=quantity;
      if(kind==='deduction')for(const store of zeroStores){if(input.rows.some(row=>row.store===store))throw new Error(`${store} 已有来源金额，不能同时标记无扣款。`);input.rows.push({kind,manual:true,store,signedAmountExact:'0',sourceName:'明确零扣款',sourceRow:1,businessId:''});}
    }
    const check=await previewMonthlySupplement(input);setPreview({input,...check});
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  async function adopt(){setBusy(true);setError('');try{await adoptMonthlySupplement(preview.input,preview);notify(`${state.ledger.period} ${kind==='dispatch'?'代发':'扣款'}来源已采用`);onClose();}catch(e){setError(e.message);setPreview(null);}finally{setBusy(false);}}
  return <Modal open title={`${state.ledger.period} · ${kind==='dispatch'?'代发':'扣款'}来源`} description="采用范围是本工作区整月，不受页面店铺筛选影响。收到或录入日期不会改变目标账本月份。" onClose={()=>!busy&&onClose()} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy} onClick={prepare}>预览采用</Button>{preview?<Button variant="primary" disabled={busy} onClick={adopt}>确认采用本月来源</Button>:null}</>}>
    <label>来源方式 <select value={mode} onChange={e=>{setMode(e.target.value);setPreview(null);}}><option value="files">导入来源表</option><option value="manual">手工录入{kind==='dispatch'?'总代发件数':'各店扣款'}</option></select></label>
    {mode==='files'?<>
      <p><input type="file" multiple accept={kind==='dispatch'?'.xlsx,.csv':'.xlsx'} disabled={busy} onChange={e=>void upload(e.target.files)} /></p>
      {current?<label><input type="checkbox" checked={retaining} onChange={e=>{setRetaining(e.target.checked);setPreview(null);}} />保留当前已采用来源（{current.sources?.length??0} 个来源，{current.rowCount} 行）</label>:null}
      {sources.map((source,index)=><details key={`${source.fileHash}/${source.sheetName}`} className="report-source"><summary><input type="checkbox" checked={source.enabled} onChange={e=>patch(index,{enabled:e.target.checked})} /> {source.fileName} / {source.sheetName} · {source.cells.length} 行</summary>
        <label>表头行 <input type="number" min="1" max={source.sourceRows?.at(-1)??source.cells.length} value={source.headerRow} onChange={e=>patch(index,{headerRow:Number(e.target.value),mapping:suggestSupplementMapping(supplementHeaders(source,Number(e.target.value)))})} /></label>
        <div className="report-mapping">{Object.keys(supplementFields).filter(field=>kind==='dispatch'?field!=='amount':field!=='quantity').map(field=><label key={field}>{fieldLabels[field]}<select value={source.mapping[field]} onChange={e=>patch(index,{mapping:{...source.mapping,[field]:e.target.value}})}><option value="-1">未映射</option>{supplementHeaders(source,source.headerRow).map((header,col)=><option key={col} value={col}>{col+1} · {String(header)}</option>)}</select></label>)}</div>
        <label>本人标记列 <select value={source.ownerField} onChange={e=>patch(index,{ownerField:e.target.value})}><option value="owner">姓名</option><option value="supplierNumber">供方货号</option></select></label><input placeholder="本人姓名或货号标记（包含匹配）" value={source.ownerMarker} onChange={e=>patch(index,{ownerMarker:e.target.value})} />
        <label><input type="checkbox" checked={source.includeAll} onChange={e=>patch(index,{includeAll:e.target.checked})} />明确采用此来源全部有效记录</label>
        {kind==='deduction'?<label>无店铺列时，按此源工作表实际店铺映射 <select value={source.store} onChange={e=>patch(index,{store:e.target.value})}><option value="">请选择实际店铺</option>{state.stores.map(store=><option key={store}>{store}</option>)}</select></label>:null}
      </details>)}
    </>:null}
    {kind==='dispatch'?<label className="form-field">采用总代发件数{current?`（原采用 ${current.adoptedQuantityExact} 件；新增来源不自动增减，请核对本次整月总数）`:mode==='files'?'（留空使用选中记录之和）':''}<input className="text-input" type="number" min="0" step="any" value={quantity} onChange={e=>{setQuantity(e.target.value);setPreview(null);}} /></label>:mode==='manual'?state.stores.map(store=><label className="form-field" key={store}>{store} 扣款金额（保留正负，真实零填 0，未取得留空）<input className="text-input" type="number" step="any" value={amounts[store]??''} onChange={e=>{setAmounts({...amounts,[store]:e.target.value});setPreview(null);}} /></label>):<div><p>没有扣款来源的店铺，可明确记录真实零值：</p>{state.stores.map(store=><label key={store}><input type="checkbox" checked={zeroStores.includes(store)} onChange={e=>{setZeroStores(previous=>e.target.checked?[...previous,store]:previous.filter(name=>name!==store));setPreview(null);}} />{store} 本月扣款为 0 </label>)}</div>}
    {preview?<Panel className="report-adoption-preview"><strong>{state.ledger.period} 整月采用预览</strong><p>本次 {preview.candidate.sources.length} 个来源 / {preview.candidate.rows.length} 行；{kind==='dispatch'?`采用 ${preview.candidate.adoptedQuantityExact} 件`:`有符号扣款合计 ${preview.candidate.signedAmountExact} 元`}</p>{current?<p>确认后替换当前 r{current.revision}（{current.sources?.length??0} 个来源 / {current.rowCount} 行），旧版本保留。{mode==='manual'||!retaining?'本次不保留此前来源，请核对是否完整。':''}</p>:null}{preview.candidate.missingStores.length?<p>尚未取得扣款：{preview.candidate.missingStores.join('、')}；财务报告会等待这些店铺明确金额。</p>:null}<div className="report-preview-rows"><table><thead><tr><th>来源 / 行</th><th>店铺 / 本人标记</th><th>单号 / SKC</th><th>{kind==='dispatch'?'件数':'金额'}</th></tr></thead><tbody>{preview.candidate.rows.slice(0,100).map((row,i)=><tr key={i}><td>{row.sourceName} / {row.sourceSheet} / {row.sourceRow}</td><td>{row.store} / {row.ownerMarker}</td><td>{row.businessId} / {row.platformSkc}</td><td>{row.quantityExact??row.signedAmountExact}</td></tr>)}</tbody></table></div>{preview.candidate.rows.length>100?<p>预览前100行，采用包括全部 {preview.candidate.rows.length} 行。</p>:null}</Panel>:null}
    {error?<p role="alert">{error}</p>:null}
  </Modal>;
}

export default function MonthlyReportManager({ ledgerId }) {
  const {notify}=useToast();
  const state=useLiveQuery(async()=>{try{return {ledgerId,data:await readMonthlyReportState(ledgerId)};}catch(error){return {ledgerId,error:error.message};}},[ledgerId]);
  const [editor,setEditor]=useState(null),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!state||state.ledgerId!==ledgerId)return <Panel>正在读取本月报告...</Panel>;
  if(state.error)return <Panel><p role="alert">{state.error}</p></Panel>;
  const data=state.data,locked=['finalized','locked'].includes(data.ledger.status);
  async function prepare(kind){setBusy(true);setError('');try{const input={ledgerId,kind,baseReportId:kind==='financial'?data.ledger.currentBaseReportId:null};setPreview({input,...await previewProfitReport(input)});}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function save(){setBusy(true);setError('');try{const report=await saveProfitReport(preview.input,{expectedFingerprint:preview.fingerprint});downloadReportFile(report);setPreview(null);notify('报告已保存并开始下载，可从历史报告重下载。');}catch(e){setError(e.message);setPreview(null);}finally{setBusy(false);}}
  return <Panel className="monthly-report-manager" id="monthly-reports"><h2>本月报告 · {data.ledger.period}</h2><p>未扣款报告先留存商品与代发基础，后收到的扣款仍归入这个账本月份。原报告可重下载。</p>
    <div className="report-sources-summary"><div><strong>代发</strong><p>{data.dispatch?`已采用 ${data.dispatch.adoptedQuantityExact} 件 · r${data.dispatch.revision}`:'尚未采用（真实零需明确填写）'}</p><Button disabled={locked} onClick={()=>setEditor('dispatch')}>登记代发</Button></div><div><strong>独立扣款</strong><p>{data.deduction?`已采用 ${data.deduction.signedAmountExact} 元 · r${data.deduction.revision}${data.deduction.missingStores.length?' · 部分店铺待取得':''}`:'尚未取得'}</p><Button disabled={data.ledger.status==='locked'} onClick={()=>setEditor('deduction')}>登记扣款</Button></div></div>
    <div className="profit-toolbar"><Button disabled={busy||locked} onClick={()=>prepare('pre_deduction')}>预览未扣款报告并定稿</Button><Button disabled={busy||!data.ledger.currentBaseReportId||data.ledger.status==='locked'} onClick={()=>prepare('financial')}>预览财务对账报告</Button></div>
    {data.ledger.reportReopenReason&&!locked?<p>基础已显式重开：{data.ledger.reportReopenReason}。本次将生成新修订，旧文件保持不变。</p>:null}
    {data.reports.length?<details><summary>历史报告（{data.reports.length}）</summary>{data.reports.map(report=><div className="report-history-row" key={report.id}><span>{report.kind==='financial'?'财务对账':'未扣款'} · r{report.revision} · {report.createdAt.slice(0,10)} · ¥{report.displayTotals.profit}</span><Button onClick={async()=>{try{downloadReportFile(await readSavedProfitReport(report.id));}catch(e){setError(e.message);}}}>重下载原文件</Button></div>)}</details>:null}
    {editor?<SupplementEditor key={`${ledgerId}/${editor}`} state={data} kind={editor} onClose={()=>setEditor(null)} />:null}
    <Modal open={Boolean(preview)} title={preview?.report.kind==='financial'?'保存财务对账报告':'保存未扣款报告并定稿'} onClose={()=>!busy&&setPreview(null)} footer={<><Button disabled={busy} onClick={()=>setPreview(null)}>取消</Button><Button disabled={busy} loading={busy} onClick={save}>保存并下载</Button></>}>
      {preview?<><p>{preview.report.period} · 整月全部店铺 · r{preview.report.revision}</p><p>商品利润 {displayMoney(preview.report.totalsExact.productProfitExact)} 元 + 代发 {displayMoney(preview.report.totalsExact.dispatchAmountExact)} 元{preview.report.kind==='financial'?` − 扣款 ${displayMoney(preview.report.totalsExact.deductionExact)} 元`:''}</p><strong>合计 {preview.report.displayTotals.profit} 元</strong><p>{preview.report.kind==='financial'?'商品及代发沿用已保存基础，仅加入当前采用扣款。':'保存后商品、销售、费率和代发冻结；更改需显式重开。'}</p></>:null}
    </Modal>{error?<p role="alert">{error}</p>:null}
  </Panel>;
}
