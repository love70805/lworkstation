import { useState } from 'react';
import { Button, Modal } from '../components/UI';
import { readSupplementWorkbook } from '../lib/monthlySupplementImport';
import { downloadReportFile } from '../lib/profitReportWorkbook';
import { dispatchOrderNumberForExport } from '../domain/dispatchOrderNumber';
import { recoverDispatchOrdersFromSources } from '../domain/dispatchOrderRecovery';

export default function DispatchOrderDownload({ saved, onClose }) {
  const [rows,setRows] = useState(saved.dispatchRows),[busy,setBusy] = useState(false),[error,setError] = useState(''),[sources,setSources] = useState([]);
  const details=rows.filter(row=>!row.manual),missing=details.filter(row=>!dispatchOrderNumberForExport(row)).length;
  async function upload(files) {
    if (!files?.length) return;
    setBusy(true);setError('');
    try {
      const loaded=(await Promise.all([...files].map(file=>readSupplementWorkbook(file,'dispatch')))).flat();
      const combined=[...sources,...loaded];
      const recovered=recoverDispatchOrdersFromSources(saved.dispatchRows,combined);
      setSources(combined);setRows(recovered);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true);setError('');
    try { await downloadReportFile(saved.report,{dispatchRows:rows});onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal open title="补齐代发 1688 单号后下载" description={`${saved.report.period} · ${saved.report.kind==='financial'?'财务对账':'未扣款'}报告 r${saved.report.revision}`} onClose={()=>!busy&&onClose()} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" loading={busy} disabled={busy} onClick={download}>下载当前补齐结果</Button></>}>
    <p>共 {details.length} 条代发记录，{details.length-missing} 条有明确单号，{missing} 条尚无单号。原始存档与利润金额保持不变。</p>
    <p>本行来源备注中的单号会自动补回。若原单号使用合并单元格，请选择当时导入的原表；文件哈希和源行核对通过后才会补齐。</p>
    <label className="form-field">选择原代发表<input type="file" multiple accept=".xlsx,.csv" disabled={busy} onChange={event=>{void upload(event.target.files);event.target.value='';}} /></label>
    {sources.length?<p role="status">已核对 {new Set(sources.map(source=>source.fileHash)).size} 个原文件；剩余 {missing} 条未取得明确单号。</p>:null}
    {error?<p role="alert">{error}</p>:null}
  </Modal>;
}
