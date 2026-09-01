import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Clipboard, Download, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge, Button, useToast } from "./UI";
import { checkSelectionCaptureInbox, getSelectionExtensionStatus } from "../lib/selectionCaptureTransport";
import { isDesktopRuntime } from "../lib/desktopRuntime";

export const SELECTION_CAPTURE_VERSION = "1.2.1";
export const selectionCaptureDownload = `/integrations/1688-selection/Shopeers-1688-Capture-v${SELECTION_CAPTURE_VERSION}.zip`;
export const extensionManagerUrl = "chrome://extensions/";

export function SelectionCaptureFlowNote({ showQueueLink, onOpenQueue }) {
  return (
    <div className="erp-flow-note">
      <Check size={17} />采集数据先进入待确认队列；1688 成本只作为参考，不会覆盖 ERP 正式成本。
      {showQueueLink ? <button type="button" className="inline-link" onClick={onOpenQueue}>打开待确认采集<ArrowRight size={14} /></button> : null}
    </div>
  );
}

function isOlderVersion(version, targetVersion = SELECTION_CAPTURE_VERSION) {
  if (!version) return false;
  const parts = String(version).split(".").map((part) => Number(part) || 0);
  const target = String(targetVersion).split(".").map((part) => Number(part) || 0);
  const size = Math.max(parts.length, target.length);
  for (let index = 0; index < size; index += 1) {
    if ((parts[index] ?? 0) !== (target[index] ?? 0)) return (parts[index] ?? 0) < (target[index] ?? 0);
  }
  return false;
}

async function checkSelectionExtension() {
  const service = await checkSelectionCaptureInbox();
  if (!service?.ok) throw new Error("本机采集收件服务未启动。");
  const payload = await getSelectionExtensionStatus();
  const extension = (payload.records ?? []).find((record) => record.extensionId === "selection-1688-capture") ?? null;
  return { service, extension };
}

export default function SelectionCaptureSetup({ diagnostics = false }) {
  const { notify } = useToast();
  const navigate = useNavigate();
  const desktop = isDesktopRuntime();
  const [state, setState] = useState("checking");
  const [info, setInfo] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);

  const check = useCallback(async () => {
    setState("checking");
    try {
      const result = await checkSelectionExtension();
      setInfo(result);
      setState("online");
      setCheckedAt(new Date());
    } catch (error) {
      setInfo(null);
      setState("offline");
      setCheckedAt(new Date());
      if (!diagnostics) notify(error.message, "warning");
    }
  }, [diagnostics, notify]);

  useEffect(() => { check(); }, [check]);

  const copyManagerUrl = async () => {
    try {
      await navigator.clipboard.writeText(extensionManagerUrl);
      notify("已复制 Chrome 扩展管理页地址。", "success");
    } catch {
      notify(`请在 Chrome 地址栏输入 ${extensionManagerUrl}`, "warning");
    }
  };

  const extension = info?.extension;
  const outdated = isOlderVersion(extension?.version);
  const connected = Boolean(!outdated && extension?.online && extension?.ready);
  const extensionLabel = connected
    ? desktop ? "内置 1688 扩展已连接" : "1688 扩展已连接"
    : state === "offline"
      ? "本机采集服务未启动"
      : outdated
        ? desktop ? "内置 1688 扩展待随应用更新" : "1688 扩展版本需要更新"
        : extension
          ? "已发现扩展，等待心跳"
          : desktop ? "暂未收到内置 1688 扩展状态" : "未检测到 1688 扩展";
  const extensionHint = connected
    ? `v${extension.version} · 可发送到待确认队列`
    : outdated
      ? desktop
        ? `当前 v${extension.version}，桌面版会随应用版本统一更新；无需手工下载扩展包。`
        : `当前 v${extension.version}，最新 v${SELECTION_CAPTURE_VERSION}。更新后才能使用当前采集与回传逻辑。`
      : checkedAt ? `最近检查 ${checkedAt.toLocaleTimeString("zh-CN", { hour12: false })}` : "正在检查连接";
  const tone = connected ? "success" : state === "offline" ? "danger" : "warning";
  return (
    <div className="selection-install-content">
      <div className="selection-install-status">
        <span className={`erp-assistant-status-icon ${tone}`}>{outdated ? <TriangleAlert size={20} /> : <ShieldCheck size={20} />}</span>
        <div><strong>{extensionLabel}</strong><small>{extensionHint}</small>{!desktop && outdated ? <a className="erp-extension-update-link" href={selectionCaptureDownload} download={`Shopeers-1688-Capture-v${SELECTION_CAPTURE_VERSION}.zip`}><Download size={14} />下载 v{SELECTION_CAPTURE_VERSION} 更新包</a> : null}</div>
        <Badge tone={tone}>{connected ? "已连接" : outdated ? "需更新" : state === "offline" ? "离线" : "待检查"}</Badge>
      </div>
      {diagnostics ? <div className="selection-install-status selection-service-status">
        <span className={`erp-assistant-status-icon ${state === "online" ? "success" : state === "offline" ? "danger" : "warning"}`}><ShieldCheck size={20} /></span>
        <div><strong>1688 本机采集收件服务</strong><small>{state === "online" ? "服务在线 · 受控桌面通道" : state === "offline" ? "服务未启动，当前无法接收扩展采集数据" : "正在检查本机服务"}</small></div>
        <Badge tone={state === "online" ? "success" : state === "offline" ? "danger" : "warning"}>{state === "online" ? "在线" : state === "offline" ? "离线" : "检查中"}</Badge>
      </div> : null}
      <div className="erp-install-actions">
        {!desktop && !diagnostics ? <a className="button button-primary" href={selectionCaptureDownload} download={`Shopeers-1688-Capture-v${SELECTION_CAPTURE_VERSION}.zip`}><Download size={17} /><span>{outdated ? `下载 v${SELECTION_CAPTURE_VERSION} 更新包` : "下载 1688 扩展"}</span></a> : null}
        {!desktop && !diagnostics ? <Button icon={Clipboard} onClick={copyManagerUrl}>复制扩展管理页地址</Button> : null}
        <Button icon={RefreshCw} loading={state === "checking"} onClick={check}>重新检查</Button>
        {desktop && !diagnostics ? <Button variant="ghost" icon={ShieldCheck} onClick={() => navigate("/diagnostics#extensions")}>系统诊断</Button> : null}
      </div>
      {!desktop && !diagnostics ? <div className="erp-install-steps">
        <div className="erp-install-step"><span>1</span><div><strong>下载并解压</strong><small>下载扩展包并解压到固定文件夹，解压后文件夹内应直接看到 manifest.json。</small></div></div>
        <div className="erp-install-step"><span>2</span><div><strong>{outdated ? "重新加载扩展" : "加载扩展"}</strong><small>打开 <code>chrome://extensions/</code>，开启开发者模式，点击“加载已解压的扩展程序”。</small></div></div>
        <div className="erp-install-step"><span>3</span><div><strong>回到 1688 确认订单页</strong><small>刷新页面，右下角出现“发送确认订单数据”后即可采集。</small></div></div>
      </div> : null}
      <SelectionCaptureFlowNote showQueueLink={!desktop} onOpenQueue={() => navigate("/products?view=pending")} />
    </div>
  );
}
