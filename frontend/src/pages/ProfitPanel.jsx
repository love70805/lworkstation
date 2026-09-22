import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronDown, Download, LockKeyhole, Plus, RotateCcw, Warehouse } from "lucide-react";
import AppShell from "../components/AppShell";
import { CostMatchingContent } from "./CostMatching";
import MonthlyReportManager from "./MonthlyReportManager";
import { REPORT_FORMULA_VERSION, displayMoney } from "../domain/profitReports";
import ProfitGroups from "./ProfitGroups";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, SearchInput, useToast } from "../components/UI";
import {
  updateLedgerWarehouseRate,
  reopenLedgerForCostCorrection,
} from "../data/database";
import { readCachedReportProducts } from "../data/repositories/derivedComputationService";
import { presentReportProducts } from "../lib/profitPresentation";
import { canonicalPlatformSku } from "../domain/identifiers";
import { useLatestSalesImport } from "../hooks/useLatestSalesImport";
import { buildProfitExportRows, formatErpUnitCost, formatManualUnitCost, formatProfitAmount, isProfitSnapshot, savedProfitRows, savedProfitSummary, summarizeProfitRows } from "../lib/profitPrecision";
import { groupProfitRowsBySkc } from "../lib/profit";
import { exportWorkbook } from "../lib/spreadsheetExport";
import { buildProfitHref, buildProfitQuery, filterProfitRows, readProfitFilter, readProfitView, saveProfitFilter } from "../lib/profitFilter";
import ManualCostDialog from "./ManualCostDialog";
import { ledgerNextStep } from "../domain/ledgerWorkflow";
import { readProfitViewState, saveProfitViewState } from "../lib/profitViewState";

const currency = (value) => `¥${displayMoney(value)}`;

const ledgerStatusLabels = {
  draft: "草稿",
  cost_pending: "待核对成本",
  approval_pending: "待确认成本",
  ready: "待确认利润",
  finalized: "已定稿",
  locked: "已锁定",
};

function SupplierMultiSelect({ options, selection, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = selection ?? options;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = selection === null || options.every((item) => selectedSet.has(item));
  const label = allSelected
    ? "全部供方货号"
    : selected.length === 0
      ? "未选择供方货号"
      : selected.length === 1
        ? selected[0]
        : `已选 ${selected.length} 个货号`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggle = (supplier) => {
    const next = selectedSet.has(supplier)
      ? selected.filter((item) => item !== supplier)
      : [...selected, supplier].toSorted();
    onChange(next.length === options.length ? null : next);
  };

  return (
    <div className="profit-multi-select" ref={rootRef}>
      <button type="button" className="profit-multi-select-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={!options.length} onClick={() => setOpen((value) => !value)}>
        <span>{label}</span><ChevronDown size={16} />
      </button>
      {open ? (
        <div className="profit-multi-select-menu" role="listbox" aria-multiselectable="true">
          <div className="profit-multi-select-head"><strong>供方货号</strong><span><button type="button" onClick={() => onChange(null)}>全选</button><button type="button" onClick={() => onChange([])}>清空</button></span></div>
          <div className="profit-multi-select-options">
            {options.map((supplier) => (
              <label className="profit-multi-select-option" key={supplier}>
                <input type="checkbox" checked={selectedSet.has(supplier)} onChange={() => toggle(supplier)} />
                <code>{supplier}</code>
                {selectedSet.has(supplier) ? <Check size={15} /> : null}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

export function ProfitWorkspaceContent({ suppliedSnapshot, onReadiness } = {}) {
  const [manualTarget, setManualTarget] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reopenDialog, setReopenDialog] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");
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
  const [missingOnly, setMissingOnly] = useState(initialFilter.missingOnly);
  const [warehouseRate, setWarehouseRate] = useState(0.7);
  const [rateDraft, setRateDraft] = useState("0.7");
  const [rateDialog, setRateDialog] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const next = readProfitFilter(searchParams, requestedLedgerId);
    setQuery(next.query);
    setStoreFilter(next.storeFilter);
    setSupplierSelection(next.supplierSelection);
    setMissingOnly(next.missingOnly);
  }, [filterSearchKey, requestedLedgerId]);

  useEffect(() => {
    if (snapshot?.ledger?.warehouseRate != null) {
      setWarehouseRate(snapshot.ledger.warehouseRate);
      setRateDraft(String(snapshot.ledger.warehouseRate));
    }
  }, [snapshot?.ledger?.id, snapshot?.ledger?.warehouseRate]);

  useEffect(() => {
    if (!snapshot?.ledger?.id) return;
    saveProfitFilter(snapshot.ledger.id, { query, storeFilter, supplierSelection, missingOnly });
  }, [missingOnly, query, snapshot?.ledger?.id, storeFilter, supplierSelection]);

  const locked = isProfitSnapshot(snapshot?.ledger);
  const legacySnapshot = locked && snapshot?.ledger?.formulaVersion !== REPORT_FORMULA_VERSION;
  const costBySku = useMemo(() => new Map((snapshot?.costs ?? []).map(cost => [cost.canonicalPlatformSku ?? canonicalPlatformSku(cost.platformSku), cost])), [snapshot?.costs]);
  const [computed, setComputed] = useState(null);
  const [calculationStatus, setCalculationStatus] = useState("reading");
  const [retryCalculation, setRetryCalculation] = useState(0);
  useEffect(() => {
    if (locked || !snapshot?.rows?.length) return;
    let active = true;
    readCachedReportProducts({ snapshot, warehouseRate, onStatus: status => { if (active) setCalculationStatus(status); } }).then(lines => {
      if (active) setComputed({ snapshot, warehouseRate, rows: presentReportProducts(lines, snapshot), error: null });
    }).catch(error => {
      if (active) setComputed(previous => ({ snapshot, warehouseRate, rows: previous?.snapshot?.ledger?.id === snapshot.ledger.id && previous?.snapshot?.ledger?.workspaceId === snapshot.ledger.workspaceId ? previous.rows : [], error: error.message }));
    });
    return () => { active = false; };
  }, [snapshot, warehouseRate, locked, retryCalculation]);
  const savedRows = useMemo(() => locked ? savedProfitRows(snapshot?.profitLines) : [], [locked, snapshot?.profitLines]);
  const sameLedger = Boolean(computed?.snapshot?.ledger?.id && snapshot?.ledger?.id && computed.snapshot.ledger.id === snapshot.ledger.id && computed.snapshot.ledger.workspaceId === snapshot.ledger.workspaceId);
  const calculation = locked ? { rows: savedRows } : computed?.snapshot === snapshot && computed?.warehouseRate === warehouseRate ? computed : { rows: sameLedger ? computed.rows : [], loading: Boolean(snapshot?.rows?.length) };
  const calculated = calculation.rows;

  const stores = useMemo(() => [...new Set(calculated.map((row) => row.store).filter(Boolean))].toSorted(), [calculated]);
  const suppliers = useMemo(() => [...new Set(calculated.map((row) => row.supplierNumber).filter(Boolean))].toSorted(), [calculated]);
  const filterState = useMemo(() => ({ query, storeFilter, supplierSelection, missingOnly }), [missingOnly, query, storeFilter, supplierSelection]);
  const viewStateKey = JSON.stringify([snapshot?.ledger?.workspaceId, snapshot?.ledger?.id, filterState]);
  const detailsStateKey = JSON.stringify([snapshot?.ledger?.workspaceId, snapshot?.ledger?.id, 'details']);
  useEffect(() => { setDetailsOpen(readProfitViewState(detailsStateKey).detailsOpen); }, [detailsStateKey]);
  const changeFilter = (patch) => {
    const next = { ...filterState, ...patch };
    const params = buildProfitQuery({ ledgerId: snapshot?.ledger?.id, ...next, view: "detail" });
    params.set("store", next.storeFilter || "all");
    params.set("missing", next.missingOnly ? "1" : "0");
    setSearchParams(params, { replace: true });
  };
  const filtered = useMemo(() => filterProfitRows(calculated, filterState), [calculated, filterState]);
  const groupedFiltered = useMemo(() => groupProfitRowsBySkc(filtered), [filtered]);
  const filteredSummary = useMemo(() => locked && snapshot?.ledger?.formulaVersion !== REPORT_FORMULA_VERSION && filtered.length === calculated.length && snapshot?.ledger?.profitSummary ? savedProfitSummary(snapshot.ledger.profitSummary) : summarizeProfitRows(filtered, costBySku), [costBySku, filtered, calculated.length, locked, snapshot?.ledger?.profitSummary]);
  const ledgerSummary = useMemo(() => summarizeProfitRows(calculated, costBySku), [calculated, costBySku]);
  useEffect(() => {
    onReadiness?.({ ledgerId: snapshot?.ledger?.id, missingCount: calculation.loading || calculation.error ? null : ledgerSummary.missing });
  }, [onReadiness, snapshot?.ledger?.id, calculation.loading, calculation.error, ledgerSummary.missing]);
  const nextStep = ledgerNextStep(snapshot?.ledger, { missingCount: ledgerSummary.missing, loading: calculation.loading });
  const { revenue, totalUnits, purchaseCosts, warehouseFees, penalties, matchedProfit, missing, missingErp } = filteredSummary;

  const canFinalize = Boolean(calculated.length) && ledgerSummary.missing === 0 && !locked && !calculation.loading && !calculation.error;
  const costMatchingHref = useMemo(() => buildProfitHref({ ledgerId: snapshot?.ledger?.id, ...filterState, view: "cost" }), [filterState, snapshot?.ledger?.id]);
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
      cell: ({ getValue }) => <strong className="mono table-code" title={getValue()}>{getValue()}</strong>,
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
      meta: { headerStyle: { width: "156px" } },
      cell: ({ row }) => {
        const item = row.original;
        if (!locked) return <div className="profit-status-actions"><Badge tone={item.finalizable ? "success" : "warning"}>{item.costSource === "manual_override" ? "人工确认" : item.costSource === "erp" ? "ERP 结果已采用" : "待确认成本"}</Badge><button className="inline-link" onClick={() => setManualTarget(item)}>{item.manualOverride ? "更正 / 撤销" : "人工填写"}</button>{!item.finalizable ? <button className="inline-link" onClick={() => navigate(costMatchingHref)}>查看候选</button> : null}</div>;
        if (item.costSource === "manual_override") return <Badge tone="success">人工更正</Badge>;
        if (item.costSource === "erp") return <Badge tone="success">ERP 结果已采用</Badge>;
        if (item.costSource === "approved_1688") return <Badge tone="warning">1688 参考，未计入利润</Badge>;
        return <div className="profit-status-actions"><Badge tone="danger">待确认成本</Badge><button className="inline-link" onClick={() => navigate(costMatchingHref)}>去查看</button></div>;
      },
    },
  ], [costMatchingHref, locked]);

  const exportProfit = async () => {
    if (!locked || snapshot?.ledger?.currentBaseReportId) { document.getElementById("monthly-reports")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (!snapshot?.ledger) return;
    setExporting(true);
    try {
      await exportWorkbook(buildProfitExportRows(filtered, snapshot.ledger, filteredSummary), `profit-${snapshot.ledger.period}-${snapshot.ledger.status}.xlsx`, "利润明细");
      notify(`已导出当前筛选的 ${filtered.length} 条 SKU 利润明细。`);
    } catch (error) {
      notify(`导出失败：${error.message}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const applyRate = async () => {
    const next = Number(rateDraft);
    if (!Number.isFinite(next) || next < 0 || !snapshot?.ledger) return;
    try {
      await updateLedgerWarehouseRate(snapshot.ledger.id, next);
      setWarehouseRate(next);
      setRateDialog(false);
      notify(`仓储费率已更新为每件 ${next.toFixed(2)} 元，利润已重新计算。`);
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const finalizeLedger = () => document.getElementById("monthly-reports")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const openCostDetails = () => {
    setDetailsOpen(true);
    saveProfitViewState(detailsStateKey, { detailsOpen: true });
    requestAnimationFrame(() => document.querySelector(".profit-table-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const reopenLedger = async () => {
    setReopening(true); setReopenError("");
    try {
      await reopenLedgerForCostCorrection({ ledgerId: snapshot.ledger.id, reason: reopenReason });
      setReopenDialog(false);
      notify("本月全部店铺已重开，原定稿快照保留在审计中。更正完成后请重新核对并定稿。");
    } catch (error) { setReopenError(error.message); }
    finally { setReopening(false); }
  };

  if (snapshot === undefined) {
    return <><Panel className="route-loader">正在读取月度账本...</Panel></>;
  }

  if (locked && (!snapshot?.profitLines?.length || !snapshot.ledger.profitSummary)) {
    return <><Panel><EmptyState icon={AlertCircle} title="历史定稿快照缺失" description="该账本缺少已保存的利润明细或汇总，暂不能展示和导出。请恢复完整备份；系统不会按当前成本重算历史。" /></Panel></>;
  }
  if (calculation.loading && !calculated.length && !manualTarget) return <Panel className="route-loader" role="status">{calculationStatus === "recalculating" ? "正在后台计算本月利润…" : "正在读取本月利润…"}</Panel>;
  if (calculation.error && !calculated.length) {
    return <Panel><div role="alert"><h2>本月利润待处理</h2><p>{calculation.error}</p><p>尚未计算商品利润，请按上方原因处理。若为来源数据错误，请核对台账；旧扣款需登记为独立扣款来源。</p></div><Button onClick={() => { setRetryCalculation(value => value + 1); }}>重新读取</Button><Button onClick={() => navigate("/ledger")}>核对月度账本</Button><Button disabled>预览并定稿</Button></Panel>;
  }
  if (!snapshot?.ledger || (!locked && !snapshot.rows?.length)) {
    return (
      <>
        <PageHeader title="利润核算" description="导入月度台账后，系统会整理销售明细，并把 ERP、历史和人工成本放在一起供你确认。" />
        <Panel><EmptyState icon={CalendarDays} title="还没有可核算的月度台账" description="先导入 CSV/XLSX 台账，再取得候选成本；人工确认后才会进入本月利润。" action={<Button variant="primary" icon={Plus} onClick={() => navigate("/import-preview")}>导入月度台账</Button>} /></Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`月度利润核算 · ${snapshot.ledger.period}`}
        title="利润核算"
        description={`${ledgerStatusLabels[snapshot.ledger.status] ?? snapshot.ledger.status} · ${calculated.length} 条 SKU 明细 · ${locked ? "历史定稿口径，使用已存快照" : "销售金额、成本和扣款会先整理，确认后再形成月度结果"}`}
        actions={<><Button icon={CalendarDays} onClick={() => navigate("/ledger")}>月度账本</Button><Button variant="primary" icon={Warehouse} onClick={() => navigate(costMatchingHref)}>ERP 成本核对</Button><Button icon={Download} loading={exporting} disabled={exporting} onClick={exportProfit}>报告与导出</Button>{locked ? <Badge tone="success"><LockKeyhole size={13} />{snapshot.ledger.status === "locked" ? "已锁定" : "已定稿"}</Badge> : <Button icon={CheckCircle2} disabled={!canFinalize} onClick={finalizeLedger}>预览并定稿</Button>}</>}
      />

      {calculation.error ? <div role="alert" className="profit-refresh-status">读取失败：{calculation.error} 以下为上次结果，暂不能定稿。<Button onClick={() => setRetryCalculation(value => value + 1)}>重新读取</Button></div> : null}
      {calculation.loading ? <p className="profit-refresh-status" role="status">正在更新计算，当前显示上次结果；更新完成后才能定稿。</p> : null}
      <section className="profit-next-step" aria-label="本月下一步">
        <div><strong>{locked ? '本月已保存' : '本月下一步'}</strong><span>{nextStep.text}</span></div>
        {nextStep.action ? <Button disabled={Boolean(calculation.loading || calculation.error)} onClick={() => nextStep.key === 'cost' ? navigate(allMissingCostsHref) : finalizeLedger()}>{nextStep.action}</Button> : null}
      </section>
      <details className="profit-purpose-help"><summary>核算说明</summary><Panel className="profit-purpose-strip">
        <div className="profit-purpose-step"><span className="profit-purpose-index">1</span><div><strong>台账明细</strong><small>SKC · SKU · 属性 · 数量 · 金额</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">2</span><div><strong>ERP 采购成本</strong><small>人工更正优先 · ERP 原始成本 · 1688 仅参考</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">3</span><div><strong>月度利润表</strong><small>{legacySnapshot ? "金额 − 总采购成本 − 仓储成本 − 客退罚款" : "商品利润 + 代发金额 − 独立扣款"}</small></div></div>
        <div className="profit-purpose-formula mono">{legacySnapshot ? "利润" : "商品利润"} = 金额 − (数量 × 单件成本) − (数量 × {warehouseRate.toFixed(2)} 元){legacySnapshot ? " − 客退罚款" : ""}</div>
      </Panel></details>

      {!suppliedSnapshot ? <div className="profit-filter-bar">
        <label htmlFor="profit-store">查看店铺</label>
        <select id="profit-store" className="select-input" value={storeFilter} onChange={(event) => changeFilter({ storeFilter: event.target.value })}><option value="all">全部店铺</option>{stores.map((store) => <option value={store} key={store}>{store}</option>)}</select>
        <span>概览随筛选变化；定稿覆盖本月全部店铺。</span>
      </div> : null}
      <div className="profit-summary-strip">
        <div className="profit-summary-item"><span>销售金额</span><strong>{currency(filteredSummary.exactTotals?.revenue ?? revenue)}</strong><small>{totalUnits.toLocaleString("zh-CN")} 件</small></div>
        <div className="profit-summary-item"><span>{missing ? "已确认采购成本" : "总采购成本"}</span><strong>{missing > 0 && missing === filtered.length ? "待补成本" : currency(filteredSummary.exactTotals?.purchaseCost ?? purchaseCosts)}</strong><small>{missing ? "缺失成本未按零计算" : "按单件平均成本 × 数量"}</small></div>
        <button className="profit-summary-item profit-summary-action" disabled={locked} onClick={() => { setRateDraft(String(warehouseRate)); setRateDialog(true); }}><span>仓储成本</span><strong>{currency(filteredSummary.exactTotals?.warehouseCost ?? warehouseFees)}</strong><small>每件 {warehouseRate.toFixed(2)} 元 · 点击调整</small><Warehouse size={18} /></button>
        <div className="profit-summary-item"><span>{legacySnapshot ? "客退罚款" : "独立扣款"}</span><strong className={legacySnapshot && penalties > 0 ? "profit-negative" : ""}>{legacySnapshot ? currency(penalties) : "见本月报告"}</strong><small>{legacySnapshot ? "台账扣款汇总" : "按整月采用来源归集"}</small></div>
        <div className={`profit-summary-item profit-summary-total ${missing ? "is-pending" : ""}`}><span>{legacySnapshot ? "总利润" : "商品利润"}</span><strong>{missing ? "待确认成本" : currency(filteredSummary.exactTotals?.profit ?? matchedProfit)}</strong><small>{missing ? `${missing} 条店铺 SKU 尚未确认成本` : legacySnapshot ? "金额 − 采购 − 仓储 − 客退" : "金额 − 采购 − 仓储"}</small></div>
      </div>

      {missing && !locked ? <div className="profit-cost-alert" role="status"><AlertCircle size={18} /><span><strong>还有 {missing} 条店铺 SKU 待确认成本</strong><small>可以等待 ERP 回传，也可以直接填写人工成本。</small></span><Button variant="ghost" icon={Warehouse} onClick={() => navigate(costMatchingHref)}>查看成本候选</Button><Button variant="primary" onClick={openCostDetails}>填写人工成本</Button></div> : null}

      <details open={detailsOpen} onToggle={event => { const open = event.currentTarget.open; if (open !== detailsOpen) { setDetailsOpen(open); saveProfitViewState(detailsStateKey, { detailsOpen: open }); } }}><summary>查看利润明细与成本更正（{filtered.length} 条店铺 SKU）</summary>{detailsOpen ? <Panel className="profit-table-panel">
        <div className="profit-table-heading">
          <div><h2>月度利润明细</h2><p>每个 SKU 一行，SKC 用分组标识；金额和成本均为人民币 CNY。</p></div>
          <span className="profit-filter-count">当前 {groupedFiltered.length} 个 SKC · {filtered.length} 个 SKU</span>
        </div>
        <div className="profit-filter-bar">
          <SearchInput value={query} onChange={(event) => changeFilter({ query: event.target.value })} placeholder="搜索 SKC、SKU、属性、供方货号或店铺..." />
          <SupplierMultiSelect options={suppliers} selection={supplierSelection} onChange={(supplierSelection) => changeFilter({ supplierSelection })} />
          <label className="profit-filter-check"><input type="checkbox" checked={missingOnly} onChange={(event) => changeFilter({ missingOnly: event.target.checked })} />只看缺成本</label>
          <button className="profit-filter-reset" type="button" onClick={() => changeFilter({ query: "", storeFilter: "all", supplierSelection: null, missingOnly: false })}>重置筛选</button>
        </div>
        <ProfitGroups key={viewStateKey} stateKey={viewStateKey} groups={groupedFiltered} columns={columns} prepareRows={prepareProfitTableRows} />
      </Panel> : null}
      </details>

      {snapshot.ledger.status === "finalized" ? <Button icon={RotateCcw} onClick={() => { setReopenReason(""); setReopenError(""); setReopenDialog(true); }}>重开本月全部店铺核算</Button> : null}
      <Modal open={rateDialog} title="修改仓储费率" description="费率按每件售出商品计入当前月度账本；定稿后不能直接修改。" onClose={() => setRateDialog(false)} footer={<><Button onClick={() => setRateDialog(false)}>取消</Button><Button variant="primary" disabled={!rateDraft || Number(rateDraft) < 0} onClick={applyRate}>应用费率</Button></>}><div className="form-field"><label className="required">每件仓储费率（CNY）</label><input className="text-input mono" type="number" inputMode="decimal" min="0" step="0.01" value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} /></div></Modal>
      {manualTarget ? <ManualCostDialog ledger={snapshot.ledger} row={manualTarget} onClose={() => setManualTarget(null)} /> : null}
      <Modal open={reopenDialog} title="确认重开本月全部店铺" description="重开后可更正成本并重新定稿。原报告和核对记录保留，已采用 ERP 成本继续有效。" onClose={() => { if (!reopening) setReopenDialog(false); }} footer={<><Button disabled={reopening} onClick={() => setReopenDialog(false)}>取消</Button><Button variant="primary" disabled={!reopenReason.trim() || reopening} loading={reopening} onClick={reopenLedger}>确认重开</Button></>}>
        <div className="form-field"><label htmlFor="profit-reopen-reason">重开原因</label><input id="profit-reopen-reason" className="text-input" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} /></div>
        {reopenError ? <p role="alert">{reopenError}</p> : null}
      </Modal>
    </>
  );
}

export function ProfitViewsContent() {
  const [readiness, setReadiness] = useState(null);
  const [retry, setRetry] = useState(0);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const snapshot = useLatestSalesImport(params.get("ledger"), undefined, retry);
  const view = readProfitView(params);
  const filter = readProfitFilter(params, snapshot?.ledger?.id);
  const store = filter.storeFilter;
  const stores = [...new Set((snapshot?.rows ?? []).map((row) => row.store))];
  const valid = snapshot?.ledger && (store === "all" || stores.includes(store));
  const change = (nextView, nextStore = store) => {
    const next = buildProfitQuery({ ledgerId: snapshot.ledger.id, ...filter, storeFilter: nextStore, view: nextView });
    next.set("store", nextStore);
    next.set("missing", filter.missingOnly ? "1" : "0");
    setParams(next);
  };
  const openAllMissingCosts = () => setParams(buildProfitQuery({ ledgerId: snapshot.ledger.id, view: 'cost', storeFilter: 'all', missingOnly: true }));
  return <>
    {!view ? <Panel><p role="alert">利润视图无效，请使用明细或成本核对。</p><Button onClick={() => { const next = new URLSearchParams(params); next.set('view', 'detail'); setParams(next); }}>查看利润明细</Button></Panel> : snapshot === undefined ? <Panel role="status">正在读取月度账本...</Panel> : snapshot?.error ? <Panel><p role="alert">账本读取失败：{snapshot.error}</p><Button onClick={() => setRetry(value => value + 1)}>重新读取</Button></Panel> : !valid ? <Panel><p role="alert">没有可用的账本或店铺，请从月度账本重新进入。</p>{snapshot?.ledger ? <Button onClick={() => { const next = new URLSearchParams(params); next.set("store", "all"); setParams(next); }}>查看全部店铺</Button> : <Button onClick={() => navigate('/ledger')}>选择账本</Button>}</Panel> : <>
      <nav className="profit-view-tabs" aria-label="利润核算视图"><Button aria-current={view === "detail" ? "page" : undefined} onClick={() => change("detail")}>利润明细</Button><Button aria-current={view === "cost" ? "page" : undefined} onClick={() => change("cost")}>成本核对</Button><label>店铺 <select className="select-input" value={store} onChange={(event) => change(view, event.target.value)}><option value="all">全部店铺</option>{stores.map((name) => <option key={name}>{name}</option>)}</select></label></nav>
      {view === "cost" ? <div className="cost-page"><CostMatchingContent key={`${snapshot.ledger.workspaceId}/${snapshot.ledger.id}/${store}`} validatedContext={{ workspaceId: snapshot.ledger.workspaceId, ledgerId: snapshot.ledger.id, store }} onPublished={() => change("detail")} /></div> : <><ProfitWorkspaceContent suppliedSnapshot={snapshot} onReadiness={setReadiness} key={`profit/${snapshot.ledger.workspaceId}/${snapshot.ledger.id}/${store}`} /><MonthlyReportManager key={`report/${snapshot.ledger.workspaceId}/${snapshot.ledger.id}`} ledgerId={snapshot.ledger.id} missingCostCount={readiness?.ledgerId === snapshot.ledger.id ? readiness.missingCount : null} onOpenCosts={openAllMissingCosts} /></>}
    </>}
  </>;
}

export default function ProfitPanel() {
  return <AppShell pageClass="profit-page"><ProfitViewsContent /></AppShell>;
}
