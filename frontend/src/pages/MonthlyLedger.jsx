import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, CalendarDays, Download, FileSpreadsheet, LockKeyhole, Plus, Trash2, TrendingUp } from "lucide-react";
import AppShell from "../components/AppShell";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, ProgressBar, SearchInput, useToast } from "../components/UI";
import { deleteMonthlyLedger, formatLedgerPeriod, listLedgerSummaries } from "../data/database";
import { filterMonthlyLedgers } from "../lib/ledgerFilter";
import { exportWorkbook } from "../lib/spreadsheetExport";

const money = (value) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });

const ledgerStateLabels = {
  draft: "草稿",
  cost_pending: "待补 ERP 成本",
  approval_pending: "待人工审批",
  ready: "可定稿",
  finalized: "已定稿",
  locked: "已锁定",
};

const ledgerStateTones = {
  draft: "neutral",
  cost_pending: "warning",
  approval_pending: "warning",
  ready: "success",
  finalized: "success",
  locked: "neutral",
};

function ledgerProgress(ledger) {
  const expected = ledger.costSummary?.expectedCount ?? ledger.summary?.skuLineCount ?? 0;
  const matched = ledger.costSummary?.formalMatchedCount ?? ledger.costSummary?.matchedCount ?? 0;
  return expected > 0 ? Math.round((matched / expected) * 100) : 0;
}

export default function MonthlyLedger() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const items = useLiveQuery(() => listLedgerSummaries(), [], []);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => filterMonthlyLedgers(items, query, ledgerStateLabels), [items, query]);

  const currentYear = String(new Date().getFullYear());
  const yearLedgers = items.filter((item) => item.period.startsWith(currentYear));
  const yearQuantity = yearLedgers.reduce((total, item) => total + (item.summary?.quantity ?? 0), 0);
  const finalizedProfits = yearLedgers.map((item) => item.profitSummary?.profit).filter((value) => value != null);
  const yearProfit = finalizedProfits.reduce((total, value) => total + value, 0);
  const pending = items.find((item) => !["finalized", "locked"].includes(item.status));

  const deleteLedger = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMonthlyLedger(deleteTarget.id);
      notify(`${formatLedgerPeriod(deleteTarget.period)}草稿及关联明细已删除。`);
      setDeleteTarget(null);
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const exportArchive = async () => {
    setExporting(true);
    try {
      await exportWorkbook(items.map((ledger) => ({
        月份: ledger.period,
        状态: ledgerStateLabels[ledger.status] ?? ledger.status,
        分组数: ledger.summary?.groupCount ?? 0,
        "SKU 明细数": ledger.summary?.skuLineCount ?? 0,
        销量: ledger.summary?.quantity ?? 0,
        销售金额: ledger.summary?.revenue ?? 0,
        扣款: ledger.summary?.penalty ?? 0,
        正式利润: ledger.profitSummary?.profit ?? "未定稿",
        更新时间: ledger.updatedAt,
      })), "shopeers-monthly-ledgers.xlsx", "月度账本");
      notify(`已导出 ${items.length} 个月度账本摘要。`);
    } catch (error) {
      notify(`导出失败：${error.message}`, "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell pageClass="ledger-page">
      <PageHeader
        title="月度账本"
        description="每个自然月保存独立的导入批次、ERP 成本、审批和利润结果。"
        actions={<><Button icon={Download} loading={exporting} disabled={exporting || items.length === 0} onClick={exportArchive}>导出归档</Button><Button variant="primary" icon={Plus} onClick={() => navigate("/import-preview")}>新建或导入账本</Button></>}
      />

      <div className="ledger-filter-bar">
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索月份或账本状态..." />
        <span className="ledger-filter-count">显示 {filteredItems.length} / {items.length} 个账本</span>
      </div>

      <div className="ledger-stat-grid">
        <Panel className="ledger-stat"><CalendarDays size={18} /><span>已建立月份</span><strong>{items.length}</strong></Panel>
        <Panel className="ledger-stat"><TrendingUp size={18} /><span>{currentYear} 年已定稿利润</span><strong>{finalizedProfits.length ? money(yearProfit) : "--"}</strong></Panel>
        <Panel className="ledger-stat"><BarChart3 size={18} /><span>{currentYear} 年导入销量</span><strong>{yearQuantity.toLocaleString("zh-CN")}</strong></Panel>
        <Panel className="ledger-stat pending"><CalendarDays size={18} /><span>当前待处理</span><strong>{pending ? formatLedgerPeriod(pending.period) : "无"}</strong><small>{pending ? ledgerStateLabels[pending.status] : "所有账本均已处理"}</small></Panel>
      </div>

      {items.length === 0 ? (
        <Panel><EmptyState icon={FileSpreadsheet} title="还没有月度账本" description="导入第一个月度销售台账后，系统会保存来源批次并进入 ERP 成本核对。" action={<Button variant="primary" icon={Plus} onClick={() => navigate("/import-preview")}>导入月度台账</Button>} /></Panel>
      ) : filteredItems.length === 0 ? (
        <Panel><EmptyState icon={FileSpreadsheet} title="没有匹配的月度账本" description="可按月份，例如“2026-08”，或账本状态搜索。" /></Panel>
      ) : (
        <div className="ledger-card-grid">
          {filteredItems.map((ledger) => {
            const progress = ledgerProgress(ledger);
            const locked = ledger.status === "locked";
            const finalized = ledger.status === "finalized";
            return (
              <Panel className={`ledger-card ${locked ? "locked" : ""}`} key={ledger.id}>
                <div className="ledger-card-head">
                  <span className="month-tile">{Number(ledger.period.slice(5))}月</span>
                  <div><h2>{formatLedgerPeriod(ledger.period)}</h2><Badge tone={ledgerStateTones[ledger.status] ?? "neutral"}>{ledgerStateLabels[ledger.status] ?? ledger.status}</Badge></div>
                  {locked ? <LockKeyhole size={17} /> : !finalized ? <button aria-label={`删除 ${formatLedgerPeriod(ledger.period)} 草稿`} title="删除草稿" onClick={() => setDeleteTarget(ledger)}><Trash2 size={18} /></button> : null}
                </div>
                <div className="ledger-metrics">
                  <span>销售金额 <strong className="mono">{money(ledger.summary?.revenue ?? 0)}</strong></span>
                  <span>总销量 <strong className="mono">{(ledger.summary?.quantity ?? 0).toLocaleString("zh-CN")}</strong></span>
                  <span>正式利润 <strong className="mono">{ledger.profitSummary?.profit != null ? money(ledger.profitSummary.profit) : "待核算"}</strong></span>
                  {!finalized && !locked ? <ProgressBar value={progress} tone={progress === 100 ? "success" : "warning"} label={`ERP 成本完整度 ${progress}%`} /> : null}
                </div>
                <div className="ledger-card-footer"><Button icon={locked ? LockKeyhole : BarChart3} onClick={() => navigate(`/profit?ledger=${encodeURIComponent(ledger.id)}`)}>{locked ? "查看归档" : finalized ? "查看本月" : "继续核算"}</Button></div>
              </Panel>
            );
          })}
        </div>
      )}

      <Modal open={Boolean(deleteTarget)} title="删除月度草稿？" description="将删除该月份的销售明细、成本批次和未完成审批，其他月份不受影响。" onClose={() => setDeleteTarget(null)} footer={<><Button onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" onClick={deleteLedger}>删除{deleteTarget ? formatLedgerPeriod(deleteTarget.period) : ""}</Button></>}><p className="modal-note">已定稿或已锁定账本不能通过此操作删除。</p></Modal>
    </AppShell>
  );
}
