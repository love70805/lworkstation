import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, FileSpreadsheet, Upload, X } from "lucide-react";
import { Button, ProgressBar, useToast } from "../components/UI";
import { getActiveMemberContext, listLedgerSummaries, previewSalesImports, saveSalesImports } from "../data/database";
import { importReturnHref } from "../lib/importNavigation";
import { summarizeImportPeriod } from "../lib/importPeriod";
import { createImportWorkerClient } from "../lib/importWorkerClient";
import { LEDGER_REPORT_MOVEMENT_TYPES, salesFields, validateSalesMapping } from "../lib/salesImport";
import { createSalesSourceCoverage } from "../domain/selectionSalesLabels";

const ACCEPTED_EXTENSIONS = new Set(["csv", "tsv", "xlsx", "xls"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
async function sha256File(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function sampleFile() {
  return new File(["供方货号,SKC,平台SKU,数量,金额\nSUP-001,SKC-001,000123,23,1245.50"], "示例店铺.csv", { type: "text/csv" });
}
const money = (value) => Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function sourceIsFiltered(item) {
  if (!item.facets || !item.filterOptions) return false;
  const full = (key, expected) => !Array.isArray(item.filterOptions[key]) || expected.every(value => item.filterOptions[key].includes(value));
  return !full("supplierNumbers", item.facets.supplierNumbers ?? []) || !full("movementTypes", (item.facets.movementTypes ?? []).filter(type => LEDGER_REPORT_MOVEMENT_TYPES.includes(type)));
}
const sourceScope = item => sourceIsFiltered(item) || item.sourceScope === "partial" ? "partial" : "full_month";
function Totals({ summary }) {
  return <span>数量 {summary.quantity} · 销售原额 ¥{money(summary.revenue)} · 扣款 ¥{money(summary.penalty)}</span>;
}


function OverlapPreview({ item }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.ceil(item.overlaps.length / 30);
  if (!item.overlaps.length) return null;
  return <div>
    <p>影响范围共 {item.overlaps.length} 组{item.replacementScope === "store_month" ? "；将完整替换本店本月，移除未出现在新文件中的旧分组。" : "；仅替换本文件涉及的重叠分组。"}</p>
    {item.overlaps.slice((page - 1) * 30, page * 30).map(overlap => <div className="batch-overlap" key={overlap.groupKey}><strong>{overlap.removed ? "移除旧分组：" : "覆盖："}{overlap.store} / {overlap.platformSkc || "无 SKC"} / {overlap.supplierNumber || "无供方货号"}</strong><p>原数据 {overlap.before.rowCount} 行：<Totals summary={overlap.before} /></p><p>新数据 {overlap.after.rowCount} 行：<Totals summary={overlap.after} /></p></div>)}
    {pageCount > 1 && <nav className="batch-submit" aria-label={`${item.fileName} 覆盖范围分页`}><Button variant="ghost" disabled={page === 1} aria-label={`${item.fileName} 上一页覆盖范围`} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} / {pageCount} 页 · 共 {item.overlaps.length} 组均受影响</span><Button variant="ghost" disabled={page === pageCount} aria-label={`${item.fileName} 下一页覆盖范围`} onClick={() => setPage(value => value + 1)}>下一页</Button></nav>}
  </div>;
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
  const periodChoiceRef = useRef(false);
  const generationRef = useRef(0);
  const abortRef = useRef(null);
  const attemptedRef = useRef("");
  const validateRef = useRef(null);
  const activeJobsRef = useRef(new Set());
  const inspectionSequenceRef = useRef(new Map());
  const [files, setFiles] = useState([]);
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ value: 0, label: "" });
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [payload, setPayload] = useState(null);
  const [overwriteSignature, setOverwriteSignature] = useState(null);
  const [result, setResult] = useState(null);
  const contextReady = !requestedLedgerId || ledgerContext?.id === requestedLedgerId;
  const contextBlocked = !contextReady || Boolean(ledgerContext?.error);
  const periodEvidence = summarizeImportPeriod(files, requestedLedgerId ? period : null);
  const suggestedPeriod = periodEvidence.suggestedPeriod;
  useEffect(() => {
    if (!result && !requestedLedgerId && !periodChoiceRef.current) setPeriod(suggestedPeriod ?? "");
  }, [requestedLedgerId, suggestedPeriod, result]);
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

  const makeClient = () => createImportWorkerClient((value, jobId, details) => {
    setFiles(current => current.map(item => item.itemId === jobId ? { ...item, progress: value, progressLabel: details?.total ? `${details.stage} ${details.completed.toLocaleString("zh-CN")} / ${details.total.toLocaleString("zh-CN")} 行` : details?.stage ?? "正在读取" } : item));
  });
  useEffect(() => {
    clientRef.current = makeClient();
    activeJobsRef.current.clear();
    return () => { generationRef.current += 1; abortRef.current?.abort(); clientRef.current?.terminate(); };
  }, []);
  const cancel = () => {
    if (abortRef.current) { abortRef.current.abort(); return; }
    generationRef.current += 1;
    clientRef.current?.terminate();
    clientRef.current = makeClient();
    inspectionSequenceRef.current.clear();
    activeJobsRef.current.clear();
    setFiles([]); setPreview(null); setPayload(null); setBusy(false); operationRef.current = false;
    setError("解析已取消，尚未写入任何数据。可重新选择文件。");
  };
  const invalidate = () => { setPreview(null); setPayload(null); setOverwriteSignature(null); setError(""); };
  const ensureJob = async (item) => {
    if (activeJobsRef.current.has(item.itemId)) return;
    const parsed = await clientRef.current.parse(item.file, item.itemId, item.selectedSheet);
    if (parsed.type === "sheet-selection-required") throw new Error("请先选择此文件的实际明细页。");
    activeJobsRef.current.add(item.itemId);
  };
  const inspectPeriod = async (item) => {
    const sequence = (inspectionSequenceRef.current.get(item.itemId) ?? 0) + 1;
    inspectionSequenceRef.current.set(item.itemId, sequence);
    try {
      await ensureJob(item);
      const { evidence } = await clientRef.current.inspectPeriod(item.itemId, item.mapping, {
        ...item.filterOptions, defaultStore: item.storeName, enforceSingleStore: true,
      });
      if (inspectionSequenceRef.current.get(item.itemId) === sequence) {
        setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, periodEvidence: evidence } : entry));
      }
    } catch (inspectionError) {
      if (inspectionSequenceRef.current.get(item.itemId) === sequence) {
        setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? {
          ...entry, periodEvidence: { distribution: [], suggestedPeriod: null, errorCount: 1 }, periodInspectionError: inspectionError.message,
        } : entry));
      }
    }
  };
  const update = (itemId, patch) => {
    invalidate();
    const current = files.find((item) => item.itemId === itemId);
    if (!current) return;
    const next = { ...current, ...patch, validation: null, periodEvidence: null, periodInspectionError: null };
    setFiles((entries) => entries.map((item) => item.itemId === itemId ? next : item));
    void inspectPeriod(next);
  };
  const loadFiles = async (selection, retryItem = null, selectedSheet = null) => {
    if (operationRef.current || !selection.length || result || contextBlocked) return;
    const generation = generationRef.current;
    operationRef.current = true; setBusy(true); invalidate();
    const additions = Array.from(selection).map((file) => ({ file, sourceScope: "full_month", importMode: "append", fileName: file.name, itemId: crypto.randomUUID(), storeName: file.name.replace(/\.[^.]+$/, "").trim(), status: "queued", progress: 0 }));
    if (retryItem) additions[0] = { ...retryItem, status: "queued", error: null, selectedSheet };
    setFiles((current) => retryItem ? current.map(item => item.itemId === retryItem.itemId ? additions[0] : item) : [...current, ...additions]);
    try {
      for (let index = 0; index < additions.length; index += 1) {
        if (generation !== generationRef.current) return;
        const item = additions[index];
        setProgress({ value: index / additions.length * 100, label: `解析 ${index + 1}/${additions.length}：${item.fileName}` });
        try {
          if (!ACCEPTED_EXTENSIONS.has(item.fileName.split(".").pop()?.toLowerCase())) throw new Error("请选择 CSV、TSV、XLSX 或 XLS 文件。");
          if (item.file.size > MAX_FILE_SIZE) throw new Error("单文件不能超过 50 MB。");
          const fileHash = await sha256File(item.file);
          if (generation !== generationRef.current) return;
          const parsed = await clientRef.current.parse(item.file, item.itemId, selectedSheet);
          if (generation !== generationRef.current) return;
          if (parsed.type === "sheet-selection-required") {
            setFiles(current => current.map(entry => entry.itemId === item.itemId ? { ...entry, ...parsed, fileHash, status: "sheet_required" } : entry));
            continue;
          }
          activeJobsRef.current.add(item.itemId);
          const filterOptions = parsed.preset === "ledger_report" ? {
            movementTypes: LEDGER_REPORT_MOVEMENT_TYPES.filter((type) => parsed.facets.movementTypes.includes(type)),
            deriveAmountFromUnitPrice: true,
          } : null;
          const inspected = await clientRef.current.inspectPeriod(item.itemId, parsed.suggestedMapping, {
            ...filterOptions, defaultStore: item.storeName, enforceSingleStore: true,
          });
          if (generation !== generationRef.current) return;
          setFiles((current) => current.map((entry) => entry.itemId !== item.itemId ? entry : {
            ...entry, ...parsed, fileHash, mapping: parsed.suggestedMapping, status: "parsed", progress: 100,
            filterOptions, periodEvidence: inspected.evidence,
            validation: inspected.evidence.validationSummary ? { summary: inspected.evidence.validationSummary } : null,
          }));
        } catch (parseError) {
          if (generation !== generationRef.current) return;
          setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, status: "error", error: parseError.message } : entry));
          await clientRef.current.release(item.itemId).catch(() => {});
        }
      }
    } finally { if (generation === generationRef.current) { setProgress({ value: 100, label: "文件解析完成" }); setBusy(false); operationRef.current = false; } }
  };
  const remove = async (item) => {
    if (operationRef.current) return;
    inspectionSequenceRef.current.delete(item.itemId);
    activeJobsRef.current.delete(item.itemId);
    invalidate(); setFiles((current) => current.filter((entry) => entry.itemId !== item.itemId));
    await clientRef.current.release(item.itemId).catch(() => {});
  };
  const applyMapping = (source) => {
    invalidate();
    const columns = Object.values(source.mapping).filter(Boolean);
    let count = 0;
    const updated = files.map((item) => {
      if (item.itemId === source.itemId || item.status !== "parsed" || !columns.every((column) => item.headers.includes(column))) return item;
      count += 1;
      return { ...item, mapping: { ...source.mapping }, validation: null, periodEvidence: null };
    });
    setFiles(updated);
    updated.filter((item) => item.periodEvidence === null).forEach((item) => { void inspectPeriod(item); });
    notify(`映射已套用到 ${count} 个兼容文件；各文件店铺保持原值。`);
  };
  const validate = async () => {
    if (operationRef.current || !ready || result) return;
    const generation = generationRef.current;
    operationRef.current = true; setBusy(true); invalidate();
    try {
      await assertImportContext();
      const items = [];
      let hasErrors = false;
      for (let index = 0; index < files.length; index += 1) {
        const item = files[index];
        setProgress({ value: index / files.length * 100, label: `校验 ${index + 1}/${files.length}：${item.fileName}` });
        if (generation !== generationRef.current) return;
        await ensureJob(item);
        const validation = await clientRef.current.validate(item.itemId, item.mapping, { ...item.filterOptions, defaultStore: item.storeName, enforceSingleStore: true, period });
        if (generation !== generationRef.current) return;
        const otherMonths = (item.periodEvidence?.distribution ?? []).filter(entry => entry.month !== period);
        if (otherMonths.length) {
          validation.summary = { ...validation.summary, errorCount: validation.summary.errorCount + 1, errors: [...validation.summary.errors, { sourceRow: "月份", messages: [`来源含 ${otherMonths.map(entry => entry.month).join("、")}，与账本 ${period} 不一致，请按月处理此文件。`] }] };
        }
        setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, validation: { summary: validation.summary } } : entry));
        hasErrors ||= validation.summary.errorCount > 0 || !validation.rows.length;
        items.push({ itemId: item.itemId, fileName: item.fileName, fileHash: item.fileHash, storeName: item.storeName,
          mapping: item.mapping, filterOptions: item.filterOptions, rows: validation.rows, summary: validation.summary,
          sourceCoverage: createSalesSourceCoverage({ period, storeName: item.storeName, scope: sourceScope(item) }),
          importMode: sourceScope(item) === "full_month" ? item.importMode ?? "append" : "append" });
      }
      // Normalized rows are sufficient for the preview. Free the XLSX heap;
      // a later mapping/store edit lazily reparses its original File.
      clientRef.current?.terminate();
      clientRef.current = makeClient();
      activeJobsRef.current.clear();
      if (hasErrors) throw new Error("部分文件有错误行或没有有效数据。请修正或明确移除问题文件后重新校验，整批尚未写入。");
      const input = { period, items };
      abortRef.current = new AbortController();
      setProgress({ value: null, label: "正在核对重复文件与替换范围…" });
      const nextPreview = await previewSalesImports({ ...input, signal: abortRef.current.signal });
      if (generation !== generationRef.current) return;
      setPreview(nextPreview); setPayload(input);
    } catch (validationError) { if (generation === generationRef.current) setError(validationError.message); }
    finally { if (generation === generationRef.current) { abortRef.current = null; setBusy(false); operationRef.current = false; setProgress({ value: 100, label: "整批校验完成" }); } }
  };
  const confirmImport = async () => {
    if (operationRef.current || result || !preview || !payload || (preview.requiresOverwrite && overwriteSignature !== preview.targetSignature)) return;
    operationRef.current = true; setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await assertImportContext();
      if (controller.signal.aborted) throw new Error("导入已取消，尚未写入数据。");
      setProgress({ value: null, label: "正在核对并原子写入，完成前可取消" });
      setResult(await saveSalesImports({ ...payload, preview, overwriteSignature, signal: controller.signal,
        onProgress: ({ completed, total }) => setProgress({ value: completed / total * 100, label: `写入 ${completed.toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")} 行` }) }));
      notify("整批处理完成，来源批次已保留。");
      // The result contains summaries only. Release raw workbook jobs and the
      // normalized payload immediately after the atomic transaction commits.
      clientRef.current?.terminate();
      setFiles([]); setPayload(null); setPreview(null);
    } catch (writeError) { invalidate(); setError(`整批未写入：${writeError.message}`); }
    finally { abortRef.current = null; setBusy(false); operationRef.current = false; }
  };
  const ready = !contextBlocked && files.length > 0 && /^\d{4}-\d{2}$/.test(period) && !periodEvidence.awaitingEvidence && files.every((item) => {
    const columns = Object.values(item.mapping ?? {}).filter(Boolean);
    return item.status === "parsed" && item.storeName.trim() && !validateSalesMapping(item.mapping, { defaultStore: item.storeName }).length && new Set(columns).size === columns.length;
  });
  const configurationKey = JSON.stringify([period, files.map(item => [item.itemId, item.status, item.storeName, item.mapping, item.filterOptions, item.sourceScope, item.importMode, item.periodEvidence]), contextBlocked]);
  validateRef.current = validate;
  useEffect(() => {
    if (!ready || busy || result || attemptedRef.current === configurationKey) return;
    const timer = setTimeout(() => { attemptedRef.current = configurationKey; void validateRef.current(); }, 100);
    return () => clearTimeout(timer);
  }, [configurationKey, ready, busy, result]);
  return <main className="wizard-shell batch-import">
    <header className="wizard-topbar"><button disabled={busy} onClick={() => navigate(returnHref)}><X size={20} />{result ? returnLabel : "取消导入"}</button><strong>月度台账批量导入</strong></header>
    <section className="wizard-content">
      <div className="wizard-intro"><span className="batch-eyebrow">第一步 · 销售数据</span><h1>导入店铺台账</h1><p>选择同一个月的店铺文件，自动识别明细、校验并显示概览，核对归属后一次导入。导入后仍可以补充、更换或重新导入，不会锁死本月数据。</p></div>
      <section className="import-flow-guide" aria-label="月度核算流程">
        <div className="import-flow-guide-heading"><strong>月度核算流程</strong><span>正常 ERP 成本回传后自动采用；异常和最终报告仍需核对。</span></div>
        <div className="import-flow-guide-steps">
          <span className="active"><b>1</b><strong>导入销售台账</strong><small>当前步骤</small></span>
          <span><b>2</b><strong>取得正式成本</strong><small>ERP 自动采用</small></span>
          <span><b>3</b><strong>核对与更正</strong><small>人工更正优先</small></span>
          <span><b>4</b><strong>确认利润</strong><small>核对后再定稿</small></span>
        </div>
      </section>
      {contextBlocked ? <section className="wizard-card">{ledgerContext?.error ? <><p role="alert">{ledgerContext.error}</p><Button onClick={() => navigate('/ledger')}>选择账本</Button><Button onClick={() => setContextRetry(value => value + 1)}>重试</Button></> : <p role="status">正在读取目标账本月份…</p>}</section> : null}
      {!result ? <>
        <section className="wizard-card">
          <fieldset disabled={busy || contextBlocked} className="batch-fieldset">
            <div className="batch-period"><div><label htmlFor="ledger-period">账本月份</label><p id="batch-period-note">{requestedLedgerId ? '沿用当前账本月份' : suggestedPeriod && !periodChoiceRef.current ? `按销售台账“添加时间”识别：${suggestedPeriod}` : '请依据销售台账日期明确选择月份'}</p></div><input id="ledger-period" disabled={Boolean(requestedLedgerId)} aria-describedby="batch-period-note batch-period-evidence" className="text-input" type="month" value={period} onChange={(event) => { periodChoiceRef.current = true; setPeriod(event.target.value); invalidate(); }} /></div>
            {files.length ? <p id="batch-period-evidence" className={periodEvidence.conflictsExisting || periodEvidence.months.length > 1 || periodEvidence.missingCount || periodEvidence.invalidCount ? "batch-period-warning" : "batch-period-evidence"} role="status">
              {periodEvidence.awaitingEvidence ? "正在核对文件中的销售台账日期…" : <>来源月份：{periodEvidence.months.length ? periodEvidence.months.map(({ month, count }) => `${month}（${count} 行）`).join("、") : "未识别到有效日期"}。{periodEvidence.missingCount ? `缺日期 ${periodEvidence.missingCount} 行。` : ""}{periodEvidence.invalidCount ? `无效日期 ${periodEvidence.invalidCount} 行。` : ""}{periodEvidence.errorCount ? `其他错误 ${periodEvidence.errorCount} 行。` : ""}{periodEvidence.conflictsExisting ? ` 来源月份与已有账本 ${period} 不一致，仍沿用账本月份。` : !requestedLedgerId && !suggestedPeriod ? "请核对文件并手动选择账本月份。" : ""}</>}
            </p> : null}
            <div className="import-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFiles(event.dataTransfer.files); }}>
              <input ref={inputRef} type="file" multiple aria-label="选择月度销售台账文件" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => { loadFiles(event.target.files); event.target.value = ""; }} />
              <Upload size={26} /><div><strong>选择或拖入多个店铺文件</strong><p>CSV / TSV / XLSX / XLS，每文件最大 50 MB；自动识别实际明细页；多个候选时仅需为该文件选择。</p></div>
              <Button onClick={() => inputRef.current?.click()}>添加文件</Button>{!files.length && <Button variant="ghost" onClick={() => loadFiles([sampleFile()])}>使用示例</Button>}
            </div>
          </fieldset>
          {busy && <div className="import-progress" role="status">{progress.value == null ? <span>{progress.label}</span> : <ProgressBar value={progress.value} label={progress.label} />}<Button onClick={cancel}>取消当前处理</Button></div>}
          <div className="batch-files">{files.map((item, index) => <section className="batch-file" key={item.itemId}>
            <div className="batch-file-heading"><span className="batch-file-icon"><FileSpreadsheet size={21} /></span><div><strong>{item.fileName}</strong><span className="batch-file-status">文件 {index + 1}{item.rowCount != null ? ` · ${item.rowCount.toLocaleString("zh-CN")} 行` : ""} · {item.status === "error" ? "解析失败" : item.status === "queued" ? (item.progressLabel || "等待解析") : item.validation ? item.validation.summary.errorCount || !item.validation.summary.validRowCount ? "需要处理" : "已校验" : item.status === "sheet_required" ? "请选择明细页" : "自动校验中"}</span></div><div className="batch-store form-field"><label htmlFor={`store-${item.itemId}`}>所属店铺</label><input id={`store-${item.itemId}`} aria-describedby={`store-note-${item.itemId}`} aria-invalid={!item.storeName.trim()} className="text-input" disabled={busy} value={item.storeName} onChange={(event) => update(item.itemId, { storeName: event.target.value })} /><small id={`store-note-${item.itemId}`}>{item.storeName.trim() ? "文件名仅作建议，请核对店铺归属。" : "请填写所属店铺后再校验。"}</small></div><Button disabled={busy} variant="ghost" aria-label={`移除 ${item.fileName}`} onClick={() => remove(item)}>移除</Button></div>
            {item.status === "error" ? <p role="alert" className="import-error">解析失败：{item.error}</p> : item.status === "queued" ? <p role="status">{item.progressLabel || "等待或正在读取工作簿…"}</p> : item.status === "sheet_required" ? <div className="form-field"><label htmlFor={`sheet-${item.itemId}`}>发现多个明细页，请选择本次来源</label><select id={`sheet-${item.itemId}`} className="text-input" defaultValue="" onChange={event => loadFiles([item.file], item, event.target.value)}><option value="" disabled>选择明细页</option>{item.sheetCandidates.map(name => <option key={name}>{name}</option>)}</select></div> : <fieldset disabled={busy} className="batch-fieldset">
              {files.some((other) => other.itemId !== item.itemId && other.fileHash === item.fileHash) && <p className="import-error" role="alert">相同文件内容重复，请移除重复文件并核对店铺。</p>}
              <p className="batch-period-evidence">{item.selectedSheet ? `明细页：${item.selectedSheet} · ` : ""}来源月份：{item.periodEvidence?.distribution?.length ? item.periodEvidence.distribution.map(entry => `${entry.month}（${entry.count.toLocaleString("zh-CN")} 行）`).join("、") : "待核对"}</p>
              {item.periodEvidence?.distribution?.length > 1 && <p className="import-error" role="alert">此文件包含多个月份，请按月处理后再导入。</p>}
              {item.periodInspectionError && <p className="import-error" role="alert">{item.periodInspectionError}</p>}

              <p className="batch-period-evidence" role="status">{sourceScope(item) === "full_month" ? `完整月台账：${period || "待确认月份"}` : `部分来源：${period || "待确认月份"}`} · {item.storeName}。{sourceScope(item) === "full_month" ? "销量标签统计月末最后七天；缺日期的商品仍显示数据不足。" : "本文件仍可核算，但不足以证明未出现商品为零销量。"}</p>
              <details className="batch-advanced"><summary>高级选项 · {Object.values(item.mapping).filter(Boolean).length} 列映射{item.filterOptions ? ` · ${item.filterOptions.movementTypes.length} 类销售变动` : ""}</summary>
              <div className="form-field"><label htmlFor={`source-scope-${item.itemId}`}>来源范围</label><select id={`source-scope-${item.itemId}`} className="text-input" value={sourceScope(item)} onChange={event => update(item.itemId, { sourceScope: event.target.value, importMode: event.target.value === "partial" ? "append" : item.importMode })}><option value="full_month" disabled={sourceIsFiltered(item)}>完整历史月台账</option><option value="partial">部分日期或筛选商品</option></select>{sourceIsFiltered(item) && <small>已缩小商品或发货类型筛选，按部分来源保存；恢复全范围后可选择完整月。</small>}</div>
              <div className="form-field"><label htmlFor={`import-mode-${item.itemId}`}>导入方式</label><select id={`import-mode-${item.itemId}`} className="text-input" value={sourceScope(item) === "partial" ? "append" : item.importMode ?? "append"} onChange={event => update(item.itemId, { importMode: event.target.value })}><option value="append">追加并替换重叠分组</option><option value="replace_store_month" disabled={sourceScope(item) !== "full_month"}>完整替换本店本月</option></select><small>默认保留未重叠分组。重新导入完整月文件时，可选择完整替换并核对预览，避免旧来源残留使七天标签无法计算。</small></div>
              <details><summary>字段映射 · {item.rowCount} 行来源数据</summary>
                <Button variant="ghost" onClick={() => applyMapping(item)}>套用到兼容文件</Button>
                <div className="mapping-table">{salesFields.map((field) => <div className="mapping-row" key={field.key}>
                  <div><strong>{field.label}{field.required ? " *" : ""}</strong><small>{field.description}</small></div>
                  <label className="mapping-select"><select aria-label={`${item.fileName} ${field.label}`} value={item.mapping[field.key] ?? ""} onChange={(event) => update(item.itemId, { mapping: { ...item.mapping, [field.key]: event.target.value } })}><option value="">-- 未映射 --</option>{item.headers.map((header) => <option key={header}>{header}</option>)}</select></label>
                  <code>{String(item.previewRows[0]?.[item.mapping[field.key]] ?? "")}</code>
                </div>)}</div>
              </details>


              </details>
              {validateSalesMapping(item.mapping, { defaultStore: item.storeName }).map((issue) => <p className="import-error" key={issue.key}>{issue.message}</p>)}
              {new Set(Object.values(item.mapping).filter(Boolean)).size !== Object.values(item.mapping).filter(Boolean).length && <p className="import-error">同一来源列不能重复映射。</p>}
              {item.validation && <div className="batch-validation"><p>有效 {item.validation.summary.validRowCount} 行 · 业务规则排除 {item.validation.summary.ignoredCount} 行 · 错误 {item.validation.summary.errorCount} 行</p>{item.validation.summary.errors.map((issue) => <p className="import-error" key={issue.sourceRow}>第 {issue.sourceRow} 行：{issue.messages.join("；")}</p>)}{!!item.validation.summary.platformSkcMissingCount && <p>有 {item.validation.summary.platformSkcMissingCount} 行缺少平台 SKC，无法生成对应 ERP 查询。</p>}</div>}
            </fieldset>}
          </section>)}</div>
          <div className="wizard-card-footer"><span>{files.length ? `${files.length} 个文件 · 已自动解析与校验` : "添加文件后自动校验"}</span>{error && ready && <Button disabled={busy} onClick={validate}>重新校验</Button>}</div>
        </section>
        {error && <div className="import-error" role="alert"><AlertCircle size={18} />{error}</div>}
        {preview && <section ref={previewRef} tabIndex={-1} aria-label={`整批预览 ${period}`} className="wizard-card batch-preview"><h2>整批预览 · {period}</h2>
          {preview.items.map((item) => <article key={item.itemId}><h3>{item.storeName} · {item.fileName}</h3><p>{item.status === "skipped_duplicate" ? "已生效重复，本次跳过" : `新增 ${item.addedGroupCount} 组，替换 ${item.replacedGroupCount} 组`} · {item.removedGroupCount ? `移除 ${item.removedGroupCount} 个旧分组 · ` : ""}有效 {item.validRowCount} / 跳过 {item.ignoredRowCount} / 错误 {item.errorCount}</p><p>{item.sourceCoverage?.scope === "full_month" ? "完整月台账" : "部分或旧来源"} · {period}{item.replacementScope === "store_month" ? " · 本店本月完整替换" : " · 按分组追加或替换"}</p><Totals summary={item.summary} />
            <OverlapPreview item={item} />
          </article>)}
          <p><strong>本次写入：</strong><Totals summary={preview.summary} /></p><p><strong>导入后全月：</strong><Totals summary={preview.finalSummary} /></p>
          {preview.requiresOverwrite && <label className="batch-overwrite"><input disabled={busy} type="checkbox" checked={overwriteSignature === preview.targetSignature} onChange={(event) => setOverwriteSignature(event.target.checked ? preview.targetSignature : null)} />我确认以上文件的全部替换范围（含分页内容）；本店本月完整替换会同时移除未出现在新文件中的旧分组。</label>}
          <div className="batch-submit"><p>核对以上文件、店铺及 {period} 月份后确认。修改配置后会自动重新校验。</p><Button variant="primary" disabled={busy || (preview.requiresOverwrite && overwriteSignature !== preview.targetSignature)} loading={busy} onClick={confirmImport}>导入</Button></div>
        </section>}
      </> : <section className="wizard-card batch-preview"><h2>整批处理完成 · {period}</h2>{result.items.map((item) => <article key={item.itemId}><h3>{item.fileName} · {item.storeName}</h3><p>{item.status === "imported" ? `已导入：新增 ${item.addedGroupCount} 组，替换 ${item.replacedGroupCount} 组` : "已生效重复，跳过"}</p><p>来源批次：<code>{item.batchId}</code></p><Totals summary={item.summary} /></article>)}<p>全月：<Totals summary={result.finalSummary} /></p><Button variant="primary" icon={ArrowRight} onClick={() => navigate(returnHref)}>{returnLabel}</Button></section>}
    </section>
  </main>;
}
