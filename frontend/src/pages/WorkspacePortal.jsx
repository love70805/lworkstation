import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileUp,
  History,
  Hourglass,
  Inbox,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Button, Panel, PageHeader, useToast } from "../components/UI";
import { db, getActiveMemberContext, getSelectionReferenceSnapshot, getWorkspaceOperationalSummary } from "../data/database";
import { describeAuditEvent } from "../domain/auditEvents";
import { resolveWorkspacePrimaryAction } from "../lib/workspaceActions";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { useWorkspaceLedgerScope } from '../lib/useWorkspaceLedgerScope';
import WorkspaceLedgerControls from '../components/WorkspaceLedgerControls';
import SalesAnalytics from './SalesAnalytics';
import { withCurrentLedgerResults } from "../data/repositories/ledgerOverviewRepository";
import { currentLedgerResult, ledgerNextStep } from "../domain/ledgerWorkflow";
import { profitWorkspaceHref } from "../lib/workspaceNavigation";

const money = (value) => Number(value ?? 0).toLocaleString("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
});

const ledgerStatusLabels = {
  draft: "草稿",
  cost_pending: "待核对成本",
  approval_pending: "待确认成本",
  ready: "待确认利润",
  finalized: "已定稿",
  locked: "已锁定",
};

const activityToneLabels = {
  success: "已完成",
  warning: "需要检查",
  danger: "已删除",
  info: "信息",
};

function formatRelativeTime(value) {
  if (!value) return "--";
  const deltaMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, "minute");
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, "hour");
  return formatter.format(Math.round(deltaHours / 24), "day");
}

export default function WorkspacePortal() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const ledgerScope = useWorkspaceLedgerScope();
  const [refresh, setRefresh] = useState(0);
  const [healthChecked, setHealthChecked] = useState(false);
  const portalData = useLiveQuery(async () => {
    try {
    const { workspaceId } = await getActiveMemberContext();
    const [summary, auditEvents, referenceSnapshot] = await Promise.all([
      getWorkspaceOperationalSummary(),
      db.auditEvents.orderBy("createdAt").reverse().filter(event => event.workspaceId === workspaceId).limit(8).toArray(),
      getSelectionReferenceSnapshot(),
    ]);
    const ledgers = await withCurrentLedgerResults([summary.latestLedger, summary.latestOpenLedger, summary.latestFinalizedLedger].filter(Boolean));
    if ((await getActiveMemberContext()).workspaceId !== workspaceId) throw new Error('工作区已切换，请重新读取。');
    return {
      refresh,
      summary: { ...summary, ...Object.fromEntries(['latestLedger', 'latestOpenLedger', 'latestFinalizedLedger'].map(key => [key, ledgers.find(ledger => ledger.id === summary[key]?.id) ?? null])) },
      auditEvents,
      referenceRows: buildSelectionReferenceRows(referenceSnapshot),
    };
    } catch (error) { return { refresh, error: error.message }; }
  }, [refresh], null);
  const checkingHealth = Boolean(refresh && portalData?.refresh !== refresh);
  useEffect(() => {
    if (refresh && portalData?.refresh === refresh) setHealthChecked(!portalData.error);
  }, [portalData, refresh]);

  const summary = portalData?.summary;
  const latestLedger = summary?.latestLedger ?? null;
  const latestOpenLedger = summary?.latestOpenLedger ?? null;
  const missingLedger = summary?.latestMissingCostLedger ?? null;
  const latestFinalizedLedger = summary?.latestFinalizedLedger ?? null;
  const latestSales = latestLedger?.summary ?? {};
  const recentActivities = (portalData?.auditEvents ?? []).map((event) => ({
    ...describeAuditEvent(event),
    id: event.id,
    time: formatRelativeTime(event.createdAt),
  }));

  const referenceRows = useMemo(() => (portalData?.referenceRows ?? [])
    .toSorted((left, right) => Number(right.recentRevenue ?? 0) - Number(left.recentRevenue ?? 0))
    .slice(0, 5), [portalData?.referenceRows]);
  const workflowLedger = ledgerScope.context?.selected;
  const nextStep = ledgerNextStep(workflowLedger, { loading: !ledgerScope.ready });
  const workflowFrozen = ['finalized', 'locked'].includes(workflowLedger?.status);
  const workflowQuery = ledgerScope.context?.query ?? '';
  const workflowStep = !workflowLedger ? 0 : workflowFrozen ? 3 : nextStep.key === 'cost' ? 1 : 2;
  const workflowSteps = [
    { title: workflowFrozen ? "查看销售台账" : "导入销售台账", detail: workflowLedger ? "沿用当前账本月份" : "先建立月度账本", path: workflowFrozen ? `/ledger?${workflowQuery}` : `/import-preview?${workflowQuery}` },
    { title: workflowFrozen ? "查看成本" : "核对成本", detail: "ERP 默认，人工更正优先", path: workflowLedger ? profitWorkspaceHref(workflowQuery, 'cost') : "/import-preview" },
    { title: workflowFrozen ? "查看本月报告" : "保存本月报告", detail: workflowFrozen ? "下载原文件或补充扣款" : "登记代发，预览后保存", path: workflowLedger ? profitWorkspaceHref(workflowQuery, 'detail') : "/import-preview" },
  ];
  const taskItems = useMemo(() => {
    const items = [];
    if ((summary?.blockedCaptureCount ?? 0) > 0) {
      items.push({ icon: TriangleAlert, tone: "danger", title: "采集存在阻断项", detail: `${summary.blockedCaptureCount} 条记录需要补齐资料`, action: "处理采集", path: "/products?view=pending" });
    } else if ((summary?.pendingCaptureCount ?? 0) > 0) {
      items.push({ icon: Hourglass, tone: "warning", title: "待确认采集", detail: `${summary.pendingCaptureCount} 条记录等待人工确认`, action: "打开队列", path: "/products?view=pending" });
    }
    if (missingLedger) {
      items.push({ icon: Warehouse, tone: "warning", title: `${missingLedger.period} 成本待补`, detail: `本月 ${missingLedger.costSummary.missingCount} 条 SKU 待补成本`, action: "核对成本", path: `/cost-matching?ledger=${encodeURIComponent(missingLedger.id)}` });
    }
    if (latestOpenLedger?.status === "ready") {
      items.push({ icon: CircleDollarSign, tone: "success", title: "账本待确认利润", detail: `${latestOpenLedger.period} 成本已齐，等待人工核对`, action: "打开账本", path: `/profit?ledger=${encodeURIComponent(latestOpenLedger.id)}` });
    }
    return items.slice(0, 3);
  }, [latestOpenLedger, missingLedger, summary?.blockedCaptureCount, summary?.pendingCaptureCount]);

  const runHealthCheck = () => {
    setHealthChecked(false);
    setRefresh(value => value + 1);
    ledgerScope.retry();
  };

  let alert = null;
  if ((summary?.blockedCaptureCount ?? 0) > 0) {
    alert = {
      icon: TriangleAlert,
      text: `${summary.blockedCaptureCount} 条采集记录存在阻断项，确认入库前需要补齐资料。`,
      action: "处理采集问题",
      path: "/products?view=pending",
    };
  } else if ((summary?.pendingCaptureCount ?? 0) > 0) {
    alert = {
      icon: Hourglass,
      text: `${summary.pendingCaptureCount} 条采集记录等待人工确认。`,
      action: "打开待确认采集",
      path: "/products?view=pending",
    };
  } else if (missingLedger) {
    alert = {
      icon: TriangleAlert,
      text: `${missingLedger.period} 仍有 ${missingLedger.costSummary.missingCount} 条平台 SKU 待补成本。`,
      action: `查看 ${missingLedger.period} 成本`,
      path: `/cost-matching?ledger=${encodeURIComponent(missingLedger.id)}`,
    };
  } else if (latestOpenLedger?.status === "ready") {
    alert = {
      icon: CircleDollarSign,
      text: `${latestOpenLedger.period} 账本的成本已经齐全，可以执行人工核对。`,
      action: "打开利润核算",
      path: `/profit?ledger=${encodeURIComponent(latestOpenLedger.id)}`,
    };
  }

  // Cross-month tasks identify their own month; normal actions follow selection.
  const primaryAction = resolveWorkspacePrimaryAction({ selectedLedger: workflowLedger, query: workflowQuery });
  const PrimaryActionIcon = primaryAction.kind === "cost" ? Warehouse : primaryAction.kind === "profit" ? CircleDollarSign : FileUp;
  const AlertIcon = alert?.icon;

  return (
    <AppShell pageClass="workspace-page">
      <PageHeader
        title="经营概览"
        description="汇总本机工作区中的商品、采集、销售账本和精确利润状态。"
        actions={<Button icon={healthChecked ? Check : RefreshCw} loading={checkingHealth} disabled={checkingHealth} onClick={runHealthCheck}>{healthChecked ? "总览已刷新" : "刷新总览"}</Button>}
      />

      {!portalData || checkingHealth ? <div className="workspace-load-state" role="status" aria-live="polite"><RefreshCw className="spin" size={16} />正在读取工作区总览...</div> : null}
      {portalData?.error ? <div className="workspace-load-state" role="alert">总览读取失败：{portalData.error}<Button onClick={runHealthCheck}>重试</Button></div> : null}

      {summary ? <div className="dashboard-metric-grid">
        <Panel className="dashboard-metric-card"><span className="overview-icon primary"><PackageCheck size={19} /></span><span><small>正式商品</small><strong>{summary?.productCount ?? 0}</strong><em>{summary?.platformSkuCount ?? 0} 个平台 SKU</em></span></Panel>
        <Panel className="dashboard-metric-card"><span className="overview-icon warning"><Hourglass size={19} /></span><span><small>待确认采集</small><strong>{summary?.pendingCaptureCount ?? 0}</strong><em>{summary?.blockedCaptureCount ?? 0} 条存在阻断项</em></span></Panel>
        <Panel className="dashboard-metric-card"><span className="overview-icon info"><ShoppingCart size={19} /></span><span><small>{latestLedger ? `${latestLedger.period} 销售额` : "最近月度销售额"}</small><strong>{money(latestSales.revenue ?? 0)}</strong><em>总销量 {Number(latestSales.quantity ?? 0).toLocaleString("zh-CN")} 件</em></span></Panel>
        <Panel className="dashboard-metric-card"><span className="overview-icon success"><CircleDollarSign size={19} /></span><span><small>最近已保存利润</small><strong>{latestFinalizedLedger && (latestFinalizedLedger.currentResult ?? currentLedgerResult(latestFinalizedLedger)).profit != null ? money((latestFinalizedLedger.currentResult ?? currentLedgerResult(latestFinalizedLedger)).profit) : "--"}</strong><em>{latestFinalizedLedger ? `${latestFinalizedLedger.period} · ${(latestFinalizedLedger.currentResult ?? currentLedgerResult(latestFinalizedLedger)).label}` : "尚无已定稿账本"}</em></span></Panel>
      </div> : null}

      {alert ? <div className="workspace-status-strip"><span className="workspace-status-icon"><AlertIcon size={18} /></span><span><strong>需要处理</strong><small>{alert.text}</small></span><Button variant="ghost" onClick={() => navigate(alert.path)}>{alert.action}<ChevronRight size={16} /></Button></div> : null}

      <section className="workspace-flow" aria-labelledby="workspace-flow-title">
        <div className="workspace-flow-heading">
          <div><h2 id="workspace-flow-title">本月核算流程</h2><p>{ledgerScope.context?.error ? '请先重新选择有效账本。' : nextStep.text}</p></div>
          {workflowLedger ? <span className="workspace-flow-period mono">{workflowLedger.period}</span> : null}
        </div>
        <div className="workspace-flow-steps">
          {workflowSteps.map((step, index) => (
            <button disabled={!ledgerScope.ready || Boolean(ledgerScope.context?.error)} className={`workspace-flow-step ${index === workflowStep ? "active" : ""} ${index < workflowStep ? "done" : ""}`} key={step.title} onClick={() => navigate(step.path, { state: { importReturnTo: `/workspace?${workflowQuery}` } })} aria-current={index === workflowStep ? "step" : undefined}>
              <span className="workspace-flow-index">{index < workflowStep ? <Check size={14} /> : index + 1}</span>
              <span><strong>{step.title}</strong><small>{step.detail}</small></span>
              {index < workflowSteps.length - 1 ? <ChevronRight className="workspace-flow-arrow" size={16} /> : null}
            </button>
          ))}
        </div>
      </section>
      <WorkspaceLedgerControls scope={ledgerScope} onError={message => notify(`切换账本失败：${message}`, 'error')} />
      <div className="workspace-layout dashboard-layout">
        <div className="workspace-primary">
          <section className="workspace-daily-trend" aria-label="每日销售趋势">
            {ledgerScope.ready && ledgerScope.context?.selected ? <SalesAnalytics key={`${ledgerScope.context.workspaceId}:${ledgerScope.context.selected.id}:${ledgerScope.context.store}`} workspaceId={ledgerScope.context.workspaceId} ledgerId={ledgerScope.context.selected.id} store={ledgerScope.context.store} stores={ledgerScope.context.stores} /> : <Panel><h2>每日销售趋势</h2><div className="dashboard-chart-empty">{ledgerScope.ready ? '选择或导入月度账本后查看每日销售趋势。' : '正在读取账本范围…'}</div></Panel>}
          </section>

          <details className="activity-panel dashboard-widget workspace-disclosure">
            <summary><span><History size={17} />最近活动</span><span className="widget-count">{recentActivities.length} 条</span></summary>
            <div className="activity-head"><span>状态</span><span>任务详情</span><span>时间</span></div>
            <div className="activity-list">
              {recentActivities.map((item) => (
                <div className="activity-row" key={item.id}>
                  <span className={`activity-dot dot-${item.tone}`} title={activityToneLabels[item.tone]} />
                  <span className={item.tone === "danger" ? "danger-text" : ""}>{item.title} <em>— {item.detail}</em></span>
                  <time className="mono">{item.time}</time>
                </div>
              ))}
              {portalData && recentActivities.length === 0 ? <div className="activity-empty">还没有审计活动，导入销售台账或创建商品后会显示在这里。</div> : null}
            </div>
          </details>
        </div>

        <aside className="workspace-secondary">
          <Panel className="dashboard-widget tasks-panel">
            <div className="panel-header"><div className="panel-title"><Inbox size={19} /><h2>当前待办</h2></div><span className="widget-count">{taskItems.length} 项</span></div>
            {!summary ? <div className="task-empty" role="status">{portalData?.error ? '待办读取失败，请重试总览。' : '正在读取工作区待办…'}</div> : taskItems.length > 0 ? <div className="task-list">{taskItems.map((item) => { const TaskIcon = item.icon; return <div className="task-item" key={item.path}><span className={`task-icon ${item.tone}`}><TaskIcon size={17} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><button onClick={() => navigate(item.path)}>{item.action}<ChevronRight size={15} /></button></div>; })}</div> : <div className="task-empty"><CircleDollarSign size={20} /><span>当前没有待办事项。</span></div>}
          </Panel>

          {referenceRows.length > 0 ? <details className="dashboard-widget reference-widget workspace-disclosure">
            <summary><span><PackageSearch size={17} />商品成本观察</span><span className="widget-count">{referenceRows.length} 项</span></summary>
            <div className="reference-mini-table"><div className="reference-mini-head"><span>平台 SKU</span><span>成本</span><span>利润</span></div>{referenceRows.map(row => <button className="reference-mini-row" key={row.id} onClick={() => row.latestLedgerId ? navigate(`/profit?ledger=${encodeURIComponent(row.latestLedgerId)}`) : navigate('/products?view=reference')}><span><strong className="mono">{row.platformSku}</strong><small>{row.platformSkc || '未关联 SKC'}</small></span><span className="mono">{row.referenceUnitCost == null ? '--' : money(row.referenceUnitCost)}</span><span className={row.latestProfit != null && row.latestProfit < 0 ? 'danger-text' : 'success-text'}>{row.latestProfit == null ? '--' : money(row.latestProfit)}</span></button>)}</div>
          </details> : null}

          <Panel className="quick-panel dashboard-widget">
            <div className="panel-header">
              <div className="panel-title"><BarChart3 size={19} /><h2>快捷操作</h2></div>
            </div>
            <div className="quick-actions">
              <button disabled={!ledgerScope.ready || Boolean(ledgerScope.context?.error)} onClick={() => navigate(primaryAction.path, { state: { importReturnTo: `/workspace?${workflowQuery}` } })}><PrimaryActionIcon size={21} /><span><strong>{primaryAction.title}</strong><small>{primaryAction.detail}</small></span><ArrowUpRight size={17} /></button>
              <button onClick={() => navigate("/products?view=reference")}><BarChart3 size={21} /><span><strong>查看选品参考</strong><small>{summary?.platformSkuCount ?? 0} 个平台 SKU 可分析</small></span><ArrowUpRight size={17} /></button>
              <button onClick={() => navigate("/ledger")}><CalendarDays size={21} /><span><strong>管理月度账本</strong><small>{summary?.openLedgerCount ?? 0} 个未完成 · {summary?.finalizedLedgerCount ?? 0} 个已定稿</small></span><ArrowUpRight size={17} /></button>
            </div>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}
