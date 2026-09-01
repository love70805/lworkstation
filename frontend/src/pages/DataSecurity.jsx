import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  DatabaseBackup,
  Download,
  FileCheck2,
  FileUp,
  HardDrive,
  History,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Badge, Button, Modal, PageHeader, Panel, ProgressBar, useToast } from "../components/UI";
import {
  clearLocalWorkspaceData,
  createWorkspaceBackupPayload,
  createWorkspaceCloudSeedPayload,
  DEFAULT_WORKSPACE_ID,
  db,
  getDataSecuritySnapshot,
  recordCloudSeedImportReceipt,
  recordWorkspaceBackupExport,
  restoreWorkspaceBackupPayload,
  restoreWorkspaceSyncRecoveryPayload,
} from "../data/database";
import { createCloudSeedProvider } from "../data/cloudSeedProvider";
import { createSyncProvider } from "../data/syncProvider";
import { runtimeConfig } from "../config/runtimeConfig";
import { validateCloudSeedPayload } from "../domain/cloudSeed";
import { validateWorkspaceBackupPayload } from "../domain/workspaceBackup";
import { replaySyncRecoveryPayload, validateSyncRecoveryPayload } from "../domain/syncRecovery";
import { downloadWorkspaceBackup } from "../lib/workspaceBackupDownload";

const ROLLBACK_BEFORE_RESTORE_KEY = "shopeers-rollback-before-restore";

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
    hour12: false,
  });
}

function describeSecurityEvent(event) {
  const metadata = event.after ?? {};
  if (event.action === "backup_exported") {
    return {
      tone: "success",
      label: "已导出备份",
      detail: metadata.fileName ?? event.objectId,
      recordCount: metadata.recordCount,
    };
  }
  if (event.action === "backup_restored") {
    return {
      tone: "info",
      label: "已恢复备份",
      detail: metadata.sourceGeneratedAt ? `备份生成于 ${formatDateTime(metadata.sourceGeneratedAt)}` : "已通过格式与 SKU 唯一性校验",
      recordCount: metadata.recordCount,
    };
  }
  if (event.action === "cloud_seed_exported") {
    return {
      tone: "info",
      label: "已导出云端种子包",
      detail: metadata.fileName ?? event.objectId,
      recordCount: metadata.recordCount,
    };
  }
  if (event.action === "cloud_seed_imported") {
    return {
      tone: "success",
      label: "云端种子包已导入",
      detail: `${metadata.fileName ?? event.objectId} · ${metadata.importVersion ?? "已确认"}`,
      recordCount: metadata.insertedCount,
    };
  }
  if (event.action === "sync_recovery_restored") {
    return {
      tone: "success",
      label: "已从云端恢复",
      detail: metadata.sourceCursor ? `同步版本 ${metadata.sourceCursor}` : "云端业务数据已恢复到本机",
      recordCount: metadata.recordCount,
    };
  }
  if (event.action === "workspace_reset") {
    return {
      tone: "warning",
      label: "已清空本机数据",
      detail: "已重新创建空白默认工作区",
      recordCount: 0,
    };
  }
  return {
    tone: "neutral",
    label: "数据安全操作",
    detail: event.action ?? "记录已更新",
    recordCount: null,
  };
}

export default function DataSecurity() {
  const { notify } = useToast();
  const restoreInputRef = useRef(null);
  const cloudSeedInputRef = useRef(null);
  const security = useLiveQuery(getDataSecuritySnapshot, [], null);
  const [storageEstimate, setStorageEstimate] = useState(null);
  const [rollbackBeforeRestore, setRollbackBeforeRestore] = useState(() => localStorage.getItem(ROLLBACK_BEFORE_RESTORE_KEY) !== "false");
  const [restoreCandidate, setRestoreCandidate] = useState(null);
  const [loadingRestoreFile, setLoadingRestoreFile] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [seedExporting, setSeedExporting] = useState(false);
  const [cloudSeedCandidate, setCloudSeedCandidate] = useState(null);
  const [cloudPreflight, setCloudPreflight] = useState(null);
  const [cloudPreflighting, setCloudPreflighting] = useState(false);
  const [cloudImportOpen, setCloudImportOpen] = useState(false);
  const [cloudImporting, setCloudImporting] = useState(false);
  const [cloudRecoveryCandidate, setCloudRecoveryCandidate] = useState(null);
  const [cloudRecoveryLoading, setCloudRecoveryLoading] = useState(false);
  const [cloudRecoveryOpen, setCloudRecoveryOpen] = useState(false);
  const [cloudRecovering, setCloudRecovering] = useState(false);
  const [cloudRecoveryText, setCloudRecoveryText] = useState("");
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerText, setDangerText] = useState("");
  const [clearing, setClearing] = useState(false);

  const usageBytes = Number(storageEstimate?.usage ?? 0);
  const quotaBytes = Number(storageEstimate?.quota ?? 0);
  const storagePercent = quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 100)) : 0;
  const events = security?.securityEvents ?? security?.backupEvents ?? [];
  const lastBackup = security?.lastBackup ?? null;
  const lastCloudSeed = security?.lastCloudSeed ?? null;
  const lastCloudImport = security?.lastCloudImport ?? null;

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

  const setRollbackPreference = (nextValue) => {
    setRollbackBeforeRestore(nextValue);
    localStorage.setItem(ROLLBACK_BEFORE_RESTORE_KEY, String(nextValue));
  };

  const exportBackup = async ({ prefix = "shopeers-backup", successMessage } = {}) => {
    setExporting(true);
    try {
      const payload = await createWorkspaceBackupPayload();
      const download = downloadWorkspaceBackup(payload, { prefix });
      await recordWorkspaceBackupExport({
        ...download,
        recordCount: payload.recordCount,
        generatedAt: payload.generatedAt,
      });
      await refreshStorageEstimate();
      notify(successMessage ?? `本机备份已导出：${download.fileName}。`, "success");
      return { payload, download };
    } catch (error) {
      notify(`备份导出失败：${error.message}`, "error");
      return null;
    } finally {
      setExporting(false);
    }
  };

  const exportCloudSeed = async () => {
    setSeedExporting(true);
    try {
      const payload = await createWorkspaceCloudSeedPayload();
      const download = downloadWorkspaceBackup(payload, { prefix: "shopeers-cloud-seed" });
      await recordWorkspaceBackupExport({
        ...download,
        recordCount: payload.recordCount,
        generatedAt: payload.generatedAt,
        exportKind: "cloud_seed",
      });
      notify(`云端种子包已生成：${download.fileName}。该文件尚未上传。`, "success");
      return { payload, download };
    } catch (error) {
      notify(`云端种子包导出失败：${error.message}`, "error");
      return null;
    } finally {
      setSeedExporting(false);
    }
  };

  const chooseRestoreFile = () => {
    restoreInputRef.current?.click();
  };

  const chooseCloudSeedFile = () => cloudSeedInputRef.current?.click();

  const readCloudSeedFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const inspection = validateCloudSeedPayload(payload);
      setCloudSeedCandidate({ fileName: file.name, fileSize: file.size, payload, inspection });
      setCloudPreflight(null);
      notify(`种子包本机校验通过，共 ${inspection.recordCount.toLocaleString("zh-CN")} 条业务记录。`, "success");
    } catch (error) {
      setCloudSeedCandidate(null);
      setCloudPreflight(null);
      notify(`无法使用该云端种子包：${error.message}`, "error");
    }
  };

  const preflightCloudSeed = async () => {
    if (!cloudSeedCandidate) return;
    if (!runtimeConfig.cloudConfigured) {
      notify("当前仍是本机模式，请先配置受控的云端 API。", "error");
      return;
    }
    setCloudPreflighting(true);
    try {
      const report = await createCloudSeedProvider().preflight(cloudSeedCandidate.payload);
      setCloudPreflight(report);
      notify(report.canImport ? "云端预检通过，尚未写入任何数据。" : `云端预检发现 ${report.conflictCount} 项冲突。`, report.canImport ? "success" : "error");
    } catch (error) {
      setCloudPreflight(null);
      notify(`云端预检失败：${error.message}`, "error");
    } finally {
      setCloudPreflighting(false);
    }
  };

  const importCloudSeed = async () => {
    if (!cloudSeedCandidate || !cloudPreflight?.canImport) return;
    setCloudImporting(true);
    try {
      const receipt = await createCloudSeedProvider().commit(cloudSeedCandidate.payload, cloudPreflight.preflightId);
      await recordCloudSeedImportReceipt({
        fileName: cloudSeedCandidate.fileName,
        preflight: cloudPreflight,
        receipt,
      });
      setCloudImportOpen(false);
      notify(receipt.idempotent ? "该种子包此前已经导入，云端未重复写入。" : `云端导入完成，新增 ${receipt.insertedCount.toLocaleString("zh-CN")} 条记录。`, "success");
    } catch (error) {
      notify(`云端导入失败：${error.message}`, "error");
    } finally {
      setCloudImporting(false);
    }
  };

  const prepareCloudRecovery = async () => {
    if (!runtimeConfig.cloudConfigured) {
      notify("当前仍是本机模式，请先配置受控的云端 API。", "error");
      return;
    }
    setCloudRecoveryLoading(true);
    try {
      const payload = await createSyncProvider().pullRecovery(DEFAULT_WORKSPACE_ID);
      const inspection = validateSyncRecoveryPayload(payload);
      const replay = replaySyncRecoveryPayload(payload);
      setCloudRecoveryCandidate({ payload, inspection, replay });
      setCloudRecoveryText("");
      setCloudRecoveryOpen(true);
      notify(`云端恢复包校验通过，共 ${replay.recordCount.toLocaleString("zh-CN")} 条记录。`, "success");
    } catch (error) {
      setCloudRecoveryCandidate(null);
      notify(`云端恢复包下载失败：${error.message}`, "error");
    } finally {
      setCloudRecoveryLoading(false);
    }
  };

  const restoreCloudRecovery = async () => {
    if (!cloudRecoveryCandidate || cloudRecoveryText !== "从云端恢复") return;
    setCloudRecovering(true);
    try {
      const currentPayload = await createWorkspaceBackupPayload();
      const rollbackDownload = downloadWorkspaceBackup(currentPayload, { prefix: "shopeers-before-cloud-recovery" });
      const receipt = await restoreWorkspaceSyncRecoveryPayload(cloudRecoveryCandidate.payload);
      await recordWorkspaceBackupExport({
        ...rollbackDownload,
        recordCount: currentPayload.recordCount,
        generatedAt: currentPayload.generatedAt,
      });
      await refreshStorageEstimate();
      setCloudRecoveryOpen(false);
      setCloudRecoveryCandidate(null);
      setCloudRecoveryText("");
      notify(`云端数据已恢复，共写入 ${receipt.recordCount.toLocaleString("zh-CN")} 条记录。`, "success");
    } catch (error) {
      notify(`云端恢复失败：${error.message}`, "error");
    } finally {
      setCloudRecovering(false);
    }
  };

  const readRestoreFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLoadingRestoreFile(true);
    try {
      const payload = JSON.parse(await file.text());
      const inspection = validateWorkspaceBackupPayload(payload, {
        tableNames: db.tables.map((table) => table.name),
      });
      setRestoreCandidate({
        fileName: file.name,
        fileSize: file.size,
        payload,
        inspection,
      });
    } catch (error) {
      notify(`无法使用该备份文件：${error.message}`, "error");
    } finally {
      setLoadingRestoreFile(false);
    }
  };

  const restoreBackup = async () => {
    if (!restoreCandidate) return;
    setRestoring(true);
    try {
      let rollback = null;
      if (rollbackBeforeRestore) {
        const currentPayload = await createWorkspaceBackupPayload();
        const download = downloadWorkspaceBackup(currentPayload, { prefix: "shopeers-before-restore" });
        rollback = {
          ...download,
          recordCount: currentPayload.recordCount,
          generatedAt: currentPayload.generatedAt,
        };
      }

      const inspection = await restoreWorkspaceBackupPayload(restoreCandidate.payload);
      if (rollback) await recordWorkspaceBackupExport(rollback);
      await refreshStorageEstimate();
      setRestoreCandidate(null);
      notify(`备份已恢复，共写入 ${inspection.recordCount.toLocaleString("zh-CN")} 条记录。`, "success");
    } catch (error) {
      notify(`备份恢复失败：${error.message}`, "error");
    } finally {
      setRestoring(false);
    }
  };

  const clearWorkspace = async () => {
    if (dangerText !== "清空本机数据") return;
    setClearing(true);
    try {
      await clearLocalWorkspaceData();
      await refreshStorageEstimate();
      setDangerOpen(false);
      setDangerText("");
      notify("本机业务数据已清空，并已创建空白默认工作区。", "success");
    } catch (error) {
      notify(`清空数据失败：${error.message}`, "error");
    } finally {
      setClearing(false);
    }
  };

  return (
    <AppShell pageClass="security-page">
      <PageHeader
        title="数据安全与备份"
        description="导出完整本机数据、校验恢复文件，并保留可追溯的操作记录。"
        actions={<Button variant="primary" icon={Download} loading={exporting} disabled={exporting} onClick={() => exportBackup()}>导出本机备份</Button>}
      />

      <div className="security-layout">
        <div className="security-main">
          <Panel className="safeguard-panel">
            <div className="section-heading"><h2><ShieldCheck size={20} />恢复保护</h2></div>
            <div className="setting-row">
              <div>
                <strong>恢复前下载当前回滚备份</strong>
                <p>恢复文件前先下载当前完整状态，便于需要时手动恢复。</p>
              </div>
              <button className={`toggle ${rollbackBeforeRestore ? "on" : ""}`} aria-label="恢复前下载回滚备份" aria-pressed={rollbackBeforeRestore} onClick={() => setRollbackPreference(!rollbackBeforeRestore)} />
            </div>
            <div className="setting-row">
              <div>
                <strong>恢复校验</strong>
                <p>仅接受 Lworkstation 本机 JSON 备份；恢复前会检查格式、数据表和平台 SKU 全局唯一性。</p>
              </div>
              <Badge tone="success"><CheckCircle2 size={14} />始终启用</Badge>
            </div>
          </Panel>

          <Panel className="snapshots-panel">
            <div className="panel-header">
              <div className="panel-title"><History size={20} /><h2>备份与恢复记录</h2></div>
              <div className="action-row">
                <Button variant="ghost" icon={RefreshCw} onClick={() => notify("备份与恢复记录已从本机数据库刷新。", "success")}>刷新</Button>
                <Button icon={FileUp} loading={loadingRestoreFile} disabled={loadingRestoreFile || restoring} onClick={chooseRestoreFile}>导入备份</Button>
              </div>
            </div>
            <input ref={restoreInputRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="选择 Lworkstation JSON 备份文件" onChange={readRestoreFile} />
            <div className="security-note">导出的文件保存在你选择的位置；浏览器不会在本机数据库中保存可直接恢复的文件副本。</div>
            <div className="table-wrap">
              <table className="data-table snapshot-table">
                <thead><tr><th>操作</th><th>本地时间</th><th>记录数</th><th>文件或来源</th></tr></thead>
                <tbody>
                  {events.map((event) => {
                    const item = describeSecurityEvent(event);
                    return <tr key={event.id}><td><Badge tone={item.tone}>{item.label}</Badge></td><td className="mono">{formatDateTime(event.createdAt)}</td><td className="mono">{item.recordCount == null ? "--" : item.recordCount.toLocaleString("zh-CN")}</td><td>{item.detail}</td></tr>;
                  })}
                </tbody>
              </table>
              {security && events.length === 0 ? <div className="security-empty">还没有备份或恢复记录。先导出一次本机备份，再保存在公司云盘或受控共享目录中。</div> : null}
            </div>
          </Panel>

          <Panel className="cloud-migration-panel">
            <div className="panel-header">
              <div className="panel-title"><CloudUpload size={20} /><h2>云端迁移与恢复</h2></div>
              <Badge tone={runtimeConfig.cloudConfigured ? "info" : "neutral"}>{runtimeConfig.cloudConfigured ? `已配置 ${runtimeConfig.syncProvider}` : "仅本机"}</Badge>
            </div>
            <p className="cloud-migration-copy">先在本机校验种子包，再发送云端预检。只有工作区、引用关系和唯一约束全部通过后，才允许确认事务导入。</p>
            <input ref={cloudSeedInputRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="选择 Lworkstation 云端种子包" onChange={readCloudSeedFile} />
            <div className="action-row cloud-migration-actions">
              <Button icon={FileCheck2} onClick={chooseCloudSeedFile}>选择并校验种子包</Button>
              <Button variant="primary" icon={CloudUpload} loading={cloudPreflighting} disabled={!cloudSeedCandidate || cloudPreflighting || !runtimeConfig.cloudConfigured} onClick={preflightCloudSeed}>发送云端预检</Button>
              {cloudPreflight?.canImport ? <Button variant="primary" disabled={cloudImporting} onClick={() => setCloudImportOpen(true)}>确认导入</Button> : null}
              <Button icon={CloudDownload} loading={cloudRecoveryLoading} disabled={cloudRecoveryLoading || !runtimeConfig.cloudConfigured} onClick={prepareCloudRecovery}>从云端恢复</Button>
            </div>
            {cloudSeedCandidate ? (
              <div className="restore-summary cloud-seed-summary">
                <span>文件 <strong>{cloudSeedCandidate.fileName}</strong></span>
                <span>工作区 <strong className="mono">{cloudSeedCandidate.inspection.workspaceId}</strong></span>
                <span>业务记录 <strong className="mono">{cloudSeedCandidate.inspection.recordCount.toLocaleString("zh-CN")}</strong></span>
                <span>文件大小 <strong className="mono">{formatBytes(cloudSeedCandidate.fileSize)}</strong></span>
              </div>
            ) : <div className="security-note">选择文件只会进行本机读取和校验，不会自动上传。</div>}
            {cloudPreflight ? (
              <div className={`cloud-preflight-result ${cloudPreflight.canImport ? "ready" : "blocked"}`}>
                <strong>{cloudPreflight.canImport ? "云端预检通过" : "云端预检未通过"}</strong>
                <span>新增 {cloudPreflight.insertCount.toLocaleString("zh-CN")} 条 · 已存在 {cloudPreflight.unchangedCount.toLocaleString("zh-CN")} 条 · 冲突 {cloudPreflight.conflictCount.toLocaleString("zh-CN")} 项</span>
                {cloudPreflight.conflicts?.length > 0 ? <small>{cloudPreflight.conflicts.slice(0, 3).map((item) => `${item.table}:${item.identity}`).join("；")}</small> : null}
              </div>
            ) : null}
            {lastCloudImport ? <small className="mono cloud-last-import">最近云端导入：{formatDateTime(lastCloudImport.importedAt)} · {lastCloudImport.importVersion}</small> : null}
          </Panel>
        </div>

        <aside className="security-side">
          <Panel className="manual-export">
            <span className="export-icon"><DatabaseBackup size={29} /></span>
            <h2>手动导出</h2>
            <p>生成包含商品、采集、供应商、ERP 成本、账本、利润与审计记录的 JSON 备份。</p>
            <Button variant="primary" icon={Download} loading={exporting} disabled={exporting} onClick={() => exportBackup()}>导出完整备份</Button>
            <Button icon={CloudUpload} loading={seedExporting} disabled={exporting || seedExporting} onClick={exportCloudSeed}>导出云端种子包</Button>
            <small>种子包仅含业务数据，不含本机设置与同步队列；生成后需由管理员导入云端。</small>
            <small className="mono">{lastBackup ? `最近备份：${formatDateTime(lastBackup.generatedAt)} · ${formatBytes(lastBackup.sizeBytes)}` : "尚未导出本机备份"}</small>
            <small className="mono">{lastCloudSeed ? `最近种子包：${formatDateTime(lastCloudSeed.generatedAt)} · ${formatBytes(lastCloudSeed.sizeBytes)}` : "尚未导出云端种子包"}</small>
          </Panel>
          <Panel className="storage-panel">
            <div className="panel-title"><HardDrive size={19} /><h2>浏览器存储</h2></div>
            <div className="storage-total"><span>已用 {formatBytes(usageBytes)}</span><span>{quotaBytes > 0 ? `配额 ${formatBytes(quotaBytes)}` : "配额未提供"}</span></div>
            <ProgressBar value={storagePercent} />
            <div className="storage-legend">
              <span><i className="active" />本机 IndexedDB <b className="mono">{security ? `${security.summary.recordCount.toLocaleString("zh-CN")} 条记录` : "读取中"}</b></span>
              <span><i />最近备份文件 <b className="mono">{lastBackup ? formatBytes(lastBackup.sizeBytes) : "--"}</b></span>
            </div>
          </Panel>
        </aside>
      </div>

      <Panel className="danger-zone">
        <div className="danger-title"><AlertTriangle size={23} /><h2>危险操作</h2></div>
        <p>清空会删除当前浏览器中的正式商品、采集、供应商、账本、成本、利润和审计记录。已下载到文件系统的备份不会被删除。</p>
        <div className="danger-action">
          <div><strong>清空当前本机工作区</strong><span>操作后仅保留空白默认工作区，需从备份文件恢复才能找回数据。</span></div>
          <Button variant="danger" onClick={() => setDangerOpen(true)}>清空数据</Button>
        </div>
      </Panel>

      <Modal
        open={cloudRecoveryOpen}
        title="从云端恢复当前工作区"
        description="恢复会覆盖当前浏览器中的业务数据，并强制下载一份覆盖前回滚备份。"
        tone="danger"
        onClose={() => { if (!cloudRecovering) { setCloudRecoveryOpen(false); setCloudRecoveryText(""); } }}
        footer={<><Button disabled={cloudRecovering} onClick={() => { setCloudRecoveryOpen(false); setCloudRecoveryText(""); }}>取消</Button><Button variant="danger" loading={cloudRecovering} disabled={cloudRecovering || cloudRecoveryText !== "从云端恢复"} onClick={restoreCloudRecovery}>确认恢复</Button></>}
      >
        <div className="restore-summary">
          <span>工作区 <strong className="mono">{cloudRecoveryCandidate?.inspection.workspaceId}</strong></span>
          <span>同步版本 <strong className="mono">{cloudRecoveryCandidate?.inspection.cursor ?? "--"}</strong></span>
          <span>增量事件 <strong className="mono">{cloudRecoveryCandidate?.inspection.eventCount?.toLocaleString("zh-CN") ?? "--"}</strong></span>
          <span>待写入记录 <strong className="mono">{cloudRecoveryCandidate?.replay.recordCount?.toLocaleString("zh-CN") ?? "--"}</strong></span>
        </div>
        <div className="form-field"><label className="required" htmlFor="cloud-recovery-confirmation">确认文字</label><input id="cloud-recovery-confirmation" className="text-input mono" value={cloudRecoveryText} onChange={(event) => setCloudRecoveryText(event.target.value)} placeholder="从云端恢复" /></div>
      </Modal>

      <Modal
        open={cloudImportOpen}
        title="确认导入云端工作区"
        description="服务端将按预检结果执行整批事务写入；发生任何冲突或错误时不会部分写入。"
        onClose={() => !cloudImporting && setCloudImportOpen(false)}
        footer={<><Button disabled={cloudImporting} onClick={() => setCloudImportOpen(false)}>取消</Button><Button variant="primary" loading={cloudImporting} disabled={cloudImporting} onClick={importCloudSeed}>确认导入云端</Button></>}
      >
        <div className="restore-summary">
          <span>文件 <strong>{cloudSeedCandidate?.fileName}</strong></span>
          <span>工作区 <strong className="mono">{cloudPreflight?.workspaceId}</strong></span>
          <span>预计新增 <strong className="mono">{cloudPreflight?.insertCount?.toLocaleString("zh-CN") ?? "--"}</strong></span>
          <span>冲突 <strong className="mono">{cloudPreflight?.conflictCount?.toLocaleString("zh-CN") ?? "--"}</strong></span>
        </div>
        <p className="modal-note">点击确认后才会把该种子包发送到已配置的云端 API。</p>
      </Modal>

      <Modal
        open={Boolean(restoreCandidate)}
        title="恢复本机备份"
        description="恢复将覆盖当前浏览器中的全部工作区数据。"
        onClose={() => !restoring && setRestoreCandidate(null)}
        footer={<><Button disabled={restoring} onClick={() => setRestoreCandidate(null)}>取消</Button><Button variant="primary" loading={restoring} disabled={restoring} onClick={restoreBackup}>恢复备份</Button></>}
      >
        <div className="restore-summary">
          <span>备份文件 <strong>{restoreCandidate?.fileName}</strong></span>
          <span>文件大小 <strong className="mono">{formatBytes(restoreCandidate?.fileSize)}</strong></span>
          <span>备份生成时间 <strong>{formatDateTime(restoreCandidate?.inspection.generatedAt)}</strong></span>
          <span>待写入记录 <strong className="mono">{restoreCandidate?.inspection?.recordCount?.toLocaleString("zh-CN") ?? "--"}</strong></span>
        </div>
        <p className="modal-note">{rollbackBeforeRestore ? "恢复前会自动下载当前状态作为回滚备份。" : "恢复前回滚备份已关闭，当前状态不会自动下载。"}</p>
      </Modal>

      <Modal
        open={dangerOpen}
        title="清空当前本机工作区"
        description="此操作无法在应用内撤销。请输入“清空本机数据”以继续。"
        tone="danger"
        onClose={() => { if (!clearing) { setDangerOpen(false); setDangerText(""); } }}
        footer={<><Button disabled={clearing} onClick={() => { setDangerOpen(false); setDangerText(""); }}>取消</Button><Button variant="danger" loading={clearing} disabled={dangerText !== "清空本机数据" || clearing} onClick={clearWorkspace}>永久清空</Button></>}
      >
        <div className="form-field"><label className="required" htmlFor="clear-workspace-confirmation">确认文字</label><input id="clear-workspace-confirmation" className="text-input mono" value={dangerText} onChange={(event) => setDangerText(event.target.value)} placeholder="清空本机数据" /></div>
      </Modal>
    </AppShell>
  );
}
