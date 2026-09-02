import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, ClipboardPaste, Copy, Download, FileJson, FileUp, Inbox, Info, ListChecks, Pencil, PlugZap, Upload, Warehouse } from "lucide-react";
import AppShell from "../components/AppShell";
import DataTable from "../components/DataTable";
import ErpAssistantSetup from "../components/ErpAssistantSetup";
import { isDesktopRuntime } from "../lib/desktopRuntime";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, SearchInput, useToast } from "../components/UI";
import { getErpCostInbox, getLatestErpCostRequest, listErpCostInbox, listErpCostRequests, markErpCostInboxStatus, rejectErpCostInboxBatches, saveErpCostRequest, savePublishedErpCostBatch, switchLoadedErpCostInbox, voidPublishedErpCostBatch } from "../data/database";
import { reconcileErpCostRows } from "../domain/erpCosts";
import { ERP_COST_ANOMALY_LABELS, upsertCostResolution } from "../domain/erpCostResolution";
import { collectErpPlatformSkcs } from "../domain/erpQueryScope";
import { buildErpInboxQueue, ERP_INBOX_MATCH_REASONS } from "../domain/erpInboxMatching";
import { canonicalPlatformSku } from "../domain/identifiers";
import { useLatestSalesImport } from "../hooks/useLatestSalesImport";
import { buildErpCostTemplate, parseErpCostInput } from "../lib/erpCostImport";
import { groupImportedSales } from "../lib/profit";
import { buildLedgerErpCostRequest } from "../lib/erpRequest";
import { registerErpBridgeRequest } from "../lib/erpInboxTransport";
import { buildProfitHref, filterProfitRows, readProfitFilter } from "../lib/profitFilter";
import { exportWorkbook } from "../lib/spreadsheetExport";
import { buildErpInboxHistory, describeEvidenceIssues, evidenceRepairGuidance, filterCostMatchGroups, filterCostMatches, groupAuxiliaryCostRows, groupCostMatchesBySkc, hasMappingIdentityIssue, isUnmappedCostMatch, rejectErpInboxBatchesForCostMatching, switchLoadedErpInboxDraft } from "../lib/costMatching";
import { clearCostDraft, invalidateLegacyCostDrafts, readRestorableCostDraft, writeCostDraft } from "../lib/costMatchingDraft";
import { CostMatchingDeleteBatchDialog, CostMatchingInboxQueueDialog, CostMatchingVoidBatchDialog } from "./CostMatchingInboxDialogs";

const currency = (value) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });
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

export default function CostMatching() {
  const desktop = isDesktopRuntime();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify } = useToast();
  const fileInputRef = useRef(null);
  const ledgerId = searchParams.get("ledger");
  const filterSearchKey = searchParams.toString();
  const profitFilter = useMemo(() => readProfitFilter(searchParams, ledgerId), [filterSearchKey, ledgerId]);
  const profitHref = useMemo(() => buildProfitHref({ ledgerId, ...profitFilter }), [ledgerId, profitFilter]);
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
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const [erpAssistantOpen, setErpAssistantOpen] = useState(false);
  const [manualInputOpen, setManualInputOpen] = useState(false);
  const [inboxQueueOpen, setInboxQueueOpen] = useState(false);
  const [resultQuery, setResultQuery] = useState("");
  const [costRequestId, setCostRequestId] = useState(null);
  const [costRequest, setCostRequest] = useState(null);
  const [loadedInboxId, setLoadedInboxId] = useState(null);
  const [selectedPendingInboxIds, setSelectedPendingInboxIds] = useState(() => new Set());
  const [deleteBatchIds, setDeleteBatchIds] = useState([]);
  const [deletingBatches, setDeletingBatches] = useState(false);
  const [voidDraft, setVoidDraft] = useState(null);
  const [voidingBatch, setVoidingBatch] = useState(false);
  const [resultHighlighted, setResultHighlighted] = useState(false);
  const [expandedUnmappedGroups, setExpandedUnmappedGroups] = useState(() => new Set());
  const restoredDraftLedgerRef = useRef(null);
  const effectiveRequestId = costRequestId ?? latestRequest?.id ?? null;
  const requestForImport = costRequest ?? latestRequest ?? null;
  const workspaceInboxRecords = useMemo(() => allInboxRecords.filter((record) => (
    !snapshot?.ledger?.workspaceId || record.workspaceId === snapshot.ledger.workspaceId
  )), [allInboxRecords, snapshot?.ledger?.workspaceId]);
  const inboxRecords = useMemo(() => workspaceInboxRecords.filter((record) => ["pending", "loaded"].includes(record.status)), [workspaceInboxRecords]);
  const processedInboxRecords = useMemo(() => buildErpInboxHistory(workspaceInboxRecords, snapshot?.ledger?.id), [snapshot?.ledger?.id, workspaceInboxRecords]);
  const loadedInbox = useMemo(() => inboxRecords.find((record) => record.id === loadedInboxId) ?? null, [inboxRecords, loadedInboxId]);

  const persistedCostRows = useMemo(() => snapshot?.costs ?? [], [snapshot?.costs]);
  const effectiveCostRows = useMemo(() => {
    if (parsedRows !== null) return parsedRows;
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
    let cancelled = false;
    const restore = async () => {
      const draft = await readRestorableCostDraft(currentLedgerId, { getInbox: getErpCostInbox });
      if (!draft) return;
      if (cancelled) return;
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
    if (!currentLedgerId || !sourceText.trim()) return;
    writeCostDraft(currentLedgerId, { sourceText, sourceName, parsedRows, batchEnvelope, resolutions, loadedInboxId });
  }, [batchEnvelope, loadedInboxId, parsedRows, resolutions, snapshot?.ledger?.id, sourceName, sourceText]);

  const salesLines = useMemo(() => snapshot?.rows ? groupImportedSales(snapshot.rows) : [], [snapshot]);
  const missingFormalCostKeys = useMemo(() => {
    const covered = new Set((snapshot?.costs ?? []).filter((row) => (
      (row.resolutionStatus === "resolved" || (row.resolutionStatus == null && Boolean(row.publishedAt)))
      && Number(row.unresolvedAnomalyCount ?? 0) === 0
    )).map((row) => (
      row.canonicalPlatformSku ?? canonicalPlatformSku(row.platformSku)
    )));
    return covered;
  }, [snapshot?.costs]);
  const filteredSalesLines = useMemo(() => filterProfitRows(
    salesLines.map((row) => ({ ...row, finalizable: missingFormalCostKeys.has(row.canonicalPlatformSku) })),
    profitFilter,
  ), [missingFormalCostKeys, profitFilter, salesLines]);
  const expectedSkus = useMemo(() => {
    const unique = new Map();
    filteredSalesLines.forEach((row) => {
      const key = canonicalPlatformSku(row.platformSku);
      if (!unique.has(key)) unique.set(key, { platformSku: row.platformSku, platformSkc: row.platformSkc });
    });
    return [...unique.values()];
  }, [filteredSalesLines]);
  const erpQueryScope = useMemo(() => collectErpPlatformSkcs(filteredSalesLines), [filteredSalesLines]);
  const { platformSkcs, missingCount: missingPlatformSkcCount } = erpQueryScope;
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

  const loadInboxRecord = useCallback(async (queueItem, { automatic = false } = {}) => {
    const inbox = queueItem?.inbox;
    const request = queueItem?.request;
    if (!inbox?.id || !inbox.envelope || !snapshot?.ledger || !request) return;
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
          expectedSkus,
          sourceName: sourceLabel,
        }),
      });
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
  }, [expectedSkus, inboxRecords, locked, notify, snapshot?.ledger]);

  useEffect(() => {
    if (!locked) return;
    for (const record of inboxRecords.filter((item) => item.status === "loaded" && item.ledgerId === snapshot?.ledger?.id)) {
      void markErpCostInboxStatus(record.id, "pending", { unloadedAt: new Date().toISOString(), unloadReason: "ledger_closed" });
    }
    setLoadedInboxId(null);
  }, [inboxRecords, locked, snapshot?.ledger?.id]);

  useEffect(() => {
    if (loadedInboxId || sourceText.trim()) return;
    const recoverable = inboxQueue.items.find((item) => item.inbox?.status === "loaded" && item.scopeMatched && item.filterScopeMatched !== false);
    const candidate = recoverable ?? inboxQueue.autoLoad;
    if (candidate) void loadInboxRecord(candidate, { automatic: true });
  }, [inboxQueue.autoLoad, inboxQueue.items, loadInboxRecord, loadedInboxId, sourceText]);

  const releaseLoadedInbox = useCallback(() => {
    if (loadedInboxId) void markErpCostInboxStatus(loadedInboxId, "pending", { unloadedAt: new Date().toISOString() });
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
        ? `已作废 ERP 正式成本批次 ${result.batchId}，账本已重新打开核算。`
        : `已作废 ERP 正式成本批次 ${result.batchId}；受影响 SKU 已恢复为缺少正式成本。`, "success");
    } catch (error) {
      notify(`作废发布失败：${error.message}`, "error");
    } finally {
      setVoidingBatch(false);
    }
  }, [notify, voidDraft]);

  const reconciliation = useMemo(() => {
    if (!snapshot?.ledger || effectiveCostRows === null) return null;
    return reconcileErpCostRows({
      workspaceId: snapshot.ledger.workspaceId,
      expectedSkus,
      costRows: effectiveCostRows,
      batchId: "preview",
      resolutions,
    });
  }, [effectiveCostRows, expectedSkus, resolutions, snapshot]);
  const auxiliaryGroups = useMemo(() => groupAuxiliaryCostRows(reconciliation?.auxiliaryCostRows), [reconciliation?.auxiliaryCostRows]);

  const parseSource = () => {
    try {
      const result = parseErpCostInput(sourceText, {
        expectedWorkspaceId: snapshot?.ledger?.workspaceId,
        expectedLedgerId: snapshot?.ledger?.id,
        expectedRequestId: effectiveRequestId,
        expectedPlatformSkcs: platformSkcs,
        requestPayload: requestForImport,
        expectedSkus,
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
    if (!snapshot?.ledger || platformSkcs.length === 0) return;
    setCopyingSkcs(true);
    try {
      const request = buildLedgerErpCostRequest({
        ledger: snapshot.ledger,
        platformSkcs,
        expectedSkus,
      });
      await writeClipboardText(request.platformSkcs.map((item) => item.platformSkc).join("\n"));
      await saveErpCostRequest(request);
      try { await registerErpBridgeRequest({ request, expectedSkus }); } catch { /* HTTP 收件服务可选，保留剪贴板降级 */ }
      setCostRequestId(request.id);
      setCostRequest(request);
      notify(`已复制 ${request.platformSkcs.length} 个平台 SKC，并记录本次 ERP 成本请求。`);
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
        "1688单号": "",
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
    if (!snapshot?.ledger || !reconciliation) return;
    if (reconciliation.summary.anomalyPendingCount > 0) {
      notify("仍有采购成本异常未完成逐条修正和确认，当前结果只能预览。", "error");
      return;
    }
    if (!effectiveRequestId && !batchEnvelope?.requestId) {
      notify("发布前必须先复制平台 SKC，建立本次成本查询关联。", "error");
      return;
    }
    setPublishing(true);
    try {
      const result = await savePublishedErpCostBatch({
        ledgerId: snapshot.ledger.id,
        workspaceId: snapshot.ledger.workspaceId,
        inboxId: loadedInbox?.id && loadedInbox.batchId === batchEnvelope?.batchId ? loadedInbox.id : null,
        requestId: batchEnvelope?.requestId ?? effectiveRequestId,
        reconciliation,
        sourceName,
        inputHash: await sha256Text(sourceText),
        sourceEnvelope: batchEnvelope,
      });
      notify(`ERP 成本批次 ${result.batchId} 已发布，匹配 ${result.matchedCount} 个平台 SKU。`);
      clearCostDraft(snapshot.ledger.id);
      navigate(profitHref);
    } catch (error) {
      notify(`成本批次发布失败：${error.message}`, "error");
    } finally {
      setPublishing(false);
    }
  };

  const anomalyGroups = useMemo(() => {
    const groups = new Map();
    (reconciliation?.matches ?? []).forEach((match) => {
      if (!match.sourceWarehouseSku || groups.has(match.sourceWarehouseSku)) return;
      if (match.status !== "anomaly_pending" && !match.resolvedAnomalyCount) return;
      groups.set(match.sourceWarehouseSku, match);
    });
    return [...groups.values()];
  }, [reconciliation?.matches]);

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
    notify(resolution.action === "confirm_true_price" ? "已确认真实采购价，正式成本已重新计算。" : "采购价已修正，正式成本已重新计算。", "success");
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
      { id: "platformSku", header: "平台 SKU / 属性", enableSorting: false, cell: ({ row }) => renderStack(row.original, (item) => <div className="cost-variant-line" key={item.canonicalPlatformSku}><strong className="mono" title={item.platformSku}>{item.platformSku}</strong><small>{item.attribute || "未提供属性"}</small></div>) },
      { id: "unitCost", header: "成本预览", enableSorting: false, cell: ({ row }) => renderStack(row.original, (item) => <div className="cost-variant-line" key={item.canonicalPlatformSku}>{item.unitCost != null ? <span className="mono table-number">{currency(item.unitCost)}</span> : <span className="pending-text">--</span>}</div>), meta: { cellStyle: { textAlign: "right" } } },
      { id: "warehouseSku", header: "仓库 SKU", enableSorting: false, cell: ({ row }) => renderStack(row.original, (item) => <div className="cost-variant-line" key={item.canonicalPlatformSku}><span className="mono">{item.sourceWarehouseSku || "--"}</span></div>) },
      { id: "evidence", header: "核算证据", enableSorting: false, cell: ({ row }) => renderStack(row.original, (item) => <div className="cost-variant-line" key={item.canonicalPlatformSku}>{item.calculationCount ? <span><strong className="mono">{item.calculationCount} 条记录</strong><small className="row-subtitle">{item.dateRange || `${item.totalQuantity ?? "--"} 件 · ${currency(item.totalPrice ?? 0)}`}</small></span> : <span className="pending-text">兼容输入</span>}</div>) },
      { id: "status", header: "核对状态", enableSorting: false, cell: ({ row }) => renderStack(row.original, (item) => <div className="cost-variant-line" key={item.canonicalPlatformSku}><div className="cost-status-stack">{item.status === "matched" ? <Badge tone={item.requiresReview ? "warning" : "success"}>{item.resolvedAnomalyCount > 0 ? "异常已在 Shopeers 处置" : item.requiresReview ? "仓库 SKU 兜底" : "平台 SKU 匹配"}</Badge> : item.status === "anomaly_pending" ? <Badge tone="danger"><AlertCircle size={12} />{item.evidenceComplete ? "成本异常待处置" : "采购证据不完整"}</Badge> : <Badge tone="danger"><AlertCircle size={12} />缺少 ERP 成本</Badge>}{item.evidenceComplete === false ? <EvidenceDetails match={item} /> : null}</div></div>) },
    ];
  }, [expandedUnmappedGroups]);

  const groupedMatches = useMemo(() => groupCostMatchesBySkc(reconciliation?.matches ?? []), [reconciliation?.matches]);
  const mappingIdentityIssue = useMemo(() => hasMappingIdentityIssue(reconciliation?.matches ?? []), [reconciliation?.matches]);
  const visibleGroupedMatches = useMemo(() => filterCostMatchGroups(groupedMatches, resultQuery), [groupedMatches, resultQuery]);
  const visibleAnomalyGroups = useMemo(() => filterCostMatches(anomalyGroups, resultQuery), [anomalyGroups, resultQuery]);

  const resolutionDialog = (
    <Modal
      open={Boolean(resolutionDraft)}
      title={resolutionDraft?.action === "confirm_true_price" ? "确认真实采购价" : "修正采购单价"}
      description="该操作只写入 Shopeers 的成本处置审计，不修改 ERP 原始采购证据。"
      className="cost-resolution-modal"
      onClose={() => setResolutionDraft(null)}
      footer={<><Button variant="ghost" onClick={() => setResolutionDraft(null)}>取消</Button><Button variant="primary" onClick={saveResolution}>保存并重新核算</Button></>}
    >
      {resolutionDraft ? <div className="cost-resolution-form">
        <div className="cost-resolution-context"><span><small>仓库 SKU</small><strong className="mono">{resolutionDraft.warehouseSku}</strong></span><span><small>采购日期</small><strong>{resolutionDraft.purchaseDate || "--"}</strong></span><span><small>原采购单价</small><strong className="mono">{currency(resolutionDraft.originalUnitPrice)}</strong></span></div>
        <div className="cost-resolution-reasons">{resolutionDraft.reasons.map((reason) => <Badge tone="warning" key={reason}>{ERP_COST_ANOMALY_LABELS[reason] ?? reason}</Badge>)}</div>
        {resolutionDraft.baseline?.enabled ? <p className="cost-resolution-baseline">历史正价样本 {resolutionDraft.baseline.sampleCount} 条，中位价 {currency(resolutionDraft.baseline.median)}，参考区间 {currency(resolutionDraft.baseline.lowerBound)} 至 {currency(resolutionDraft.baseline.upperBound)}。</p> : <p className="cost-resolution-baseline">历史正价样本不足 6 条，本次仅依据 0 元或 1 元强提醒进行核对。</p>}
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
      {effectiveRequestId ? <p className="cost-request-note">已关联 ERP 请求：<code>{effectiveRequestId}</code></p> : <p className="cost-request-note warning-text">发布前请先复制平台 SKC，以建立查询关联。</p>}
    </Modal>
  );

  if (snapshot === undefined) {
    return <AppShell pageClass="cost-page"><Panel className="route-loader">正在读取月度账本...</Panel></AppShell>;
  }

  if (!snapshot?.ledger || salesLines.length === 0) {
    return (
      <AppShell pageClass="cost-page">
        <div className="page-back-row cost-page-toolbar"><Button icon={PlugZap} onClick={() => setErpAssistantOpen(true)}>{desktop ? "ERP 扩展状态" : "安装 ERP 助手"}</Button></div>
        <PageHeader title="ERP 成本核对" description="先导入月度销售台账，才能生成平台 SKC 查询并核对正式成本。" />
        <Panel><EmptyState icon={Warehouse} title="没有可核对的月度销售明细" description="导入台账后，本页会按平台 SKU 列出所有需要 ERP 成本的明细。" action={<Button variant="primary" icon={Upload} onClick={() => navigate("/import-preview")}>导入月度台账</Button>} /></Panel>
        {erpAssistantDialog}
        {deleteBatchDialog}
        {voidBatchDialog}
      </AppShell>
    );
  }

  return (
    <AppShell pageClass="cost-page">
      <div className="page-back-row cost-page-toolbar"><Button icon={PlugZap} onClick={() => setErpAssistantOpen(true)}>{desktop ? "ERP 扩展状态" : "安装 ERP 助手"}</Button></div>
      <PageHeader
        eyebrow={`月度利润 › ${snapshot.ledger.period}`}
        title="ERP 成本核对"
        description={`当前筛选：${describeProfitFilter(profitFilter)}。先复制 ${platformSkcs.length} 个平台 SKC 到卓麟 ERP 查询；扩展回传采购证据后，由本页核对并发布正式成本。`}
        actions={<><Button icon={platformSkcs.length ? Copy : AlertCircle} loading={copyingSkcs} disabled={copyingSkcs || locked || platformSkcs.length === 0} onClick={copySkcs}>{platformSkcs.length ? `复制 ${platformSkcs.length} 个平台 SKC` : "待补平台 SKC"}</Button><Button icon={Download} loading={exportingTemplate} disabled={exportingTemplate} onClick={downloadCostTemplate} title="下载可用 WPS/Excel 打开的成本导入模板">下载成本导入模板</Button><Button icon={Inbox} variant="ghost" onClick={() => setInboxQueueOpen(true)} title="查看按时间排列的 ERP 回传批次">待处理 {inboxQueue.pendingCount}</Button><Button variant="ghost" onClick={() => setManualInputOpen(true)}>{batchEnvelope ? "查看当前成本" : "手动导入"}</Button><input ref={fileInputRef} className="visually-hidden" type="file" aria-label="选择 ERP 成本结果文件" accept=".json,.tsv,.csv,.txt,.xlsx,.xls" onChange={(event) => loadFile(event.target.files[0])} /></>}
      />

      {reconciliation?.summary.anomalyPendingCount > 0 ? <div className="cost-anomaly-warning" role="alert"><AlertCircle size={20} /><span><strong>有 {reconciliation.summary.anomalyPendingCount} 个平台 SKU 尚不能发布正式成本</strong><small>{reconciliation.summary.evidenceIncompleteCount > 0 ? mappingIdentityIssue ? `${reconciliation.summary.evidenceIncompleteCount} 项平台身份映射待修正；请先核对 ERP 与当前账本的 SKU/SKC，再重新采集。` : `${reconciliation.summary.evidenceIncompleteCount} 项缺少完整历史采购证据；请使用 ERP Assistant v8.0.15 重新抓取。` : `Shopeers 发现 ${reconciliation.summary.unresolvedAnomalyCount} 条采购价需要核对，请在下方完成修正或确认真实价格。`}</small></span></div> : null}

      {visibleAnomalyGroups.length > 0 ? <Panel className="cost-resolution-panel">
        <div className="panel-header"><div className="panel-title"><AlertCircle size={19} /><h2>采购成本异常处置</h2></div><Badge tone="warning">Shopeers 核对</Badge></div>
        <div className="cost-resolution-list">{visibleAnomalyGroups.map((match) => <section className="cost-resolution-group" key={match.sourceWarehouseSku}>
          <header><span><small>仓库 SKU</small><strong className="mono">{match.sourceWarehouseSku}</strong></span><span><small>当前预览成本</small><strong className="mono">{match.unitCost == null ? "--" : currency(match.unitCost)}</strong></span>{match.baseline?.enabled ? <span><small>历史参考区间</small><strong className="mono">{currency(match.baseline.lowerBound)} - {currency(match.baseline.upperBound)}</strong></span> : <span><small>历史基线</small><strong>样本不足</strong></span>}</header>
          {!match.evidenceComplete ? <div className="cost-resolution-empty"><AlertCircle size={17} /><div><strong>当前批次没有完整采购历史</strong><small>旧版批次和手工汇总只能预览，不能通过人工确认变成 ERP 正式成本。</small><EvidenceDetails match={match} /></div></div> : <div className="cost-resolution-records">{(match.costDecision?.anomalies ?? []).map((anomaly) => {
            const record = match.costDecision?.selectedRecords?.find((item) => item.recordId === anomaly.recordId);
            return <article className={`cost-resolution-record ${anomaly.status === "resolved" ? "resolved" : "pending"}`} key={anomaly.recordId}>
              <div><strong>{record?.purchaseDate || "日期未知"} · <span className="mono">{currency(anomaly.originalUnitPrice)}</span></strong><small>{anomaly.reasons.map((reason) => ERP_COST_ANOMALY_LABELS[reason] ?? reason).join("；")}</small>{anomaly.resolution ? <small>已由 {anomaly.resolution.resolvedBy} 于 {new Date(anomaly.resolution.resolvedAt).toLocaleString("zh-CN")} {anomaly.resolution.action === "confirm_true_price" ? "确认真实价格" : `修正为 ${currency(anomaly.resolution.resolvedUnitPrice)}`}</small> : null}</div>
              <div className="cost-resolution-actions">{anomaly.status === "resolved" ? <Badge tone="success">已处置</Badge> : <><Button icon={Pencil} onClick={() => openResolution(match, anomaly, "correct_price")}>修正价格</Button>{anomaly.originalUnitPrice > 0 ? <Button variant="ghost" onClick={() => openResolution(match, anomaly, "confirm_true_price")}>确认真实价格</Button> : null}</>}</div>
            </article>;
          })}</div>}
        </section>)}</div>
      </Panel> : null}

      {platformSkcs.length === 0 ? <div className="cost-skc-warning" role="alert"><AlertCircle size={18} /><span><strong>当前账本缺少平台 SKC</strong><small>{missingPlatformSkcCount || salesLines.length} 条销售明细无法生成 ERP 查询。请回到台账导入，确认“平台 SKC”列已正确映射；不能用平台 SKU 代替 ERP 的 SKC 查询单位。</small></span><Button variant="ghost" onClick={() => navigate(`/import-preview?ledger=${encodeURIComponent(snapshot.ledger.id)}`)}>检查导入映射</Button></div> : null}

      <div className="match-stat-grid">
        <Panel className="match-stat"><ListChecks size={22} /><span>待核对平台 SKU</span><strong>{expectedSkus.length}</strong></Panel>
        <Panel className="match-stat match-success"><CheckCircle2 size={22} /><span>已匹配</span><strong>{reconciliation?.summary.matchedCount ?? 0}<small> 个 SKU</small></strong></Panel>
        <Panel className="match-stat match-warning"><AlertCircle size={22} /><span>重复覆盖</span><strong>{reconciliation?.summary.overrideCount ?? 0}<small> 条</small></strong></Panel>
        <Panel className="match-stat match-danger"><AlertCircle size={22} /><span>仍缺成本</span><strong>{reconciliation?.summary.missingCount ?? expectedSkus.length}<small> 个 SKU</small></strong><p>{reconciliation?.summary.invalidRowCount ?? 0} 条无效输入</p></Panel>
      </div>

      <div className="cost-workflow">
        <Panel className={`cost-preview-panel ${resultHighlighted ? "cost-preview-highlight" : ""}`}>
          {parseError ? <div className="cost-inline-error" role="alert"><AlertCircle size={16} />{parseError}</div> : null}
          <div className="panel-header cost-preview-header"><div className="panel-title"><ListChecks size={19} /><h2>平台 SKU 核对结果</h2></div><div className="cost-preview-tools"><SearchInput value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} placeholder="搜索 SKC、SKU、仓库 SKU、供应商或采购单..." /><span className="cost-preview-count">{reconciliation ? `显示 ${visibleGroupedMatches.length} / ${groupedMatches.length} 个 SKC` : "等待成本数据"}</span>{reconciliation ? <Badge tone={reconciliation.summary.missingCount === 0 ? "success" : "warning"}>{reconciliation.summary.missingCount === 0 ? "成本完整" : "仍需补齐"}</Badge> : null}</div></div>
          {!reconciliation ? <EmptyState icon={Warehouse} title="等待成本数据" description="ERP Assistant 收件后会自动解析；也可以粘贴或导入 ERP 输出。本区按平台 SKC 折叠展示，多个平台 SKU 会并列显示。" /> : visibleGroupedMatches.length ? <DataTable columns={columns} data={visibleGroupedMatches} getRowId={(row) => row.id} pageSize={12} /> : <EmptyState icon={ListChecks} title="没有匹配的核对结果" description="可按平台 SKC、平台 SKU、仓库 SKU、供应商或采购单搜索。" />}
          {reconciliation?.overrides.length ? <div className="cost-audit-note"><AlertCircle size={17} />检测到 {reconciliation.overrides.length} 次有效覆盖，旧值与新值已写入批次审计。</div> : null}
          {reconciliation?.summary.anomalyConfirmedCount ? <div className="cost-audit-note cost-audit-confirmed"><CheckCircle2 size={17} />有 {reconciliation.summary.anomalyConfirmedCount} 个平台 SKU 已完成 Shopeers 成本处置；原始采购证据、修正或真实价确认、原因和时间会随正式成本保存。</div> : null}
          {reconciliation?.unmatchedCostRows.length ? <div className="cost-audit-note"><AlertCircle size={17} />有 {reconciliation.unmatchedCostRows.length} 行成本不属于当前账本平台 SKU，将保留在预览但不写入利润成本。</div> : null}
          {auxiliaryGroups.length ? <details className="cost-auxiliary-audit"><summary><Info size={17} />同查询 SKC 下、本账本未使用的额外变体 <strong>{reconciliation.summary.auxiliaryCount}</strong> 行</summary><div className="cost-auxiliary-list">{auxiliaryGroups.map((group) => <section key={group.id}><header><strong className="mono">{group.platformSkc}</strong><span>仓库 SKU <code>{group.warehouseSku}</code></span></header><p>{group.variants.map((variant) => variant.platformSku).join("、")}</p><small>采购记录 {group.purchaseRecordCount} 条 · 排除记录 {group.excludedRecordCount} 条 · 仅供预览与审计，不影响本账本成本，也不会写入正式利润。</small></section>)}</div></details> : null}
          <div className="cost-publish-bar"><span>{reconciliation ? reconciliation.summary.anomalyPendingCount > 0 ? `成本待处置 ${reconciliation.summary.anomalyPendingCount} 项，完成后才能发布` : `可发布 ${reconciliation.summary.matchedCount} 项，缺失 ${reconciliation.summary.missingCount} 项` : "解析后才能发布成本批次"}</span><Button variant="primary" loading={publishing} disabled={locked || publishing || !reconciliation?.summary.matchedCount || reconciliation?.summary.anomalyPendingCount > 0} onClick={publish}>{locked ? "账本已定稿" : reconciliation?.summary.anomalyPendingCount > 0 ? "完成成本处置后可发布" : "发布已匹配 ERP 成本"}</Button></div>
        </Panel>
      </div>
      {inboxQueueDialog}
      {deleteBatchDialog}
      {voidBatchDialog}
      {manualInputDialog}
      {erpAssistantDialog}
      {resolutionDialog}
    </AppShell>
  );
}
