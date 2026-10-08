import ImportSupplierPicker from '../components/ImportSupplierPicker';
import ImportMovementPicker from '../components/ImportMovementPicker';
import { readImportPreference, restoreImportPreference, saveImportNumbers, parseImportKeywords, matchImportNumberSuffixes } from '../lib/importSupplierPreferences';
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, FileSpreadsheet, Upload, X } from "lucide-react";
import { Button, ProgressBar, useToast } from "../components/UI";
import { getActiveMemberContext, listLedgerSummaries, previewSalesImports, saveSalesImports } from "../data/database";
import { importReturnHref } from "../lib/importNavigation";
import { buildProfitHref } from "../lib/profitFilter";
import { summarizeImportPeriod } from "../lib/importPeriod";
import { clearImportStages, removeImportStage } from "../lib/salesImportStage";
import { createImportWorkerClient } from "../lib/importWorkerClient";
import { LEDGER_REPORT_MOVEMENT_TYPES, salesFields, suggestMappings, validateSalesMapping } from "../lib/salesImport";
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
  const types = item.facets.movementTypes ?? [];
  const expected = item.preset === "ledger_report" ? types.filter(type => LEDGER_REPORT_MOVEMENT_TYPES.includes(type)) : types;
  return !full("movementTypes", expected);
}
const sourceScope = item => sourceIsFiltered(item) || item.sourceScope === "partial" ? "partial" : "full_month";
function Totals({ summary }) {
  return <span>数量 {summary.quantity} · 销售原额 ¥{money(summary.revenue)} · 扣款 ¥{money(summary.penalty)}</span>;
}
function CatalogImportResult({ catalog, onOpen }) {
  if (!catalog) return null;
  const labels = { missing_skc: '缺少平台 SKC', skc_conflict: '同一 SKU 对应多个 SKC', store_conflict: '店铺归属有冲突',
    attribute_conflict: '属性描述有冲突', duplicate_skc: '已有多份相同 SKC 档案', duplicate_sku: 'SKU 已有多份归属', owned_other_skc: 'SKU 已属于其他 SKC',
    unavailable_owner: '已有归属不可用或无权访问', unavailable_parent: '已有父级归属需核对', workspace_mismatch: '工作区归属需核对' };
  return <section className="batch-catalog-result" aria-label="自动建档结果"><h3>商品预存资料</h3>
    <p>新建 {catalog.createdProductCount} 份预存资料 · 新增 {catalog.addedSkuCount} 个 SKU · 关联已有 {catalog.linkedSkuCount} 个 SKU。</p>
    <p>基础档案保留商品标识和台账属性；名称、图片、供应商等资料可在商品库补齐。</p>
    {catalog.issues.length > 0 && <details><summary>待核对建档项目 · {catalog.issues.length} 个（台账已成功导入）</summary><div className="batch-catalog-issues">{catalog.issues.map((issue, index) => <p key={`${issue.platformSku}:${index}`}><strong>{issue.platformSku}</strong>：{labels[issue.reason] ?? '归属需核对'}</p>)}</div></details>}
    <Button onClick={onOpen}>打开预存区</Button>
  </section>;
}

const PRIMARY_MAPPING_KEYS = ["platformSku", "platformSkc", "supplierNumber", "quantity", "unitPrice", "amount", "store", "sourceAddedAt"];
const PRIMARY_MAPPING_FIELDS = PRIMARY_MAPPING_KEYS.map(key => salesFields.find(field => field.key === key));
const EXTRA_MAPPING_FIELDS = salesFields.filter(field => !PRIMARY_MAPPING_KEYS.includes(field.key));

function mappingState(field, item, availableMapping) {
  const mapping = item.mapping;
  const deriveAmount = Boolean(item.filterOptions?.deriveAmountFromUnitPrice);
  const hasQuantity = Boolean(mapping.quantity || mapping.customerShipmentQuantity || mapping.platformOrderQuantity);
  if (deriveAmount && field.key === "amount") return {
    kind: hasQuantity && mapping.unitPrice ? "calculated" : "required",
    label: hasQuantity && mapping.unitPrice ? "由数量 × 单价计算" : "需映射数量和单价",
    readOnly: true, source: "数量 × 单价",
    description: "标准台账的销售原额按数量 × 单价计算，源表“金额”不作为销售收入。",
  };
  if (deriveAmount && ["customerAmount", "platformAmount"].includes(field.key)) return {
    kind: "unused", label: "本格式无需映射", readOnly: true, source: "使用数量 × 单价",
    description: "标准台账已使用数量和单价计算销售原额。",
  };
  if (field.key === "store" && !mapping.store && item.storeName.trim()) return {
    kind: "fallback", label: item.storeName.trim() === item.fileName.replace(/\.[^.]+$/, "").trim() ? "使用文件名店铺" : "使用填写的店铺",
    emptyLabel: "使用所属店铺", sample: item.storeName,
  };
  if (field.key === "quantity" && !mapping.quantity && hasQuantity) return {
    kind: "fallback", label: "使用备用数量列", emptyLabel: "使用客单发货与平台客单",
  };
  if (!deriveAmount && field.key === "amount" && !mapping.amount && (mapping.customerAmount || mapping.platformAmount)) return {
    kind: "fallback", label: "使用备用金额列", emptyLabel: "使用客单金额与平台金额",
  };
  const needsGroupColumn = field.key === "platformSkc" ? !mapping.supplierNumber : field.key === "supplierNumber" && !mapping.platformSkc;
  const needed = field.required || needsGroupColumn || (field.key === "store" && !item.storeName.trim())
    || (deriveAmount && ["quantity", "unitPrice"].includes(field.key));
  if (mapping[field.key]) return {
    kind: "mapped", label: mapping[field.key] === item.suggestedMapping?.[field.key] ? "已自动映射" : "已手动映射", needed,
    emptyLabel: needed ? "请选择来源列（必需）" : "不使用此可选字段",
  };
  if (needed) return {
    kind: "required", label: needsGroupColumn ? "SKC 与供方货号至少映射一项" : "必需字段未映射", needed,
    emptyLabel: needsGroupColumn ? "请选择 SKC 或供方货号来源列" : "请选择来源列（必需）",
  };
  return {
    kind: "optional", label: availableMapping[field.key] ? "可选 · 未选择来源列" : "可选 · 源表无该列",
    emptyLabel: availableMapping[field.key] ? "不使用此可选字段" : "源表无该列（可选）",
  };
}

function FieldMapping({ item, onChange, onApply }) {
  const availableMapping = suggestMappings(item.headers);
  const renderField = (field) => {
    const state = mappingState(field, item, availableMapping);
    const statusId = `mapping-status-${item.itemId}-${field.key}`;
    const sample = state.sample ?? (!state.readOnly ? item.previewRows[0]?.[item.mapping[field.key]] : null);
    return <div className={`mapping-row${state.kind === "required" ? " mapping-required" : ""}`} data-field={field.key} data-mapping-status={state.kind} key={field.key}>
      <div><strong>{field.key === "amount" ? "销售原额" : field.label}{state.needed ? " *" : ""}</strong><small>{state.description ?? field.description}</small></div>
      {state.readOnly ? <div className="batch-mapping-calculated">{state.source}</div> : <label className="mapping-select"><select aria-label={`${item.fileName} ${field.label}`} aria-describedby={statusId} aria-invalid={state.kind === "required"} value={item.mapping[field.key] ?? ""} onChange={event => onChange({ ...item.mapping, [field.key]: event.target.value })}><option value="">{state.emptyLabel}</option>{item.headers.map(header => <option key={header}>{header}</option>)}</select></label>}
      <div className="batch-mapping-result"><span id={statusId} className={`batch-mapping-state ${state.kind}`}>{state.label}</span>{sample != null && String(sample) !== "" ? <code>{String(sample)}</code> : null}</div>
    </div>;
  };
  return <details className="batch-mapping"><summary>字段映射 · {item.rowCount} 行来源数据</summary>
    <div className="batch-mapping-heading"><p>主要字段已列出，备用字段按需展开。</p><Button variant="ghost" onClick={onApply}>套用到兼容文件</Button></div>
    <div className="mapping-head"><span>工作台字段</span><span>对应来源</span><span>识别结果与示例</span></div>
    <div className="mapping-table batch-mapping-main">{PRIMARY_MAPPING_FIELDS.map(renderField)}</div>
    <details className="batch-mapping-extra"><summary>备用与来源字段 · {EXTRA_MAPPING_FIELDS.length} 项</summary><p>可选字段缺列无需补齐，不影响已识别台账导入。</p><div className="mapping-table">{EXTRA_MAPPING_FIELDS.map(renderField)}</div></details>
  </details>;
}


function OverlapPreview({ item }) {
  const [page, setPage] = useState(1);
  const changes = [...item.overlaps, ...(item.additions ?? [])];
  const pageCount = Math.ceil(changes.length / 30);
  if (!changes.length) return null;
  return <details className="batch-impact-details"><summary>查看 SKC 影响明细 · {changes.length} 组</summary>
    <p>影响范围共 {changes.length} 组{item.replacementScope === "store_month" ? "；将完整替换本店本月，移除本次未选入的旧分组。" : "；仅替换本文件涉及的重叠分组。"}</p>
    {changes.slice((page - 1) * 30, page * 30).map(overlap => <div className="batch-overlap" key={overlap.groupKey}><strong>{overlap.added ? "新增货号：" : overlap.removed ? "移除旧分组：" : "覆盖："}{overlap.store} / {overlap.platformSkc || "无 SKC"} / {overlap.supplierNumber || "无供方货号"}</strong><p>原数据 {overlap.before.rowCount} 行：<Totals summary={overlap.before} /></p><p>新数据 {overlap.after.rowCount} 行：<Totals summary={overlap.after} /></p></div>)}
    {pageCount > 1 && <nav className="batch-submit" aria-label={`${item.fileName} 覆盖范围分页`}><Button variant="ghost" disabled={page === 1} aria-label={`${item.fileName} 上一页覆盖范围`} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} / {pageCount} 页 · 共 {changes.length} 组均受影响</span><Button variant="ghost" disabled={page === pageCount} aria-label={`${item.fileName} 下一页覆盖范围`} onClick={() => setPage(value => value + 1)}>下一页</Button></nav>}
  </details>;
}

export default function ImportPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const requestedLedgerId = new URLSearchParams(location.search).get('ledger');
  const [ledgerContext, setLedgerContext] = useState(null);
  const [contextRetry, setContextRetry] = useState(0);
  const { notify } = useToast();
  const importWorkspaceRef = useRef(null);
  const stageOwnerRef = useRef(crypto.randomUUID());
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
  const pendingJobsRef = useRef(new Map());
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
  const [batchSuffixText, setBatchSuffixText] = useState('');
  const [appliedSuffixes, setAppliedSuffixes] = useState([]);
  const batchSuffixesRef = useRef([]);
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
    if (importWorkspaceRef.current && (await getActiveMemberContext()).workspaceId !== importWorkspaceRef.current) throw new Error('工作区已切换，请重新选择导入文件。');
    if (requestedLedgerId && (await getActiveMemberContext()).workspaceId !== ledgerContext.workspaceId) throw new Error('工作区已切换，请返回重新选择账本，当前文件尚未写入。');
  };

  const makeClient = () => createImportWorkerClient((value, jobId, details) => {
    setFiles(current => current.map(item => item.itemId === jobId ? { ...item, progress: value, progressLabel: details?.total ? `${details.stage} ${details.completed.toLocaleString("zh-CN")} / ${details.total.toLocaleString("zh-CN")} 行` : details?.stage ?? "正在读取" } : item));
  }, { stageOwner: stageOwnerRef.current });
  useEffect(() => {
    void clearImportStages(null, { expiredOnly: true }).catch(() => {});
    clientRef.current = makeClient();
    activeJobsRef.current.clear();
    return () => { generationRef.current += 1; abortRef.current?.abort(); clientRef.current?.terminate(); void clearImportStages(stageOwnerRef.current).catch(() => {}); };
  }, []);
  const cancel = () => {
    if (abortRef.current) { setProgress({ value: null, label: "正在取消，等待整批回滚…" }); abortRef.current.abort(); return; }
    generationRef.current += 1;
    clientRef.current?.terminate();
    const cancelledOwner = stageOwnerRef.current;
    stageOwnerRef.current = crypto.randomUUID();
    clientRef.current = makeClient();
    pendingJobsRef.current.clear();
    void clearImportStages(cancelledOwner).catch(() => {});
    inspectionSequenceRef.current.clear();
    activeJobsRef.current.clear();
    setFiles([]); setPreview(null); setPayload(null); setBusy(false); operationRef.current = false;
    setError("解析已取消，尚未写入任何数据。可重新选择文件。");
  };
  const invalidate = () => { setPreview(null); setPayload(null); setOverwriteSignature(null); setError(""); };
  const ensureJob = async (item) => {
    if (activeJobsRef.current.has(item.itemId)) return;
    const client = clientRef.current;
    const existing = pendingJobsRef.current.get(item.itemId);
    if (existing?.client === client) return existing.promise;
    const promise = client.parse(item.file, item.itemId, item.selectedSheet).then(parsed => {
      if (parsed.type === "sheet-selection-required") throw new Error("请先选择此文件的实际明细页。");
      if (clientRef.current === client) activeJobsRef.current.add(item.itemId);
      return parsed;
    }).finally(() => {
      if (pendingJobsRef.current.get(item.itemId)?.promise === promise) pendingJobsRef.current.delete(item.itemId);
    });
    pendingJobsRef.current.set(item.itemId, { client, promise });
    return promise;
  };
  const inspectPeriod = async (item) => {
    const sequence = (inspectionSequenceRef.current.get(item.itemId) ?? 0) + 1;
    inspectionSequenceRef.current.set(item.itemId, sequence);
    try {
      await ensureJob(item);
      if (inspectionSequenceRef.current.get(item.itemId) !== sequence) return;
      const { evidence, rowSource, facets } = await clientRef.current.inspectPeriod(item.itemId, item.mapping, {
        ...item.filterOptions, defaultStore: item.storeName, enforceSingleStore: true,
      });
      if (inspectionSequenceRef.current.get(item.itemId) === sequence) {
        setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, facets: facets ?? entry.facets, periodEvidence: evidence, rowSource } : entry));
      } else void removeImportStage(rowSource?.id).catch(() => {});
      if (inspectionSequenceRef.current.get(item.itemId) === sequence) {
        activeJobsRef.current.delete(item.itemId);
        await clientRef.current.release(item.itemId).catch(() => {});
      }
    } catch (inspectionError) {
      if (inspectionSequenceRef.current.get(item.itemId) === sequence) {
        setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? {
          ...entry, periodEvidence: { distribution: [], suggestedPeriod: null, errorCount: 1 }, periodInspectionError: inspectionError.message,
        } : entry));
      }
    }
  };
  const update = async (itemId, patch) => {
    // Explicitly applying the same selection invalidates its sealed rows too.
    // Rebuild the preview even when the resulting configuration key is equal.
    attemptedRef.current = "";
    invalidate();
    const current = files.find((item) => item.itemId === itemId);
    if (!current) return;
    void removeImportStage(current.rowSource?.id).catch(() => {});
    let next = { ...current, ...patch, validation: null, periodEvidence: null, rowSource: null, periodInspectionError: null };
    setFiles((entries) => entries.map((item) => item.itemId === itemId ? next : item));
    if (patch.mapping || patch.storeName !== undefined) {
      const sequence = (inspectionSequenceRef.current.get(itemId) ?? 0) + 1;
      inspectionSequenceRef.current.set(itemId, sequence);
      try {
        await ensureJob(next);
        if (inspectionSequenceRef.current.get(itemId) !== sequence) return;
        const refreshed = await clientRef.current.inspectPeriod(itemId, next.mapping, { ...next.filterOptions, supplierNumbers: [], defaultStore: next.storeName, enforceSingleStore: true });
        void removeImportStage(refreshed.rowSource?.id).catch(() => {});
        if (inspectionSequenceRef.current.get(itemId) !== sequence) return;
        const choices = refreshed.facets?.supplierNumbers ?? next.facets?.supplierNumbers ?? [];
        const preference = patch.storeName !== undefined ? readImportPreference(importWorkspaceRef.current, next.storeName) : next.supplierPreference;
        const saved = next.usesBatchSuffix ? matchImportNumberSuffixes(choices, batchSuffixesRef.current)
          : patch.storeName !== undefined ? preference.selected : next.filterOptions?.supplierNumbers ?? [];
        const movementChoices = refreshed.facets?.movementTypes ?? next.facets?.movementTypes ?? [];
        const movementTypes = next.mapping.movementType && Array.isArray(next.filterOptions.movementTypes)
          ? next.filterOptions.movementTypes.filter(type => movementChoices.includes(type)) : undefined;
        next = { ...next, supplierPreference: preference, supplierKeywords: patch.storeName !== undefined ? preference.keywords : next.supplierKeywords, facets: refreshed.facets ?? next.facets, filterOptions: { ...next.filterOptions, movementTypes, supplierNumbers: saved.filter(value => choices.includes(value)) }, missingNumbers: saved.filter(value => !choices.includes(value)) };
        setFiles(entries => entries.map(item => item.itemId === itemId ? next : item));
      } catch (error) { setError(error.message); return; }
    }
    void inspectPeriod(next);
  };
  const loadFiles = async (selection, retryItem = null, selectedSheet = null) => {
    if (operationRef.current || !selection.length || result || contextBlocked) return;
    const generation = generationRef.current;
    operationRef.current = true; setBusy(true); invalidate();
    const additions = Array.from(selection).map((file) => ({ file, sourceScope: "full_month", importMode: "replace_store_month", fileName: file.name, itemId: crypto.randomUUID(), storeName: file.name.replace(/\.[^.]+$/, "").trim(), status: "queued", progress: 0 }));
    if (retryItem) additions[0] = { ...retryItem, status: "queued", error: null, selectedSheet };
    setFiles((current) => retryItem ? current.map(item => item.itemId === retryItem.itemId ? additions[0] : item) : [...current, ...additions]);
    try {
      importWorkspaceRef.current = (await getActiveMemberContext()).workspaceId;
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
          const supplierPreference = readImportPreference(importWorkspaceRef.current, item.storeName);
          const choices = parsed.facets?.supplierNumbers ?? [];
          const restored = restoreImportPreference(supplierPreference, choices);
          const suffixes = batchSuffixesRef.current;
          const filterOptions = { supplierNumbers: suffixes.length ? matchImportNumberSuffixes(choices, suffixes) : restored.selected, ...(parsed.preset === "ledger_report" ? {
            movementTypes: LEDGER_REPORT_MOVEMENT_TYPES.filter((type) => parsed.facets.movementTypes.includes(type)),
            deriveAmountFromUnitPrice: true,
          } : {}) };
          const inspected = await clientRef.current.inspectPeriod(item.itemId, parsed.suggestedMapping, {
            ...filterOptions, defaultStore: item.storeName, enforceSingleStore: true,
          });
          if (generation !== generationRef.current) return;
          setFiles((current) => current.map((entry) => entry.itemId !== item.itemId ? entry : {
            ...entry, ...parsed, fileHash, mapping: parsed.suggestedMapping, status: "parsed", progress: 100,
            filterOptions, usesBatchSuffix: Boolean(suffixes.length), supplierPreference, supplierKeywords: supplierPreference.keywords, missingNumbers: suffixes.length ? [] : restored.missing, periodEvidence: inspected.evidence, rowSource: inspected.rowSource,
            validation: inspected.evidence.validationSummary ? { summary: inspected.evidence.validationSummary } : null,
          }));
          // Each completed file is on disk; release its workbook heap before
          // reading the next file, even while the configuration UI stays open.
          clientRef.current.terminate(); clientRef.current = makeClient(); activeJobsRef.current.clear();
        } catch (parseError) {
          if (generation !== generationRef.current) return;
          setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, status: "error", error: parseError.message } : entry));
          await clientRef.current.release(item.itemId).catch(() => {});
        }
      }
    } catch (error) { if (generation === generationRef.current) setError(error.message); } finally { if (generation === generationRef.current) { setProgress({ value: 100, label: "文件解析完成" }); setBusy(false); operationRef.current = false; } }
  };
  const remove = async (item) => {
    if (operationRef.current) return;
    inspectionSequenceRef.current.delete(item.itemId);
    activeJobsRef.current.delete(item.itemId);
    void removeImportStage(item.rowSource?.id).catch(() => {});
    invalidate(); setFiles((current) => current.filter((entry) => entry.itemId !== item.itemId));
    await clientRef.current.release(item.itemId).catch(() => {});
  };
  const applyMapping = (source) => {
    const columns = Object.values(source.mapping).filter(Boolean);
    for (const item of files) if (item.itemId !== source.itemId && item.status === 'parsed' && columns.every(column => item.headers.includes(column))) void update(item.itemId, { mapping: { ...source.mapping } });
  };
  const applyBatchSuffixes = () => {
    if (busy || contextBlocked) return;
    const suffixes = parseImportKeywords(batchSuffixText);
    if (!suffixes.length) return;
    batchSuffixesRef.current = suffixes;
    setAppliedSuffixes(suffixes);
    for (const item of files) if (item.status === 'parsed') void update(item.itemId, {
      usesBatchSuffix: true, missingNumbers: [],
      filterOptions: { ...item.filterOptions, supplierNumbers: matchImportNumberSuffixes(item.facets?.supplierNumbers ?? [], suffixes) },
    });
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
        let validation;
        if (item.rowSource) validation = { rowSource: item.rowSource, summary: item.periodEvidence.validationSummary };
        else {
          await ensureJob(item);
          validation = await clientRef.current.validate(item.itemId, item.mapping, { ...item.filterOptions, defaultStore: item.storeName, enforceSingleStore: true, period });
        }
        if (generation !== generationRef.current) return;
        const otherMonths = (item.periodEvidence?.distribution ?? []).filter(entry => entry.month !== period);
        if (otherMonths.length) {
          validation.summary = { ...validation.summary, errorCount: validation.summary.errorCount + 1, errors: [...validation.summary.errors, { sourceRow: "月份", messages: [`来源含 ${otherMonths.map(entry => entry.month).join("、")}，与账本 ${period} 不一致，请按月处理此文件。`] }] };
        }
        setFiles((current) => current.map((entry) => entry.itemId === item.itemId ? { ...entry, validation: { summary: validation.summary } } : entry));
        hasErrors ||= validation.summary.errorCount > 0 || !(validation.rowSource?.rowCount ?? validation.rows?.length);
        items.push({ itemId: item.itemId, fileName: item.fileName, fileHash: item.fileHash, storeName: item.storeName,
          mapping: item.mapping, filterOptions: item.filterOptions, rows: validation.rows, rowSource: validation.rowSource, summary: validation.summary,
          sourceCoverage: createSalesSourceCoverage({ period, storeName: item.storeName, scope: sourceScope(item), supplierNumbers: item.filterOptions.supplierNumbers }),
          importMode: sourceScope(item) === "full_month" ? item.importMode ?? "replace_store_month" : "append" });
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
      try { saveImportNumbers(importWorkspaceRef.current, files); }
      catch { notify("数据已导入，但货号偏好未能保存；下次请重新选择。", "warning"); }
      notify("整批处理完成，来源批次已保留。");
      // The result contains summaries only. Release raw workbook jobs and the
      // normalized payload immediately after the atomic transaction commits.
      clientRef.current?.terminate();
      setFiles([]); setPayload(null); setPreview(null);
      void clearImportStages(stageOwnerRef.current).catch(() => {});
    } catch (writeError) { invalidate(); setError(`整批未写入：${writeError.message}`); }
    finally { abortRef.current = null; setBusy(false); operationRef.current = false; }
  };
  const ready = !contextBlocked && files.length > 0 && /^\d{4}-\d{2}$/.test(period) && !periodEvidence.awaitingEvidence && files.every((item) => {
    const columns = Object.values(item.mapping ?? {}).filter(Boolean);
    const hasMovements = !Array.isArray(item.filterOptions?.movementTypes) || item.filterOptions.movementTypes.length > 0;
    return item.status === "parsed" && hasMovements && item.filterOptions?.supplierNumbers?.length > 0 && item.storeName.trim() && !validateSalesMapping(item.mapping, { defaultStore: item.storeName }).length && new Set(columns).size === columns.length;
  });
  const configurationKey = JSON.stringify([period, files.map(item => [item.itemId, item.status, item.storeName, item.mapping, item.filterOptions, item.sourceScope, item.importMode, item.periodEvidence]), contextBlocked]);
  const storesWithoutNumbers = files.filter(item => item.status === 'parsed' && !item.filterOptions?.supplierNumbers?.length).map(item => item.storeName || item.fileName);
  const storesWithoutMovements = files.filter(item => item.status === 'parsed' && Array.isArray(item.filterOptions?.movementTypes) && !item.filterOptions.movementTypes.length).map(item => item.storeName || item.fileName);
  const importPreparation = periodEvidence.awaitingEvidence ? '正在按本次选择重新校验…'
    : storesWithoutMovements.length ? `${storesWithoutMovements.join('、')}未选变动类型，请勾选后再导入`
    : storesWithoutNumbers.length ? `${storesWithoutNumbers.join('、')}未选货号，请调整后缀或展开本店货号选择`
    : !period ? '请选择账本月份'
    : error || '选择货号并核对店铺后自动校验';
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
          <span className={result ? "completed" : "active"} aria-current={!result ? "step" : undefined}><b>1</b><strong>导入销售台账</strong><small>{result ? "已完成" : "当前步骤"}</small></span>
          <span className={result ? "active" : undefined} aria-current={result ? "step" : undefined}><b>2</b><strong>取得正式成本</strong><small>{result ? "下一步 · ERP 自动采用" : "ERP 自动采用"}</small></span>
          <span><b>3</b><strong>核对与更正</strong><small>人工更正优先</small></span>
          <span><b>4</b><strong>确认利润</strong><small>核对后再定稿</small></span>
        </div>
      </section>
      {contextBlocked ? <section className="wizard-card">{ledgerContext?.error ? <><p role="alert">{ledgerContext.error}</p><Button onClick={() => navigate('/ledger')}>选择账本</Button><Button onClick={() => setContextRetry(value => value + 1)}>重试</Button></> : <p role="status">正在读取目标账本月份…</p>}</section> : null}
      {!result ? <>
        {!!files.length && <section className="batch-action-bar" aria-label="本次导入操作">
          <div className="batch-action-summary"><strong>{period || '月份待确认'} · {files.length} 个文件</strong><span id="batch-import-status" role="status">{busy ? progress.label || '正在校验…' : preview ? `新增 ${preview.items.reduce((n, item) => n + item.addedGroupCount, 0)} 组 · 替换 ${preview.items.reduce((n, item) => n + item.replacedGroupCount, 0)} 组 · 移除 ${preview.items.reduce((n, item) => n + (item.removedGroupCount ?? 0), 0)} 组${preview.requiresOverwrite && overwriteSignature !== preview.targetSignature ? ' · 请确认替换范围后导入' : ''}` : importPreparation}</span></div>
          {preview?.requiresOverwrite && <label className="batch-overwrite"><input disabled={busy} type="checkbox" checked={overwriteSignature === preview.targetSignature} onChange={event => setOverwriteSignature(event.target.checked ? preview.targetSignature : null)} />确认本次全部替换范围（含分页内容）与移除旧分组；可展开下方 SKC 明细核对。</label>}
          <Button variant="primary" aria-describedby="batch-import-status" disabled={busy || !preview || (preview.requiresOverwrite && overwriteSignature !== preview.targetSignature)} loading={busy} onClick={confirmImport}>导入</Button>
        </section>}
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
            <section className="batch-suffix-picker" aria-label="整批货号后缀选择">
              <label htmlFor="batch-supplier-suffix">整批按货号后缀选择</label>
              <div><input id="batch-supplier-suffix" className="text-input" value={batchSuffixText} placeholder="例如 HHHX；多个后缀用逗号分隔" aria-describedby="batch-suffix-help" onChange={event => setBatchSuffixText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); applyBatchSuffixes(); } }} /><Button disabled={!parseImportKeywords(batchSuffixText).length} onClick={applyBatchSuffixes}>应用到本批文件</Button></div>
              <p id="batch-suffix-help">只匹配货号末尾，忽略英文大小写与全半角差异。应用后替换本批选择；新增文件沿用，仍可逐店调整。</p>
              {!!parseImportKeywords(batchSuffixText).length && <p role="status">{files.filter(item => item.status === 'parsed').map(item => `${item.storeName}：命中 ${matchImportNumberSuffixes(item.facets?.supplierNumbers ?? [], parseImportKeywords(batchSuffixText)).length} / ${item.facets?.supplierNumbers?.length ?? 0} 个`).join('；') || '添加文件后显示各店命中数量。'}</p>}
              {!!appliedSuffixes.length && <p role="status">已应用后缀：{appliedSuffixes.join('、')}。零命中的店铺请单独调整或移除文件。</p>}
            </section>
          </fieldset>
          {busy && <div className="import-progress" role="status">{progress.value == null ? <span>{progress.label}</span> : <ProgressBar value={progress.value} label={progress.label} />}<Button onClick={cancel}>取消当前处理</Button></div>}
          <div className="batch-files">{files.map((item, index) => <section className="batch-file" key={item.itemId}>
            <div className="batch-file-heading"><span className="batch-file-icon"><FileSpreadsheet size={21} /></span><div><strong>{item.fileName}</strong><span className="batch-file-status">文件 {index + 1}{item.rowCount != null ? ` · ${item.rowCount.toLocaleString("zh-CN")} 行` : ""} · {item.status === "error" ? "解析失败" : item.status === "queued" ? (item.progressLabel || "等待解析") : item.validation ? item.validation.summary.errorCount || !item.validation.summary.validRowCount ? "需要处理" : "已校验" : item.status === "sheet_required" ? "请选择明细页" : "自动校验中"}</span></div><div className="batch-store form-field"><label htmlFor={`store-${item.itemId}`}>所属店铺</label><input id={`store-${item.itemId}`} aria-describedby={`store-note-${item.itemId}`} aria-invalid={!item.storeName.trim()} className="text-input" disabled={busy} value={item.storeName} onChange={(event) => update(item.itemId, { storeName: event.target.value })} /><small id={`store-note-${item.itemId}`}>{item.storeName.trim() ? "文件名仅作建议，请核对店铺归属。" : "请填写所属店铺后再校验。"}</small></div><Button disabled={busy} variant="ghost" aria-label={`移除 ${item.fileName}`} onClick={() => remove(item)}>移除</Button></div>
            {item.status === "error" ? <p role="alert" className="import-error">解析失败：{item.error}</p> : item.status === "queued" ? <p role="status">{item.progressLabel || "等待或正在读取工作簿…"}</p> : item.status === "sheet_required" ? <div className="form-field"><label htmlFor={`sheet-${item.itemId}`}>发现多个明细页，请选择本次来源</label><select id={`sheet-${item.itemId}`} className="text-input" defaultValue="" onChange={event => loadFiles([item.file], item, event.target.value)}><option value="" disabled>选择明细页</option>{item.sheetCandidates.map(name => <option key={name}>{name}</option>)}</select></div> : <fieldset disabled={busy} className="batch-fieldset">
              {files.some((other) => other.itemId !== item.itemId && other.fileHash === item.fileHash) && <p className="import-error" role="alert">相同文件内容重复，请移除重复文件并核对店铺。</p>}
              <p className="batch-period-evidence">{item.selectedSheet ? `明细页：${item.selectedSheet} · ` : ""}来源月份：{item.periodEvidence?.distribution?.length ? item.periodEvidence.distribution.map(entry => `${entry.month}（${entry.count.toLocaleString("zh-CN")} 行）`).join("、") : "待核对"}</p>
              {item.periodEvidence?.distribution?.length > 1 && <p className="import-error" role="alert">此文件包含多个月份，请按月处理后再导入。</p>}
              {item.periodInspectionError && <p className="import-error" role="alert">{item.periodInspectionError}</p>}

              <details className="batch-store-suppliers" open={!item.usesBatchSuffix}><summary>本店货号 · 已选 {item.filterOptions?.supplierNumbers?.length ?? 0} / {item.facets?.supplierNumbers?.length ?? 0} 个{item.usesBatchSuffix ? ' · 沿用整批后缀' : ' · 可单独调整'}</summary>
              <ImportSupplierPicker key={`${item.itemId}:${item.storeName}`} store={item.storeName} choices={item.facets?.supplierNumbers ?? []} counts={item.facets?.supplierCounts} selected={item.filterOptions?.supplierNumbers ?? []} missing={item.missingNumbers ?? []} keywords={item.supplierKeywords ?? []} previousMatches={item.supplierPreference?.matched ?? []} hasSaved={item.supplierPreference?.hasSaved ?? false} onKeywordsChange={supplierKeywords => setFiles(entries => entries.map(entry => entry.itemId === item.itemId ? { ...entry, supplierKeywords } : entry))} onChange={supplierNumbers => update(item.itemId, { usesBatchSuffix: false, filterOptions: { ...item.filterOptions, supplierNumbers } })} />
              </details>
              {item.usesBatchSuffix && !item.filterOptions?.supplierNumbers?.length && <p role="alert" className="import-error">本店没有命中所选后缀，请展开本店货号调整，或移除此文件。</p>}
              <ImportMovementPicker store={item.storeName} choices={item.facets?.movementTypes ?? []} counts={item.facets?.movementTypeCounts}
                selected={item.filterOptions?.movementTypes ?? item.facets?.movementTypes ?? []}
                defaults={item.preset === "ledger_report" ? LEDGER_REPORT_MOVEMENT_TYPES.filter(type => item.facets?.movementTypes?.includes(type)) : item.facets?.movementTypes ?? []}
                onChange={movementTypes => update(item.itemId, { filterOptions: { ...item.filterOptions, movementTypes } })} />
              <p className="batch-period-evidence" role="status">{sourceScope(item) === "full_month" ? `所选货号完整月台账：${period || "待确认月份"}` : `部分来源：${period || "待确认月份"}`} · {item.storeName}。{sourceScope(item) === "full_month" ? "仅证明所选货号的完整月份，销量标签统计月末最后七天；缺日期的商品仍显示数据不足。" : "本文件仍可核算，但不足以证明未出现商品为零销量。"}</p>
              <details className="batch-advanced"><summary>高级选项 · {Object.values(item.mapping).filter(Boolean).length} 列已映射{item.filterOptions?.deriveAmountFromUnitPrice ? " · 销售额自动计算" : ""}{item.filterOptions?.movementTypes ? ` · ${item.filterOptions.movementTypes.length} 类销售变动` : ""}</summary>
              <div className="form-field"><label htmlFor={`source-scope-${item.itemId}`}>来源范围</label><select id={`source-scope-${item.itemId}`} className="text-input" value={sourceScope(item)} onChange={event => update(item.itemId, { sourceScope: event.target.value, importMode: event.target.value === "partial" ? "append" : "replace_store_month" })}><option value="full_month" disabled={sourceIsFiltered(item)}>完整历史月台账</option><option value="partial">部分日期来源</option></select>{sourceIsFiltered(item) && <small>已缩小销售变动类型筛选，按部分来源保存；恢复全范围后可选择完整月。</small>}</div>
              <div className="form-field"><label htmlFor={`import-mode-${item.itemId}`}>导入方式</label><select id={`import-mode-${item.itemId}`} className="text-input" value={sourceScope(item) === "partial" ? "append" : item.importMode ?? "append"} onChange={event => update(item.itemId, { importMode: event.target.value })}><option value="append">追加并替换重叠分组</option><option value="replace_store_month" disabled={sourceScope(item) !== "full_month"}>完整替换本店本月</option></select><small>完整月默认替换本店本月为此次选择；部分日期仅追加或替换重叠分组。请核对下方移除范围。</small></div>
              <FieldMapping item={item} onChange={mapping => update(item.itemId, { mapping })} onApply={() => applyMapping(item)} />


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
          <p>核对文件、店铺及 {period} 月份后，可在上方操作区导入。修改配置后会自动重新校验。</p>
        </section>}
      </> : <section className="wizard-card batch-preview"><h2>整批处理完成 · {period}</h2>
        <section className="batch-next-step" aria-label="继续本月利润核算">
          <h3>下一步：取得正式成本</h3>
          <p>销售台账已导入。先取得 ERP 正式成本并核对缺失或异常，再核算与确认本月利润。</p>
          <Button variant="primary" icon={ArrowRight} onClick={() => navigate(buildProfitHref({ ledgerId: result.ledgerId, view: 'cost' }))}>下一步：取得正式成本</Button>
        </section>
        {result.items.map((item) => <article key={item.itemId}><h3>{item.fileName} · {item.storeName}</h3><p>{item.status === "imported" ? `已导入：新增 ${item.addedGroupCount} 组，替换 ${item.replacedGroupCount} 组` : "已生效重复，跳过"}</p><p>来源批次：<code>{item.batchId}</code></p><Totals summary={item.summary} /></article>)}
        <p>全月：<Totals summary={result.finalSummary} /></p>
        {result.catalog && <details className="batch-catalog-details"><summary>商品预存资料 · 新建 {result.catalog.createdProductCount} 份 · 可稍后补齐</summary><CatalogImportResult catalog={result.catalog} onOpen={() => navigate('/products?view=reference')} /></details>}
        <Button variant="ghost" onClick={() => navigate(returnHref)}>{returnLabel}</Button>
      </section>}
    </section>
  </main>;
}
