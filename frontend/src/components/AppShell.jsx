import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Activity,
  ArrowLeft,
  Archive,
  Bell,
  Check,
  ChevronRight,
  Download,
  HardDrive,
  Inbox,
  LayoutGrid,
  Menu,
  Moon,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  WalletCards,
  X,
} from "lucide-react";
import { createWorkspaceBackupPayload, getWorkspaceOperationalSummary, recordWorkspaceBackupExport } from "../data/database";
import { runtimeConfig } from "../config/runtimeConfig";
import { useCloudAuth } from "../hooks/useCloudAuth";
import { downloadWorkspaceBackup } from "../lib/workspaceBackupDownload";
import { normalizeAppearance, toggleAppearance } from "../lib/uiState";
import CloudAuthDialog from "./CloudAuthDialog";
import { Button, IconButton, Modal, useToast } from "./UI";

const APP_VERSION = typeof window !== "undefined" ? window.shopeersDesktopRuntime?.version ?? null : null;
const APP_VERSION_LABEL = APP_VERSION ? `v${APP_VERSION}` : "浏览器环境";
const PRODUCT_NAME = "Lworkstation";
const READ_NOTIFICATIONS_KEY = "shopeers-read-notifications";
const SIDEBAR_COLLAPSED_KEY = "shopeers-sidebar-collapsed";
const SIDEBAR_COMPACT_QUERY = "(max-width: 1200px)";

const baseNavigation = [
  { id: "workspace", label: "工作区首页", path: "/workspace", icon: LayoutGrid, match: ["/workspace"] },
  { id: "products", label: "选品工作台", path: "/products", icon: Archive, match: ["/products", "/capture"] },
  { id: "profit", label: "利润核算", path: "/profit", icon: WalletCards, match: ["/profit", "/cost-matching", "/import-preview", "/ledger", "/erp-assistant"] },
  { id: "diagnostics", label: "系统诊断与备份", path: "/diagnostics", icon: Activity, match: ["/diagnostics", "/data-security"] },
];

function isActive(pathname, item) {
  return item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function readStoredNotificationIds() {
  try {
    const value = JSON.parse(localStorage.getItem(READ_NOTIFICATIONS_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readStoredSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function readCompactSidebar() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(SIDEBAR_COMPACT_QUERY).matches;
}

function formatCheckTime(value) {
  if (!value) return "本次打开时";
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function AppShell({ children, pageClass = "" }) {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const { notify } = useToast();
  const menuRef = useRef(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const [compactSidebar, setCompactSidebar] = useState(readCompactSidebar);
  const [compactSidebarExpanded, setCompactSidebarExpanded] = useState(false);
  const [openMenu, setOpenMenu] = useState("");
  const [openDialog, setOpenDialog] = useState("");
  const [readNotificationIds, setReadNotificationIds] = useState(readStoredNotificationIds);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [backingUp, setBackingUp] = useState(false);
  const [supportCopied, setSupportCopied] = useState(false);
  const [appearance, setAppearance] = useState(() => normalizeAppearance(localStorage.getItem("shopeers-appearance")));
  const workspaceSummary = useLiveQuery(getWorkspaceOperationalSummary, [], null);
  const cloudAuth = useCloudAuth();
  const cloudEnvironment = runtimeConfig.syncProvider === "supabase"
    ? (cloudAuth.user ? "环境：云端" : "环境：待登录")
    : "环境：本机";
  const effectiveSidebarCollapsed = compactSidebar ? !compactSidebarExpanded : sidebarCollapsed;

  const backTarget = useMemo(() => {
    if (baseNavigation.some((item) => item.path === pathname)) return null;
    if (pathname.startsWith("/products") || pathname.startsWith("/capture")) return "/products";
    if (pathname.startsWith("/profit") || pathname.startsWith("/cost-matching") || pathname.startsWith("/import-preview") || pathname.startsWith("/ledger") || pathname.startsWith("/erp-assistant")) return "/profit";
    if (pathname.startsWith("/data-security")) return "/diagnostics";
    if (pathname.startsWith("/diagnostics")) return "/workspace";
    return "/workspace";
  }, [pathname]);

  const goBack = () => {
    if (backTarget) navigate(backTarget);
  };

  const navigation = useMemo(() => baseNavigation.map((item) => (
    item.id === "products"
      ? { ...item, count: workspaceSummary?.pendingCaptureCount ?? 0 }
      : item
  )), [workspaceSummary?.pendingCaptureCount]);

  const notifications = useMemo(() => {
    if (!workspaceSummary) return [];
    const items = [];
    if (workspaceSummary.pendingCaptureCount > 0) {
      items.push({
        id: `captures:${workspaceSummary.pendingCaptureCount}:${workspaceSummary.latestCaptureAt ?? "none"}`,
        tone: workspaceSummary.blockedCaptureCount > 0 ? "warning" : "info",
        title: `${workspaceSummary.pendingCaptureCount} 条采集等待确认`,
        detail: workspaceSummary.blockedCaptureCount > 0
          ? `${workspaceSummary.blockedCaptureCount} 条存在阻断项`
          : "均可进入待确认队列处理",
        path: "/products?view=pending",
      });
    }
    if (workspaceSummary.missingCostCount > 0 && workspaceSummary.latestOpenLedger) {
      items.push({
        id: `costs:${workspaceSummary.latestOpenLedger.id}:${workspaceSummary.latestOpenLedger.updatedAt ?? "none"}:${workspaceSummary.missingCostCount}`,
        tone: "danger",
        title: `${workspaceSummary.missingCostCount} 个 SKU 缺少正式成本`,
        detail: `${workspaceSummary.latestOpenLedger.period} 账本暂不能定稿`,
        path: `/cost-matching?ledger=${encodeURIComponent(workspaceSummary.latestOpenLedger.id)}`,
      });
    } else if (workspaceSummary.latestOpenLedger?.status === "ready") {
      items.push({
        id: `ledger-ready:${workspaceSummary.latestOpenLedger.id}:${workspaceSummary.latestOpenLedger.updatedAt ?? "none"}`,
        tone: "success",
        title: `${workspaceSummary.latestOpenLedger.period} 账本可定稿`,
        detail: "正式成本已完整，等待最终复核",
        path: `/profit?ledger=${encodeURIComponent(workspaceSummary.latestOpenLedger.id)}`,
      });
    }
    return items;
  }, [workspaceSummary]);

  const unreadCount = notifications.filter((notification) => !readNotificationIds.includes(notification.id)).length;

  useEffect(() => {
    setMobileOpen(false);
    setOpenMenu("");
    setCompactSidebarExpanded(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(SIDEBAR_COMPACT_QUERY);
    const syncCompactSidebar = () => {
      setCompactSidebar(media.matches);
      if (media.matches) setCompactSidebarExpanded(false);
    };
    syncCompactSidebar();
    media.addEventListener("change", syncCompactSidebar);
    return () => media.removeEventListener("change", syncCompactSidebar);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    localStorage.setItem("shopeers-appearance", appearance);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", appearance === "dark" ? "#121821" : "#f6f7f9");
  }, [appearance]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const closeMenu = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "mousedown" && menuRef.current?.contains(event.target)) return;
      setOpenMenu("");
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, []);

  const toggleMenu = (menu) => setOpenMenu((current) => current === menu ? "" : menu);

  const toggleSidebar = () => {
    if (compactSidebar) {
      setCompactSidebarExpanded((current) => !current);
      return;
    }
    setSidebarCollapsed((current) => !current);
  };

  const showDialog = (dialog) => {
    setOpenMenu("");
    setMobileOpen(false);
    if (dialog === "support") setSupportCopied(false);
    setOpenDialog(dialog);
  };

  const persistReadNotifications = (ids) => {
    const compact = ids.slice(-50);
    setReadNotificationIds(compact);
    localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(compact));
  };

  const openNotification = (notification) => {
    if (!readNotificationIds.includes(notification.id)) {
      persistReadNotifications([...readNotificationIds, notification.id]);
    }
    setOpenMenu("");
    navigate(notification.path);
  };

  const copySupportSummary = async () => {
    const summary = workspaceSummary
      ? `${PRODUCT_NAME} 经营管理中心 ${APP_VERSION_LABEL}｜本机工作区｜正式商品 ${workspaceSummary.productCount}｜平台 SKU ${workspaceSummary.platformSkuCount}｜待确认采集 ${workspaceSummary.pendingCaptureCount}｜未完成账本 ${workspaceSummary.openLedgerCount}`
      : `${PRODUCT_NAME} 经营管理中心 ${APP_VERSION_LABEL}｜本机工作区｜数据读取中`;
    try {
      await navigator.clipboard.writeText(summary);
      setSupportCopied(true);
    } catch {
      notify("浏览器未授权读取剪贴板，请稍后重试。", "error");
    }
  };

  const checkLocalWorkspace = async () => {
    setCheckingConnection(true);
    try {
      await getWorkspaceOperationalSummary();
      const checkedAt = new Date().toISOString();
      setLastCheckedAt(checkedAt);
    } catch (error) {
      notify(`本机数据库检查失败：${error.message}`, "error");
    } finally {
      setCheckingConnection(false);
      setOpenMenu("");
    }
  };

  const exportLocalBackup = async () => {
    setBackingUp(true);
    try {
      const payload = await createWorkspaceBackupPayload();
      const download = downloadWorkspaceBackup(payload);
      await recordWorkspaceBackupExport({
        ...download,
        recordCount: payload.recordCount,
        generatedAt: payload.generatedAt,
      });
      notify(`本机备份已导出：${download.fileName}。`, "success");
    } catch (error) {
      notify(`备份导出失败：${error.message}`, "error");
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div className={`app-shell ${effectiveSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-assets" aria-label={`${PRODUCT_NAME} 经营管理中心`}>
            <img className="brand-logo brand-logo-light" src="/assets/brand/lworkstation-wordmark-light.svg" alt="" aria-hidden="true" draggable="false" />
            <img className="brand-logo brand-logo-dark" src="/assets/brand/lworkstation-wordmark-dark.svg" alt="" aria-hidden="true" draggable="false" />
            <img className="brand-mark" src="/assets/brand/l7-app-icon-master.svg" alt="" aria-hidden="true" draggable="false" />
          </span>
          <IconButton
            icon={effectiveSidebarCollapsed ? PanelLeftOpen : Menu}
            label={effectiveSidebarCollapsed ? "展开导航" : "折叠导航"}
            className="sidebar-collapse-toggle"
            aria-expanded={!effectiveSidebarCollapsed}
            onClick={toggleSidebar}
          />
          <IconButton icon={X} label="关闭导航" className="sidebar-close" onClick={() => setMobileOpen(false)} />
        </div>

        <nav className="side-navigation" aria-label="主导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link className={`nav-item ${isActive(pathname, item) ? "active" : ""}`} to={item.path} key={item.path} title={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
                {item.count > 0 ? <small className="nav-count">{item.count}</small> : null}
              </Link>
            );
          })}
        </nav>

      </aside>

      {mobileOpen ? <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} /> : null}

      <header className="topbar">
        <div className="topbar-leading">
          <IconButton icon={Menu} label="打开导航" className="mobile-menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} />
          {backTarget ? <IconButton icon={ArrowLeft} label="返回上一级" className="global-back" onClick={goBack} /> : null}
        </div>
        <div className="topbar-actions" ref={menuRef}>
          <div className="topbar-control environment-control">
            <button className="environment-chip" aria-haspopup="menu" aria-expanded={openMenu === "environment"} onClick={() => toggleMenu("environment")}><i /> {cloudEnvironment}</button>
            {openMenu === "environment" ? <div className="topbar-popover environment-popover" role="menu"><div className="popover-heading"><span className="popover-icon success"><HardDrive size={18} /></span><span><strong>本机工作区</strong><small>数据保存在当前浏览器的 IndexedDB</small></span></div><div className="popover-detail"><span>本地数据库 <b>已连接</b></span><span>数据模式 <b>正式本地数据</b></span><span>当前记录 <b>{workspaceSummary ? workspaceSummary.recordCount.toLocaleString("zh-CN") : "读取中"}</b></span><span>最后检查 <b>{formatCheckTime(lastCheckedAt)}</b></span></div><button className="popover-link" disabled={checkingConnection} onClick={checkLocalWorkspace}>{checkingConnection ? "正在检查" : "重新检查连接"}<RefreshCw className={checkingConnection ? "spin" : ""} size={16} /></button></div> : null}
          </div>
          <Button variant="primary" icon={Inbox} onClick={() => navigate("/products?view=pending")}>待确认采集{workspaceSummary?.pendingCaptureCount ? `（${workspaceSummary.pendingCaptureCount}）` : ""}</Button>
          <span className="topbar-separator" />
          <div className="topbar-control appearance-control">
            <IconButton
              icon={appearance === "dark" ? Sun : Moon}
              label={appearance === "dark" ? "切换到亮色模式" : "切换到夜间模式"}
              aria-pressed={appearance === "dark"}
              onClick={() => setAppearance((current) => toggleAppearance(current))}
            />
          </div>
          <div className="topbar-control notification-control">
            <IconButton icon={Bell} label={`通知${unreadCount ? `，${unreadCount} 条未读` : ""}`} className={`${unreadCount ? "has-notification" : ""} ${openMenu === "notifications" ? "active" : ""}`} aria-expanded={openMenu === "notifications"} onClick={() => toggleMenu("notifications")} />
            {openMenu === "notifications" ? <div className="topbar-popover notifications-popover" role="menu"><div className="popover-title">通知 <small>{unreadCount} 条未读</small></div>{notifications.length > 0 ? notifications.map((notification) => <button key={notification.id} onClick={() => openNotification(notification)}><span className={`notification-dot ${notification.tone}`} /><span><strong>{notification.title}</strong><small>{notification.detail}</small></span></button>) : <div className="popover-empty"><Check size={17} /><span>当前没有待处理通知</span></div>}{notifications.length > 0 ? <button className="popover-link" disabled={unreadCount === 0} onClick={() => { persistReadNotifications([...new Set([...readNotificationIds, ...notifications.map((item) => item.id)])]); setOpenMenu(""); }}>全部标记已读<Check size={16} /></button> : null}</div> : null}
          </div>
          <div className="topbar-control account-control">
            <button className={`avatar-button ${openMenu === "account" ? "active" : ""}`} aria-label="打开账户菜单" aria-haspopup="menu" aria-expanded={openMenu === "account"} onClick={() => toggleMenu("account")}><span className="avatar" aria-hidden="true">L</span></button>
            {openMenu === "account" ? <div className="topbar-popover account-popover" role="menu"><div className="account-summary"><span className="avatar avatar-large" aria-hidden="true">L</span><span><strong>{cloudAuth.user?.email ?? "Lworkstation 用户"}</strong><small>{cloudAuth.user ? "云端工作区成员" : runtimeConfig.syncProvider === "supabase" ? "尚未登录云端" : "本机工作区管理员"}</small></span></div><button onClick={() => showDialog("cloud-auth")}><ShieldCheck size={17} />{cloudAuth.user ? "云端账户" : "登录云端工作区"}<ChevronRight size={15} /></button><button onClick={() => showDialog("settings")}><Settings size={17} />工作区偏好<ChevronRight size={15} /></button><button onClick={() => showDialog("support")}><ShieldCheck size={17} />产品支持摘要<ChevronRight size={15} /></button></div> : null}
          </div>
        </div>
      </header>

      <main className={`main-canvas ${pageClass}`}>
        <div className="page-container">{children}</div>
      </main>

      <Modal
        open={openDialog === "settings"}
        title="工作区设置"
        description="这些偏好和本地数据仅属于当前浏览器工作区。"
        onClose={() => setOpenDialog("")}
        footer={<Button variant="primary" onClick={() => setOpenDialog("")}>完成</Button>}
      >
        <div className="shell-dialog-list">
          <div><span><strong>界面语言</strong><small>导航、状态和提示均使用中文</small></span><b>简体中文</b></div>
          <div><span><strong>数据保存位置</strong><small>IndexedDB 本地数据不会自动上传云端</small></span><b>仅本机</b></div>
          <div><span><strong>当前数据量</strong><small>商品、账本、成本与审计等全部本地记录</small></span><b>{workspaceSummary ? workspaceSummary.recordCount.toLocaleString("zh-CN") : "读取中"}</b></div>
          <button type="button" disabled={backingUp} onClick={exportLocalBackup}><Download size={18} /><span><strong>{backingUp ? "正在导出备份" : "导出本机备份"}</strong><small>生成包含当前工作区全部表的 JSON 文件</small></span><ChevronRight size={16} /></button>
        </div>
      </Modal>

      <Modal
        open={openDialog === "support"}
        title="帮助与支持"
        description="复制当前环境的脱敏摘要，便于定位问题。"
        onClose={() => setOpenDialog("")}
        footer={<><Button onClick={() => setOpenDialog("")}>关闭</Button><Button variant="primary" icon={supportCopied ? Check : undefined} onClick={copySupportSummary}>{supportCopied ? "已复制" : "复制支持摘要"}</Button></>}
      >
        <div className="shell-dialog-list support-summary">
          <div><span><strong>应用版本</strong><small>{PRODUCT_NAME} 经营管理中心</small></span><b>{APP_VERSION_LABEL}</b></div>
          <div><span><strong>运行环境</strong><small>本机 IndexedDB 工作区</small></span><b>已连接</b></div>
          <div><span><strong>业务数据</strong><small>正式商品 / 平台 SKU / 待确认采集</small></span><b>{workspaceSummary ? `${workspaceSummary.productCount} / ${workspaceSummary.platformSkuCount} / ${workspaceSummary.pendingCaptureCount}` : "读取中"}</b></div>
          <div><span><strong>建议操作</strong><small>故障排查和日志导出请使用左侧“系统诊断”</small></span><b>诊断中心</b></div>
        </div>
      </Modal>

      <CloudAuthDialog open={openDialog === "cloud-auth"} onClose={() => setOpenDialog("")} />
    </div>
  );
}
