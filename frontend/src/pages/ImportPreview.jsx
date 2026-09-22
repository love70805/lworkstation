import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, FileSpreadsheet, Upload, X } from "lucide-react";
import { Button, ProgressBar, useToast } from "../components/UI";
import { getActiveMemberContext, listLedgerSummaries, previewSalesImports, saveSalesImports } from "../data/database";
import { importReturnHref } from "../lib/importNavigation";
import { createImportWorkerClient } from "../lib/importWorkerClient";
import { LEDGER_REPORT_MOVEMENT_TYPES, salesFields, validateSalesMapping } from "../lib/salesImport";

const ACCEPTED_EXTENSIONS = new Set(["csv", "tsv", "xlsx", "xls"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
function previousMonth() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
async function sha256File(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function sampleFile() {
  return new File(["供方货号,SKC,平台SKU,数量,金额\nSUP-001,SKC-001,000123,23,1245.50"], "示例店铺.csv", { type: "text/csv" });
}
const money = (value) => Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function Totals({ summary }) {
  return <span>数量 {summary.quantity} · 销售原额 ¥{money(summary.revenue)} · 扣款 ¥{money(summary.penalty)}</span>;
}

export default function ImportPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const requestedLedgerId = new URLSearchParams(location.search).get('ledger');
  const [ledgerContext, setLedgerContext] = useState(null);
  const [contextRetry, setContextRetry] = useState(0);
  const { notify } = useToast();
  const inputRef = useRef(null);
  const previewRef = useRef(null);
  const clientRef = useRef(null);
  const operationRef = useRef(false);
  const [files, setFiles] = useState([]);
  const [period, setPeriod] = useState(() => requestedLedgerId ? '' : previousMonth());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ value: 0, label: "" });
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [payload, setPayload] = useState(null);
  const [overwriteSignature, setOverwriteSignature] = useState(null);
  const [result, setResult] = useState(null);
  const contextReady = !requestedLedgerId || ledgerContext?.id === requestedLedgerId;
  const contextBlocked = !contextReady || Boolean(ledgerContext?.error);
  const returnHref = importReturnHref(location.search, location.state?.importReturnTo, result?.ledgerId);
  const returnLabel = returnHref.startsWith('/workspace') ? '返回经营概览' : returnHref.startsWith('/ledger') ? '返回月度账本' : '返回利润面板';
  useEffect(() => {
    if (!requestedLedgerId) { setLedgerContext(null); return; }
    let active = true;
    setLedgerContext(null);
    (async () => {
      try {
        const member = await getActiveMemberContext();
        const ledger = (await listLedgerSummaries()).find(item => item.id === requestedLedgerId && item.workspaceId === member.workspaceId);
        if (!ledger) throw new Error('指定账本不存在或不属于当前工作区，请重新选择账本。');
        if (['finalized', 'locked'].includes(ledger.status)) throw new Error('本月基础已定稿，请返回账本显式重开后再导入。');
        if ((await getActiveMemberContext()).workspaceId !== member.workspaceId) throw new Error('工作区已切换，请重新选择账本。');
        if (active) { setPeriod(ledger.period); setLedgerContext({ id: ledger.id, workspaceId: member.workspaceId }); }
      } catch (failure) { if (active) setLedgerContext({ id: requestedLedgerId, error: failure.message }); }
    })();
    return () => { active = false; };
  }, [requestedLedgerId, contextRetry]);
  const assertImportContext = async () => {
    if (contextBlocked) throw new Error('请先确认目标账本。');
    if (requestedLedgerId && (await getActiveMemberContext()).workspaceId !== ledgerContext.workspaceId) throw new Error('工作区已切换，请返回重新选择账本，当前文件尚未写入。');
  };

  useEffect(() => {
    if (!preview) return;
    previewRef.current?.focus({ preventScroll: true });
    previewRef.current?.scrollIntoView?.({ behavior: "auto", block: "start" });
  }, [preview]);

  useEffect(() => {
    clientRef.current = createImportWorkerClient((value, jobId) => {
      setFiles((current) => current.map((item) => item.itemId === jobId ? { ...item, progress: value } : item));
    });
    return () => clientRef.current?.terminate();
  }, []);
  const invalidate = () => { setPreview(null); setPayload(null); setOverwriteSignature(null); setError(""); };
  const update = (itemId, patch) => {
    invalidate();
    setFiles((current) => current.map((item) => item.itemId === itemId ? { ...item, ...patch, validation: null } : item));
  };
  const loadFiles = async (selection) => {
    if (operationRef.current || !selection.length || result || contextBlocked) return;
    operationRef.current = true; setBusy(true); invalidate();
    const additions = Array.from(selection).map((file) => ({ file, fileName: file.name, itemId: crypto.randomUUID(), storeName: file.name.replace(/\.[^.]+$/, "").trim(), status: "queued", progress: 0 }));
    setFiles((current) => [...current, ...additions]);
    try {
      for (let index = 0; index < additions.length; index += 1) {
        const item = additions[index];
        setProgress({ value: index / additions.length * 100, label: `解析 ${index + 1}/${additions.length}：${item.fileName}` });
        try {
          if (!ACCEPTED_EXTENSIONS.has(item.fileName.split(".").pop()?.toLowerCase())) throw new Error("请选择 CSV、TSV、XLSX 或 XLS 文件。");
          if (item.file.size > MAX_FILE_SIZE) throw new Error("单文件不能超过 50 MB。");
          const fileHash = await sha256File(item.file);
          const parsed = await clientRef.current.parse(item.file, item.itemId);
          setFiles((current) => current.map((entry) => entry.itemId !== item.itemId ? entry : {
            ...entry, ...parsed, fileHash, mapping: parsed.suggestedMapping, status: "parsed", progress: 100,
            filterOptions: parsed.preset === "ledger_report" ? {
              movementTypes: LEDGER_REPORT_MOVEMENT_TYPES.filter((type) => parsed.facets.movementTypes.includes(type)),
              supplierNumbers: parsed.facets.supplierNumbers, deriveAmountFromUnitPrice: true,
            } : null,
          }));
        } catch (parseError) {
          setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, status: "error", error: parseError.message } : entry));
          await clientRef.current.release(item.itemId).catch(() => {});
        }
      }
    } finally { setProgress({ value: 100, label: "文件解析完成" }); setBusy(false); operationRef.current = false; }
  };
  const remove = async (item) => {
    if (operationRef.current) return;
    invalidate(); setFiles((current) => current.filter((entry) => entry.itemId !== item.itemId));
    await clientRef.current.release(item.itemId).catch(() => {});
  };
  const applyMapping = (source) => {
    invalidate();
    const columns = Object.values(source.mapping).filter(Boolean);
    let count = 0;
    setFiles(files.map((item) => {
      if (item.itemId === source.itemId || item.status !== "parsed" || !columns.every((column) => item.headers.includes(column))) return item;
      count += 1;
      return { ...item, mapping: { ...source.mapping }, validation: null };
    }));
    notify(`映射已套用到 ${count} 个兼容文件；各文件店铺与筛选保持原值。`);
  };
  const validate = async () => {
    if (operationRef.current || !ready || result) return;
    operationRef.current = true; setBusy(true); invalidate();
    try {
      await assertImportContext();
      const items = [];
      let hasErrors = false;
      for (let index = 0; index < files.length; index += 1) {
        const item = files[index];
        setProgress({ value: index / files.length * 100, label: `校验 ${index + 1}/${files.length}：${item.fileName}` });
        const validation = await clientRef.current.validate(item.itemId, item.mapping, { ...item.filterOptions, defaultStore: item.storeName, enforceSingleStore: true, period });
        setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, validation } : entry));
        hasErrors ||= validation.summary.errorCount > 0 || !validation.rows.length;
        items.push({ itemId: item.itemId, fileName: item.fileName, fileHash: item.fileHash, storeName: item.storeName,
          mapping: item.mapping, filterOptions: item.filterOptions, rows: validation.rows, summary: validation.summary });
      }
      if (hasErrors) throw new Error("部分文件有错误行或没有有效数据。请修正或明确移除问题文件后重新校验，整批尚未写入。");
      const input = { period, items };
      setPreview(await previewSalesImports(input)); setPayload(input);
    } catch (validationError) { setError(validationError.message); }
    finally { setBusy(false); operationRef.current = false; setProgress({ value: 100, label: "整批校验完成" }); }
  };
  const confirmImport = async () => {
    if (operationRef.current || result || !preview || !payload || (preview.requiresOverwrite && overwriteSignature !== preview.targetSignature)) return;
    operationRef.current = true; setBusy(true);
    try {
      await assertImportContext();
      setResult(await saveSalesImports({ ...payload, preview, overwriteSignature }));
      notify("整批处理完成，来源批次已保留。");
      for (const item of files) clientRef.current.release(item.itemId).catch(() => {});
    } catch (writeError) { invalidate(); setError(`整批未写入：${writeError.message}`); }
    finally { setBusy(false); operationRef.current = false; }
  };
  const ready = !contextBlocked && files.length > 0 && /^\d{4}-\d{2}$/.test(period) && files.every((item) => {
    const columns = Object.values(item.mapping ?? {}).filter(Boolean);
    return item.status === "parsed" && item.storeName.trim() && !validateSalesMapping(item.mapping, { defaultStore: item.storeName }).length && new Set(columns).size === columns.length;
  });
  return <main className="wizard-shell batch-import">
    <header className="wizard-topbar"><button disabled={busy} onClick={() => navigate(returnHref)}><X size={20} />{result ? returnLabel : "取消导入"}</button><strong>月度台账批量导入</strong></header>
    <section className="wizard-content">
      <div className="wizard-intro"><span className="batch-eyebrow">第一步 · 销售数据</span><h1>导入店铺台账</h1><p>选择同一个月的店铺文件，核对归属后统一预览、一次导入。导入后仍可以补充、更换或重新导入，不会锁死本月数据。</p></div>
      <section className="import-flow-guide" aria-label="月度核算流程">
        <div className="import-flow-guide-heading"><strong>月度核算流程</strong><span>这里只是建立数据，最终是否采用由人工决定。</span></div>
        <div className="import-flow-guide-steps">
          <span className="active"><b>1</b><strong>导入销售台账</strong><small>当前步骤</small></span>
          <span><b>2</b><strong>取得候选成本</strong><small>ERP、历史或人工</small></span>
          <span><b>3</b><strong>核对与更正</strong><small>人工更正优先</small></span>
          <span><b>4</b><strong>确认利润</strong><small>核对后再定稿</small></span>
        </div>
      </section>
      {contextBlocked ? <section className="wizard-card">{ledgerContext?.error ? <><p role="alert">{ledgerContext.error}</p><Button onClick={() => navigate('/ledger')}>选择账本</Button><Button onClick={() => setContextRetry(value => value + 1)}>重试</Button></> : <p role="status">正在读取目标账本月份…</p>}</section> : null}
      {!result ? <>
        <section className="wizard-card">
          <fieldset disabled={busy || contextBlocked} className="batch-fieldset">
            <div className="batch-period"><div><label htmlFor="ledger-period">账本月份</label><p id="batch-period-note">{requestedLedgerId ? '沿用当前账本月份' : '本批所有文件导入同一月份'}</p></div><input id="ledger-period" disabled={Boolean(requestedLedgerId)} aria-describedby="batch-period-note" className="text-input" type="month" value={period} onChange={(event) => { setPeriod(event.target.value); invalidate(); }} /></div>
            <div className="import-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFiles(event.dataTransfer.files); }}>
              <input ref={inputRef} type="file" multiple aria-label="选择月度销售台账文件" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => { loadFiles(event.target.files); event.target.value = ""; }} />
              <Upload size={26} /><div><strong>选择或拖入多个店铺文件</strong><p>CSV / TSV / XLSX / XLS，每文件最大 50 MB；工作簿仅读取第一工作表。</p></div>
              <Button onClick={() => inputRef.current?.click()}>添加文件</Button>{!files.length && <Button variant="ghost" onClick={() => loadFiles([sampleFile()])}>使用示例</Button>}
            </div>
          </fieldset>
          {busy && <div className="import-progress"><ProgressBar value={progress.value} label={progress.label} /></div>}
          <div className="batch-files">{files.map((item, index) => <section className="batch-file" key={item.itemId}>
            <div className="batch-file-heading"><span className="batch-file-icon"><FileSpreadsheet size={21} /></span><div><strong>{item.fileName}</strong><span className="batch-file-status">文件 {index + 1}{item.rowCount != null ? ` · ${item.rowCount.toLocaleString("zh-CN")} 行` : ""} · {item.status === "error" ? "解析失败" : item.status === "queued" ? `正在解析 ${item.progress}%` : item.validation ? item.validation.summary.errorCount || !item.validation.rows.length ? "需要处理" : "已校验" : "已解析，待校验"}</span></div><div className="batch-store form-field"><label htmlFor={`store-${item.itemId}`}>所属店铺</label><input id={`store-${item.itemId}`} aria-describedby={`store-note-${item.itemId}`} aria-invalid={!item.storeName.trim()} className="text-input" disabled={busy} value={item.storeName} onChange={(event) => update(item.itemId, { storeName: event.target.value })} /><small id={`store-note-${item.itemId}`}>{item.storeName.trim() ? "文件名仅作建议，请核对店铺归属。" : "请填写所属店铺后再校验。"}</small></div><Button disabled={busy} variant="ghost" aria-label={`移除 ${item.fileName}`} onClick={() => remove(item)}>移除</Button></div>
            {item.status === "error" ? <p role="alert" className="import-error">解析失败：{item.error}</p> : item.status === "queued" ? <p>等待或正在解析 · {item.progress}%</p> : <fieldset disabled={busy} className="batch-fieldset">
              {files.some((other) => other.itemId !== item.itemId && other.fileHash === item.fileHash) && <p className="import-error" role="alert">相同文件内容重复，请移除重复文件并核对店铺。</p>}

              <details className="batch-advanced"><summary>高级选项 · {Object.values(item.mapping).filter(Boolean).length} 列映射{item.filterOptions ? ` · 已选 ${item.filterOptions.movementTypes.length} 类变动 / ${item.filterOptions.supplierNumbers.length} 个货号` : ""}</summary>
              <details><summary>字段映射 · {item.rowCount} 行来源数据</summary>
                <Button variant="ghost" onClick={() => applyMapping(item)}>套用到兼容文件</Button>
                <div className="mapping-table">{salesFields.map((field) => <div className="mapping-row" key={field.key}>
                  <div><strong>{field.label}{field.required ? " *" : ""}</strong><small>{field.description}</small></div>
                  <label className="mapping-select"><select aria-label={`${item.fileName} ${field.label}`} value={item.mapping[field.key] ?? ""} onChange={(event) => update(item.itemId, { mapping: { ...item.mapping, [field.key]: event.target.value } })}><option value="">-- 未映射 --</option>{item.headers.map((header) => <option key={header}>{header}</option>)}</select></label>
                  <code>{String(item.previewRows[0]?.[item.mapping[field.key]] ?? "")}</code>
                </div>)}</div>
              </details>

              {item.preset === "ledger_report" && <details open><summary>文件筛选（数量 × 单价计算销售原额）</summary>{[["movementTypes", "变动类型", item.facets.movementTypes], ["supplierNumbers", "供方货号", item.facets.supplierNumbers]].map(([key, label, options]) => <div className="batch-filters" key={key}><strong>{label}</strong><Button variant="ghost" onClick={() => update(item.itemId, { filterOptions: { ...item.filterOptions, [key]: [...options] } })}>全选</Button><Button variant="ghost" onClick={() => update(item.itemId, { filterOptions: { ...item.filterOptions, [key]: [] } })}>清空</Button><div>{options.map((value) => <label key={value}><input type="checkbox" checked={item.filterOptions[key].includes(value)} onChange={(event) => update(item.itemId, { filterOptions: { ...item.filterOptions, [key]: event.target.checked ? [...item.filterOptions[key], value] : item.filterOptions[key].filter((entry) => entry !== value) } })} />{value}</label>)}</div></div>)}</details>}
              </details>
              {validateSalesMapping(item.mapping, { defaultStore: item.storeName }).map((issue) => <p className="import-error" key={issue.key}>{issue.message}</p>)}
              {new Set(Object.values(item.mapping).filter(Boolean)).size !== Object.values(item.mapping).filter(Boolean).length && <p className="import-error">同一来源列不能重复映射。</p>}
              {item.validation && <div className="batch-validation"><p>有效 {item.validation.rows.length} 行 · 筛除/规则跳过 {item.validation.summary.ignoredCount} 行 · 错误 {item.validation.summary.errorCount} 行</p>{item.validation.summary.errors.map((issue) => <p className="import-error" key={issue.sourceRow}>第 {issue.sourceRow} 行：{issue.messages.join("；")}</p>)}{!!item.validation.summary.platformSkcMissingCount && <p>有 {item.validation.summary.platformSkcMissingCount} 行缺少平台 SKC，无法生成对应 ERP 查询。</p>}</div>}
            </fieldset>}
          </section>)}</div>
          <div className="wizard-card-footer"><span>{files.length ? `${files.length} 个文件 · 核对店铺后预览本次导入` : "添加文件后开始校验"}</span><Button variant="primary" disabled={!ready || busy} loading={busy} onClick={validate}>统一校验与预览</Button></div>
        </section>
        {error && <div className="import-error" role="alert"><AlertCircle size={18} />{error}</div>}
        {preview && <section ref={previewRef} tabIndex={-1} aria-label={`整批预览 ${period}`} className="wizard-card batch-preview"><h2>整批预览 · {period}</h2>
          {preview.items.map((item) => <article key={item.itemId}><h3>{item.storeName} · {item.fileName}</h3><p>{item.status === "skipped_duplicate" ? "已生效重复，本次跳过" : `新增 ${item.addedGroupCount} 组，替换 ${item.replacedGroupCount} 组`} · 有效 {item.validRowCount} / 跳过 {item.ignoredRowCount} / 错误 {item.errorCount}</p><Totals summary={item.summary} />
            {item.overlaps.map((overlap) => <div className="batch-overlap" key={overlap.groupKey}><strong>覆盖：{overlap.store} / {overlap.platformSkc || "无 SKC"} / {overlap.supplierNumber || "无供方货号"}</strong><p>原数据 {overlap.before.rowCount} 行：<Totals summary={overlap.before} /></p><p>新数据 {overlap.after.rowCount} 行：<Totals summary={overlap.after} /></p></div>)}
          </article>)}
          <p><strong>本次写入：</strong><Totals summary={preview.summary} /></p><p><strong>导入后全月：</strong><Totals summary={preview.finalSummary} /></p>
          {preview.requiresOverwrite && <label className="batch-overwrite"><input disabled={busy} type="checkbox" checked={overwriteSignature === preview.targetSignature} onChange={(event) => setOverwriteSignature(event.target.checked ? preview.targetSignature : null)} />我确认仅替换以上列出的重叠分组；其他店铺与分组保留。</label>}
          <div className="batch-submit"><p>核对以上文件、店铺及 {period} 月份后确认。修改配置需重新校验。</p><Button variant="primary" disabled={busy || (preview.requiresOverwrite && overwriteSignature !== preview.targetSignature)} loading={busy} onClick={confirmImport}>确认导入</Button></div>
        </section>}
      </> : <section className="wizard-card batch-preview"><h2>整批处理完成 · {period}</h2>{result.items.map((item) => <article key={item.itemId}><h3>{item.fileName} · {item.storeName}</h3><p>{item.status === "imported" ? `已导入：新增 ${item.addedGroupCount} 组，替换 ${item.replacedGroupCount} 组` : "已生效重复，跳过"}</p><p>来源批次：<code>{item.batchId}</code></p><Totals summary={item.summary} /></article>)}<p>全月：<Totals summary={result.finalSummary} /></p><Button variant="primary" icon={ArrowRight} onClick={() => navigate(returnHref)}>{returnLabel}</Button></section>}
    </section>
  </main>;
}
