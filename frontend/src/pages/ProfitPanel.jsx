import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronDown, Download, LockKeyhole, Plus, RotateCcw, Warehouse } from "lucide-react";
import AppShell from "../components/AppShell";
import DataTable from "../components/DataTable";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, SearchInput, useToast } from "../components/UI";
import {
  finalizeMonthlyLedger,
  revokeApproved1688Fallback,
  saveApproved1688Fallback,
  updateLedgerWarehouseRate,
} from "../data/database";
import { resolveFormalCostDecision } from "../domain/costPolicy";
import { canonicalPlatformSku } from "../domain/identifiers";
import { calculateExactProfitLine, calculateReferenceProfitLine, PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { useLatestSalesImport } from "../hooks/useLatestSalesImport";
import { sumMoney } from "../lib/money";
import { groupImportedSales, groupProfitRowsBySkc } from "../lib/profit";
import { exportWorkbook } from "../lib/spreadsheetExport";
import { buildCostMatchingHref, filterProfitRows, readProfitFilter, saveProfitFilter } from "../lib/profitFilter";

const currency = (value) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });

const ledgerStatusLabels = {
  draft: "草稿",
  cost_pending: "待补 ERP 成本",
  approval_pending: "待人工审批",
  ready: "可定稿",
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

function summarizeProfitRows(rows, costBySku) {
  const missingSkuKeys = new Set(rows.filter((row) => !row.finalizable).map((row) => row.canonicalPlatformSku));
  const formalRows = rows.filter((row) => row.finalizable);
  return {
    revenue: sumMoney(rows.map((row) => row.revenue)),
    totalUnits: rows.reduce((sum, row) => sum + row.qty, 0),
    purchaseCosts: sumMoney(formalRows.map((row) => row.purchaseCost)),
    warehouseFees: sumMoney(rows.map((row) => row.warehouseCost)),
    penalties: sumMoney(rows.map((row) => row.penalty)),
    matchedProfit: sumMoney(formalRows.map((row) => row.profit)),
    missing: missingSkuKeys.size,
    missingErp: new Set(rows
      .filter((row) => !costBySku.has(row.canonicalPlatformSku))
      .map((row) => row.canonicalPlatformSku)).size,
  };
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

export default function ProfitPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify } = useToast();
  const requestedLedgerId = searchParams.get("ledger");
  const filterSearchKey = searchParams.toString();
  const initialFilterRef = useRef(null);
  if (initialFilterRef.current === null) initialFilterRef.current = readProfitFilter(searchParams, requestedLedgerId);
  const initialFilter = initialFilterRef.current;
  const snapshot = useLatestSalesImport(requestedLedgerId);
  const [query, setQuery] = useState(initialFilter.query);
  const [storeFilter, setStoreFilter] = useState(initialFilter.storeFilter);
  const [supplierSelection, setSupplierSelection] = useState(initialFilter.supplierSelection);
  const [missingOnly, setMissingOnly] = useState(initialFilter.missingOnly);
  const [warehouseRate, setWarehouseRate] = useState(0.7);
  const [rateDraft, setRateDraft] = useState("0.7");
  const [rateDialog, setRateDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [approvalTarget, setApprovalTarget] = useState(null);
  const [approvalAmount, setApprovalAmount] = useState("");
  const [approvalSource, setApprovalSource] = useState("");
  const [approvalActor, setApprovalActor] = useState("本地复核人");
  const [approvalReason, setApprovalReason] = useState("");
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

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

  const sourceRows = useMemo(() => snapshot?.rows ? groupImportedSales(snapshot.rows) : [], [snapshot]);
  const costBySku = useMemo(() => new Map((snapshot?.costs ?? []).map((cost) => [
    cost.canonicalPlatformSku ?? canonicalPlatformSku(cost.platformSku),
    cost,
  ])), [snapshot?.costs]);
  const approvalBySku = useMemo(() => {
    const latest = new Map();
    (snapshot?.approvals ?? [])
      .filter((approval) => approval.status === "approved")
      .toSorted((a, b) => String(a.approvedAt).localeCompare(String(b.approvedAt)))
      .forEach((approval) => latest.set(
        approval.canonicalPlatformSku ?? canonicalPlatformSku(approval.platformSku),
        approval,
      ));
    return latest;
  }, [snapshot?.approvals]);

  const calculated = useMemo(() => sourceRows.map((row) => {
    const erpCost = costBySku.get(row.canonicalPlatformSku);
    const approval = approvalBySku.get(row.canonicalPlatformSku) ?? null;
    const importedReference = Number(row.legacyImportedUnitCost) > 0 ? {
      id: `IMPORT-REF-${snapshot?.ledger?.id}-${row.canonicalPlatformSku}`,
      kind: "supplier_landed",
      platformSku: row.platformSku,
      unitCost: Number(row.legacyImportedUnitCost),
      currency: "CNY",
      source: "月度台账历史参考",
      orderNumber: row.order1688 ?? null,
    } : null;
    const reference1688Cost = approval?.referenceCost ?? importedReference;
    const costDecision = resolveFormalCostDecision({
      ledgerId: snapshot?.ledger?.id,
      platformSku: row.platformSku,
      erpCost: erpCost ? {
        id: erpCost.id,
        platformSku: erpCost.platformSku,
        unitCost: erpCost.unitCost,
        currency: erpCost.currency,
        resolutionStatus: erpCost.resolutionStatus,
        unresolvedAnomalyCount: erpCost.unresolvedAnomalyCount,
      } : null,
      reference1688Cost,
      approval,
    });
    const result = costDecision.source === "approved_1688"
      ? calculateReferenceProfitLine({
        revenue: row.revenue,
        quantity: row.qty,
        referenceCost: costDecision,
        warehouseRate,
        penalty: row.penalty,
      })
      : calculateExactProfitLine({
        revenue: row.revenue,
        quantity: row.qty,
        costDecision,
        warehouseRate,
        penalty: row.penalty,
      });

    return {
      ...row,
      ...result,
      costDecision,
      unitCost: costDecision.unitCost,
      costSource: costDecision.source,
      costSourceRecordId: costDecision.sourceRecordId,
      orderNumber: erpCost?.orderNumber ?? reference1688Cost?.orderNumber ?? null,
      warehouseSku: erpCost?.warehouseSku ?? null,
      approvalId: costDecision.approvalId,
      approval,
      reference1688Cost,
    };
  }), [approvalBySku, costBySku, snapshot?.ledger?.id, sourceRows, warehouseRate]);

  const stores = useMemo(() => [...new Set(calculated.map((row) => row.store).filter(Boolean))].toSorted(), [calculated]);
  const suppliers = useMemo(() => [...new Set(calculated.map((row) => row.supplierNumber).filter(Boolean))].toSorted(), [calculated]);
  const filterState = useMemo(() => ({ query, storeFilter, supplierSelection, missingOnly }), [missingOnly, query, storeFilter, supplierSelection]);
  const filtered = useMemo(() => filterProfitRows(calculated, filterState), [calculated, filterState]);
  const groupedFiltered = useMemo(() => groupProfitRowsBySkc(filtered), [filtered]);
  const tableRows = useMemo(() => prepareProfitTableRows(filtered), [filtered]);
  const filteredSummary = useMemo(() => summarizeProfitRows(filtered, costBySku), [costBySku, filtered]);
  const ledgerSummary = useMemo(() => summarizeProfitRows(calculated, costBySku), [calculated, costBySku]);
  const { revenue, totalUnits, purchaseCosts, warehouseFees, penalties, matchedProfit, missing, missingErp } = filteredSummary;
  const locked = ["finalized", "locked"].includes(snapshot?.ledger?.status);
  const canFinalize = Boolean(calculated.length) && ledgerSummary.missing === 0 && !locked;
  const costMatchingHref = useMemo(() => buildCostMatchingHref({ ledgerId: snapshot?.ledger?.id, ...filterState }), [filterState, snapshot?.ledger?.id]);

  const openApproval = useCallback((row) => {
    setApprovalTarget(row);
    setApprovalAmount(row.reference1688Cost?.unitCost ? String(row.reference1688Cost.unitCost) : "");
    setApprovalSource(row.reference1688Cost?.orderNumber ?? row.order1688 ?? "");
    setApprovalReason("");
  }, []);

  const approveFallback = async () => {
    if (!snapshot?.ledger || !approvalTarget) return;
    setApprovalSaving(true);
    try {
      await saveApproved1688Fallback({
        ledgerId: snapshot.ledger.id,
        platformSku: approvalTarget.platformSku,
        unitCost: approvalAmount,
        reason: approvalReason,
        approvedBy: approvalActor,
        referenceSource: approvalSource ? "1688 来源单号/说明" : "人工录入的 1688 落地参考",
        referenceOrderNumber: approvalSource,
      });
      notify(`${approvalTarget.platformSku} 已完成 1688 兜底成本审批，仅对 ${snapshot.ledger.period} 账本生效。`);
      setApprovalTarget(null);
      setApprovalAmount("");
      setApprovalSource("");
      setApprovalReason("");
    } catch (error) {
      notify(`审批失败：${error.message}`, "error");
    } finally {
      setApprovalSaving(false);
    }
  };

  const revokeFallback = async () => {
    if (!snapshot?.ledger || !revokeTarget?.approvalId) return;
    setRevoking(true);
    try {
      await revokeApproved1688Fallback({
        ledgerId: snapshot.ledger.id,
        approvalId: revokeTarget.approvalId,
        reason: revokeReason,
        revokedBy: approvalActor,
      });
      notify(`${revokeTarget.platformSku} 的 1688 兜底审批已撤销。`);
      setRevokeTarget(null);
      setRevokeReason("");
    } catch (error) {
      notify(`撤销失败：${error.message}`, "error");
    } finally {
      setRevoking(false);
    }
  };

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
      accessorKey: "qty",
      header: "数量",
      enableSorting: false,
      size: 78,
      meta: { headerStyle: { width: "78px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => <span className="mono table-number">{Number(getValue() ?? 0).toLocaleString("zh-CN")}</span>,
    },
    {
      accessorKey: "revenue",
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
      cell: ({ row }) => row.original.unitCost != null ? <span className={`mono table-number ${row.original.costSource === "erp" ? "profit-cost-formal" : "profit-cost-reference"}`}>{currency(row.original.unitCost)}{row.original.costSource === "approved_1688" ? <small>人工参考</small> : null}</span> : row.original.reference1688Cost?.unitCost != null ? <span className="mono table-number profit-cost-reference" title="1688 参考成本">{currency(row.original.reference1688Cost.unitCost)}<small>参考</small></span> : <Badge tone="danger"><AlertCircle size={12} />缺失</Badge>,
    },
    {
      accessorKey: "purchaseCost",
      header: "总采购成本",
      enableSorting: false,
      size: 118,
      meta: { headerStyle: { width: "118px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => getValue() != null ? <span className="mono table-number">{currency(getValue())}</span> : <span className="pending-text">待成本</span>,
    },
    {
      accessorKey: "warehouseCost",
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
      accessorKey: "profit",
      header: "总利润",
      enableSorting: false,
      size: 118,
      meta: { headerStyle: { width: "118px", textAlign: "right", justifyContent: "flex-end" }, cellStyle: { textAlign: "right" } },
      cell: ({ getValue }) => getValue() == null ? <span className="pending-text">待补成本</span> : <strong className={`mono table-number ${Number(getValue()) < 0 ? "profit-negative" : "profit-positive"}`}>{currency(getValue())}</strong>,
    },
    {
      id: "costStatus",
      header: "成本状态",
      enableSorting: false,
      size: 156,
      meta: { headerStyle: { width: "156px" } },
      cell: ({ row }) => {
        const item = row.original;
        if (item.costSource === "erp") return <Badge tone="success">ERP 正式成本</Badge>;
        if (item.costSource === "approved_1688") return <div className="profit-status-actions"><Badge tone="warning">人工参考，待 ERP</Badge>{!locked ? <button className="inline-link muted" onClick={() => { setRevokeTarget(item); setRevokeReason(""); }}>撤销</button> : null}</div>;
        return <div className="profit-status-actions"><Badge tone="danger">待补成本</Badge><button className="inline-link" onClick={() => navigate(costMatchingHref)}>去核对</button></div>;
      },
    },
  ], [costMatchingHref, locked]);

  const exportProfit = async () => {
    if (!snapshot?.ledger) return;
    setExporting(true);
    try {
      await exportWorkbook(filtered.map((row) => ({
        SKC: row.groupSkc,
        SKU: row.platformSku,
        属性: row.attribute,
        数量: row.qty,
        金额: row.revenue,
        "1688单号": row.orderNumber ?? "",
        成本口径: row.costSource === "erp" ? "ERP 正式成本" : row.costSource === "approved_1688" ? "人工参考，未计正式利润" : "待 ERP 成本",
        单件平均成本: row.unitCost ?? row.reference1688Cost?.unitCost ?? "缺失",
        "总件数*成本": row.purchaseCost ?? "缺失",
        仓储成本: row.warehouseCost,
        客退罚款: row.penalty,
        利润: row.profit ?? "未完成",
      })), `profit-${snapshot.ledger.period}-${snapshot.ledger.status}.xlsx`, "利润明细");
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

  const finalizeLedger = async () => {
    if (!snapshot?.ledger || !canFinalize) return;
    setFinalizing(true);
    try {
      await finalizeMonthlyLedger({
        ledgerId: snapshot.ledger.id,
        formulaVersion: PROFIT_FORMULA_VERSION,
        profitSummary: {
          revenue: ledgerSummary.revenue,
          quantity: ledgerSummary.totalUnits,
          purchaseCost: ledgerSummary.purchaseCosts,
          warehouseCost: ledgerSummary.warehouseFees,
          penalty: ledgerSummary.penalties,
          profit: ledgerSummary.matchedProfit,
          profitRate: ledgerSummary.revenue === 0 ? null : Number(((ledgerSummary.matchedProfit / ledgerSummary.revenue) * 100).toFixed(2)),
          missingSkuCount: 0,
        },
        profitLines: calculated.map((row) => ({
          platformSku: row.platformSku,
          canonicalPlatformSku: row.canonicalPlatformSku,
          platformSkc: row.platformSkc,
          groupSkc: row.groupSkc,
          supplierNumber: row.supplierNumber,
          store: row.store,
          attribute: row.attribute,
          quantity: row.qty,
          revenue: row.revenue,
          penalty: row.penalty,
          unitCost: row.unitCost,
          purchaseCost: row.purchaseCost,
          warehouseCost: row.warehouseCost,
          profit: row.profit,
          profitRate: row.profitRate,
          costSource: row.costSource,
          costSourceRecordId: row.costSourceRecordId,
          costApprovalId: row.approvalId,
          costPolicyVersion: row.costDecision.policyVersion,
          orderNumber: row.orderNumber,
          finalizable: row.finalizable,
          calculationMode: "exact",
        })),
      });
      notify(`${snapshot.ledger.period} 月度利润已定稿，并写入商品经营历史。`);
    } catch (error) {
      notify(`定稿失败：${error.message}`, "error");
    } finally {
      setFinalizing(false);
    }
  };

  if (snapshot === undefined) {
    return <AppShell pageClass="profit-page"><Panel className="route-loader">正在读取月度账本...</Panel></AppShell>;
  }

  if (!snapshot?.ledger || sourceRows.length === 0) {
    return (
      <AppShell pageClass="profit-page">
        <PageHeader title="利润核算面板" description="导入月度台账后，系统会按平台 SKC/SKU 建立精确利润核算。" />
        <Panel><EmptyState icon={CalendarDays} title="还没有可核算的月度台账" description="先导入 CSV/XLSX 台账，再复制平台 SKC 到 ERP 获取正式成本。" action={<Button variant="primary" icon={Plus} onClick={() => navigate("/import-preview")}>导入月度台账</Button>} /></Panel>
      </AppShell>
    );
  }

  return (
    <AppShell pageClass="profit-page">
      <PageHeader
        eyebrow={`月度利润核算 · ${snapshot.ledger.period}`}
        title="利润核算面板"
        description={`${ledgerStatusLabels[snapshot.ledger.status] ?? snapshot.ledger.status} · ${sourceRows.length} 条 SKU 明细 · 销售金额、采购成本、仓储成本和总利润一览`}
        actions={<><Button icon={CalendarDays} onClick={() => navigate("/ledger")}>月度账本</Button><Button variant="primary" icon={Warehouse} onClick={() => navigate(costMatchingHref)}>ERP 成本核对</Button><Button icon={Download} loading={exporting} disabled={exporting} onClick={exportProfit}>导出利润表</Button>{locked ? <Badge tone="success"><LockKeyhole size={13} />{snapshot.ledger.status === "locked" ? "已锁定" : "已定稿"}</Badge> : <Button icon={CheckCircle2} loading={finalizing} disabled={!canFinalize || finalizing} onClick={finalizeLedger}>定稿本月</Button>}</>}
      />

      <Panel className="profit-purpose-strip">
        <div className="profit-purpose-step"><span className="profit-purpose-index">1</span><div><strong>台账明细</strong><small>SKC · SKU · 属性 · 数量 · 金额</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">2</span><div><strong>ERP 采购成本</strong><small>ERP 正式口径 · 1688 仅参考</small></div></div>
        <span className="profit-purpose-arrow">→</span>
        <div className="profit-purpose-step"><span className="profit-purpose-index">3</span><div><strong>月度利润表</strong><small>金额 − 总采购成本 − 仓储成本 − 客退罚款</small></div></div>
        <div className="profit-purpose-formula mono">利润 = 金额 − (数量 × 单件成本) − (数量 × {warehouseRate.toFixed(2)} 元) − 客退罚款</div>
      </Panel>

      <div className="profit-summary-strip">
        <div className="profit-summary-item"><span>销售金额</span><strong>{currency(revenue)}</strong><small>{totalUnits.toLocaleString("zh-CN")} 件</small></div>
        <div className="profit-summary-item"><span>总采购成本</span><strong>{currency(purchaseCosts)}</strong><small>按单件平均成本 × 数量</small></div>
        <button className="profit-summary-item profit-summary-action" disabled={locked} onClick={() => { setRateDraft(String(warehouseRate)); setRateDialog(true); }}><span>仓储成本</span><strong>{currency(warehouseFees)}</strong><small>每件 {warehouseRate.toFixed(2)} 元 · 点击调整</small><Warehouse size={18} /></button>
        <div className="profit-summary-item"><span>客退罚款</span><strong className={penalties > 0 ? "profit-negative" : ""}>{currency(penalties)}</strong><small>台账扣款汇总</small></div>
        <div className={`profit-summary-item profit-summary-total ${missing ? "is-pending" : ""}`}><span>总利润</span><strong>{missing ? "待 ERP 成本" : currency(matchedProfit)}</strong><small>{missing ? `${missing} 个 SKU 尚未取得 ERP 正式成本` : "金额 − 采购 − 仓储 − 客退"}</small></div>
      </div>

      {missing ? <div className="profit-cost-alert" role="status"><AlertCircle size={18} /><span><strong>还有 {missing} 个平台 SKU 未完成 ERP 正式成本</strong><small>当前总利润暂不定稿；ERP 缺失 {missingErp} 个，人工确认和 1688 成本只作参考，不会写入正式利润。</small></span><Button variant="ghost" icon={Warehouse} onClick={() => navigate(costMatchingHref)}>进入 ERP 成本核对</Button></div> : null}

      <Panel className="profit-table-panel">
        <div className="profit-table-heading">
          <div><h2>月度利润明细</h2><p>每个 SKU 一行，SKC 用分组标识；金额和成本均为人民币 CNY。</p></div>
          <span className="profit-filter-count">当前 {groupedFiltered.length} 个 SKC · {filtered.length} 个 SKU</span>
        </div>
        <div className="profit-filter-bar">
          <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKC、SKU、属性、供方货号或店铺..." />
          <select className="select-input" value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="all">全部店铺</option>{stores.map((store) => <option value={store} key={store}>{store}</option>)}</select>
          <SupplierMultiSelect options={suppliers} selection={supplierSelection} onChange={setSupplierSelection} />
          <label className="profit-filter-check"><input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} />只看缺成本</label>
          <button className="profit-filter-reset" type="button" onClick={() => { setQuery(""); setStoreFilter("all"); setSupplierSelection(null); setMissingOnly(false); }}>重置筛选</button>
        </div>
        <DataTable className="profit-table" columns={columns} data={tableRows} getRowId={(row) => row.id} getRowProps={(row) => ({ className: `${row.groupStart ? "profit-group-start " : ""}${!row.finalizable ? "missing-profit-row" : ""}` })} />
      </Panel>

      <Modal open={rateDialog} title="修改仓储费率" description="费率按每件售出商品计入当前月度账本；定稿后不能直接修改。" onClose={() => setRateDialog(false)} footer={<><Button onClick={() => setRateDialog(false)}>取消</Button><Button variant="primary" disabled={!rateDraft || Number(rateDraft) < 0} onClick={applyRate}>应用费率</Button></>}><div className="form-field"><label className="required">每件仓储费率（CNY）</label><input className="text-input mono" type="number" inputMode="decimal" min="0" step="0.01" value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} /></div></Modal>
      <Modal
        open={Boolean(approvalTarget)}
        title="确认人工参考成本"
        description="仅在 ERP 无有效成本时使用，只对当前账本与平台 SKU 生效，且不会替代 ERP 正式利润口径。"
        onClose={() => !approvalSaving && setApprovalTarget(null)}
        footer={<><Button disabled={approvalSaving} onClick={() => setApprovalTarget(null)}>取消</Button><Button variant="primary" icon={CheckCircle2} loading={approvalSaving} disabled={approvalSaving || !(Number(approvalAmount) > 0) || !approvalActor.trim() || !approvalReason.trim()} onClick={approveFallback}>确认审批</Button></>}
      >
        <div className="approval-context">
          <span>账本 <strong className="mono">{snapshot.ledger.period}</strong></span>
          <span>平台 SKU <strong className="mono">{approvalTarget?.platformSku}</strong></span>
          <span>平台 SKC <strong className="mono">{approvalTarget?.groupSkc || "--"}</strong></span>
        </div>
        <div className="approval-form-grid">
          <div className="form-field"><label className="required">1688 参考单件成本（CNY）</label><input className="text-input mono" type="number" inputMode="decimal" min="0.01" step="0.01" value={approvalAmount} onChange={(event) => setApprovalAmount(event.target.value)} /></div>
          <div className="form-field"><label>1688 单号或来源说明</label><input className="text-input mono" value={approvalSource} onChange={(event) => setApprovalSource(event.target.value)} placeholder="例如：A-20260806-01" /></div>
          <div className="form-field"><label className="required">复核人</label><input className="text-input" value={approvalActor} onChange={(event) => setApprovalActor(event.target.value)} /></div>
          <div className="form-field approval-reason"><label className="required">审批原因</label><textarea className="text-input" rows="3" value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder="说明 ERP 缺失原因、参考成本核对依据及本月使用理由。" /></div>
        </div>
        <p className="modal-note">人工参考成本可用于核对和预估，但账本仍需 ERP 成本才能定稿；后续 ERP 成本始终具有更高优先级。</p>
      </Modal>
      <Modal
        open={Boolean(revokeTarget)}
        title="撤销 1688 兜底审批？"
        description="撤销后将移除该 SKU 的人工参考记录；无论是否保留参考，当前账本均需 ERP 成本才能定稿。"
        onClose={() => !revoking && setRevokeTarget(null)}
        footer={<><Button disabled={revoking} onClick={() => setRevokeTarget(null)}>取消</Button><Button variant="danger" icon={RotateCcw} loading={revoking} disabled={revoking || !revokeReason.trim() || !approvalActor.trim()} onClick={revokeFallback}>确认撤销</Button></>}
      >
        <div className="approval-context"><span>平台 SKU <strong className="mono">{revokeTarget?.platformSku}</strong></span><span>已审批成本 <strong className="mono">{revokeTarget?.unitCost != null ? currency(revokeTarget.unitCost) : "--"}</strong></span></div>
        <div className="approval-form-grid">
          <div className="form-field"><label className="required">操作人</label><input className="text-input" value={approvalActor} onChange={(event) => setApprovalActor(event.target.value)} /></div>
          <div className="form-field approval-reason"><label className="required">撤销原因</label><textarea className="text-input" rows="3" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder="说明为什么撤销本次成本审批。" /></div>
        </div>
      </Modal>
    </AppShell>
  );
}
