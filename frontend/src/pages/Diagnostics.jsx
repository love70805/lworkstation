import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Activity, CloudOff, CloudUpload, Copy, Database, Download, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import AppShell from "../components/AppShell";
import ErpAssistantSetup from "../components/ErpAssistantSetup";
import SelectionCaptureSetup from "../components/SelectionCaptureSetup";
import { Badge, Button, Panel, PageHeader, useToast } from "../components/UI";
import { db, getDataSecuritySnapshot } from "../data/database";
import { getSyncStatusSnapshot } from "../data/syncOutbox";
import { runSyncOnce } from "../data/syncRunner";
import { createSyncProvider } from "../data/syncProvider";
import { DEFAULT_WORKSPACE_ID } from "../data/database";
import { getRuntimeConfigSummary, runtimeConfig } from "../config/runtimeConfig";
import { describeAuditEvent } from "../domain/auditEvents";
import { getRuntimeEnvironmentCopy, isDesktopRuntime } from "../lib/desktopRuntime";

const DESKTOP_RUNTIME = isDesktopRuntime();
const RUNTIME_COPY = getRuntimeEnvironmentCopy();
const APP_VERSION = RUNTIME_COPY.application;

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function localDateStamp(value) {
  const date = new Date(value ?? Date.now());
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function triggerDownload(fileName, content) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function Diagnostics() {
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useToast();
  const diagnostics = useLiveQuery(getDataSecuritySnapshot, [], null);
  const recentEvents = useLiveQuery(() => db.auditEvents.orderBy("createdAt").reverse().limit(20).toArray(), [], []);
  const syncStatus = useLiveQuery(getSyncStatusSnapshot, [], null);
  const [storageEstimate, setStorageEstimate] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncHealth, setSyncHealth] = useState(null);
  const [checkingSyncHealth, setCheckingSyncHealth] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);

  const refreshStorageEstimate = async () => {
    const estimate = await (navigator.storage?.estimate?.() ?? Promise.resolve(null));
    setStorageEstimate(estimate);
    return estimate;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const estimate = await (navigator.storage?.estimate?.() ?? Promise.resolve(null));
      if (active) setStorageEstimate(estimate);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (location.hash !== "#extensions") return;
    const frame = window.requestAnimationFrame(() => document.getElementById("extensions")?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  const usageBytes = Number(storageEstimate?.usage ?? 0);
  const quotaBytes = Number(storageEstimate?.quota ?? 0);
  const storagePercent = quotaBytes > 0 ? Math.round((usageBytes / quotaBytes) * 100) : null;
  const summary = diagnostics?.summary;
  const lastBackup = diagnostics?.lastBackup;
  const runtimeSummary = getRuntimeConfigSummary();

  const checkSyncHealth = async () => {
    if (!runtimeSummary.cloudConfigured) {
      setSyncHealth({ status: "skipped", reason: "local_only", backend: "local" });
      notify("当前为本机模式，无需检查云端服务。", "success");
      return;
    }
    setCheckingSyncHealth(true);
    try {
      const result = await createSyncProvider().health();
      setSyncHealth(result);
      notify(`同步服务可用：${result.backend ?? "远端"}。`, "success");
    } catch (error) {
      setSyncHealth({ status: "error", message: error.message });
      notify(`同步服务不可用：${error.message}`, "error");
    } finally {
      setCheckingSyncHealth(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [freshDiagnostics, freshStorage] = await Promise.all([getDataSecuritySnapshot(), refreshStorageEstimate()]);
      setLastCheckedAt(new Date().toISOString());
      notify(`本机检查完成：已读取 ${freshDiagnostics.summary.recordCount.toLocaleString("zh-CN")} 条记录${freshStorage?.usage ? `，占用 ${formatBytes(freshStorage.usage)}` : ""}。`, "success");
    } catch (error) {
      notify(`本机检查失败：${error.message}`, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const syncNow = async () => {
    if (!runtimeSummary.cloudConfigured) {
      notify("尚未配置云端同步端点，当前仍保持本机模式。", "error");
      return;
    }
    setSyncing(true);
    try {
      const result = await runSyncOnce({ workspaceId: DEFAULT_WORKSPACE_ID });
      if (result.status === "synced") {
        notify(`云端同步完成：已上传 ${result.eventCount} 条审计事件。`, "success");
      } else if (result.status === "idle") {
        notify("没有待上传的审计事件。", "success");
      } else {
        notify(`云端同步未完成：${result.error ?? "请检查同步服务"}`, "error");
      }
    } catch (error) {
      notify(`云端同步失败：${error.message}`, "error");
    } finally {
      setSyncing(false);
    }
  };

  const copySummary = async () => {
    const text = [
      `Lworkstation ${APP_VERSION}`,
      `环境：${RUNTIME_COPY.environment}`,
      `记录：${summary?.recordCount ?? "读取中"}`,
      `本机存储：${quotaBytes > 0 ? `${formatBytes(usageBytes)} / ${formatBytes(quotaBytes)}` : "当前环境未提供配额"}`,
      `最近备份：${lastBackup ? formatDateTime(lastBackup.generatedAt) : "尚未导出"}`,
      `云端协作：${runtimeSummary.cloudConfigured ? runtimeConfig.syncProvider : "未配置"}`,
      `待上传审计：${syncStatus?.retryableCount ?? "读取中"}`,
    ].join(" | ");
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制脱敏诊断摘要。", "success");
    } catch {
      notify("当前环境未授权写入剪贴板，请稍后重试。", "error");
    }
  };

  const exportReport = () => {
    const generatedAt = new Date().toISOString();
    const report = {
      format: "shopeers-local-diagnostics",
      formatVersion: 1,
      applicationVersion: APP_VERSION,
      generatedAt,
      environment: "local-indexeddb",
      recordCount: summary?.recordCount ?? null,
      storage: {
        usageBytes,
        quotaBytes: quotaBytes || null,
      },
      lastBackup: lastBackup ? {
        generatedAt: lastBackup.generatedAt,
        recordCount: lastBackup.recordCount,
        sizeBytes: lastBackup.sizeBytes,
      } : null,
      sync: syncStatus ? {
        provider: runtimeConfig.syncProvider,
        cloudConfigured: runtimeSummary.cloudConfigured,
        pendingCount: syncStatus.pendingCount,
        inFlightCount: syncStatus.inFlightCount,
        failedCount: syncStatus.failedCount,
        syncedCount: syncStatus.syncedCount,
      } : null,
      recentActions: recentEvents.map((event) => ({
        createdAt: event.createdAt,
        objectType: event.objectType,
        action: event.action,
      })),
    };
    const fileName = `shopeers-diagnostics-${localDateStamp(generatedAt)}.json`;
    triggerDownload(fileName, JSON.stringify(report, null, 2));
    notify(`诊断摘要已导出：${fileName}。`, "success");
  };

  return (
    <AppShell pageClass="diagnostics-page">
      <PageHeader
        title="系统诊断"
        description={RUNTIME_COPY.diagnosticsDescription}
        actions={<Button icon={RefreshCw} loading={refreshing} disabled={refreshing} onClick={refresh}>刷新状态</Button>}
      />

      <div className="diagnostic-meta"><span>应用 <strong className="mono">{APP_VERSION}</strong></span><span>环境 <strong className="mono">{RUNTIME_COPY.environment}</strong></span><span>云端协作 <strong className="mono">{runtimeSummary.cloudConfigured ? runtimeConfig.syncProvider : "未配置"}</strong></span><span>上次检查 <strong className="mono">{lastCheckedAt ? formatDateTime(lastCheckedAt) : "未运行"}</strong></span></div>

      <div className="diagnostic-card-grid">
        <Panel className="diagnostic-card"><Database size={22} /><div><h2>本机数据库</h2><Badge tone={summary ? "success" : "neutral"}>{summary ? "可读取" : "读取中"}</Badge></div><strong className="mono">{summary ? `${summary.recordCount.toLocaleString("zh-CN")} 条` : "--"}</strong><p>{DESKTOP_RUNTIME ? "桌面工作站中的全部业务记录" : "当前浏览器中的全部业务记录"}</p><footer><span>模式：IndexedDB</span><span>{summary ? "已读取" : "等待数据"}</span></footer></Panel>
        <Panel className="diagnostic-card"><HardDrive size={22} /><div><h2>{DESKTOP_RUNTIME ? "桌面存储" : "浏览器存储"}</h2><Badge tone={quotaBytes > 0 ? "success" : "neutral"}>{quotaBytes > 0 ? "已估算" : "未提供配额"}</Badge></div><strong className="mono">{storagePercent == null ? formatBytes(usageBytes) : `${storagePercent}%`}</strong><p>{quotaBytes > 0 ? `${formatBytes(usageBytes)} / ${formatBytes(quotaBytes)}` : `已用 ${formatBytes(usageBytes)}`}</p><footer><span>来源：Storage API</span><span>本机</span></footer></Panel>
        <Panel className="diagnostic-card"><ShieldCheck size={22} /><div><h2>备份状态</h2><Badge tone={lastBackup ? "success" : "warning"}>{lastBackup ? "已导出" : "尚未导出"}</Badge></div><strong className="mono">{lastBackup ? `${lastBackup.recordCount.toLocaleString("zh-CN")} 条` : "--"}</strong><p>{lastBackup ? `最近导出：${formatDateTime(lastBackup.generatedAt)}` : "请先导出本机完整备份"}</p><footer><span>{lastBackup ? formatBytes(lastBackup.sizeBytes) : "无导出记录"}</span><button onClick={() => navigate("/data-security")}>打开备份中心</button></footer></Panel>
        <Panel className="diagnostic-card"><CloudOff size={22} /><div><h2>云端协作</h2><Badge tone={syncHealth?.status === "ok" ? "success" : runtimeSummary.cloudConfigured ? "info" : "neutral"}>{syncHealth?.status === "ok" ? "服务正常" : runtimeSummary.cloudConfigured ? "已配置" : "未配置"}</Badge></div><strong className="mono">{syncHealth?.backend ?? (runtimeSummary.cloudConfigured ? runtimeConfig.syncProvider : "仅本机")}</strong><p>{syncHealth?.status === "error" ? syncHealth.message : runtimeSummary.cloudConfigured ? "同步端点已配置，可上传本地审计 outbox" : "当前数据不会自动上传或与其他成员同步"}</p><footer><span>待上传审计：{syncStatus?.retryableCount ?? "读取中"}</span><span className="diagnostic-card-actions"><button className="diagnostic-sync-button" disabled={checkingSyncHealth} onClick={checkSyncHealth}><RefreshCw size={13} />{checkingSyncHealth ? "检查中" : "检查服务"}</button><button className="diagnostic-sync-button" disabled={syncing || !runtimeSummary.cloudConfigured || !(syncStatus?.retryableCount > 0)} onClick={syncNow}><CloudUpload size={13} />{syncing ? "同步中" : "立即同步"}</button></span></footer></Panel>
      </div>

      <section className="diagnostic-extension-section" id="extensions" aria-labelledby="diagnostic-extension-title">
        <div className="diagnostic-section-heading">
          <div><h2 id="diagnostic-extension-title">扩展与本机服务</h2><p>{DESKTOP_RUNTIME ? "桌面版扩展随应用内置；此处保留详细连接状态，不提供手工安装或扩展包下载。" : "检查浏览器扩展与本机收件服务；安装入口仍保留在对应业务页面。"}</p></div>
          <Badge tone={DESKTOP_RUNTIME ? "success" : "info"}>{DESKTOP_RUNTIME ? "桌面内置" : "浏览器扩展"}</Badge>
        </div>
        <div className="diagnostic-extension-grid">
          <div className="diagnostic-extension-group"><ErpAssistantSetup diagnostics /></div>
          <div className="diagnostic-extension-group"><div className="diagnostic-extension-group-heading"><strong>1688 采集扩展与收件服务</strong><small>状态检查不会改变待确认队列或选品数据。</small></div><SelectionCaptureSetup diagnostics /></div>
        </div>
      </section>

      <Panel className="trace-panel">
        <div className="panel-header">
          <div className="panel-title"><Activity size={20} /><h2>近期操作记录</h2><Badge>最近 20 条</Badge></div>
          <div className="action-row"><Button icon={Copy} onClick={copySummary}>复制摘要</Button><Button icon={Download} onClick={exportReport}>导出摘要</Button></div>
        </div>
        <div className="terminal-log">
          {recentEvents.map((event) => {
            const item = describeAuditEvent(event);
            const logTone = item.tone === "success" ? "info" : item.tone;
            return <div className="log-line" key={event.id}><span className="log-time">[{formatDateTime(event.createdAt)}]</span><strong className={`log-${logTone}`}>{item.title}</strong><span className="log-source">[{event.objectType ?? "workspace"}]</span><span>{item.detail}</span></div>;
          })}
          {recentEvents.length === 0 ? <p className="log-awaiting">暂无本机操作记录。导入销售台账、保存商品或导出备份后会显示在这里。</p> : null}
        </div>
      </Panel>

      <div className="diagnostic-links"><span>诊断与备份已整合到本模块</span><span>数据模式：<code>本机 IndexedDB</code></span><span>云端协作：<code>{syncHealth?.status === "ok" ? "服务正常" : runtimeSummary.cloudConfigured ? "已配置" : "未配置"}</code></span></div>
    </AppShell>
  );
}
