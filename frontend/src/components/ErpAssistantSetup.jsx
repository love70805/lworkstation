import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CircleHelp, Clipboard, Download, ExternalLink, FolderOpen, PlugZap, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge, Button, PageHeader, Panel, useToast } from "./UI";
import { isDesktopRuntime } from "../lib/desktopRuntime";
import { getErpExtensionStatus, getErpRequestHistory } from "../lib/erpInboxTransport";
import { getActiveMemberContext } from "../data/database";

export const ERP_ASSISTANT_VERSION = "8.0.14";
export const extensionDownload = `/integrations/erp-assistant/ERP-Assistant-v${ERP_ASSISTANT_VERSION}-shopeers-bridge.zip`;
export const extensionManagerUrl = "chrome://extensions/";

function isOlderVersion(version, targetVersion = ERP_ASSISTANT_VERSION) {
  if (!version) return false;
  const parts = String(version).split(".").map((part) => Number(part) || 0);
  const target = String(targetVersion).split(".").map((part) => Number(part) || 0);
  const size = Math.max(parts.length, target.length);
  for (let index = 0; index < size; index += 1) {
    if ((parts[index] ?? 0) !== (target[index] ?? 0)) return (parts[index] ?? 0) < (target[index] ?? 0);
  }
  return false;
}

async function checkInboxService() {
  const context = await getActiveMemberContext();
  const [payload, extensionPayload] = await Promise.all([
    getErpRequestHistory({ workspaceId: context.workspaceId }),
    getErpExtensionStatus(),
  ]);
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const extensionRecords = Array.isArray(extensionPayload?.records) ? extensionPayload.records : [];
  const pageExtension = extensionRecords.find((record) => record.extensionId === "erp-assistant") ?? null;
  const installedExtension = extensionRecords.find((record) => record.extensionId === "erp-assistant-installation") ?? null;
  return {
    requestCount: records.length,
    registeredCount: records.filter((record) => record.status === "registered").length,
    latestRequestAt: records.map((record) => record.registeredAt ?? record.requestedAt).filter(Boolean).sort().at(-1) ?? null,
    extension: pageExtension?.online ? pageExtension : installedExtension ?? pageExtension,
  };
}

export function DesktopErpExtensionSummary({ extensionLabel, extensionHint, extensionTone, extensionBadge, serviceLabel, onRefresh, onOpenDiagnostics, checking }) {
  return (
    <Panel className="desktop-extension-summary">
      <div className={`erp-assistant-status-icon ${extensionTone}`}><PlugZap size={21} /></div>
      <div className="desktop-extension-summary-copy">
        <span>内置 ERP 扩展</span>
        <strong>{extensionLabel}</strong>
        <small>{extensionHint} · {serviceLabel}</small>
      </div>
      <Badge tone={extensionTone}>{extensionBadge}</Badge>
      <div className="desktop-extension-summary-actions">
        <Button icon={RefreshCw} onClick={onRefresh} loading={checking}>复检</Button>
        <Button variant="ghost" icon={ShieldCheck} onClick={onOpenDiagnostics}>系统诊断</Button>
      </div>
    </Panel>
  );
}

export default function ErpAssistantSetup({ compact = false, diagnostics = false }) {
  const { notify } = useToast();
  const navigate = useNavigate();
  const desktop = isDesktopRuntime();
  const [serviceStatus, setServiceStatus] = useState("checking");
  const [serviceInfo, setServiceInfo] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const previousExtensionState = useRef(null);

  const checkService = useCallback(async () => {
    setServiceStatus("checking");
    try {
      const info = await checkInboxService();
      setServiceInfo(info);
      setServiceStatus("online");
      setCheckedAt(new Date());
      const currentExtensionState = isOlderVersion(info.extension?.version)
        ? "outdated"
        : info.extension?.online && info.extension?.ready
          ? "connected"
          : info.extension
            ? "waiting-refresh"
            : "not-detected";
      if (currentExtensionState === "connected" && previousExtensionState.current !== "connected") {
        notify("ERP Assistant 已安装并连接，可以开始核算。", "success");
      }
      previousExtensionState.current = currentExtensionState;
    } catch {
      setServiceInfo(null);
      setServiceStatus("offline");
      setCheckedAt(new Date());
      previousExtensionState.current = "service-offline";
    }
  }, [notify]);

  useEffect(() => { checkService(); }, [checkService]);
  useEffect(() => {
    const timer = window.setInterval(checkService, 10000);
    return () => window.clearInterval(timer);
  }, [checkService]);

  const copyManagerUrl = async () => {
    try {
      await navigator.clipboard.writeText(extensionManagerUrl);
      notify("已复制 Chrome 扩展管理页地址，请粘贴到地址栏打开。", "success");
    } catch {
      notify(`请在 Chrome 地址栏输入 ${extensionManagerUrl}`, "warning");
    }
  };

  const serviceLabel = serviceStatus === "online"
    ? serviceInfo?.registeredCount > 0 ? "收件服务在线，已有待处理请求" : "收件服务在线，等待 ERP 回传"
    : serviceStatus === "offline" ? "本机收件服务未启动" : "正在检查本机收件服务";
  const serviceTone = serviceStatus === "online" ? "success" : serviceStatus === "offline" ? "danger" : "neutral";
  const extension = serviceInfo?.extension;
  const extensionStatus = serviceStatus !== "online"
    ? "service-offline"
    : isOlderVersion(extension?.version)
      ? "outdated"
    : extension?.online && extension?.ready
      ? "connected"
      : extension
        ? "waiting-refresh"
        : "not-detected";
  const extensionLabel = {
    connected: desktop ? "内置扩展已运行" : "扩展已安装并运行",
    outdated: desktop ? "内置扩展版本待随应用更新" : "扩展版本需要更新",
    "waiting-refresh": desktop ? "内置扩展已加载，等待刷新卓麟 ERP" : "已发现扩展，等待刷新卓麟 ERP",
    "not-detected": desktop ? "暂未收到内置扩展状态" : "未检测到浏览器扩展",
    "service-offline": "无法检测扩展状态",
  }[extensionStatus];
  const extensionTone = extensionStatus === "connected" ? "success" : extensionStatus === "service-offline" || extensionStatus === "not-detected" ? "danger" : "warning";
  const extensionHint = extensionStatus === "connected"
    ? `${extension.version ? `v${extension.version} · ` : ""}当前页面已连接`
    : extensionStatus === "outdated"
      ? desktop
        ? `当前 v${extension.version}，桌面版会随应用版本统一更新；无需手工下载扩展包。`
        : `当前 v${extension.version}，最新 v${ERP_ASSISTANT_VERSION}。下载更新包并在 Chrome 重新加载扩展后，再刷新卓麟 ERP。`
    : extensionStatus === "waiting-refresh"
      ? `${extension.version ? `v${extension.version} · ` : ""}请回到卓麟 ERP 采购管理页刷新`
      : extensionStatus === "not-detected"
        ? desktop ? "请先打开桌面版的卓麟 ERP 标签页，再重新检查" : "请在 Chrome 扩展管理页加载并启用 ERP Assistant"
        : "先启动本机收件服务，再检查扩展连接";
  const checkedLabel = checkedAt ? `最近检查 ${checkedAt.toLocaleTimeString("zh-CN", { hour12: false })}` : "等待检查";

  const statusCards = (
    <div className={`erp-assistant-status-grid ${compact ? "erp-assistant-status-grid-compact" : ""}`}>
      <Panel className="erp-assistant-status-card">
        <div className={`erp-assistant-status-icon ${extensionTone}`}>{extensionStatus === "outdated" ? <TriangleAlert size={21} /> : <PlugZap size={21} />}</div>
        <div><span>{desktop ? "内置 ERP 扩展" : "浏览器扩展"}</span><strong>{extensionLabel}</strong><small>{extensionHint}{extension?.lastSeenAt ? ` · 最近检测 ${new Date(extension.lastSeenAt).toLocaleTimeString("zh-CN", { hour12: false })}` : ""}</small>{!desktop && extensionStatus === "outdated" ? <a className="erp-extension-update-link" href={extensionDownload} download={`ERP-Assistant-v${ERP_ASSISTANT_VERSION}-shopeers-bridge.zip`}><Download size={14} />下载 v{ERP_ASSISTANT_VERSION} 更新包</a> : null}</div>
        <Badge tone={extensionTone}>{extensionStatus === "connected" ? "已连接" : extensionStatus === "outdated" ? "需更新" : extensionStatus === "waiting-refresh" ? "待刷新" : extensionStatus === "service-offline" ? "待检查" : "未检测到"}</Badge>
      </Panel>
      <Panel className="erp-assistant-status-card">
        <div className={`erp-assistant-status-icon ${serviceTone}`}><ShieldCheck size={21} /></div>
        <div><span>本机收件服务</span><strong>{serviceLabel}</strong><small>{checkedLabel}{serviceInfo ? ` · ${serviceInfo.requestCount} 条历史请求` : ""}</small></div>
        <Badge tone={serviceTone}>{serviceStatus === "online" ? "在线" : serviceStatus === "offline" ? "离线" : "检查中"}</Badge>
      </Panel>
    </div>
  );

  const installPanel = (
    <Panel className={`erp-install-panel ${compact ? "erp-install-panel-compact" : ""}`}>
      <div className="panel-header">
        <div className="panel-title"><Download size={19} /><h2>{extensionStatus === "outdated" ? "更新 ERP Assistant" : "安装 ERP Assistant"}</h2></div>
        <Badge tone="neutral">仅限 Chrome</Badge>
      </div>
      <div className="erp-install-intro">
        <p>{extensionStatus === "outdated" ? `检测到旧版 v${extension?.version}。请更新到 v${ERP_ASSISTANT_VERSION}，以使用当前的分页、进度和自动回传逻辑。` : "安装一次即可。以后从卓麟 ERP 的“采购管理”页执行查询，扩展会按平台 SKC 抓取采购记录、计算单件平均成本，并自动回传到利润核算。"}</p>
        <div className="erp-install-actions">
          <a className="button button-primary" href={extensionDownload} download={`ERP-Assistant-v${ERP_ASSISTANT_VERSION}-shopeers-bridge.zip`}><Download size={17} /><span>{extensionStatus === "outdated" ? `下载 v${ERP_ASSISTANT_VERSION} 更新包` : "下载扩展包"}</span></a>
          <Button icon={Clipboard} onClick={copyManagerUrl}>复制扩展管理页地址</Button>
        </div>
      </div>
      <div className="erp-local-extension"><FolderOpen size={18} /><span><strong>当前工作区已内置解压版</strong><small>加载已解压扩展程序时，可直接选择项目目录：</small></span><code>integrations/erp-assistant-extension</code></div>
      <div className="erp-install-steps">
        <div className="erp-install-step"><span>1</span><div><strong>下载并解压</strong><small>下载扩展包，解压到一个固定文件夹，不要直接删除该文件夹。</small></div></div>
        <div className="erp-install-step"><span>2</span><div><strong>{extensionStatus === "outdated" ? "重新加载扩展" : "加载扩展"}</strong><small>打开 <code>chrome://extensions/</code>，开启“开发者模式”，点击“加载已解压的扩展程序”，选择能看到 <code>manifest.json</code> 的文件夹。</small></div></div>
        <div className="erp-install-step"><span>3</span><div><strong>刷新卓麟 ERP</strong><small>回到卓麟 ERP 的“采购管理”页刷新。页面出现“核算 SKU 成本”按钮后，扩展才算安装成功。</small></div></div>
      </div>
    </Panel>
  );

  const extensionBadge = extensionStatus === "connected" ? "已连接" : extensionStatus === "outdated" ? "需更新" : extensionStatus === "waiting-refresh" ? "待刷新" : extensionStatus === "service-offline" ? "待检查" : "未检测到";

  if (compact && desktop && !diagnostics) {
    return (
      <div className="erp-assistant-setup-compact desktop-extension-compact">
        <DesktopErpExtensionSummary
          extensionLabel={extensionLabel}
          extensionHint={extensionHint}
          extensionTone={extensionTone}
          extensionBadge={extensionBadge}
          serviceLabel={serviceLabel}
          checking={serviceStatus === "checking"}
          onRefresh={checkService}
          onOpenDiagnostics={() => navigate("/diagnostics#extensions")}
        />
      </div>
    );
  }

  if (compact || diagnostics) {
    return (
      <div className={`erp-assistant-setup-compact ${diagnostics ? "erp-assistant-setup-diagnostics" : ""}`}>
        <div className="erp-assistant-compact-toolbar">
          <span><strong>{desktop ? "ERP 内置扩展与收件服务" : "ERP 扩展与收件服务"}</strong><small>打开本区时会自动检查，也可以随时手动复检。</small></span>
          <Button icon={RefreshCw} onClick={checkService} loading={serviceStatus === "checking"}>重新检查连接</Button>
        </div>
        {statusCards}
        {!desktop && !diagnostics ? installPanel : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="系统连接"
        title="ERP 助手"
        description="安装并检查卓麟 ERP 成本采集扩展。扩展只读取采购管理页，并把正式 ERP 成本回传到本机工作区。"
        actions={<Button icon={RefreshCw} onClick={checkService} loading={serviceStatus === "checking"}>检查连接</Button>}
      />
      {statusCards}
      {!desktop ? installPanel : null}
      <Panel className="erp-flow-panel">
        <div className="panel-header"><div className="panel-title"><CircleHelp size={19} /><h2>实际使用顺序</h2></div><a className="erp-doc-link" href="https://www.zhuolinkeji.cn/" target="_blank" rel="noreferrer">打开卓麟 ERP <ExternalLink size={15} /></a></div>
        <div className="erp-flow-list">
          <div><span>01</span><p><strong>利润核算 → ERP 成本核对</strong><small>按销售人员或供方货号筛选后，复制平台 SKC。</small></p></div>
          <div><span>02</span><p><strong>卓麟 ERP → 采购管理</strong><small>将平台 SKC 粘贴到查询框，点击“查询”，再点击“核算 SKU 成本”。</small></p></div>
          <div><span>03</span><p><strong>回到 Shopeers</strong><small>等待自动收件，解析并核对，确认无误后发布正式 ERP 成本。</small></p></div>
        </div>
        <div className="erp-flow-note"><Check size={17} />ERP 成本为正式成本；1688 成本只作参考，不会自动替代 ERP 成本。</div>
      </Panel>
    </>
  );
}
