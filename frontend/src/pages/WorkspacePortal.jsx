import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  CloudOff,
  Database,
  FileUp,
  History,
  Hourglass,
  Inbox,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  TriangleAlert,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Badge, Button, Panel, PageHeader, useToast } from "../components/UI";
import { db, getSelectionReferenceSnapshot, getWorkspaceOperationalSummary } from "../data/database";
import { describeAuditEvent } from "../domain/auditEvents";
import { resolveWorkspacePrimaryAction } from "../lib/workspaceActions";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";

const money = (value) => Number(value ?? 0).toLocaleString("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
});

const ledgerStatusLabels = {
  draft: "草稿",
  cost_pending: "待补 ERP 成本",
  approval_pending: "待审批",
  ready: "可定稿",
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

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex > 1 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatCompactMoney(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "--";
  if (Math.abs(amount) >= 10000) return `¥${(amount / 10000).toFixed(1)}万`;
  return `¥${Math.round(amount).toLocaleString("zh-CN")}`;
}

function formatPeriodLabel(period) {
  return period ? `${Number(String(period).slice(5))}月` : "--";
}

function TrendChart({ items, onOpenLedger }) {
  const width = 640;
  const height = 176;
  const padding = { top: 16, right: 14, bottom: 28, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = items.map((item) => Math.max(0, Number(item.summary?.revenue ?? 0)));
  const max = Math.max(...values, 1);
  const points = items.map((item, index) => ({
    x: padding.left + (items.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (items.length - 1)),
    y: padding.top + plotHeight - (values[index] / max) * plotHeight,
    value: values[index],
    label: formatPeriodLabel(item.period),
  }));
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = points.length > 0
    ? `${points[0].x},${padding.top + plotHeight} ${polyline} ${points.at(-1).x},${padding.top + plotHeight}`
    : "";

  if (items.length === 0) {
    return <div className="dashboard-chart-empty"><TrendingUp size={22} /><div><strong>还没有可展示的销售趋势</strong><span>导入第一份月度销售台账后，这里会按月份汇总销售额。</span></div><Button icon={FileUp} onClick={onOpenLedger}>管理账本</Button></div>;
  }

  return (
    <div className="dashboard-chart-wrap">
      <svg className="dashboard-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="月度销售额趋势图">
        <title>月度销售额趋势图</title>
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + plotHeight * ratio;
          return <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} /><text x={padding.left - 10} y={y + 4} textAnchor="end">{formatCompactMoney(max * (1 - ratio))}</text></g>;
        })}
        {area ? <polygon className="dashboard-chart-area" points={area} /> : null}
        {polyline ? <polyline className="dashboard-chart-line" points={polyline} /> : null}
        {points.map((point) => <g key={point.label}><circle className="dashboard-chart-point" cx={point.x} cy={point.y} r="4" /><text className="dashboard-chart-label" x={point.x} y={height - 10} textAnchor="middle">{point.label}</text></g>)}
      </svg>
      <div className="dashboard-chart-caption"><span><i className="chart-legend-dot" />销售金额</span><strong>{formatCompactMoney(values.at(-1))} <small>最近月份</small></strong></div>
    </div>
  );
}

export default function WorkspacePortal() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [healthChecked, setHealthChecked] = useState(false);
  const [storageStatus, setStorageStatus] = useState(null);
  const portalData = useLiveQuery(async () => {
    const [summary, auditEvents, ledgers, referenceSnapshot] = await Promise.all([
      getWorkspaceOperationalSummary(),
      db.auditEvents.orderBy("createdAt").reverse().limit(8).toArray(),
      db.ledgers.orderBy("period").reverse().limit(8).toArray(),
      getSelectionReferenceSnapshot(),
    ]);
    return {
      summary,
      auditEvents,
      ledgers: ledgers.toSorted((left, right) => String(left.period).localeCompare(String(right.period))),
      referenceRows: buildSelectionReferenceRows(referenceSnapshot),
    };
  }, [], null);

  const summary = portalData?.summary;
  const latestLedger = summary?.latestLedger ?? null;
  const latestOpenLedger = summary?.latestOpenLedger ?? null;
  const latestFinalizedLedger = summary?.latestFinalizedLedger ?? null;
  const latestSales = latestLedger?.summary ?? {};
  const recentActivities = (portalData?.auditEvents ?? []).map((event) => ({
    ...describeAuditEvent(event),
    id: event.id,
    time: formatRelativeTime(event.createdAt),
  }));
  const trendLedgers = portalData?.ledgers ?? [];
  const referenceRows = useMemo(() => (portalData?.referenceRows ?? [])
    .toSorted((left, right) => Number(right.recentRevenue ?? 0) - Number(left.recentRevenue ?? 0))
    .slice(0, 5), [portalData?.referenceRows]);
  const taskItems = useMemo(() => {
    const items = [];
    if ((summary?.blockedCaptureCount ?? 0) > 0) {
      items.push({ icon: TriangleAlert, tone: "danger", title: "采集存在阻断项", detail: `${summary.blockedCaptureCount} 条记录需要补齐资料`, action: "处理采集", path: "/products?view=pending" });
    } else if ((summary?.pendingCaptureCount ?? 0) > 0) {
      items.push({ icon: Hourglass, tone: "warning", title: "待确认采集", detail: `${summary.pendingCaptureCount} 条记录等待人工确认`, action: "打开队列", path: "/products?view=pending" });
    }
    if ((summary?.missingCostCount ?? 0) > 0 && latestOpenLedger) {
      items.push({ icon: Warehouse, tone: "warning", title: "ERP 成本待补齐", detail: `${latestOpenLedger.period} 账本缺少 ${summary.missingCostCount} 个 SKU 成本`, action: "进入核对", path: `/cost-matching?ledger=${encodeURIComponent(latestOpenLedger.id)}` });
    }
    if (latestOpenLedger?.status === "ready") {
      items.push({ icon: CircleDollarSign, tone: "success", title: "账本可以定稿", detail: `${latestOpenLedger.period} 正式成本已完整`, action: "打开账本", path: `/profit?ledger=${encodeURIComponent(latestOpenLedger.id)}` });
    }
    return items.slice(0, 3);
  }, [latestOpenLedger, summary?.blockedCaptureCount, summary?.missingCostCount, summary?.pendingCaptureCount]);

  const runHealthCheck = async () => {
    setCheckingHealth(true);
    setHealthChecked(false);
    try {
      const [, estimate] = await Promise.all([
        getWorkspaceOperationalSummary(),
        navigator.storage?.estimate?.() ?? Promise.resolve(null),
      ]);
      setStorageStatus(estimate);
      setHealthChecked(true);
    } catch (error) {
      notify(`自检失败：${error.message}`, "error");
    } finally {
      setCheckingHealth(false);
    }
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
  } else if ((summary?.missingCostCount ?? 0) > 0 && latestOpenLedger) {
    alert = {
      icon: TriangleAlert,
      text: `${latestOpenLedger.period} 账本仍有 ${summary.missingCostCount} 个平台 SKU 缺少正式成本。`,
      action: "进入 ERP 成本核对",
      path: `/cost-matching?ledger=${encodeURIComponent(latestOpenLedger.id)}`,
    };
  } else if (latestOpenLedger?.status === "ready") {
    alert = {
      icon: CircleDollarSign,
      text: `${latestOpenLedger.period} 账本的正式成本已经完整，可以执行最终复核。`,
      action: "打开利润核算",
      path: `/profit?ledger=${encodeURIComponent(latestOpenLedger.id)}`,
    };
  }

  // The contextual alert owns the blocking next step. The first quick action
  // deliberately points to the adjacent workflow so the home page never
  // presents two prominent controls that land on the same route.
  const primaryAction = resolveWorkspacePrimaryAction({ alertPath: alert?.path, latestOpenLedger });
  const PrimaryActionIcon = primaryAction.kind === "cost" ? Warehouse : primaryAction.kind === "profit" ? CircleDollarSign : FileUp;
  const AlertIcon = alert?.icon;

  return (
    <AppShell pageClass="workspace-page">
      <PageHeader
        title="经营概览"
        description="汇总本机工作区中的商品、采集、销售账本和精确利润状态。"
        actions={<Button icon={healthChecked ? Check : RefreshCw} loading={checkingHealth} disabled={checkingHealth} onClick={runHealthCheck}>{healthChecked ? "总览已刷新" : "刷新总览"}</Button>}
      />

      {!portalData ? <div className="workspace-load-state" role="status" aria-live="polite"><RefreshCw className="spin" size={16} />正在读取工作区总览...</div> : null}

      <div className="dashboard-metric-grid">
        <Panel className="dashboard-metric-card"><span className="overview-icon primary"><PackageCheck size={19} /></span><span><small>正式商品</small><strong>{summary?.productCount ?? 0}</strong><em>{summary?.platformSkuCount ?? 0} 个平台 SKU</em></span></Panel>
        <Panel className="dashboard-metric-card"><span className="overview-icon warning"><Hourglass size={19} /></span><span><small>待确认采集</small><strong>{summary?.pendingCaptureCount ?? 0}</strong><em>{summary?.blockedCaptureCount ?? 0} 条存在阻断项</em></span></Panel>
        <Panel className="dashboard-metric-card"><span className="overview-icon info"><ShoppingCart size={19} /></span><span><small>{latestLedger ? `${latestLedger.period} 销售额` : "最近月度销售额"}</small><strong>{money(latestSales.revenue ?? 0)}</strong><em>总销量 {Number(latestSales.quantity ?? 0).toLocaleString("zh-CN")} 件</em></span></Panel>
        <Panel className="dashboard-metric-card"><span className="overview-icon success"><CircleDollarSign size={19} /></span><span><small>最近定稿利润</small><strong>{latestFinalizedLedger?.profitSummary ? money(latestFinalizedLedger.profitSummary.profit) : "--"}</strong><em>{latestFinalizedLedger ? `${latestFinalizedLedger.period} · ${ledgerStatusLabels[latestFinalizedLedger.status]}` : "尚无已定稿账本"}</em></span></Panel>
      </div>

      {alert ? <div className="workspace-status-strip"><span className="workspace-status-icon"><AlertIcon size={18} /></span><span><strong>需要处理</strong><small>{alert.text}</small></span><Button variant="ghost" onClick={() => navigate(alert.path)}>{alert.action}<ChevronRight size={16} /></Button></div> : null}

      <div className="workspace-layout dashboard-layout">
        <div className="workspace-primary">
          <Panel className="dashboard-widget trend-widget">
            <div className="panel-header"><div className="panel-title"><TrendingUp size={19} /><h2>月度销售趋势</h2></div><button className="widget-more" aria-label="查看月度账本" title="查看月度账本" onClick={() => navigate("/ledger")}><ArrowUpRight size={18} /></button></div>
            <div className="widget-subtitle">按已导入月度台账汇总销售金额，利润定稿状态不会被改变。</div>
            <TrendChart items={trendLedgers} onOpenLedger={() => navigate("/ledger")} />
          </Panel>

          <Panel className="activity-panel dashboard-widget">
            <div className="panel-header">
              <div className="panel-title"><History size={19} /><h2>最近活动</h2></div>
              <span className="widget-count">{recentActivities.length} 条</span>
            </div>
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
          </Panel>
        </div>

        <aside className="workspace-secondary">
          <Panel className="dashboard-widget tasks-panel">
            <div className="panel-header"><div className="panel-title"><Inbox size={19} /><h2>当前待办</h2></div><span className="widget-count">{taskItems.length} 项</span></div>
            {taskItems.length > 0 ? <div className="task-list">{taskItems.map((item) => { const TaskIcon = item.icon; return <div className="task-item" key={item.path}><span className={`task-icon ${item.tone}`}><TaskIcon size={17} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><button onClick={() => navigate(item.path)}>{item.action}<ChevronRight size={15} /></button></div>; })}</div> : <div className="task-empty"><CircleDollarSign size={20} /><span>当前没有阻塞事项，工作区运行正常。</span></div>}
          </Panel>

          <Panel className="dashboard-widget reference-widget">
            <div className="panel-header"><div className="panel-title"><PackageSearch size={19} /><h2>商品成本观察</h2></div><button className="widget-more" aria-label="查看全部商品成本参考" title="查看全部商品成本参考" onClick={() => navigate("/products?view=reference")}><ArrowUpRight size={17} /></button></div>
            <div className="widget-subtitle">优先展示近三个月有经营记录的平台 SKU。</div>
            {referenceRows.length > 0 ? <div className="reference-mini-table"><div className="reference-mini-head"><span>平台 SKU</span><span>成本</span><span>利润</span></div>{referenceRows.map((row) => <button className="reference-mini-row" key={row.id} onClick={() => row.latestLedgerId ? navigate(`/profit?ledger=${encodeURIComponent(row.latestLedgerId)}`) : navigate("/products?view=reference")}><span><strong className="mono">{row.platformSku}</strong><small>{row.platformSkc || "未关联 SKC"}</small></span><span className="mono">{row.referenceUnitCost == null ? "--" : money(row.referenceUnitCost)}</span><span className={`mono ${row.latestProfit != null && row.latestProfit < 0 ? "danger-text" : "success-text"}`}>{row.latestProfit == null ? "--" : money(row.latestProfit)}</span></button>)}</div> : <div className="task-empty"><PackageSearch size={20} /><span>还没有可展示的商品成本参考。</span></div>}
          </Panel>

          <Panel className="health-panel dashboard-widget">
            <div className="panel-header">
              <div className="panel-title"><Activity size={19} /><h2>健康状态</h2></div>
              <span className="widget-count">本机</span>
            </div>
            <div className="health-row">
              <span className="health-icon success"><Database size={19} /></span>
              <span><strong>本机数据库</strong><small className="mono">IndexedDB · v{db.verno}</small></span>
              <span className="health-status"><Badge tone="success" dot>已连接</Badge><small className="mono">{summary ? `${summary.recordCount} 条记录` : "读取中"}</small></span>
            </div>
            <div className="health-row">
              <span className="health-icon warning"><CloudOff size={19} /></span>
              <span><strong>云端协作</strong><small>尚未配置共享数据库</small></span>
              <span className="health-status"><Badge tone="neutral" dot>未连接</Badge><small>{storageStatus ? `${formatBytes(storageStatus.usage)} / ${formatBytes(storageStatus.quota)}` : "当前仅本机"}</small></span>
            </div>
          </Panel>

          <Panel className="quick-panel dashboard-widget">
            <div className="panel-header">
              <div className="panel-title"><BarChart3 size={19} /><h2>快捷操作</h2></div>
            </div>
            <div className="quick-actions">
              <button onClick={() => navigate(primaryAction.path)}><PrimaryActionIcon size={21} /><span><strong>{primaryAction.title}</strong><small>{primaryAction.detail}</small></span><ArrowUpRight size={17} /></button>
              <button onClick={() => navigate("/products?view=reference")}><BarChart3 size={21} /><span><strong>查看选品参考</strong><small>{summary?.platformSkuCount ?? 0} 个平台 SKU 可分析</small></span><ArrowUpRight size={17} /></button>
              <button onClick={() => navigate("/ledger")}><CalendarDays size={21} /><span><strong>管理月度账本</strong><small>{summary?.openLedgerCount ?? 0} 个未完成 · {summary?.finalizedLedgerCount ?? 0} 个已定稿</small></span><ArrowUpRight size={17} /></button>
            </div>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}
