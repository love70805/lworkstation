import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, CalendarDays, Download, FileSpreadsheet, LockKeyhole, Plus, Trash2, TrendingUp } from "lucide-react";
import AppShell from "../components/AppShell";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, ProgressBar, SearchInput, useToast } from "../components/UI";
import { deleteMonthlyLedger, formatLedgerPeriod, listLedgerSummaries } from "../data/database";
import { filterMonthlyLedgers } from "../lib/ledgerFilter";
import { exportWorkbook } from "../lib/spreadsheetExport";
import { withCurrentLedgerResults } from "../data/repositories/ledgerOverviewRepository";
import { currentLedgerResult } from "../domain/ledgerWorkflow";

const money = (value) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });

const ledgerStateLabels = {
  draft: "草稿",
  cost_pending: "待核对成本",
  approval_pending: "待确认成本",
  ready: "待确认利润",
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
  const [refresh, setRefresh] = useState(0);
  const result = useLiveQuery(async () => {
    try { return { items: await withCurrentLedgerResults(await listLedgerSummaries()) }; }
    catch (error) { return { error: error.message }; }
  }, [refresh], null);
  const items = result?.items ?? [];
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => filterMonthlyLedgers(items, query, ledgerStateLabels), [items, query]);

  const currentYear = String(new Date().getFullYear());
  const yearLedgers = items.filter((item) => item.period.startsWith(currentYear));
  const yearQuantity = yearLedgers.reduce((total, item) => total + (item.summary?.quantity ?? 0), 0);
  const finalizedProfits = yearLedgers.map((item) => (item.currentResult ?? currentLedgerResult(item)).profit).filter((value) => value != null);
  const baseMonths = yearLedgers.filter(item => ['base', 'deduction_pending', 'legacy'].includes((item.currentResult ?? currentLedgerResult(item)).state)).length;
  const yearProfit = finalizedProfits.reduce((total, value) => total + value, 0);
  const pending = items.find((item) => !["finalized", "locked"].includes(item.status));

  const deleteLedger = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteMonthlyLedger(deleteTarget.id, "local-user");
      notify(`${formatLedgerPeriod(deleteTarget.period)}账本及关联明细已删除。`);
      setDeleteTarget(null);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setDeleting(false);
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
        当前利润: (ledger.currentResult ?? currentLedgerResult(ledger)).profit ?? "待核算",
        利润来源: (ledger.currentResult ?? currentLedgerResult(ledger)).label,
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
        description="每个自然月保存独立的销售数据、成本来源和利润结果，人工可以随时补充或修正。"
        actions={<><Button icon={Download} loading={exporting} disabled={exporting || items.length === 0} onClick={exportArchive}>导出归档</Button><Button variant="primary" icon={Plus} onClick={() => navigate("/import-preview")}>新建或导入账本</Button></>}
      />

      <div className="ledger-filter-bar">
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索月份或账本状态..." />
        <span className="ledger-filter-count">{!result ? '正在读取账本…' : result.error ? '读取失败' : `显示 ${filteredItems.length} / ${items.length} 个账本`}</span>
      </div>

      {result && !result.error ? <div className="ledger-stat-grid">
        <Panel className="ledger-stat"><CalendarDays size={18} /><span>已建立月份</span><strong>{items.length}</strong></Panel>
        <Panel className="ledger-stat"><TrendingUp size={18} /><span>{currentYear} 年已保存利润</span><strong>{finalizedProfits.length ? money(yearProfit) : "--"}</strong><small>{baseMonths ? `含 ${baseMonths} 个未扣款或历史定稿月份` : '采用各月当前财务报告'}</small></Panel>
        <Panel className="ledger-stat"><BarChart3 size={18} /><span>{currentYear} 年导入销量</span><strong>{yearQuantity.toLocaleString("zh-CN")}</strong></Panel>
        <Panel className="ledger-stat pending"><CalendarDays size={18} /><span>当前待处理</span><strong>{pending ? formatLedgerPeriod(pending.period) : "无"}</strong><small>{pending ? ledgerStateLabels[pending.status] : "所有账本均已处理"}</small></Panel>
      </div> : null}

      {!result ? <Panel><p role="status">正在读取月度账本与报告结果…</p></Panel> : result.error ? <Panel><p role="alert">账本读取失败：{result.error}</p><Button onClick={() => setRefresh(value => value + 1)}>重试</Button></Panel> : items.length === 0 ? (
        <Panel><EmptyState icon={FileSpreadsheet} title="还没有月度账本" description="导入第一个月度销售台账后，系统会保存来源批次并进入成本核对。" action={<Button variant="primary" icon={Plus} onClick={() => navigate("/import-preview")}>导入月度台账</Button>} /></Panel>
      ) : filteredItems.length === 0 ? (
        <Panel><EmptyState icon={FileSpreadsheet} title="没有匹配的月度账本" description="可按月份，例如“2026-08”，或账本状态搜索。" /></Panel>
      ) : (
        <div className="ledger-card-grid">
          {filteredItems.map((ledger) => {
            const progress = ledgerProgress(ledger);
            const locked = ledger.status === "locked";
            const finalized = ledger.status === "finalized";
            const current = ledger.currentResult ?? currentLedgerResult(ledger);
            return (
              <Panel className={`ledger-card ${locked ? "locked" : ""}`} key={ledger.id}>
                <div className="ledger-card-head">
                  <span className="month-tile">{Number(ledger.period.slice(5))}月</span>
                  <div><h2>{formatLedgerPeriod(ledger.period)}</h2><Badge tone={ledgerStateTones[ledger.status] ?? "neutral"}>{ledgerStateLabels[ledger.status] ?? ledger.status}</Badge></div>
                  <span className="ledger-card-head-actions">{locked ? <LockKeyhole size={17} title="已锁定" /> : null}<button aria-label={`删除 ${formatLedgerPeriod(ledger.period)} 账本`} title="删除账本" onClick={() => setDeleteTarget(ledger)}><Trash2 size={18} /></button></span>
                </div>
                <div className="ledger-metrics">
                  <span>销售金额 <strong className="mono">{money(ledger.summary?.revenue ?? 0)}</strong></span>
                  <span>总销量 <strong className="mono">{(ledger.summary?.quantity ?? 0).toLocaleString("zh-CN")}</strong></span>
                  <span>月度利润 <strong className="mono">{current.profit != null ? money(current.profit) : "待核算"}</strong></span>
                  <small>{current.label}{current.state === 'deduction_pending' ? ' · 当前金额为未扣款基础' : ''}</small>
                  {!finalized && !locked ? <ProgressBar value={progress} tone={progress === 100 ? "success" : "warning"} label={`成本确认进度 ${progress}%`} /> : null}
                </div>
                <div className="ledger-card-footer"><Button icon={locked ? LockKeyhole : BarChart3} onClick={() => navigate(`/profit?ledger=${encodeURIComponent(ledger.id)}`)}>{locked ? "查看归档" : finalized ? "查看本月" : "继续核算"}</Button></div>
              </Panel>
            );
          })}
        </div>
      )}

      <Modal size="small" open={Boolean(deleteTarget)} title="删除月度账本？" description="将删除该月份的销售明细、ERP 回传、成本批次、人工成本、利润结果和报告历史，其他月份不受影响。没有备份将无法恢复。" onClose={() => { if (!deleting) setDeleteTarget(null); }} footer={<><Button disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" loading={deleting} disabled={deleting} onClick={deleteLedger}>确认删除{deleteTarget ? formatLedgerPeriod(deleteTarget.period) : ""}</Button></>}><p className="modal-note">已定稿或已锁定也可以删除。备份不是必需步骤。<button className="inline-link" disabled={deleting} onClick={() => { setDeleteTarget(null); navigate("/data-security"); }}>先去备份中心</button></p></Modal>
    </AppShell>
  );
}
