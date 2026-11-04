import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarDays, CheckCircle2, Plus, Warehouse } from "lucide-react";
import AppShell from "../components/AppShell";
import { CostMatchingContent } from "./CostMatching";
import MonthlyReportManager from "./MonthlyReportManager";
import MonthlyProfitSummary from "./MonthlyProfitSummary";
import { monthlyProfitSummary } from "../domain/monthlyProfitSummary";
import { displayMoney } from "../domain/profitReports";
import ProfitGroups from "./ProfitGroups";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, useToast } from "../components/UI";
import ProfitScopeFilters from "../components/ProfitScopeFilters";
import {
  updateLedgerWarehouseRate,
} from "../data/database";
import { readCachedReportProducts } from "../data/repositories/derivedComputationService";
import { presentReportProducts } from "../lib/profitPresentation";
import { canonicalPlatformSku } from "../domain/identifiers";
import { useLatestSalesImport } from "../hooks/useLatestSalesImport";
import { formatErpUnitCost, formatManualUnitCost, formatProfitAmount, summarizeProfitRows } from "../lib/profitPrecision";
import { groupProfitRowsBySkc } from "../lib/profit";
import { buildProfitHref, buildProfitQuery, filterProfitRowsByScope, searchProfitRows, readProfitFilter, readProfitView, saveProfitFilter } from "../lib/profitFilter";
import ManualCostDialog from "./ManualCostDialog";
import { ledgerNextStep } from "../domain/ledgerWorkflow";
import { describeLedgerCostIdentityIssue } from '../domain/ledgerCostIdentity';
import { readProfitViewState, saveProfitViewState } from "../lib/profitViewState";

const currency = (value) => `¥${displayMoney(value)}`;

const ledgerStatusLabels = {
  draft: "草稿",
  cost_pending: "待核对成本",
  approval_pending: "待确认成本",
  ready: "待确认利润",
  finalized: "可继续盘点",
  locked: "可继续盘点",
};

function prepareProfitTableRows(rows) {
  let previousGroupKey = null;
  const groupCounts = new Map();
  rows.forEach((row) => groupCounts.set(row.groupKey, (groupCounts.get(row.groupKey) ?? 0) + 1));
  return rows.map((row) => {
    const groupStart = row.groupKey !== previousGroupKey;
    previousGroupKey = row.groupKey;
    return {
      ...row,
      groupStart,
      groupSkuCount: groupCounts.get(row.groupKey) ?? 1,
    };
  });
}

export function ProfitWorkspaceContent({ suppliedSnapshot, onReadiness, reportState, onEditSupplement, onCostDetails } = {}) {
  const [manualTarget, setManualTarget] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const openCost = row => onCostDetails ? onCostDetails(row) : setManualTarget(row);
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

  const stores = useMemo(() => [...new Set(calculated.map((row) => row.store).filter(Boolean))].toSorted(), [calculated]);
  const suppliers = useMemo(() => [...new Set(calculated.filter((row) => storeFilter === "all" || row.store === storeFilter).map((row) => row.supplierNumber).filter(Boolean))].toSorted(), [calculated, storeFilter]);
  const filterState = useMemo(() => ({ query, storeFilter, supplierSelection, supplierStoreSelection, missingOnly, ...(supplierScopeError ? { supplierScopeError } : {}) }), [missingOnly, query, storeFilter, supplierSelection, supplierStoreSelection, supplierScopeError]);
  const viewStateKey = JSON.stringify([snapshot?.ledger?.workspaceId, snapshot?.ledger?.id, filterState]);
  const detailsStateKey = JSON.stringify([snapshot?.ledger?.workspaceId, snapshot?.ledger?.id, 'details']);
  useEffect(() => { setDetailsOpen(readProfitViewState(detailsStateKey).detailsOpen !== false); }, [detailsStateKey]);
  const changeFilter = (patch) => {
    const next = { ...filterState, ...patch };
    const params = buildProfitQuery({ ledgerId: snapshot?.ledger?.id, workspaceId: snapshot?.ledger?.workspaceId, ...next, view: "detail" });
    params.set("store", next.storeFilter || "all");
    params.set("missing", next.missingOnly ? "1" : "0");
    setSearchParams(params, { replace: true });
  };
  const scopedRows = useMemo(() => filterProfitRowsByScope(calculated, { storeFilter, supplierSelection, supplierStoreSelection, missingOnly }), [calculated, storeFilter, supplierSelection, supplierStoreSelection, missingOnly]);
  const filtered = useMemo(() => searchProfitRows(scopedRows, query), [scopedRows, query]);
  const groupedFiltered = useMemo(() => groupProfitRowsBySkc(filtered), [filtered]);
  const filteredSummary = useMemo(() => summarizeProfitRows(filtered, costBySku), [costBySku, filtered]);
  const ledgerSummary = useMemo(() => summarizeProfitRows(calculated, costBySku), [calculated, costBySku]);
  useEffect(() => {
    onReadiness?.({ ledgerId: snapshot?.ledger?.id, missingCount: calculation.loading || calculation.error ? null : ledgerSummary.missing });
  }, [onReadiness, snapshot?.ledger?.id, calculation.loading, calculation.error, ledgerSummary.missing]);
  const nextStep = ledgerNextStep(snapshot?.ledger, { missingCount: ledgerSummary.missing, loading: calculation.loading });
  const { revenue, totalUnits, purchaseCosts, warehouseFees, matchedProfit, missing, missingErp } = filteredSummary;
  const monthlySummary = snapshot?.ledger ? monthlyProfitSummary({ ledger: snapshot.ledger, reportState, productProfitExact: ledgerSummary.exactTotals?.profit, missingCostCount: calculation.loading || calculation.error ? null : ledgerSummary.missing }) : null;

  const costMatchingHref = useMemo(() => buildProfitHref({ ledgerId: snapshot?.ledger?.id, workspaceId: snapshot?.ledger?.workspaceId, ...filterState, view: "cost" }), [filterState, snapshot?.ledger?.id, snapshot?.ledger?.workspaceId]);
  const allMissingCostsHref = buildProfitHref({ ledgerId: snapshot?.ledger?.id, view: 'cost', storeFilter: 'all', missingOnly: true });

  const columns = useMemo(() => [
    {
      accessorKey: "groupSkc",
      header: "平台 SKC",
      enableSorting: false,
      size: 190,
      meta: { headerStyle: { width: "190px" } },
      cell: ({ row }) => row.original.groupStart ? (
        <div className="profit-flat-skc">
          <strong className="mono" title={row.original.groupSkc}>{row.original.groupSkc}</strong>
          <small>{row.original.store} · {row.original.supplierNumber || "未填供方货号"}</small>
          <em>{row.original.groupSkuCount} 个 SKU</em>
        </div>
      ) : <span className="profit-skc-continuation" aria-label="同一平台 SKC">↳</span>,
    },
    {
      accessorKey: "platformSku",
      header: "平台 SKU",
      enableSorting: false,
      size: 180,
      meta: { headerStyle: { width: "180px" } },
      cell: ({ getValue, row }) => <div><strong className="mono table-code" title={getValue()}>{getValue()}</strong><small className="profit-attribute">{row.original.attribute || "未提供属性"}</small></div>,
    },
    {
      accessorKey: "attribute",
      header: "属性",
      enableSorting: false,
      size: 210,
      meta: { headerStyle: { width: "210px" } },
      cell: ({ getValue }) => <span className="profit-attribute" title={getValue() || "未提供属性"}>{getValue() || "未提供属性"}</span>,
    },
    {
      id: "qty", accessorFn: row => row.quantityExact ?? row.qty,
      header: "数量",
      enableSorting: false,
      size: 78,
      meta: { headerStyle: { width: "78px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className="mono table-number">{Number(getValue() ?? 0).toLocaleString("zh-CN")}</span>,
    },
    {
      id: "revenue", accessorFn: row => row.revenueExact ?? row.revenue,
      header: "金额",
      enableSorting: false,
      size: 112,
      meta: { headerStyle: { width: "112px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className="mono table-number profit-revenue">{currency(getValue() ?? 0)}</span>,
    },
    {
      accessorKey: "orderNumber",
      header: "1688 单号",
      enableSorting: false,
      size: 170,
      meta: { headerStyle: { width: "170px" } },
      cell: ({ getValue }) => <span className="mono table-code table-code-muted" title={getValue() || "暂无采购单号"}>{getValue() || "--"}</span>,
    },
    {
      id: "unitCost",
      header: "单件平均成本",
      enableSorting: false,
      size: 118,
      meta: { headerStyle: { width: "118px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ row }) => row.original.unitCost != null ? <span className={`mono table-number ${row.original.costSource === "erp" ? "profit-cost-formal" : "profit-cost-reference"}`}>{row.original.costSource === "manual_override" ? formatManualUnitCost(row.original.unitCost) : row.original.costSource === "erp" ? formatErpUnitCost(row.original.unitCost) : currency(row.original.unitCost)}{row.original.costSource === "approved_1688" ? <small>人工参考</small> : null}</span> : row.original.reference1688Cost?.unitCost != null ? <span className="mono table-number profit-cost-reference" title="1688 参考成本">{currency(row.original.reference1688Cost.unitCost)}<small>参考</small></span> : <Badge tone="danger"><AlertCircle size={12} />缺失</Badge>,
    },
    {
      id: "purchaseCost", accessorFn: row => row.purchaseCostExact ?? row.purchaseCost,
      header: "总采购成本",
      enableSorting: false,
      size: 118,
      meta: { headerStyle: { width: "118px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => getValue() != null ? <span className="mono table-number">{formatProfitAmount(getValue())}</span> : <span className="pending-text">待成本</span>,
    },
    {
      id: "warehouseCost", accessorFn: row => row.warehouseCostExact ?? row.warehouseCost,
      header: "仓储成本",
      enableSorting: false,
      size: 108,
      meta: { headerStyle: { width: "108px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className="mono table-number">{currency(getValue() ?? 0)}</span>,
    },
    {
      accessorKey: "penalty",
      header: "客退罚款",
      enableSorting: false,
      size: 108,
      meta: { headerStyle: { width: "108px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className={`mono table-number ${Number(getValue() ?? 0) > 0 ? "profit-penalty" : ""}`}>{currency(getValue() ?? 0)}</span>,
    },
    {
      id: "profit", accessorFn: row => row.profitExact ?? row.profit,
      header: "总利润",
      enableSorting: false,
      size: 118,
      meta: { headerStyle: { width: "118px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => getValue() == null ? <span className="pending-text">待补成本</span> : <strong className={`mono table-number ${Number(getValue()) < 0 ? "profit-negative" : "profit-positive"}`}>{formatProfitAmount(getValue())}</strong>,
    },
    {
      id: "costStatus",
      header: "成本状态",
      enableSorting: false,
      size: 156,
      meta: { headerStyle: { width: "156px", position: "sticky", right: 0, zIndex: 2, background: "var(--surface)" }, cellStyle: { position: "sticky", right: 0, zIndex: 1, background: "var(--surface)" } },
      cell: ({ row }) => {
        const item = row.original;
        const ignored = costBySku.get(canonicalPlatformSku(item.platformSku))?.resolutions?.some(resolution => resolution.action === 'ignore_anomaly');
        return <div className="profit-status-actions"><Badge tone={item.finalizable ? ignored ? "warning" : "success" : "warning"}>{item.costIdentityIssue ? "归属待核对" : item.costSource === "manual_override" ? "人工更正" : ignored ? "异常已忽略" : item.costSource === "erp" ? "ERP 已采用" : "待补成本"}</Badge><button className="inline-link" onClick={() => openCost(item)}>成本详情</button></div>;
      },
    },
  ], [costMatchingHref, costBySku, onCostDetails]);

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

  const openReports = () => document.getElementById("monthly-reports")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const openCostDetails = () => {
    setDetailsOpen(true);
    saveProfitViewState(detailsStateKey, { detailsOpen: true });
    requestAnimationFrame(() => document.querySelector(".profit-table-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };



  if (snapshot === undefined) {
    return <><Panel className="route-loader">正在读取月度账本...</Panel></>;
  }

  if (calculation.loading && !calculated.length && !manualTarget) return <Panel className="route-loader" role="status">{calculationStatus.startsWith('正在') ? calculationStatus : calculationStatus === "recalculating" ? "正在后台计算本月利润…" : "正在读取本月利润…"}<progress aria-label="本月利润计算进度" /></Panel>;
  if (calculation.error && !calculated.length) {
    return <Panel><div role="alert"><h2>本月利润待处理</h2><p>{calculation.error}</p><p>尚未计算商品利润，请按上方原因处理。若为来源数据错误，请核对台账；旧扣款需登记为独立扣款来源。</p></div><Button onClick={() => { setRetryCalculation(value => value + 1); }}>重新读取</Button><Button onClick={() => navigate("/ledger")}>核对月度账本</Button><Button disabled>导出利润表</Button></Panel>;
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
        {nextStep.action ? <Button disabled={Boolean(calculation.loading || calculation.error)} onClick={() => nextStep.key === 'cost' ? navigate(allMissingCostsHref) : finalizeLedger()}>{nextStep.action}</Button> : null}
      </section> : null}
      <details className="profit-purpose-help"><summary>核算说明</summary><Panel className="profit-purpose-strip">
        <div className="profit-purpose-step"><span className="profit-purpose-index">1</span><div><strong>台账明细</strong><small>SKC · SKU · 属性 · 数量 · 金额</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">2</span><div><strong>ERP 采购成本</strong><small>人工更正优先 · ERP 原始成本 · 1688 仅参考</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">3</span><div><strong>月度利润表</strong><small>商品利润 + 代发金额 − 独立扣款</small></div></div>
        <div className="profit-purpose-formula mono">商品利润 = 金额 − (数量 × 单件成本) − (数量 × {warehouseRate.toFixed(2)} 元)</div>
      </Panel></details>

      {!suppliedSnapshot ? <ProfitScopeFilters filter={filterState} stores={stores} suppliers={suppliers} workspaceId={snapshot?.ledger?.workspaceId} scopeRows={calculated} onChange={changeFilter} /> : null}
      <div className="profit-summary-strip profit-summary-products">
        <div className="profit-summary-item"><span>销售金额</span><strong>{currency(filteredSummary.exactTotals?.revenue ?? revenue)}</strong><small>{totalUnits.toLocaleString("zh-CN")} 件</small></div>
        <div className="profit-summary-item"><span>{missing ? "已确认采购成本" : "总采购成本"}</span><strong>{missing > 0 && missing === filtered.length ? "待补成本" : currency(filteredSummary.exactTotals?.purchaseCost ?? purchaseCosts)}</strong><small>{missing ? "缺失成本未按零计算" : "按单件平均成本 × 数量"}</small></div>
        <button className="profit-summary-item profit-summary-action" onClick={() => { setRateDraft(String(warehouseRate)); setRateDialog(true); }}><span>仓储成本</span><strong>{currency(filteredSummary.exactTotals?.warehouseCost ?? warehouseFees)}</strong><small>每件 {warehouseRate.toFixed(2)} 元 · 点击调整</small><Warehouse size={18} /></button>
        <div className={`profit-summary-item profit-summary-total ${missing ? "is-pending" : ""}`}><span>商品利润</span><strong>{missing ? "待确认成本" : currency(filteredSummary.exactTotals?.profit ?? matchedProfit)}</strong><small>{missing ? `${missing} 条店铺 SKU 尚未确认成本` : "金额 − 采购 − 仓储"}</small></div>
      </div>
      {monthlySummary ? <MonthlyProfitSummary summary={monthlySummary} ledger={snapshot.ledger} onEdit={onEditSupplement} /> : null}

      {missing ? <div className="profit-cost-alert" role="status"><AlertCircle size={18} /><span><strong>还有 {missing} 条店铺 SKU 待确认成本</strong><small>价格异常可在上方一键忽略；无采购数据的项目可在明细中补成本。</small></span><Button onClick={() => { changeFilter({ missingOnly: true }); setDetailsOpen(true); }}>只看待补成本</Button></div> : null}

      <details open={detailsOpen} onToggle={event => { const open = event.currentTarget.open; if (open !== detailsOpen) { setDetailsOpen(open); saveProfitViewState(detailsStateKey, { detailsOpen: open }); } }}><summary>查看利润明细与成本更正（{filtered.length} 条店铺 SKU）</summary>{detailsOpen ? <Panel className={`profit-table-panel${showAllColumns ? '' : ' profit-table-compact'}`}>
        <div className="profit-table-heading">
          <div><h2>月度利润明细</h2><p>每个 SKU 一行，SKC 用分组标识；金额和成本均为人民币 CNY。</p></div>
          <div className="page-actions"><span className="profit-filter-count">当前 {groupedFiltered.length} 个 SKC · {filtered.length} 个 SKU</span><Button variant="ghost" onClick={() => setShowAllColumns(value => !value)}>{showAllColumns ? "精简列" : "展开全部列"}</Button></div>
        </div>
        <ProfitGroups key={viewStateKey} stateKey={viewStateKey} groups={groupedFiltered} columns={showAllColumns ? columns : columns.filter(column => ["platformSku", "qty", "revenue", "unitCost", "profit", "costStatus"].includes(column.id ?? column.accessorKey))} prepareRows={prepareProfitTableRows} />
      </Panel> : null}
      </details>

      <Modal open={rateDialog} title="修改仓储费率" description="费率按每件售出商品计入当前月度账本，可随时调整。" onClose={() => setRateDialog(false)} footer={<><Button onClick={() => setRateDialog(false)}>取消</Button><Button variant="primary" disabled={!rateDraft || Number(rateDraft) < 0} onClick={applyRate}>应用费率</Button></>}><div className="form-field"><label className="required">每件仓储费率（CNY）</label><input className="text-input mono" type="number" inputMode="decimal" min="0" step="0.01" value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} /></div></Modal>
      {manualTarget ? <ManualCostDialog ledger={snapshot.ledger} row={calculated.find(row => row.id === manualTarget.id) ?? manualTarget} onClose={() => setManualTarget(null)} /> : null}

    </>
  );
}

export function ProfitViewsContent({ monthControl = null }) {
  const [readiness, setReadiness] = useState(null);
  const [reportState, setReportState] = useState(null);
  const [supplementEditor, setSupplementEditor] = useState(null);
  const [costTarget, setCostTarget] = useState(null);
  const [retry, setRetry] = useState(0);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const snapshot = useLatestSalesImport(params.get("ledger"), undefined, retry);
  useEffect(() => { setSupplementEditor(null); setCostTarget(null); }, [snapshot?.ledger?.id, snapshot?.ledger?.workspaceId]);
  const filter = useMemo(() => readProfitFilter(params, snapshot?.ledger?.id, { workspaceId: snapshot?.ledger?.workspaceId }), [params, snapshot?.ledger?.id, snapshot?.ledger?.workspaceId]);
  const store = filter.storeFilter;
  const stores = useMemo(() => [...new Set((snapshot?.rows ?? []).map(row => row.store))], [snapshot?.rows]);
  const suppliers = useMemo(() => [...new Set((snapshot?.rows ?? []).filter(row => store === "all" || row.store === store).map(row => row.supplierNumber).filter(Boolean))].toSorted(), [snapshot?.rows, store]);
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
    <PageHeader title="利润核算" eyebrow={snapshot.ledger.period} description="查看利润、补齐成本、导出报表。"
      actions={<div className="profit-workspace-controls">{monthControl}<label>店铺 <select className="select-input" aria-label="查看店铺" value={store} onChange={event => changeScope({storeFilter:event.target.value})}><option value="all">全部店铺</option>{stores.map(name => <option key={name}>{name}</option>)}</select></label><Button icon={CalendarDays} onClick={() => navigate('/ledger')}>月度账本</Button></div>} />
    <section id="monthly-report-section" className="profit-report-section profit-report-top" tabIndex={-1} aria-label="本月报告">
      <MonthlyReportManager compact key={'report/'+snapshot.ledger.id} ledgerId={snapshot.ledger.id} workspaceId={snapshot.ledger.workspaceId}
        onState={setReportState} editor={supplementEditor} onEdit={setSupplementEditor}
        missingCostCount={readiness?.ledgerId === snapshot.ledger.id ? readiness.missingCount : null}
        onOpenCosts={() => changeScope({storeFilter:'all', missingOnly:true})} />
    </section>
    <ProfitScopeFilters filter={filter} suppliers={suppliers} workspaceId={snapshot.ledger.workspaceId} scopeRows={snapshot.rows ?? []} onChange={changeScope} showStore={false} />
    <CostMatchingContent compact suppliedSnapshot={snapshot} key={'cost/'+snapshot.ledger.id}
      validatedContext={{workspaceId:snapshot.ledger.workspaceId, ledgerId:snapshot.ledger.id, store}}
      reviewTarget={costTarget} onReviewClose={() => setCostTarget(null)} />
    <ProfitWorkspaceContent suppliedSnapshot={snapshot} onReadiness={setReadiness} reportState={reportState}
      onEditSupplement={setSupplementEditor} onCostDetails={setCostTarget} key={'profit/'+snapshot.ledger.id} />
  </>;
}

export default function ProfitPanel() {
  return <AppShell pageClass="profit-page"><ProfitViewsContent /></AppShell>;
}
