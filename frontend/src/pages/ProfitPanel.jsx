import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, Plus, Warehouse } from "lucide-react";
import AppShell from "../components/AppShell";
import { CostMatchingContent } from "./CostMatching";
import MonthlyReportManager from "./MonthlyReportManager";
import MonthlyProfitSummary from "./MonthlyProfitSummary";
import { monthlyProfitSummary } from "../domain/monthlyProfitSummary";
import { displayMoney } from "../domain/profitReports";
import ProfitGroups from "./ProfitGroups";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, useToast } from "../components/UI";
import ProfitScopeFilters from "../components/ProfitScopeFilters";
import CostAttention from "../components/CostAttention";
import {
  updateLedgerWarehouseRate,
} from "../data/database";
import { readCachedReportProducts } from "../data/repositories/derivedComputationService";
import { presentReportProducts } from "../lib/profitPresentation";
import { canonicalPlatformSku } from "../domain/identifiers";
import { useLatestSalesImport } from "../hooks/useLatestSalesImport";
import { formatErpUnitCost, formatManualUnitCost, formatProfitAmount, summarizeProfitRows } from "../lib/profitPrecision";
import { countProfitIdentities, groupProfitRowsBySkc } from "../lib/profit";
import { storeSkuKey } from "../domain/manualCostOverride";
import { buildProfitHref, buildProfitQuery, filterProfitRowsByScope, searchProfitRows, readProfitFilter, readProfitView, saveProfitFilter } from "../lib/profitFilter";
import ManualCostDialog from "./ManualCostDialog";
import { ledgerNextStep } from "../domain/ledgerWorkflow";
import { readProfitViewState, saveProfitViewState } from "../lib/profitViewState";

const currency = (value) => `¥${displayMoney(value)}`;
const filterIdentity = value => JSON.stringify([value.query, value.storeFilter, value.supplierSelection ?? null, value.supplierStoreSelection ?? null, value.missingOnly, value.supplierScopeError ?? '']);

const ledgerStatusLabels = {
  draft: "草稿",
  cost_pending: "待核对成本",
  approval_pending: "待确认成本",
  ready: "待确认利润",
  finalized: "可继续盘点",
  locked: "可继续盘点",
};

export function ProfitWorkspaceContent({ suppliedSnapshot, onReadiness, reportState, onEditSupplement, onCostDetails, detailsRequest, reviewReasons } = {}) {
  const [manualTarget, setManualTarget] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [revealSequence, setRevealSequence] = useState(0);
  const pendingReveal = useRef(null), handledRequest = useRef(null), detailsPanel = useRef(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useToast();
  const requestedLedgerId = searchParams.get("ledger");
  const filterSearchKey = searchParams.toString();
  const initialFilterRef = useRef(null);
  if (initialFilterRef.current === null) initialFilterRef.current = readProfitFilter(searchParams, requestedLedgerId);
  const initialFilter = initialFilterRef.current;
  const snapshot = useLatestSalesImport(requestedLedgerId, suppliedSnapshot);
  const [query, setQuery] = useState(initialFilter.query);
  const [storeFilter, setStoreFilter] = useState(initialFilter.storeFilter);
  const [supplierSelection, setSupplierSelection] = useState(initialFilter.supplierSelection);
  const [supplierStoreSelection, setSupplierStoreSelection] = useState(initialFilter.supplierStoreSelection);
  const [supplierScopeError, setSupplierScopeError] = useState(initialFilter.supplierScopeError);
  const [missingOnly, setMissingOnly] = useState(initialFilter.missingOnly);
  const [warehouseRate, setWarehouseRate] = useState(0.7);
  const [rateDraft, setRateDraft] = useState("0.7");
  const [rateDialog, setRateDialog] = useState(false);

  useEffect(() => {
    const next = readProfitFilter(searchParams, requestedLedgerId || snapshot?.ledger?.id, { workspaceId: snapshot?.ledger?.workspaceId });
    setQuery(next.query);
    setStoreFilter(next.storeFilter);
    setSupplierSelection((previous) => JSON.stringify(previous) === JSON.stringify(next.supplierSelection) ? previous : next.supplierSelection);
    setSupplierStoreSelection((previous) => JSON.stringify(previous) === JSON.stringify(next.supplierStoreSelection) ? previous : next.supplierStoreSelection);
    setMissingOnly(next.missingOnly);
    setSupplierScopeError(next.supplierScopeError);
  }, [filterSearchKey, requestedLedgerId, snapshot?.ledger?.id, snapshot?.ledger?.workspaceId]);

  useEffect(() => {
    if (snapshot?.ledger?.warehouseRate != null) {
      setWarehouseRate(snapshot.ledger.warehouseRate);
      setRateDraft(String(snapshot.ledger.warehouseRate));
    }
  }, [snapshot?.ledger?.id, snapshot?.ledger?.warehouseRate]);

  useEffect(() => {
    if (!snapshot?.ledger?.id) return;
    saveProfitFilter(snapshot.ledger.id, { query, storeFilter, supplierSelection, supplierStoreSelection, missingOnly });
  }, [missingOnly, query, snapshot?.ledger?.id, storeFilter, supplierSelection, supplierStoreSelection]);

  const costBySku = useMemo(() => new Map((snapshot?.costs ?? []).map(cost => [cost.canonicalPlatformSku ?? canonicalPlatformSku(cost.platformSku), cost])), [snapshot?.costs]);
  const [computed, setComputed] = useState(null);
  const [calculationStatus, setCalculationStatus] = useState("reading");
  const [retryCalculation, setRetryCalculation] = useState(0);
  useEffect(() => {
    if (!snapshot?.rows?.length) return;
    let active = true;
    readCachedReportProducts({ snapshot, warehouseRate, onStatus: status => { if (active) setCalculationStatus(status); } }).then(lines => {
      if (active) setComputed({ snapshot, warehouseRate, rows: presentReportProducts(lines, snapshot), error: null });
    }).catch(error => {
      if (active) setComputed(previous => ({ snapshot, warehouseRate, rows: previous?.snapshot?.ledger?.id === snapshot.ledger.id && previous?.snapshot?.ledger?.workspaceId === snapshot.ledger.workspaceId ? previous.rows : [], error: error.message }));
    });
    return () => { active = false; };
  }, [snapshot, warehouseRate, retryCalculation]);
  const sameLedger = Boolean(computed?.snapshot?.ledger?.id && snapshot?.ledger?.id && computed.snapshot.ledger.id === snapshot.ledger.id && computed.snapshot.ledger.workspaceId === snapshot.ledger.workspaceId);
  const calculation = computed?.snapshot === snapshot && computed?.warehouseRate === warehouseRate ? computed : { rows: sameLedger ? computed.rows : [], loading: Boolean(snapshot?.rows?.length) };
  const calculated = calculation.rows;

  const scopeRows = suppliedSnapshot?.rows ?? calculated;
  const stores = useMemo(() => [...new Set(scopeRows.map((row) => row.store).filter(Boolean))].toSorted(), [scopeRows]);
  const suppliers = useMemo(() => [...new Set(scopeRows.filter((row) => storeFilter === "all" || row.store === storeFilter).map((row) => row.supplierNumber).filter(Boolean))].toSorted(), [scopeRows, storeFilter]);
  const filterState = useMemo(() => ({ query, storeFilter, supplierSelection, supplierStoreSelection, missingOnly, ...(supplierScopeError ? { supplierScopeError } : {}) }), [missingOnly, query, storeFilter, supplierSelection, supplierStoreSelection, supplierScopeError]);
  const viewStateKey = JSON.stringify([snapshot?.ledger?.workspaceId, snapshot?.ledger?.id, filterState]);
  const detailsStateKey = JSON.stringify([snapshot?.ledger?.workspaceId, snapshot?.ledger?.id, 'details']);
  useEffect(() => { setDetailsOpen(readProfitViewState(detailsStateKey).detailsOpen !== false); }, [detailsStateKey]);
  const readyForDetails = Boolean(snapshot?.ledger && calculated.length);
  useLayoutEffect(() => {
    if (!readyForDetails) return;
    const position = readProfitViewState(detailsStateKey).windowScrollY;
    if (Number.isFinite(position)) window.scrollTo({ top: position, behavior: 'auto' });
    return () => saveProfitViewState(detailsStateKey, { windowScrollY: window.scrollY });
  }, [detailsStateKey, readyForDetails]);
  const changeFilter = (patch) => {
    const next = { ...filterState, ...patch };
    const params = buildProfitQuery({ ledgerId: snapshot?.ledger?.id, workspaceId: snapshot?.ledger?.workspaceId, ...next, view: "detail" });
    params.set("store", next.storeFilter || "all");
    params.set("missing", next.missingOnly ? "1" : "0");
    setSearchParams(params, { replace: true });
  };
  const showMissingCosts = () => {
    const patch = { missingOnly: true, storeFilter: 'all', query: '', supplierSelection: null, supplierStoreSelection: null, supplierScopeError: undefined };
    pendingReveal.current = filterIdentity({ ...filterState, ...patch });
    changeFilter(patch);
    setDetailsOpen(true);
    saveProfitViewState(detailsStateKey, { detailsOpen: true });
    setRevealSequence(value => value + 1);
  };
  useEffect(() => {
    if (!detailsRequest || detailsRequest.ledgerId !== snapshot?.ledger?.id || handledRequest.current === detailsRequest) return;
    handledRequest.current = detailsRequest;
    showMissingCosts();
  }, [detailsRequest]);
  useEffect(() => {
    if (!pendingReveal.current || pendingReveal.current !== filterIdentity(filterState) || !detailsOpen || calculation.loading) return;
    const frame = requestAnimationFrame(() => {
      const panel = detailsPanel.current;
      if (!panel) return;
      pendingReveal.current = null;
      panel.querySelector('.profit-status-switch [aria-pressed="true"]')?.focus({ preventScroll: true });
      panel.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [filterState, detailsOpen, calculation.loading, revealSequence]);
  const scopedRows = useMemo(() => filterProfitRowsByScope(calculated, { storeFilter, supplierSelection, supplierStoreSelection, missingOnly }), [calculated, storeFilter, supplierSelection, supplierStoreSelection, missingOnly]);
  const filtered = useMemo(() => searchProfitRows(scopedRows, query), [scopedRows, query]);
  const groupedFiltered = useMemo(() => groupProfitRowsBySkc(filtered), [filtered]);
  const { skcCount, storeSkuCount } = useMemo(() => countProfitIdentities(filtered), [filtered]);
  const filteredSummary = useMemo(() => summarizeProfitRows(filtered, costBySku), [costBySku, filtered]);
  const ledgerSummary = useMemo(() => summarizeProfitRows(calculated, costBySku), [calculated, costBySku]);
  useEffect(() => {
    onReadiness?.({ ledgerId: snapshot?.ledger?.id, missingCount: calculation.loading || calculation.error ? null : ledgerSummary.missing });
  }, [onReadiness, snapshot?.ledger?.id, calculation.loading, calculation.error, ledgerSummary.missing]);
  const nextStep = ledgerNextStep(snapshot?.ledger, { missingCount: ledgerSummary.missing, loading: calculation.loading });
  const { revenue, totalUnits, purchaseCosts, warehouseFees, matchedProfit, missing, missingErp } = filteredSummary;
  const monthlySummary = snapshot?.ledger ? monthlyProfitSummary({ ledger: snapshot.ledger, reportState, productProfitExact: ledgerSummary.exactTotals?.profit, missingCostCount: calculation.loading || calculation.error ? null : ledgerSummary.missing }) : null;

  const allMissingCostsHref = buildProfitHref({ ledgerId: snapshot?.ledger?.id, view: 'cost', storeFilter: 'all', missingOnly: true });

  const columns = useMemo(() => [
    {
      accessorKey: "platformSku",
      header: "平台 SKU",
      enableSorting: false,
      size: 166,
      meta: { headerStyle: { width: "166px" } },
      cell: ({ getValue, row }) => <div>
        <strong className="mono table-code" title={getValue()}>{getValue()}</strong>
        {row.original.attribute && <small className="profit-attribute">{row.original.attribute}</small>}
        {row.original.orderNumber && <small className="profit-attribute">采购单号 {row.original.orderNumber}</small>}
      </div>,
    },
    {
      id: "qty", accessorFn: row => row.quantityExact ?? row.qty,
      header: "数量",
      enableSorting: false,
      size: 55,
      meta: { headerStyle: { width: "55px", textAlign: "right" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className="mono table-number">{Number(getValue() ?? 0).toLocaleString("zh-CN")}</span>,
    },
    {
      id: "revenue", accessorFn: row => row.revenueExact ?? row.revenue,
      header: "销售金额",
      enableSorting: false,
      size: 90,
      meta: { headerStyle: { width: "90px", textAlign: "right" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className="mono table-number profit-revenue">{currency(getValue() ?? 0)}</span>,
    },
    {
      id: "unitCost",
      header: "单件平均成本",
      enableSorting: false,
      size: 100,
      meta: { headerStyle: { width: "100px", textAlign: "right" }, cellStyle: { textAlign: "right" } },
      cell: ({ row }) => row.original.unitCost != null ? <span className={`mono table-number ${row.original.costSource === "erp" ? "profit-cost-formal" : "profit-cost-reference"}`}>{row.original.costSource === "manual_override" ? formatManualUnitCost(row.original.unitCost) : row.original.costSource === "erp" ? formatErpUnitCost(row.original.unitCost) : currency(row.original.unitCost)}{row.original.costSource === "approved_1688" ? <small>人工参考</small> : null}</span> : row.original.reference1688Cost?.unitCost != null ? <span className="mono table-number profit-cost-reference" title="1688 参考成本">{currency(row.original.reference1688Cost.unitCost)}<small>参考</small></span> : <span className="pending-text" aria-label="缺少单件成本">—</span>,
    },
    {
      id: "purchaseCost", accessorFn: row => row.purchaseCostExact ?? row.purchaseCost,
      header: "总采购成本",
      enableSorting: false,
      size: 94,
      meta: { headerStyle: { width: "94px", textAlign: "right" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => getValue() != null ? <span className="mono table-number">{formatProfitAmount(getValue())}</span> : <span className="pending-text">待成本</span>,
    },
    {
      id: "warehouseCost", accessorFn: row => row.warehouseCostExact ?? row.warehouseCost,
      header: "仓储成本",
      enableSorting: false,
      size: 88,
      meta: { headerStyle: { width: "88px", textAlign: "right" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className="mono table-number">{currency(getValue() ?? 0)}</span>,
    },
    {
      id: "profit", accessorFn: row => row.profitExact ?? row.profit,
      header: "总利润",
      enableSorting: false,
      size: 95,
      meta: { headerStyle: { width: "95px", textAlign: "right" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => getValue() == null ? <span className="pending-text" aria-label="待补成本后计算利润">—</span> : <strong className={`mono table-number ${Number(getValue()) < 0 ? "profit-negative" : "profit-positive"}`}>{formatProfitAmount(getValue())}</strong>,
    },
    {
      id: "costStatus",
      header: "成本状态",
      enableSorting: false,
      size: 142,
      meta: { headerStyle: { width: "142px", position: "sticky", right: 0, zIndex: 2, background: "var(--surface)" }, cellStyle: { position: "sticky", right: 0, zIndex: 1, background: "var(--surface)" } },
      cell: ({ row }) => {
        const item = row.original;
        const ignored = costBySku.get(canonicalPlatformSku(item.platformSku))?.resolutions?.some(resolution => resolution.action === 'ignore_anomaly');
        const entry = reviewReasons?.get(storeSkuKey(item.store, item.platformSku));
        const priceReview = !item.finalizable && entry?.state === 'anomaly_pending';
        const mappingIssue = item.costIdentityIssue || (!item.finalizable && entry?.mappingIssue);
        const mode = item.finalizable || priceReview || mappingIssue ? 'details' : 'edit';
        const status = mappingIssue ? '归属待核对' : item.finalizable
          ? item.costSource === 'manual_override' ? '人工更正' : ignored ? '异常已忽略' : 'ERP 已采用'
          : entry?.inlineReason ?? '原因待查';
        const action = mappingIssue ? '核对映射' : item.finalizable ? '成本详情' : priceReview ? '核对采购价' : '补录成本';
        const open = () => {
          if (onCostDetails) onCostDetails({ store: item.store, platformSku: item.platformSku, mode, ledgerId: snapshot.ledger.id, workspaceId: snapshot.ledger.workspaceId });
          else setManualTarget({ ...item, mode });
        };
        return <div className="profit-status-actions"><Badge tone={item.finalizable && !ignored ? 'success' : 'warning'}>{status}</Badge><button className="inline-link" onClick={open}>{action}</button></div>;
      },
    },
  ], [costBySku, onCostDetails, reviewReasons, snapshot?.ledger?.id, snapshot?.ledger?.workspaceId]);

  const applyRate = async () => {
    const next = Number(rateDraft);
    if (!Number.isFinite(next) || next < 0 || !snapshot?.ledger) return;
    try {
      if (snapshot.ledger.accountingMode) await updateLedgerWarehouseRate(snapshot.ledger.id, next, undefined, snapshot.ledger.accountingMode);
      else await updateLedgerWarehouseRate(snapshot.ledger.id, next);
      setWarehouseRate(next);
      setRateDialog(false);
      notify(`仓储费率已更新为每件 ${next.toFixed(2)} 元，利润已重新计算。`);
    } catch (error) {
      notify(error.message, "error");
    }
  };

  if (snapshot === undefined) {
    return <><Panel className="route-loader">正在读取月度账本...</Panel></>;
  }

  const scopeFilters = <ProfitScopeFilters filter={filterState} stores={stores} suppliers={suppliers} workspaceId={snapshot?.ledger?.workspaceId}
    scopeRows={scopeRows} showStore={!suppliedSnapshot} onChange={patch => {
      if (patch.missingOnly === true) {
        setDetailsOpen(true);
        saveProfitViewState(detailsStateKey, { detailsOpen: true });
      }
      changeFilter(patch);
    }} />;
  if (calculation.loading && !calculated.length && !manualTarget) return <>{scopeFilters}<Panel className="route-loader" role="status">{calculationStatus.startsWith('正在') ? calculationStatus : calculationStatus === "recalculating" ? "正在后台计算本月利润…" : "正在读取本月利润…"}<progress aria-label="本月利润计算进度" /></Panel></>;
  if (calculation.error && !calculated.length) {
    return <>{scopeFilters}<Panel><div role="alert"><h2>本月利润待处理</h2><p>{calculation.error}</p><p>尚未计算商品利润，请按上方原因处理。若为来源数据错误，请核对台账；旧扣款需登记为独立扣款来源。</p></div><Button onClick={() => { setRetryCalculation(value => value + 1); }}>重新读取</Button><Button onClick={() => navigate("/ledger")}>核对月度账本</Button><Button disabled>导出利润表</Button></Panel></>;
  }
  if (!snapshot?.ledger || !snapshot.rows?.length) {
    return (
      <Panel><EmptyState icon={CalendarDays} title="还没有可核算的月度台账" description="先导入 CSV/XLSX 台账，再取得候选成本；人工确认后才会进入本月利润。" action={<Button variant="primary" icon={Plus} onClick={() => navigate("/import-preview")}>导入月度台账</Button>} /></Panel>
    );
  }

  return (
    <>
      {!suppliedSnapshot ? <div className="profit-section-toolbar"><p>{calculated.length} 条 SKU 明细 · 核对成本后形成月度结果</p><div className="page-actions"><Button icon={CalendarDays} onClick={() => navigate("/ledger")}>月度账本</Button></div></div> : null}

      {calculation.error ? <div role="alert" className="profit-refresh-status">读取失败：{calculation.error} 以下为上次结果，请刷新后再导出。<Button onClick={() => setRetryCalculation(value => value + 1)}>重新读取</Button></div> : null}
      {calculation.loading ? <p className="profit-refresh-status" role="status">正在更新计算，当前显示上次结果；更新完成后可导出。</p> : null}
      {!suppliedSnapshot ? <section className="profit-next-step" aria-label="本月下一步">
        <div><strong>本月下一步</strong><span>{nextStep.text}</span></div>
        {nextStep.action ? <Button disabled={Boolean(calculation.loading || calculation.error)} onClick={() => navigate(nextStep.key === 'cost' ? allMissingCostsHref : buildProfitHref({ ledgerId: snapshot.ledger.id, view: 'detail' }))}>{nextStep.action}</Button> : null}
      </section> : null}
      {!suppliedSnapshot && missing ? <CostAttention missing={missing} /> : null}
      <details className="profit-purpose-help"><summary>核算说明</summary><Panel className="profit-purpose-strip">
        <div className="profit-purpose-step"><span className="profit-purpose-index">1</span><div><strong>台账明细</strong><small>SKC · SKU · 属性 · 数量 · 金额</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">2</span><div><strong>ERP 采购成本</strong><small>人工更正优先 · ERP 原始成本 · 1688 仅参考</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">3</span><div><strong>月度利润表</strong><small>商品利润 + 代发金额 − 独立扣款</small></div></div>
        <div className="profit-purpose-formula mono">商品利润 = 金额 − (数量 × 单件成本) − (数量 × {warehouseRate.toFixed(2)} 元)</div>
      </Panel></details>

      {monthlySummary ? <MonthlyProfitSummary summary={monthlySummary} ledger={snapshot.ledger} onEdit={onEditSupplement} /> : null}
      <p className="profit-subtotal-label">商品小计 · 当前筛选范围</p>
      <div className="profit-summary-strip profit-summary-products">
        <div className="profit-summary-item"><span>销售金额</span><strong>{currency(filteredSummary.exactTotals?.revenue ?? revenue)}</strong><small>{totalUnits.toLocaleString("zh-CN")} 件</small></div>
        <div className="profit-summary-item"><span>{missing ? "已确认采购成本" : "总采购成本"}</span><strong>{missing > 0 && missing === filtered.length ? "待补成本" : currency(filteredSummary.exactTotals?.purchaseCost ?? purchaseCosts)}</strong><small>{missing ? "缺失成本未按零计算" : "按单件平均成本 × 数量"}</small></div>
        <button className="profit-summary-item profit-summary-action" onClick={() => { setRateDraft(String(warehouseRate)); setRateDialog(true); }}><span>仓储成本</span><strong>{currency(filteredSummary.exactTotals?.warehouseCost ?? warehouseFees)}</strong><small>每件 {warehouseRate.toFixed(2)} 元 · 点击调整</small><Warehouse size={18} /></button>
        <div className={`profit-summary-item profit-summary-total ${missing ? "is-pending" : ""}`}><span>商品利润</span><strong>{missing ? "待确认成本" : currency(filteredSummary.exactTotals?.profit ?? matchedProfit)}</strong><small>{missing ? `${missing} 条店铺 SKU 尚未确认成本` : "金额 − 采购 − 仓储"}</small></div>
      </div>

      <div className="profit-detail-area" ref={detailsPanel}>
      {scopeFilters}
      <details open={detailsOpen} onToggle={event => { const open = event.currentTarget.open; if (open !== detailsOpen) { setDetailsOpen(open); saveProfitViewState(detailsStateKey, { detailsOpen: open }); } }}><summary>查看利润明细与成本更正（{storeSkuCount} 条店铺 SKU）</summary>{detailsOpen ? <section aria-label="月度利润明细" className="panel profit-table-panel">
        <ProfitGroups key={viewStateKey} stateKey={viewStateKey} groups={groupedFiltered} columns={columns}
          skcCount={skcCount} storeSkuCount={storeSkuCount}
          initiallyExpanded={missingOnly} expandRequest={!calculation.loading && pendingReveal.current === filterIdentity(filterState) ? revealSequence : 0} />
      </section> : null}
      </details>
      </div>

      <Modal open={rateDialog} title="修改仓储费率" description="费率按每件售出商品计入当前月度账本，可随时调整。" onClose={() => setRateDialog(false)} footer={<><Button onClick={() => setRateDialog(false)}>取消</Button><Button variant="primary" disabled={!rateDraft || Number(rateDraft) < 0} onClick={applyRate}>应用费率</Button></>}><div className="form-field"><label className="required">每件仓储费率（CNY）</label><input className="text-input mono" type="number" inputMode="decimal" min="0" step="0.01" value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} /></div></Modal>
      {manualTarget ? <ManualCostDialog ledger={snapshot.ledger} row={calculated.find(row => row.id === manualTarget.id) ?? manualTarget} viewFirst={manualTarget.mode === 'details'} onClose={() => setManualTarget(null)} /> : null}

    </>
  );
}

export function ProfitViewsContent({ monthControl = null }) {
  const [readiness, setReadiness] = useState(null);
  const [reportState, setReportState] = useState(null);
  const [supplementEditor, setSupplementEditor] = useState(null);
  const [costTarget, setCostTarget] = useState(null);
  const [reviewReasons, setReviewReasons] = useState(null);
  const [detailsRequest, setDetailsRequest] = useState(null);
  const [retry, setRetry] = useState(0);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const snapshot = useLatestSalesImport(params.get("ledger"), undefined, retry);
  useEffect(() => { setSupplementEditor(null); setCostTarget(null); }, [snapshot?.ledger?.id, snapshot?.ledger?.workspaceId]);
  const filter = useMemo(() => readProfitFilter(params, snapshot?.ledger?.id, { workspaceId: snapshot?.ledger?.workspaceId }), [params, snapshot?.ledger?.id, snapshot?.ledger?.workspaceId]);
  const store = filter.storeFilter;
  const stores = useMemo(() => [...new Set((snapshot?.rows ?? []).map(row => row.store))], [snapshot?.rows]);
  const changeScope = patch => {
    const next = { ...filter, ...patch };
    const nextParams = buildProfitQuery({ ledgerId: snapshot.ledger.id, workspaceId: snapshot.ledger.workspaceId, ...next, view: "detail" });
    nextParams.set("store", next.storeFilter || "all");
    nextParams.set("missing", next.missingOnly ? "1" : "0");
    setParams(nextParams, { replace: true });
    saveProfitFilter(snapshot.ledger.id, next);
  };
  if (snapshot === undefined) return <Panel role="status">正在读取月度账本…<progress aria-label="读取账本" /></Panel>;
  if (snapshot?.error) return <Panel><p role="alert">账本读取失败：{snapshot.error}</p><Button onClick={() => setRetry(value => value + 1)}>重新读取</Button></Panel>;
  if (!snapshot?.ledger) return <Panel><EmptyState icon={CalendarDays} title="开始本月利润核算" description="导入销售台账后，在这里采集成本、处理异常并导出利润表。" action={<Button variant="primary" onClick={() => navigate('/import-preview')}>导入月度台账</Button>} /></Panel>;
  if (store !== 'all' && !stores.includes(store)) return <Panel><p role="alert">当前账本没有此店铺。</p><Button onClick={() => changeScope({storeFilter:'all'})}>查看全部店铺</Button></Panel>;
  return <>
    <PageHeader title="利润核算" eyebrow={snapshot.ledger.period} description="随时调整台账与成本，重新核算并导出；历史报表保留原样。"
      actions={<div className="profit-workspace-controls">{monthControl}<label>店铺 <select className="select-input" aria-label="查看店铺" value={store} onChange={event => changeScope({storeFilter:event.target.value})}><option value="all">全部店铺</option>{stores.map(name => <option key={name}>{name}</option>)}</select></label><Button icon={CalendarDays} onClick={() => navigate('/ledger')}>月度账本</Button></div>} />
    <section id="monthly-report-section" className="profit-report-section profit-report-top" tabIndex={-1} aria-label="本月报告">
      <MonthlyReportManager compact key={'report/'+snapshot.ledger.id} ledgerId={snapshot.ledger.id} workspaceId={snapshot.ledger.workspaceId}
        onState={setReportState} editor={supplementEditor} onEdit={setSupplementEditor}
        missingCostCount={readiness?.ledgerId === snapshot.ledger.id ? readiness.missingCount : null}
        onOpenCosts={() => setDetailsRequest({ ledgerId: snapshot.ledger.id })} />
    </section>
    <CostMatchingContent compact suppliedSnapshot={snapshot} key={'cost/'+snapshot.ledger.id}
      validatedContext={{workspaceId:snapshot.ledger.workspaceId, ledgerId:snapshot.ledger.id, store}}
      reviewTarget={costTarget} onReviewReasons={setReviewReasons} onReviewClose={() => setCostTarget(null)} />
    <ProfitWorkspaceContent suppliedSnapshot={snapshot} onReadiness={setReadiness} reportState={reportState}
      reviewReasons={reviewReasons?.ledgerId === snapshot.ledger.id && reviewReasons.workspaceId === snapshot.ledger.workspaceId ? reviewReasons.byStoreSku : null}
      onEditSupplement={setSupplementEditor} onCostDetails={setCostTarget} detailsRequest={detailsRequest} key={'profit/'+snapshot.ledger.id} />
  </>;
}

export default function ProfitPanel() {
  return <AppShell pageClass="profit-page"><ProfitViewsContent /></AppShell>;
}
