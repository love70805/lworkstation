import { formatErpUnitCost, formatManualUnitCost } from "../lib/profitPrecision";
import { erpAdoptionReadiness } from "../domain/erpAdoptionReadiness";
import { ERP_COST_BATCH_VERSION } from "../domain/erpCostBatchEnvelope";
import { cancelAutoErpRequest, ensureAutoErpRequest, erpRequestScopeKey } from "../lib/autoErpRequest";
import { selectManualOverride } from "../domain/manualCostOverride";
import { resolveFormalCostDecision } from "../domain/costPolicy";
import ManualCostDialog from "./ManualCostDialog";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, ClipboardPaste, Copy, Download, FileJson, FileUp, Inbox, Info, ListChecks, PlugZap, Upload, Warehouse } from "lucide-react";
import AppShell from "../components/AppShell";
import DataTable from "../components/DataTable";
import ErpAssistantSetup from "../components/ErpAssistantSetup";
import { isDesktopRuntime } from "../lib/desktopRuntime";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, SearchInput, useToast } from "../components/UI";
import { getErpCostInbox, getLatestErpCostRequest, listErpCostInbox, listErpCostRequests, markErpCostInboxStatus, processErpCostInboxAdoption, rejectErpCostInboxBatches, saveErpCostRequest, savePublishedErpCostBatch, switchLoadedErpCostInbox, voidPublishedErpCostBatch } from "../data/database";
import { reconcileErpCostRows } from "../domain/erpCosts";
import { ERP_COST_ANOMALY_LABELS, upsertCostResolution } from "../domain/erpCostResolution";
import { adoptedCostEvidence } from "../domain/erpPurchaseEvidence";
import { collectErpPlatformSkcs } from "../domain/erpQueryScope";
import { buildErpInboxQueue, ERP_INBOX_MATCH_REASONS } from "../domain/erpInboxMatching";
import { canonicalPlatformSku } from "../domain/identifiers";
import { useLatestSalesImport } from "../hooks/useLatestSalesImport";
import { useLedgerIdentity } from "../hooks/useLedgerIdentity";
import { buildErpCostTemplate, parseErpCostInput } from "../lib/erpCostImport";
import { groupImportedSales } from "../lib/profit";
import { registerErpBridgeRequest } from "../lib/erpInboxTransport";
import { buildProfitHref, filterProfitRows, readProfitFilter } from "../lib/profitFilter";
import { exportWorkbook } from "../lib/spreadsheetExport";
import { buildErpInboxHistory, describeEvidenceIssues, evidenceRepairGuidance, filterCostMatchGroups, groupAuxiliaryCostRows, groupCostMatchesBySkc, isUnmappedCostMatch, rejectErpInboxBatchesForCostMatching, switchLoadedErpInboxDraft, withLedgerAttributes } from "../lib/costMatching";
import { clearCostDraft, invalidateLegacyCostDrafts, readRestorableCostDraft, writeCostDraft } from "../lib/costMatchingDraft";
import { recoverCompleteErpCostDrafts } from "../lib/erpLegacyDraftRecovery";
import { ERP_ADOPTION_ITEM_LABELS, describeErpAdoptionReason, groupAdoptionExceptions, summarizeAdoptionForDisplay } from "../lib/erpAdoptionPresentation";
import { CostMatchingDeleteBatchDialog, CostMatchingInboxQueueDialog, CostMatchingVoidBatchDialog } from "./CostMatchingInboxDialogs";

const currency = (value) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });
const costViewCache = new Map();

export function CostMatchingContent({ validatedContext, onPublished }) {
  const snapshot = useLatestSalesImport(validatedContext?.ledgerId);
  if (snapshot === undefined) return <Panel>正在验证成本核对范围...</Panel>;
  if (!validatedContext?.ledgerId || snapshot?.ledger?.id !== validatedContext.ledgerId || snapshot?.ledger?.workspaceId !== validatedContext.workspaceId || (validatedContext.store !== "all" && !snapshot.rows.some((row) => row.store === validatedContext.store))) return <Panel><p role="alert">账本或店铺不属于当前工作区，请重新选择。</p></Panel>;
  return <CostMatchingBody key={`${validatedContext.workspaceId}/${validatedContext.ledgerId}/${validatedContext.store}`} validatedContext={validatedContext} onPublished={onPublished} />;
}

export default function CostMatching() {
  return <AppShell pageClass="cost-page"><CostMatchingBody /></AppShell>;
}
const purchaseCurrency = (value) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 20 });
async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function writeClipboardText(value) {
  const text = String(value ?? "");
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some embedded browsers expose the Clipboard API but reject writes.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy") ?? false;
  textarea.remove();
  if (!copied) throw new Error("当前浏览器未授予剪贴板写入权限，请检查浏览器权限后重试。");
}

async function readCostFileText(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["xlsx", "xls"].includes(extension)) return file.text();

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("成本工作簿中没有可读取的工作表。");
  return XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { FS: "\t", RS: "\n" });
}

function describeProfitFilter(filter) {
  const parts = [];
  if (filter.query) parts.push(`搜索“${filter.query}”`);
  if (filter.storeFilter !== "all") parts.push(`店铺：${filter.storeFilter}`);
  if (Array.isArray(filter.supplierSelection)) parts.push(filter.supplierSelection.length ? `供方货号：${filter.supplierSelection.length} 个` : "未选择供方货号");
  if (filter.missingOnly) parts.push("只看缺成本");
  return parts.length ? parts.join(" · ") : "全部利润明细";
}

function EvidenceDetails({ match }) {
  const issues = describeEvidenceIssues(match);
  if (issues.length === 0) return null;
  const guidance = evidenceRepairGuidance(issues.map((item) => item.key));
  const purchaseRecords = Array.isArray(match.purchaseRecords) ? match.purchaseRecords : [];
  const excludedRecords = Array.isArray(match.excludedRecords) ? match.excludedRecords : [];
  return (
    <details className="cost-evidence-details">
      <summary><Info size={14} />查看证据问题与补齐指引</summary>
      <div className="cost-evidence-details-body">
        <ul className="cost-evidence-issue-list">
          {issues.map((issue) => <li key={issue.key}><strong>{issue.label}</strong><span>{issue.detail}</span></li>)}
        </ul>
        {purchaseRecords.length || excludedRecords.length ? <div className="cost-evidence-record-counts"><span>采购记录 {purchaseRecords.length} 条</span><span>排除记录 {excludedRecords.length} 条</span></div> : null}
        {guidance.length ? <div className="cost-evidence-guidance"><strong>建议</strong>{guidance.map((item) => <p key={item}>{item}</p>)}</div> : null}
      </div>
    </details>
  );
}

function EvidencePreview({ variants }) {
  const unmapped = variants.filter(isUnmappedCostMatch);
  if (unmapped.length === 0) return null;
  return (
    <div className="cost-evidence-inline">
      {unmapped.map((item) => {
        const records = Array.isArray(item.purchaseRecords) ? item.purchaseRecords : [];
        const excluded = Array.isArray(item.excludedRecords) ? item.excludedRecords : [];
        return <details key={`${item.canonicalPlatformSku || item.sourceWarehouseSku}-evidence`}>
          <summary>查看 {item.sourceWarehouseSku || "未映射仓库 SKU"} 原始证据</summary>
          <div className="cost-evidence-inline-body">
            <span>平台 SKU：{item.sourcePlatformSku || "未映射"} · 平台 SKC：{item.platformSkc || "未映射"}</span>
            <span>证据引用：{item.raw?.evidenceRef || item.evidenceRef || "缺失"}</span>
            <span>采购记录 {records.length} 条 · 排除记录 {excluded.length} 条 · 警告 {Array.isArray(item.sourceWarnings) ? item.sourceWarnings.length : 0} 条</span>
            {records.slice(0, 3).map((record) => <small key={record.recordId || `${record.purchaseDate}-${record.unitPrice}`}>采购 {record.recordId || "未知记录"} · {record.purchaseDate || "日期未知"} · {record.unitPrice == null ? "单价未知" : currency(record.unitPrice)}</small>)}
            {excluded.slice(0, 3).map((record) => <small key={record.recordId || `excluded-${record.purchaseDate}`}>排除 {record.recordId || "未知记录"} · {(record.exclusionReasons || []).join("；") || "原因未知"}</small>)}
          </div>
        </details>;
      })}
    </div>
  );
}

function SelectedPurchaseEvidence({ match }) {
  const records = match.costDecision?.selectedRecords ?? adoptedCostEvidence(match.raw ?? match).selected.filter(Boolean);
  if (!records.length) return <span className="pending-text">{match.periodReviewRequired ? "选样待复核" : match.costDecision ? "无合格采购" : "兼容输入"}</span>;
  return <details className="cost-evidence-details">
    <summary>{match.periodReviewRequired ? "原采用" : "参与核算"} {records.length} 笔采购</summary>
    <div className="cost-evidence-details-body">
      {records.map(record => <div key={record.recordId} className="cost-selected-purchase">
        <strong>{record.purchaseDate}</strong>
        <span>{record.order1688 ? "1688" : "采购单"} · {record.order1688 || record.purchaseOrderNo || record.purchaseOrderId || "未提供单号"}</span>
        {record.order1688 && record.purchaseOrderNo ? <small>采购单 · {record.purchaseOrderNo}</small> : null}
        <small>{record.quantity} 件 × {formatErpUnitCost(record.effectiveUnitPrice ?? record.unitPrice)}</small>
      </div>)}
    </div>
  </details>;
}

function CostMatchingBody({ validatedContext, onPublished }) {
  const desktop = isDesktopRuntime();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useToast();
  const fileInputRef = useRef(null);
  const ledgerId = validatedContext?.ledgerId ?? searchParams.get("ledger");
  const filterSearchKey = searchParams.toString();
  const profitFilter = useMemo(() => ({ ...readProfitFilter(searchParams, ledgerId), ...(validatedContext ? { storeFilter: validatedContext.store } : {}) }), [filterSearchKey, ledgerId, validatedContext]);
  const profitHref = useMemo(() => buildProfitHref({ ledgerId, ...profitFilter }), [ledgerId, profitFilter]);
  const importSearch = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    if (ledgerId) next.set("ledger", ledgerId);
    return next.toString();
  }, [filterSearchKey, ledgerId]);
  const openLedgerImport = () => navigate(`/import-preview${importSearch ? `?${importSearch}` : ""}`, { state: { importReturnTo: `/profit${importSearch ? `?${importSearch}` : ""}` } });
  const viewKey = `${validatedContext?.workspaceId ?? ""}/${ledgerId ?? ""}/${profitFilter.storeFilter}`;
  const initialView = useMemo(() => {
    const saved = costViewCache.get(viewKey);
    return saved?.filterHref === profitHref ? saved : null;
  }, [viewKey, profitHref]);
  const tableHandleRef = useRef(null);
  const rememberTable = useCallback(handle => { if (handle) tableHandleRef.current = handle; }, []);
  const viewStateRef = useRef(null);
  const snapshot = useLatestSalesImport(ledgerId);
  const latestRequest = useLiveQuery(() => getLatestErpCostRequest(ledgerId), [ledgerId], null);
  const allInboxRecords = useLiveQuery(() => listErpCostInbox({ statuses: ["pending", "loaded", "applied", "rejected", "voided"] }), [], []);
  const requestRecords = useLiveQuery(() => listErpCostRequests(), [], []);
  const locked = ["finalized", "locked"].includes(snapshot?.ledger?.status);
  const ledgerLocked = snapshot?.ledger?.status === "locked";
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("clipboard.tsv");
  const [parsedRows, setParsedRows] = useState(null);
  const [batchEnvelope, setBatchEnvelope] = useState(null);
  const [resolutions, setResolutions] = useState([]);
  const [resolutionDraft, setResolutionDraft] = useState(null);
  const [parseError, setParseError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [copyingSkcs, setCopyingSkcs] = useState(false);
  const [registrationState, setRegistrationState] = useState({ status: "idle", message: "" });
  const [registrationRetry, setRegistrationRetry] = useState(0);
  const [incomingCandidate, setIncomingCandidate] = useState(null);
  const [manualTarget, setManualTarget] = useState(null);
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const [erpAssistantOpen, setErpAssistantOpen] = useState(false);
  const [manualInputOpen, setManualInputOpen] = useState(false);
  const [inboxQueueOpen, setInboxQueueOpen] = useState(false);
  const [resultQuery, setResultQuery] = useState(() => initialView?.resultQuery ?? "");
  const [costRequestId, setCostRequestId] = useState(null);
  const [costRequest, setCostRequest] = useState(null);
  const [loadedInboxId, setLoadedInboxId] = useState(null);
  const [selectedPendingInboxIds, setSelectedPendingInboxIds] = useState(() => new Set());
  const [deleteBatchIds, setDeleteBatchIds] = useState([]);
  const [deletingBatches, setDeletingBatches] = useState(false);
  const [voidDraft, setVoidDraft] = useState(null);
  const [voidingBatch, setVoidingBatch] = useState(false);
  const [resultHighlighted, setResultHighlighted] = useState(false);
  const [expandedUnmappedGroups, setExpandedUnmappedGroups] = useState(() => new Set(initialView?.expandedGroups ?? []));
  viewStateRef.current = { filterHref: profitHref, resultQuery, expandedGroups: [...expandedUnmappedGroups] };
  useLayoutEffect(() => () => {
    costViewCache.delete(viewKey);
    costViewCache.set(viewKey, { ...viewStateRef.current, table: tableHandleRef.current?.getViewState() });
    if (costViewCache.size > 20) costViewCache.delete(costViewCache.keys().next().value);
  }, [viewKey]);
  const restoredDraftLedgerRef = useRef(null);
  const draftReadyLedgerRef = useRef(null);
  const [draftReadyLedger, setDraftReadyLedger] = useState(null);
  const previousRegistrationRef = useRef(null);
  const unloadedInboxIdsRef = useRef(new Set());
  const ledgerIdentityRef = useLedgerIdentity(snapshot?.ledger?.id);
  const effectiveRequestId = costRequestId ?? latestRequest?.id ?? null;
  const requestForImport = requestRecords.find((request) => request.id === batchEnvelope?.requestId) ?? costRequest ?? latestRequest ?? null;
  const workspaceInboxRecords = useMemo(() => allInboxRecords.filter((record) => (
    !snapshot?.ledger?.workspaceId || record.workspaceId === snapshot.ledger.workspaceId
  )), [allInboxRecords, snapshot?.ledger?.workspaceId]);
  const inboxRecords = useMemo(() => workspaceInboxRecords.filter((record) => ["pending", "loaded"].includes(record.status)), [workspaceInboxRecords]);
  const processedInboxRecords = useMemo(() => buildErpInboxHistory(workspaceInboxRecords, snapshot?.ledger?.id), [snapshot?.ledger?.id, workspaceInboxRecords]);
  const loadedInbox = useMemo(() => inboxRecords.find((record) => record.id === loadedInboxId) ?? null, [inboxRecords, loadedInboxId]);
  const sourceInbox = useMemo(() => workspaceInboxRecords.find(record => record.batchId === batchEnvelope?.batchId && record.ledgerId === snapshot?.ledger?.id) ?? null, [workspaceInboxRecords, batchEnvelope?.batchId, snapshot?.ledger?.id]);
  const currentInbox = loadedInbox ?? sourceInbox;
  const latestAdoptionInbox = useMemo(() => workspaceInboxRecords.filter(record => record.ledgerId === snapshot?.ledger?.id && record.adoption?.version).toSorted((a, b) => Date.parse(b.receivedAt ?? b.adoption.processedAt) - Date.parse(a.receivedAt ?? a.adoption.processedAt))[0] ?? null, [workspaceInboxRecords, snapshot?.ledger?.id]);
  const reviewAdoption = currentInbox ? currentInbox.adoption : latestAdoptionInbox?.adoption;
  const adoptionNotice = summarizeAdoptionForDisplay(reviewAdoption, { status: currentInbox ? currentInbox.status : latestAdoptionInbox?.status });
  const adoptionItemsBySku = useMemo(() => new Map((reviewAdoption?.items ?? []).map(item => [item.canonicalPlatformSku, item])), [reviewAdoption]);
  const exceptionGroups = useMemo(() => groupAdoptionExceptions(reviewAdoption), [reviewAdoption]);

  const persistedCostRows = useMemo(() => snapshot?.costs ?? [], [snapshot?.costs]);
  const effectiveCostRows = useMemo(() => {
    if (parsedRows !== null) {
      const incoming = new Set(parsedRows.filter((row) => row.platformSku).map((row) => canonicalPlatformSku(row.platformSku)));
      return [...persistedCostRows.filter((row) => !incoming.has(canonicalPlatformSku(row.platformSku))), ...parsedRows];
    }
    if (sourceText.trim()) return [];
    return persistedCostRows.length > 0 ? persistedCostRows : null;
  }, [parsedRows, persistedCostRows, sourceText]);

  useEffect(() => {
    invalidateLegacyCostDrafts();
  }, []);

  useEffect(() => {
    const currentLedgerId = snapshot?.ledger?.id;
    if (!currentLedgerId || restoredDraftLedgerRef.current === currentLedgerId) return;
    restoredDraftLedgerRef.current = currentLedgerId;
    draftReadyLedgerRef.current = null;
    setDraftReadyLedger(null);
    setSourceText(""); setParsedRows(null); setBatchEnvelope(null); setLoadedInboxId(null); setCostRequest(null); setCostRequestId(null);
    let cancelled = false;
    const restore = async () => {
      // Run the same safe migration here before the draft TTL can discard an
      // old complete batch when the app opens directly on this page.
      try { await recoverCompleteErpCostDrafts({ workspaceId: snapshot.ledger.workspaceId }); }
      catch { /* The background inbox cycle remains the recovery path. */ }
      const draft = await readRestorableCostDraft(currentLedgerId, { getInbox: getErpCostInbox });
      if (cancelled) return;
      draftReadyLedgerRef.current = currentLedgerId;
      setDraftReadyLedger(currentLedgerId);
      if (!draft) return;
      setSourceText(draft.sourceText);
      setSourceName(draft.sourceName || "已恢复成本草稿");
      setParsedRows(Array.isArray(draft.parsedRows) ? draft.parsedRows : null);
      setBatchEnvelope(draft.batchEnvelope ?? null);
      setResolutions(Array.isArray(draft.resolutions) ? draft.resolutions : []);
      setLoadedInboxId(draft.loadedInboxId ?? null);
      setParseError("");
      notify("已恢复本账本上次未发布的成本核对草稿。", "success");
    };
    void restore();
    return () => { cancelled = true; };
  }, [notify, snapshot?.ledger?.id]);

  useEffect(() => {
    const currentLedgerId = snapshot?.ledger?.id;
    if (!currentLedgerId || draftReadyLedgerRef.current !== currentLedgerId) return;
    if (!sourceText.trim()) { clearCostDraft(currentLedgerId); return; }
    writeCostDraft(currentLedgerId, { sourceText, sourceName, parsedRows, batchEnvelope, resolutions, loadedInboxId });
  }, [batchEnvelope, loadedInboxId, parsedRows, resolutions, snapshot?.ledger?.id, sourceName, sourceText]);

  const salesLines = useMemo(() => snapshot?.rows ? groupImportedSales(snapshot.rows) : [], [snapshot]);
  const formalCostsBySku = useMemo(() => new Map((snapshot?.costs ?? []).map(row => [
    canonicalPlatformSku(row.platformSku), row,
  ])), [snapshot?.costs]);
  const formalSalesLines = useMemo(() => salesLines.map((row) => {
      const scope = { workspaceId: snapshot?.ledger?.workspaceId, ledgerId: snapshot?.ledger?.id, period: snapshot?.ledger?.period, store: row.store, platformSku: row.platformSku };
      const decision = resolveFormalCostDecision({ ...scope, erpCost: formalCostsBySku.get(row.canonicalPlatformSku), manualOverride: selectManualOverride(snapshot?.approvals, scope) });
      return { ...row, finalizable: decision.eligibleForExactProfit };
    }), [formalCostsBySku, salesLines, snapshot?.ledger, snapshot?.approvals]);
  const filteredSalesLines = useMemo(() => filterProfitRows(formalSalesLines, profitFilter), [formalSalesLines, profitFilter]);
  const expectedSkus = useMemo(() => {
    const unique = new Map();
    formalSalesLines.forEach((row) => {
      const key = canonicalPlatformSku(row.platformSku);
      if (!unique.has(key)) unique.set(key, { platformSku: row.platformSku, platformSkc: row.platformSkc });
    });
    return [...unique.values()];
  }, [formalSalesLines]);
  const erpQueryScope = useMemo(() => collectErpPlatformSkcs(formalSalesLines), [formalSalesLines]);
  const { platformSkcs } = erpQueryScope;
  const displayQueryScope = useMemo(() => collectErpPlatformSkcs(filteredSalesLines), [filteredSalesLines]);
  const { platformSkcs: displayPlatformSkcs, missingCount: missingPlatformSkcCount } = displayQueryScope;
  const displaySkuSet = useMemo(() => new Set(filteredSalesLines.map(row => row.canonicalPlatformSku)), [filteredSalesLines]);
  const registrationScope = erpRequestScopeKey({ ledger: snapshot?.ledger, platformSkcs, expectedSkus });
  useEffect(() => {
    if (locked || !snapshot?.ledger || !platformSkcs.length) return;
    const timer = window.setInterval(() => setRegistrationRetry((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [registrationScope, locked]);
  useEffect(() => {
    const previous = previousRegistrationRef.current;
    previousRegistrationRef.current = snapshot?.ledger ?? null;
    if (previous && (previous.id !== snapshot?.ledger?.id || locked || !platformSkcs.length)) {
      void cancelAutoErpRequest(previous, { latest: getLatestErpCostRequest, register: registerErpBridgeRequest }).catch((error) => setRegistrationState({ status: "failed", message: `旧回传关联取消失败：${error.message}` }));
    }
    if (!snapshot?.ledger || locked || !platformSkcs.length) return;
    let cancelled = false;
    setRegistrationState({ status: "registering", message: "正在准备 ERP 回传关联" });
    void ensureAutoErpRequest({ ledger: snapshot.ledger, platformSkcs, expectedSkus }, {
      latest: getLatestErpCostRequest, save: saveErpCostRequest, register: registerErpBridgeRequest,
      isCurrent: () => !cancelled,
    }).then((request) => {
      if (!request || cancelled) return;
      if (!sourceText.trim() && !loadedInboxId) { setCostRequestId(request.id); setCostRequest(request); }
      setRegistrationState({ status: "registered", message: "回传关联已登记，可在已选范围内分批查询" });
    }).catch((error) => { if (!cancelled) setRegistrationState({ status: "failed", message: `登记失败：${error.message}` }); });
    return () => { cancelled = true; };
  }, [registrationScope, registrationRetry, locked]);
  const inboxQueue = useMemo(() => buildErpInboxQueue({
    inboxes: inboxRecords,
    requests: requestRecords,
    ledger: snapshot?.ledger,
    currentPlatformSkcs: platformSkcs,
  }), [inboxRecords, platformSkcs, requestRecords, snapshot?.ledger]);

  useEffect(() => {
    const pendingIds = new Set(inboxRecords.filter((record) => record.status === "pending").map((record) => record.id));
    setSelectedPendingInboxIds((current) => {
      const next = new Set([...current].filter((id) => pendingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [inboxRecords]);

  const loadInboxRecord = useCallback(async (queueItem, { automatic = false, discardDraft = false } = {}) => {
    const inbox = queueItem?.inbox;
    const request = queueItem?.request;
    if (!inbox?.id || !inbox.envelope || !snapshot?.ledger || !request) return;
    if (sourceText.trim() && loadedInboxId !== inbox.id && !discardDraft) { setIncomingCandidate(queueItem); return; }
    if (!queueItem.scopeMatched || locked) {
      notify(locked ? "当前账本已定稿或锁定，ERP 批次继续保留在待处理列表。" : `该批次暂不能载入：${ERP_INBOX_MATCH_REASONS[queueItem.reason] ?? queueItem.reason}`, "error");
      return;
    }
    const previousLoaded = inboxRecords.find((record) => record.status === "loaded" && record.id !== inbox.id && record.ledgerId === snapshot.ledger.id);
    const envelopeText = JSON.stringify(inbox.envelope, null, 2);
    const sourceLabel = `${automatic ? "自动收件" : "待处理批次"} · ${inbox.batchId}`;
    try {
      const result = await switchLoadedErpInboxDraft({
        candidate: inbox,
        previous: previousLoaded,
        markStatus: markErpCostInboxStatus,
        switchStatus: switchLoadedErpCostInbox,
        parseCandidate: () => parseErpCostInput(envelopeText, {
          expectedWorkspaceId: snapshot.ledger.workspaceId,
          expectedLedgerId: snapshot.ledger.id,
          expectedRequestId: request.id ?? request.requestId,
          expectedPlatformSkcs: request.platformSkcs,
          requestPayload: request,
          expectedSkus: request.expectedSkus ?? expectedSkus,
          sourceName: sourceLabel,
        }),
      });
      if (ledgerIdentityRef.current !== inbox.ledgerId) { await markErpCostInboxStatus(inbox.id, "pending", { unloadedAt: new Date().toISOString() }); return; }
      setSourceText(envelopeText);
      setSourceName(sourceLabel);
      setParsedRows(result.rows);
      setBatchEnvelope(result.envelope);
      setResolutions([]);
      setParseError("");
      setLoadedInboxId(inbox.id);
      setCostRequestId(request.id ?? request.requestId);
      setCostRequest(request);
      setInboxQueueOpen(false);
      setResultHighlighted(true);
      window.setTimeout(() => setResultHighlighted(false), 2400);
      notify(`${automatic ? "已自动接收" : "已载入"} ERP 成本批次 ${inbox.batchId}，共 ${result.rows.length} 行成本证据。`, "success");
    } catch (error) {
      setParseError(error.message);
      notify(`ERP 批次核对失败，已继续保留待处理：${error.message}`, "error");
    }
  }, [expectedSkus, inboxRecords, locked, notify, snapshot?.ledger, sourceText, loadedInboxId]);

  useEffect(() => {
    if (!locked) return;
    for (const record of inboxRecords.filter((item) => item.status === "loaded" && item.ledgerId === snapshot?.ledger?.id)) {
      void markErpCostInboxStatus(record.id, "pending", { unloadedAt: new Date().toISOString(), unloadReason: "ledger_closed" });
    }
    setLoadedInboxId(null);
  }, [inboxRecords, locked, snapshot?.ledger?.id]);

  useEffect(() => {
    if (draftReadyLedger !== snapshot?.ledger?.id || loadedInboxId || sourceText.trim()) return;
    const recoverable = inboxQueue.items.find((item) => item.inbox?.status === "loaded" && !unloadedInboxIdsRef.current.has(item.inbox.id) && item.scopeMatched && item.filterScopeMatched !== false);
    const candidate = recoverable ?? inboxQueue.autoLoad;
    if (candidate && !unloadedInboxIdsRef.current.has(candidate.inbox.id)) void loadInboxRecord(candidate, { automatic: true });
  }, [draftReadyLedger, snapshot?.ledger?.id, inboxQueue.autoLoad, inboxQueue.items, loadInboxRecord, loadedInboxId, sourceText]);

  const releaseLoadedInbox = useCallback(() => {
    if (loadedInboxId) unloadedInboxIdsRef.current.add(loadedInboxId);
    if (loadedInboxId) void markErpCostInboxStatus(loadedInboxId, "pending", { unloadedAt: new Date().toISOString(), autoLoadSuppressed: true });
    setLoadedInboxId(null);
  }, [loadedInboxId]);

  const clearCurrentCostDraft = useCallback(() => {
    const currentLedgerId = snapshot?.ledger?.id;
    if (currentLedgerId) clearCostDraft(currentLedgerId);
    setSourceText("");
    setSourceName("clipboard.tsv");
    setParsedRows(null);
    setBatchEnvelope(null);
    setResolutions([]);
    setParseError("");
    setLoadedInboxId(null);
    setCostRequestId(null);
    setCostRequest(null);
  }, [snapshot?.ledger?.id]);

  const openDeleteBatches = useCallback((ids) => {
    setInboxQueueOpen(false);
    setDeleteBatchIds(ids);
  }, []);

  const cancelDeleteBatches = useCallback(() => {
    setDeleteBatchIds([]);
    setInboxQueueOpen(true);
  }, []);

  const openVoidBatch = useCallback((inbox) => {
    setInboxQueueOpen(false);
    setVoidDraft({ inbox, reason: "" });
  }, []);

  const cancelVoidBatch = useCallback(() => {
    setVoidDraft(null);
    setInboxQueueOpen(true);
  }, []);

  const confirmDeleteBatches = useCallback(async () => {
    if (deleteBatchIds.length === 0) return;
    setDeletingBatches(true);
    try {
      const result = await rejectErpInboxBatchesForCostMatching({
        ids: deleteBatchIds,
        loadedInboxId,
        rejectBatches: rejectErpCostInboxBatches,
        clearLoadedDraft: clearCurrentCostDraft,
      });
      setSelectedPendingInboxIds((current) => {
        const next = new Set(current);
        deleteBatchIds.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteBatchIds([]);
      setInboxQueueOpen(true);
      notify(`已删除 ${result.rejectedCount} 个 ERP 收件批次；原始回传与审计仍保留。`, "success");
    } catch (error) {
      notify(`删除 ERP 批次失败：${error.message}`, "error");
    } finally {
      setDeletingBatches(false);
    }
  }, [clearCurrentCostDraft, deleteBatchIds, loadedInboxId, notify]);

  const confirmVoidBatch = useCallback(async () => {
    if (!voidDraft?.inbox?.id) return;
    setVoidingBatch(true);
    try {
      const result = await voidPublishedErpCostBatch({
        inboxId: voidDraft.inbox.id,
        reason: voidDraft.reason,
      });
      setVoidDraft(null);
      setInboxQueueOpen(true);
      notify(result.reopened
        ? `已撤回本次采用的 ERP 成本 ${result.batchId}，本月已重新打开核对。`
        : `已撤回本次采用的 ERP 成本 ${result.batchId}；受影响 SKU 需要重新确认成本。`, "success");
    } catch (error) {
      notify(`撤回采用失败：${error.message}`, "error");
    } finally {
      setVoidingBatch(false);
    }
  }, [notify, voidDraft]);

  const reconciliation = useMemo(() => {
    if (!snapshot?.ledger || effectiveCostRows === null) return null;
    return reconcileErpCostRows({
      workspaceId: snapshot.ledger.workspaceId,
      period: snapshot.ledger.period,
      expectedSkus,
      costRows: effectiveCostRows,
      batchId: "preview",
      resolutions,
    });
  }, [effectiveCostRows, expectedSkus, resolutions, snapshot]);
  const publicationReconciliation = useMemo(() => parsedRows == null || !snapshot?.ledger ? null : reconcileErpCostRows({ workspaceId: snapshot.ledger.workspaceId, period: snapshot.ledger.period, expectedSkus: requestForImport?.expectedSkus ?? expectedSkus, costRows: parsedRows, batchId: "preview", resolutions }), [parsedRows, expectedSkus, requestForImport, resolutions, snapshot?.ledger]);
  const adoption = useMemo(() => erpAdoptionReadiness({ ledger: snapshot?.ledger, salesRows: snapshot?.rows, approvals: snapshot?.approvals, reconciliation: publicationReconciliation }), [snapshot, publicationReconciliation]);
  const hasNewBatch = Boolean(parsedRows && batchEnvelope?.formatVersion === ERP_COST_BATCH_VERSION && batchEnvelope.evidenceStatus === "complete");
  const isAutomaticInbox = Boolean(currentInbox && currentInbox.receivedVia !== 'manual-v2-import');
  const canRetryAutomatic = Boolean(currentInbox?.adoption?.version) && resolutions.length > 0 && !locked;
  const hasFilteredRows = filteredSalesLines.length > 0;
  const allCostsReady = formalSalesLines.length > 0 && formalSalesLines.every(row => row.finalizable);
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    for (const key of ["q", "supplier"]) next.delete(key);
    next.set("store", "all"); next.set("missing", "0");
    setResultQuery(""); setSearchParams(next, { replace: true });
  };
  const auxiliaryGroups = useMemo(() => groupAuxiliaryCostRows(reconciliation?.auxiliaryCostRows), [reconciliation?.auxiliaryCostRows]);

  const parseSource = () => {
    try {
      const result = parseErpCostInput(sourceText, {
        expectedWorkspaceId: snapshot?.ledger?.workspaceId,
        expectedLedgerId: snapshot?.ledger?.id,
        expectedRequestId: effectiveRequestId,
        expectedPlatformSkcs: requestForImport?.platformSkcs ?? platformSkcs,
        requestPayload: requestForImport,
        expectedSkus: requestForImport?.expectedSkus ?? expectedSkus,
        sourceName,
      });
      setParsedRows(result.rows);
      setBatchEnvelope(result.envelope);
      setResolutions([]);
      setParseError("");
      notify(result.kind === "batch"
        ? `ERP v8.0 批次包校验通过，共 ${result.rows.length} 行成本证据。`
        : result.kind === "legacy_batch"
          ? `已按 ERP v8.0 原始输出包装成本批次，共 ${result.rows.length} 行成本证据。`
          : `已解析 ${result.rows.length} 行 ERP 成本，正在按平台 SKU 核对。`, "success");
      setManualInputOpen(false);
    } catch (error) {
      setParsedRows(null);
      setBatchEnvelope(null);
      setResolutions([]);
      setParseError(error.message);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setSourceText(text);
      setSourceName("clipboard.tsv");
      setParsedRows(null);
      setBatchEnvelope(null);
      releaseLoadedInbox();
      setResolutions([]);
      setParseError("");
      notify("已读取剪贴板内容，请点击“解析并核对”。");
    } catch (error) {
      notify(`无法读取剪贴板：${error.message}`, "error");
    }
  };

  const loadFile = async (file) => {
    if (!file) return;
    try {
      const text = await readCostFileText(file);
      setSourceText(text);
      setSourceName(file.name);
      setParsedRows(null);
      setBatchEnvelope(null);
      releaseLoadedInbox();
      setResolutions([]);
      setParseError("");
      notify(`已读取 ${file.name}，请解析并核对。`);
    } catch (error) {
      notify(`成本文件读取失败：${error.message}`, "error");
    }
  };

  const copySkcs = async () => {
    if (!snapshot?.ledger || displayPlatformSkcs.length === 0) return;
    setCopyingSkcs(true);
    try {
      await writeClipboardText(displayPlatformSkcs.join("\n"));
      notify(`已复制 ${displayPlatformSkcs.length} 个平台 SKC。`);
    } catch (error) {
      notify(`复制 SKC 失败：${error.message}`, "error");
    } finally {
      setCopyingSkcs(false);
    }
  };

  const downloadCostTemplate = async () => {
    setExportingTemplate(true);
    try {
      await exportWorkbook([{
        平台SKU: "",
        平台SKC: "",
        仓库SKU: "",
        "关联单号": "",
        单件平均成本: "",
        "供应商1688链接": "",
      }], "erp-cost-template.xlsx", "ERP成本导入模板");
      notify("WPS/Excel 成本导入模板已下载。填写后可直接从“导入 ERP 成本结果”导回。", "success");
    } catch (error) {
      notify(`成本模板下载失败：${error.message}`, "error");
    } finally {
      setExportingTemplate(false);
    }
  };

  const publish = async () => {
    if (!snapshot?.ledger || publishing) return;
    if (isAutomaticInbox) {
      if (!canRetryAutomatic) return;
      setPublishing(true);
      try {
        const result = await processErpCostInboxAdoption({ inboxId: currentInbox.id, resolutions });
        notify(`已重新处理 ERP 异常：自动采用 ${result.adoption?.summary?.adoptedCount - result.adoption?.summary?.manualEffectiveCount || 0} 项，剩余 ${result.adoption?.summary?.remainingCount ?? 0} 项。`, "success");
        if (result.status === "applied") { clearCostDraft(snapshot.ledger.id); if (onPublished) onPublished(result); }
      } catch (error) { notify(`重试 ERP 异常失败：${error.message}`, "error"); }
      finally { setPublishing(false); }
      return;
    }
    if (!hasNewBatch || !publicationReconciliation) return;
    if (!adoption.canAdopt) {
      notify("仍有未解决的采购异常；人工更正须覆盖该 SKU 在本月的全部店铺。", "error");
      return;
    }
    if (!effectiveRequestId && !batchEnvelope?.requestId) {
      notify("采用前需要已登记的成本查询关联，请重试登记或查看回传批次。", "error");
      return;
    }
    setPublishing(true);
    try {
      const inputHash = await sha256Text(sourceText);
      if (ledgerIdentityRef.current !== snapshot.ledger.id) return;
      const result = await savePublishedErpCostBatch({
        ledgerId: snapshot.ledger.id,
        workspaceId: snapshot.ledger.workspaceId,
        inboxId: loadedInbox?.id && loadedInbox.batchId === batchEnvelope?.batchId ? loadedInbox.id : null,
        requestId: batchEnvelope?.requestId ?? effectiveRequestId,
        reconciliation: publicationReconciliation,
        sourceName,
        inputHash,
        sourceEnvelope: batchEnvelope,
      });
      notify(`本次 ERP 已采用 ${result.matchedCount} 个 SKU；${result.manuallyCoveredCount ?? 0} 个 SKU 继续使用人工成本。`);
      clearCostDraft(snapshot.ledger.id);
      if (ledgerIdentityRef.current === snapshot.ledger.id) {
        if (onPublished) onPublished(result);
        else navigate(profitHref);
      }
    } catch (error) {
      notify(`采用 ERP 成本失败：${error.message}`, "error");
    } finally {
      setPublishing(false);
    }
  };

  const reviewMatchBySku = useMemo(() => new Map((reconciliation?.matches ?? []).map(row => [row.canonicalPlatformSku, row])), [reconciliation]);
  const allReviewRows = useMemo(() => formalSalesLines.map(row => {
    const scope = { workspaceId: snapshot?.ledger?.workspaceId, ledgerId: snapshot?.ledger?.id, period: snapshot?.ledger?.period, store: row.store, platformSku: row.platformSku };
    const manualOverride = selectManualOverride(snapshot?.approvals, scope);
    const erpCost = formalCostsBySku.get(row.canonicalPlatformSku);
    const decision = resolveFormalCostDecision({ ...scope, erpCost, manualOverride });
    const match = reviewMatchBySku.get(row.canonicalPlatformSku);
    return { ...row, manualOverride, erpCost, decision, match, unitCost: manualOverride?.approvedAmount ?? decision.unitCost ?? match?.unitCost };
  }), [formalSalesLines, formalCostsBySku, reviewMatchBySku, snapshot?.ledger, snapshot?.approvals]);
  const filteredReviewRowIds = useMemo(() => new Set(filteredSalesLines.map(row => row.id)), [filteredSalesLines]);
  const reviewRows = useMemo(() => allReviewRows.filter(row => filteredReviewRowIds.has(row.id)), [allReviewRows, filteredReviewRowIds]);
  const reviewRowsBySku = useMemo(() => {
    const result = new Map();
    for (const row of reviewRows) { const group = result.get(row.canonicalPlatformSku) ?? []; group.push(row); result.set(row.canonicalPlatformSku, group); }
    return result;
  }, [reviewRows]);
  const targetRow = manualTarget ? allReviewRows.find(row => row.id === manualTarget.id) ?? null : null;
  const targetAdoptionItem = targetRow ? adoptionItemsBySku.get(targetRow.canonicalPlatformSku) : null;
  const targetCostExplanation = targetRow?.manualOverride
    ? `更正说明：${targetRow.manualOverride.reason}。原 ERP 证据保留，更正不会将异常记录变为合格采购。`
    : targetRow?.decision.eligibleForExactProfit
      ? 'ERP 正式成本已生效，可直接核算。'
      : targetAdoptionItem
        ? `${ERP_ADOPTION_ITEM_LABELS[targetAdoptionItem.state] ?? '回传待核对'}${targetAdoptionItem.reason ? `：${describeErpAdoptionReason(targetAdoptionItem.reason)}` : ''}；候选价尚未计入正式利润。`
        : reviewAdoption?.state === 'blocked'
          ? `本批次来源未通过整批校验：${describeErpAdoptionReason(reviewAdoption.reason) || '请查看批次记录'}；候选价仅供预览。`
          : targetRow?.match?.status === 'matched'
            ? '已算出 ERP 候选价，但尚无正式采用记录；候选价仅供预览，请检查收件或草稿恢复状态。'
            : '当前没有已采用的有效成本；请查看 ERP 回传与批次状态。';
  const candidateSkuSet = useMemo(() => new Set((parsedRows ?? []).map(row => canonicalPlatformSku(row.platformSku))), [parsedRows]);
  const reviewMatches = useMemo(() => withLedgerAttributes((reconciliation?.matches ?? expectedSkus.map(row => ({ ...row, canonicalPlatformSku: canonicalPlatformSku(row.platformSku), status: "missing", unitCost: null }))).filter(row => displaySkuSet.has(row.canonicalPlatformSku)), snapshot?.rows), [reconciliation, expectedSkus, displaySkuSet, snapshot?.rows]);

  const openResolution = (match, anomaly, action) => {
    const record = match.costDecision?.selectedRecords?.find((item) => item.recordId === anomaly.recordId);
    if (!record) return;
    setResolutionDraft({
      warehouseSku: match.sourceWarehouseSku,
      recordId: record.recordId,
      purchaseDate: record.purchaseDate,
      originalUnitPrice: record.unitPrice,
      resolvedUnitPrice: action === "confirm_true_price" ? String(record.unitPrice) : "",
      action,
      reasons: anomaly.reasons,
      baseline: match.baseline,
      reason: "",
    });
  };

  const saveResolution = () => {
    if (!resolutionDraft) return;
    const resolvedUnitPrice = Number(resolutionDraft.resolvedUnitPrice);
    if (!Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice <= 0) {
      notify("确认后的采购单价必须大于 0。", "error");
      return;
    }
    if (resolutionDraft.action === "correct_price" && Math.abs(resolvedUnitPrice - resolutionDraft.originalUnitPrice) < 0.00005) {
      notify("修正价格必须与原采购单价不同。", "error");
      return;
    }
    const resolution = {
      warehouseSku: resolutionDraft.warehouseSku,
      recordId: resolutionDraft.recordId,
      action: resolutionDraft.action,
      originalUnitPrice: resolutionDraft.originalUnitPrice,
      resolvedUnitPrice,
      reason: resolutionDraft.reason.trim() || (resolutionDraft.action === "confirm_true_price"
        ? "已核对 ERP 采购记录，确认属于真实采购价"
        : "已核对 ERP 采购记录并修正录入价格"),
      resolvedBy: "local-user",
      resolvedAt: new Date().toISOString(),
    };
    setResolutions((current) => upsertCostResolution(current, resolution));
    setResolutionDraft(null);
    notify(resolution.action === "confirm_true_price" ? "已确认真实采购价，候选成本已重新计算。" : "采购价已修正，候选成本已重新计算。", "success");
  };

  const columns = useMemo(() => {
    const isCollapsed = (group) => group.variants.some(isUnmappedCostMatch) && !expandedUnmappedGroups.has(group.id);
    const renderStack = (group, render) => {
      const unmapped = group.variants.filter(isUnmappedCostMatch);
      const mapped = group.variants.filter((item) => !isUnmappedCostMatch(item));
      if (isCollapsed(group)) return <div className="cost-variant-stack">{mapped.map(render)}{unmapped.length ? <span className="cost-collapsed-cell">{unmapped.length} 条未映射证据 · 点击展开</span> : null}</div>;
      return <div className="cost-variant-stack">{group.variants.map(render)}</div>;
    };
    return [
      { accessorKey: "platformSkc", header: "平台 SKC", enableSorting: false, cell: ({ row }) => {
        const group = row.original;
        const unmappedCount = group.variants.filter(isUnmappedCostMatch).length;
        const expanded = expandedUnmappedGroups.has(group.id);
        return <div className="cost-group-skc"><span className="cost-group-skc-label">{unmappedCount ? <button className="cost-group-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedUnmappedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })} title={expanded ? "收起未映射证据" : "展开查看未映射原始证据"}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<strong className="mono">{group.platformSkc}</strong></button> : <strong className="mono">{group.platformSkc}</strong>}<small>{group.skuCount} 个 SKU{unmappedCount ? ` · ${unmappedCount} 条未映射` : ""}</small></span>{expanded ? <EvidencePreview variants={group.variants} /> : null}</div>;
      } },
      { id: "platformSku", header: "平台 SKU / 属性", enableSorting: false, cell: ({ row }) => renderStack(row.original, (item) => <div className="cost-variant-line" key={item.canonicalPlatformSku}><strong className="mono" title={item.platformSku}>{item.platformSku}</strong><small>{item.attribute || "未提供属性"}</small>{item.attributeEvidence?.length > 1 ? <details><summary>查看 {item.attributeEvidence.length} 种属性来源</summary>{item.attributeEvidence.map(({ attribute, sources }) => <p key={attribute}><strong>{attribute}</strong>：{sources.slice(0, 3).map((source) => `${source.store || "店铺未填"}${source.sourceSheet ? `/${source.sourceSheet}` : ""} 第${source.sourceRow ?? "?"}行`).join("、")}{sources.length > 3 ? `，另 ${sources.length - 3} 行` : ""}</p>)}</details> : null}</div>) },
      { id: "unitCost", header: "ERP 证据 / 候选", enableSorting: false, cell: ({ row }) => renderStack(row.original, item => <div className="cost-variant-line" key={item.canonicalPlatformSku}><span className="cost-status-stack">{item.unitCost != null ? <span className="mono table-number">{formatErpUnitCost(item.unitCost)}</span> : <span className="pending-text">尚无可用值</span>}<small>{adoptionItemsBySku.has(item.canonicalPlatformSku) ? ERP_ADOPTION_ITEM_LABELS[adoptionItemsBySku.get(item.canonicalPlatformSku).state] ?? "回传待核对" : candidateSkuSet.has(item.canonicalPlatformSku) ? item.status === "matched" ? "手动批次待采用" : item.status === "anomaly_pending" ? item.costDecision?.selectedRecords?.length === 0 ? "本月及以前无合格采购" : item.evidenceComplete ? "采购异常待处理" : "采购证据不完整" : "未查到可用成本，原因待查" : item.status === "matched" ? "已采用 ERP" : item.periodReviewRequired ? "原采用选样待复核" : "尚未收到可用成本"}</small></span></div>) },
      { id: "currentCost", header: "当前采用结果", enableSorting: false, cell: ({ row }) => renderStack(row.original, item => <div className="cost-variant-line cost-store-results" key={item.canonicalPlatformSku}>{(reviewRowsBySku.get(item.canonicalPlatformSku) ?? []).map(line => <div key={line.id}><strong>{line.store}</strong><span className="mono">{line.decision.eligibleForExactProfit ? line.manualOverride ? formatManualUnitCost(line.decision.unitCost) : formatErpUnitCost(line.decision.unitCost) : "待补成本"}</span><small>{line.manualOverride ? "人工更正有效" : line.decision.eligibleForExactProfit ? "ERP 已采用" : "未采用有效成本"}{line.manualOverride?.approvedAt || line.erpCost?.publishedAt ? ` · ${new Date(line.manualOverride?.approvedAt ?? line.erpCost.publishedAt).toLocaleDateString("zh-CN")}` : ""}</small></div>)}</div>) },
      { id: "actions", header: "详情与更正", enableSorting: false, cell: ({ row }) => renderStack(row.original, item => <div className="cost-variant-line cost-store-results" key={item.canonicalPlatformSku}>{(reviewRowsBySku.get(item.canonicalPlatformSku) ?? []).map(line => <Button key={line.id} onClick={() => setManualTarget(line)}>{line.store} · {locked ? "查看详情" : line.manualOverride ? "更正 / 撤销" : "处理成本"}</Button>)}</div>) },
    ];
  }, [expandedUnmappedGroups, candidateSkuSet, adoptionItemsBySku, reviewRowsBySku, locked]);

  const groupedMatches = useMemo(() => groupCostMatchesBySkc(reviewMatches), [reviewMatches]);
  const visibleGroupedMatches = useMemo(() => filterCostMatchGroups(groupedMatches, resultQuery), [groupedMatches, resultQuery]);
  const visibleReviewRows = useMemo(() => visibleGroupedMatches.flatMap(group => group.variants.flatMap(item => reviewRowsBySku.get(item.canonicalPlatformSku) ?? [])), [visibleGroupedMatches, reviewRowsBySku]);
  const targetIndex = targetRow ? visibleReviewRows.findIndex(row => row.id === targetRow.id) : -1;
  const nextTarget = targetIndex >= 0 ? visibleReviewRows[targetIndex + 1] : null;

  const resolutionDialog = (
    <Modal
      open={Boolean(resolutionDraft)}
      title={resolutionDraft?.action === "confirm_true_price" ? "确认真实采购价" : "修正采购单价"}
      description="该操作只写入 Lworkstation 的成本处置审计，不修改 ERP 原始采购证据。"
      className="cost-resolution-modal"
      onClose={() => setResolutionDraft(null)}
      footer={<><Button variant="ghost" onClick={() => setResolutionDraft(null)}>取消</Button><Button variant="primary" onClick={saveResolution}>保存并重新核算</Button></>}
    >
      {resolutionDraft ? <div className="cost-resolution-form">
        <div className="cost-resolution-context"><span><small>仓库 SKU</small><strong className="mono">{resolutionDraft.warehouseSku}</strong></span><span><small>采购日期</small><strong>{resolutionDraft.purchaseDate || "--"}</strong></span><span><small>原采购单价</small><strong className="mono">{purchaseCurrency(resolutionDraft.originalUnitPrice)}</strong></span></div>
        <div className="cost-resolution-reasons">{resolutionDraft.reasons.map((reason) => <Badge tone="warning" key={reason}>{ERP_COST_ANOMALY_LABELS[reason] ?? reason}</Badge>)}</div>
        {resolutionDraft.baseline?.enabled ? <p className="cost-resolution-baseline">历史正价样本 {resolutionDraft.baseline.sampleCount} 条，中位价 {currency(resolutionDraft.baseline.median)}，参考区间 {currency(resolutionDraft.baseline.lowerBound)} 至 {currency(resolutionDraft.baseline.upperBound)}。</p> : <p className="cost-resolution-baseline">历史正价样本不足 6 条；本次仅核对零价或一元采购价。</p>}
        <div className="form-field"><label>{resolutionDraft.action === "confirm_true_price" ? "确认价格" : "修正后单价（CNY）"}</label><input className="text-input mono" type="number" min="0.0001" step="0.0001" disabled={resolutionDraft.action === "confirm_true_price"} value={resolutionDraft.resolvedUnitPrice} onChange={(event) => setResolutionDraft((current) => ({ ...current, resolvedUnitPrice: event.target.value }))} /></div>
        <div className="form-field"><label>核对说明（可选）</label><textarea className="text-area" rows="3" value={resolutionDraft.reason} onChange={(event) => setResolutionDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="例如：供应商真实调价，已与采购单据核对" /></div>
      </div> : null}
    </Modal>
  );

  const erpAssistantDialog = (
    <Modal
      open={erpAssistantOpen}
      title={desktop ? "内置 ERP 扩展状态" : "ERP 助手安装与连接"}
      description={desktop ? "桌面版已内置扩展，这里显示当前连接状态；完整信息保留在系统诊断。" : "安装一次即可。这里可以检查本机收件服务是否在线，并查看扩展安装步骤。"}
      className="erp-assistant-modal"
      onClose={() => setErpAssistantOpen(false)}
      footer={<Button variant="primary" onClick={() => setErpAssistantOpen(false)}>返回成本核对</Button>}
    >
      <ErpAssistantSetup compact />
    </Modal>
  );

  const inboxQueueDialog = (
    <CostMatchingInboxQueueDialog
      open={inboxQueueOpen && deleteBatchIds.length === 0 && !voidDraft}
      inboxQueue={inboxQueue}
      processedInboxRecords={processedInboxRecords}
      ledger={snapshot?.ledger}
      requests={requestRecords}
      selectedPendingInboxIds={selectedPendingInboxIds}
      loadedInboxId={loadedInboxId}
      accountingReadOnly={locked}
      ledgerLocked={ledgerLocked}
      onClose={() => setInboxQueueOpen(false)}
      onManualImport={() => { setInboxQueueOpen(false); setManualInputOpen(true); }}
      onTogglePending={(id, selected) => setSelectedPendingInboxIds((current) => { const next = new Set(current); if (selected) next.add(id); else next.delete(id); return next; })}
      onDeleteSelected={openDeleteBatches}
      onLoadInbox={(item) => void loadInboxRecord(item)}
      onDeleteOne={(id) => openDeleteBatches([id])}
      onVoid={openVoidBatch}
    />
  );

  const deleteBatchDialog = (
    <CostMatchingDeleteBatchDialog
      ids={deleteBatchIds}
      deleting={deletingBatches}
      onCancel={cancelDeleteBatches}
      onConfirm={() => void confirmDeleteBatches()}
    />
  );

  const voidBatchDialog = (
    <CostMatchingVoidBatchDialog
      draft={voidDraft}
      voiding={voidingBatch}
      ledgerStatus={snapshot?.ledger?.status}
      onCancel={cancelVoidBatch}
      onReasonChange={(reason) => setVoidDraft((current) => ({ ...current, reason }))}
      onConfirm={() => void confirmVoidBatch()}
    />
  );

  const manualInputDialog = (
    <Modal
      open={manualInputOpen}
      title="手动输入 ERP 成本"
      description="自动回传优先。只有在扩展未回传、需要补录或使用旧版结果时，才需要手动输入。"
      className="cost-manual-input-modal"
      onClose={() => setManualInputOpen(false)}
      footer={<><Button variant="ghost" onClick={() => setManualInputOpen(false)}>取消</Button><Button variant="primary" disabled={locked || !sourceText.trim()} onClick={parseSource}>解析并核对</Button></>}
    >
      {batchEnvelope ? <div className="cost-batch-summary"><FileJson size={20} /><span><strong>当前已载入 ERP 采购证据批次</strong><small><code>{batchEnvelope.batchId}</code> · {batchEnvelope.summary.outputRowCount} 行 / {batchEnvelope.summary.warehouseSkuCount} 个仓库 SKU</small></span><Badge tone={batchEnvelope.evidenceStatus === "complete" ? "success" : "warning"}>{batchEnvelope.evidenceStatus === "complete" ? "完整证据" : "兼容预览"}</Badge></div> : null}
      <textarea className="cost-textarea cost-manual-textarea mono" value={sourceText} disabled={locked} onChange={(event) => { setSourceText(event.target.value); setSourceName("手动输入"); setParsedRows(null); setBatchEnvelope(null); releaseLoadedInbox(); setParseError(""); }} placeholder={buildErpCostTemplate()} aria-label="手动输入 ERP 成本批次 JSON、TSV 或 CSV" />
      {parseError ? <div className="import-error" role="alert"><AlertCircle size={18} />{parseError}</div> : null}
      <div className="cost-source-actions cost-manual-actions"><Button icon={ClipboardPaste} disabled={locked} onClick={pasteFromClipboard}>粘贴 ERP 结果</Button><Button variant="ghost" disabled={locked} onClick={() => { setSourceText(buildErpCostTemplate()); setSourceName("template.tsv"); setParsedRows(null); setBatchEnvelope(null); releaseLoadedInbox(); setParseError(""); }}>插入列模板</Button><Button variant="ghost" icon={FileUp} disabled={locked} onClick={() => fileInputRef.current?.click()}>导入成本文件</Button></div>
      {effectiveRequestId ? <p className="cost-request-note">已关联 ERP 请求：<code>{effectiveRequestId}</code></p> : <p className="cost-request-note warning-text">{registrationState.status === "failed" ? "回传关联登记失败，请关闭此窗口后点击“重试登记”。" : "正在自动登记回传关联，请等待登记完成。"}复制平台 SKC 仅用于方便 ERP 查询。</p>}
    </Modal>
  );

  if (snapshot === undefined) {
    return <Panel className="route-loader">正在读取月度账本...</Panel>;
  }

  if (!snapshot?.ledger || salesLines.length === 0) {
    return (
      <>
        <div className="page-back-row cost-page-toolbar"><Button icon={PlugZap} onClick={() => setErpAssistantOpen(true)}>{desktop ? "ERP 扩展状态" : "安装 ERP 助手"}</Button></div>
        {!validatedContext ? <PageHeader title="ERP 成本核对" description="先导入月度销售台账，再采集一次 ERP 成本供本月反复核对和复用。" /> : null}
        <Panel><EmptyState icon={Warehouse} title="没有可核对的月度销售明细" description="导入台账后，本页会按平台 SKU 列出所有需要 ERP 成本的明细。" action={<Button variant="primary" icon={Upload} onClick={openLedgerImport}>导入月度台账</Button>} /></Panel>
        {erpAssistantDialog}
        {deleteBatchDialog}
        {voidBatchDialog}
      </>
    );
  }

  return (
    <>
      {!locked && platformSkcs.length > 0 && registrationState.message ? <p className="cost-registration-status" role="status">{registrationState.message}{registrationState.status === "failed" ? <Button onClick={() => setRegistrationRetry((value) => value + 1)}>重试登记</Button> : null}</p> : null}
      {sourceText.trim() && inboxQueue.items.some((item) => item.scopeMatched && item.inbox.status === "pending" && item.inbox.id !== loadedInboxId) ? <Panel><p>本机已收到新批次；正常项已自动处理，剩余项和当前草稿仍保留。</p><Button onClick={() => setInboxQueueOpen(true)}>查看回传批次</Button></Panel> : null}
      <div className="page-back-row cost-page-toolbar"><Button icon={PlugZap} onClick={() => setErpAssistantOpen(true)}>{desktop ? "ERP 扩展状态" : "安装 ERP 助手"}</Button></div>
      <div className="profit-section-toolbar"><div>{!validatedContext ? <h1>ERP 成本核对</h1> : null}<p>当前范围：{describeProfitFilter(profitFilter)} · 采购截至 {snapshot.ledger.period}</p></div><div className="page-actions"><Button icon={displayPlatformSkcs.length ? Copy : AlertCircle} loading={copyingSkcs} disabled={copyingSkcs || displayPlatformSkcs.length === 0} onClick={copySkcs}>{displayPlatformSkcs.length ? `复制 ${displayPlatformSkcs.length} 个平台 SKC` : hasFilteredRows ? "待补平台 SKC" : "当前范围无明细"}</Button><Button icon={Download} loading={exportingTemplate} disabled={exportingTemplate} onClick={downloadCostTemplate} title="下载可用 WPS/Excel 打开的成本导入模板">下载成本导入模板</Button><Button icon={Inbox} variant="ghost" onClick={() => setInboxQueueOpen(true)} title="查看按时间排列的 ERP 回传批次">待处理 {inboxQueue.pendingCount}</Button><Button variant="ghost" onClick={() => setManualInputOpen(true)}>{batchEnvelope ? "查看当前证据" : "手动导入"}</Button><input ref={fileInputRef} className="visually-hidden" type="file" aria-label="选择 ERP 成本结果文件" accept=".json,.tsv,.csv,.txt,.xlsx,.xls" onChange={(event) => loadFile(event.target.files[0])} /></div></div>

      <div className="cost-flow-guide" aria-label="成本核对状态" role="status">
        <div className="cost-flow-guide-heading"><strong>{locked ? "当前账本只读" : adoptionNotice?.title ?? (hasNewBatch ? "手动批次待核对" : allCostsReady ? "本月成本已齐" : "等待 ERP 回传或人工更正")}</strong><span>{adoptionNotice?.details ?? (hasNewBatch ? `已收到 ${parsedRows.length} 行证据 · 可采用 ${adoption.summary.erpAdoptableCount} 个 SKU · 异常待处理 ${adoption.summary.blockedAnomalyCount} 个` : persistedCostRows.length ? `已有 ${persistedCostRows.length} 个 SKU 的正式 ERP 成本。` : "可查询 ERP 并等待回传，也可从明细填写当前店铺的人工成本。")}</span></div>
      </div>

      {(adoptionNotice?.remainingCount > 0 || hasNewBatch && adoption.summary.blockedAnomalyCount > 0) ? <div className="cost-anomaly-warning" role="alert"><AlertCircle size={20} /><span><strong>{adoptionNotice?.remainingCount ?? adoption.summary.blockedAnomalyCount} 个 SKU 仍需核对</strong><small>查看采购证据并处理异常、补齐缺失项或按店铺人工更正。原始回传记录保留。</small></span><Button variant="ghost" onClick={clearFilters}>查看全部范围</Button></div> : null}
      {exceptionGroups.length ? <details className="cost-exception-groups" open>
        <summary>按原因查看剩余项与处理方式</summary>
        <div className="cost-exception-grid">{exceptionGroups.map(group => <section key={group.state}>
          <h3>{group.label} <span>{group.items.length}</span></h3><p>{group.action}</p>
          <div>{group.items.map(item => <Button key={item.canonicalPlatformSku} variant="ghost" onClick={() => { clearFilters(); setResultQuery(item.platformSku); window.setTimeout(() => document.querySelector(".cost-preview-panel")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 0); }}>{item.platformSku}</Button>)}</div>
        </section>)}</div>
      </details> : null}
      {hasFilteredRows && missingPlatformSkcCount > 0 ? <div className="cost-skc-warning" role="alert"><AlertCircle size={18} /><span><strong>当前范围有 {missingPlatformSkcCount} 条明细缺少平台 SKC</strong><small>这些明细无法生成对应 ERP 查询；请检查台账映射，或按店铺人工更正。已有 SKC 的其他明细可继续查询。</small></span><Button variant="ghost" onClick={openLedgerImport}>检查导入映射</Button></div> : null}

      <div className="match-stat-grid">
        <Panel className="match-stat"><ListChecks size={22} /><span>当前查看平台 SKU</span><strong>{displaySkuSet.size}</strong></Panel>
        <Panel className="match-stat match-success"><CheckCircle2 size={22} /><span>当前有效成本</span><strong>{filteredSalesLines.filter(row => row.finalizable).length}<small> 条店铺 SKU</small></strong></Panel>
        <Panel className="match-stat match-warning"><AlertCircle size={22} /><span>ERP 自动采用</span><strong>{adoptionNotice?.automaticCount ?? 0}<small> 个 SKU</small></strong></Panel>
        <Panel className="match-stat match-danger"><AlertCircle size={22} /><span>仍缺有效成本</span><strong>{filteredSalesLines.filter(row => !row.finalizable).length}<small> 条店铺 SKU</small></strong><p>按当前查看范围</p></Panel>
      </div>

      <div className="cost-workflow">
        <Panel className={`cost-preview-panel ${resultHighlighted ? "cost-preview-highlight" : ""}`}>
          {parseError ? <div className="cost-inline-error" role="alert"><AlertCircle size={16} />{parseError}</div> : null}
          <div className="panel-header cost-preview-header"><div className="panel-title"><ListChecks size={19} /><h2>成本核对与更正</h2></div><div className="cost-preview-tools"><SearchInput value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} placeholder="搜索 SKC、SKU、仓库 SKU、供应商或采购单..." /><span className="cost-preview-count">显示 {visibleGroupedMatches.length} / {groupedMatches.length} 个 SKC</span><Button variant="ghost" onClick={clearFilters}>清除筛选</Button></div></div>
          {visibleGroupedMatches.length ? <DataTable ref={rememberTable} columns={columns} data={visibleGroupedMatches} getRowId={(row) => row.id} pageSize={12} initialViewState={initialView?.table} paginationResetKey={`${profitHref}/${resultQuery}`} /> : <EmptyState icon={ListChecks} title={!hasFilteredRows && profitFilter.missingOnly && allCostsReady ? "本月成本已齐" : "当前筛选没有匹配明细"} description={!hasFilteredRows && profitFilter.missingOnly && allCostsReady ? "没有待补成本的店铺 SKU，可返回利润明细继续核算。" : "清除搜索、店铺或缺成本筛选后查看；这不代表台账缺少 SKC。"} action={<Button onClick={clearFilters}>查看全部明细</Button>} />}
          {reconciliation?.overrides.length ? <div className="cost-audit-note"><AlertCircle size={17} />检测到 {reconciliation.overrides.length} 次候选替换，旧值与新值会随采用写入批次审计。</div> : null}
          {reconciliation?.summary.anomalyConfirmedCount ? <div className="cost-audit-note cost-audit-confirmed"><CheckCircle2 size={17} />有 {reconciliation.summary.anomalyConfirmedCount} 个平台 SKU 已完成人工判断；原始采购证据、修正结果、原因和时间会随本月成本保存。</div> : null}
          {hasNewBatch && publicationReconciliation?.unmatchedCostRows.length ? <div className="cost-audit-note"><AlertCircle size={17} />本批次有 {publicationReconciliation.unmatchedCostRows.length} 行成本不属于已登记的平台 SKU 范围，保留证据但不写入正式成本。</div> : null}
          {auxiliaryGroups.length ? <details className="cost-auxiliary-audit"><summary><Info size={17} />同查询 SKC 下、本账本未使用的额外变体 <strong>{reconciliation.summary.auxiliaryCount}</strong> 行</summary><div className="cost-auxiliary-list">{auxiliaryGroups.map((group) => <section key={group.id}><header><strong className="mono">{group.platformSkc}</strong><span>仓库 SKU <code>{group.warehouseSku}</code></span></header><p>{group.variants.map((variant) => variant.platformSku).join("、")}</p><small>采购记录 {group.purchaseRecordCount} 条 · 排除记录 {group.excludedRecordCount} 条 · 仅供预览与审计，不影响本账本成本，也不会写入正式利润。</small></section>)}</div></details> : null}
          {(sourceText.trim() || locked || !persistedCostRows.length) ? <div className="cost-publish-bar"><span>{isAutomaticInbox ? adoptionNotice?.details ?? "正在自动核验本次回传，请稍后查看结果。" : hasNewBatch ? `手动批次可采用 ${adoption.summary.erpAdoptableCount} 项 · 异常待处理 ${adoption.summary.blockedAnomalyCount} 项` : sourceText.trim() ? "当前输入仅供核对；正式 ERP 采用需要完整采购证据批次。" : "尚无 ERP 成本，可从列表人工更正。"}</span>{locked ? <Button disabled>账本已定稿</Button> : isAutomaticInbox ? <Button variant="primary" loading={publishing} disabled={publishing || !canRetryAutomatic} onClick={publish}>重试已处理异常</Button> : hasNewBatch ? <Button variant="primary" loading={publishing} disabled={publishing || !adoption.canAdopt} onClick={publish}>采用手动批次成本</Button> : null}</div> : null}
          {(hasNewBatch || isAutomaticInbox) ? <p className="cost-audit-note">回传按完整账本范围核对，页面筛选不改变采用范围；人工有效值始终优先，异常证据保留。</p> : null}
        </Panel>
      </div>
      {inboxQueueDialog}
      {targetRow ? <ManualCostDialog key={targetRow.id} ledger={snapshot.ledger} row={targetRow} readOnly={locked} className="cost-detail-modal" title="成本详情与更正" onClose={() => setManualTarget(null)} onNext={nextTarget ? () => setManualTarget(nextTarget) : undefined}>
        <div className="cost-detail-current"><strong>当前采用：{targetRow.decision.eligibleForExactProfit ? targetRow.manualOverride ? `${formatManualUnitCost(targetRow.decision.unitCost)} · 人工更正` : `${formatErpUnitCost(targetRow.decision.unitCost)} · ERP` : "缺少有效成本"}</strong><small>{targetCostExplanation}</small></div>
        <section className="cost-detail-evidence"><h3>ERP 采购证据</h3>{targetRow.match && targetRow.match.status !== "missing" ? <><p>仓库 SKU：{targetRow.match.sourceWarehouseSku || "未映射"} · {snapshot.ledger.period} 及以前</p><SelectedPurchaseEvidence match={targetRow.match} /><EvidenceDetails match={targetRow.match} />{(targetRow.match.costDecision?.anomalies ?? []).map(anomaly => <div className="cost-resolution-record" key={anomaly.recordId}><div><strong>{purchaseCurrency(anomaly.originalUnitPrice)}</strong><small>{anomaly.reasons.map(reason => ERP_COST_ANOMALY_LABELS[reason] ?? reason).join("；")}</small></div>{anomaly.status === "resolved" ? <Badge tone="success">已处置</Badge> : !locked && candidateSkuSet.has(targetRow.canonicalPlatformSku) ? <div className="cost-resolution-actions"><Button onClick={() => openResolution(targetRow.match, anomaly, "correct_price")}>修正采购价</Button>{anomaly.originalUnitPrice > 0 ? <Button onClick={() => openResolution(targetRow.match, anomaly, "confirm_true_price")}>确认真实价格</Button> : null}</div> : <Badge tone="warning">原证据待复核</Badge>}</div>)}</> : <p>当前没有可用 ERP 证据；历史回传仍在批次记录中，人工成本仅用于当前店铺。</p>}</section>
      </ManualCostDialog> : null}
      {deleteBatchDialog}
      {voidBatchDialog}
      {manualInputDialog}
      {erpAssistantDialog}
      {resolutionDialog}
      <Modal open={Boolean(incomingCandidate)} onClose={() => setIncomingCandidate(null)} title="已收到 ERP 成本结果" description="新批次已持久保存；载入将替换当前未发布草稿。" footer={<><Button onClick={() => setIncomingCandidate(null)}>保留草稿</Button><Button variant="primary" onClick={() => { const candidate = incomingCandidate; setIncomingCandidate(null); void loadInboxRecord(candidate, { discardDraft: true }); }}>丢弃草稿并载入结果</Button></>}><p>{incomingCandidate?.inbox?.batchId}</p></Modal>
    </>
  );
}
