const { app, BrowserWindow, dialog, Menu, WebContentsView, ipcMain, nativeTheme, net, protocol, session, shell } = require("electron");
const path = require("node:path");
const crypto = require("node:crypto");
const smokeUserDataPath = process.env.SHOPEERS_DESKTOP_SMOKE_USER_DATA
  ? path.resolve(process.env.SHOPEERS_DESKTOP_SMOKE_USER_DATA)
  : null;
const smokeCachePath = process.env.SHOPEERS_DESKTOP_SMOKE_CACHE
  ? path.resolve(process.env.SHOPEERS_DESKTOP_SMOKE_CACHE)
  : null;
if (smokeUserDataPath) app.setPath("userData", smokeUserDataPath);
if (smokeCachePath) {
  app.setPath("cache", smokeCachePath);
  process.env.LOCALAPPDATA = smokeCachePath;
}
const { autoUpdater, CancellationToken } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { normalizeAllowedRemoteUrl, resolveRemotePopup } = require("./remote-navigation.cjs");
const { isAllowedWorkspaceUrl } = require("./workspace-navigation.cjs");
const { createInboxServiceController } = require("./inbox-service.cjs");
const { navigationState, navigateHistory } = require("./navigation-history.cjs");
const { cleanupRuntimeExtensionStagingSync, extensionStorageConfig, prepareRuntimeExtension, runtimeRoot } = require("./extension-runtime.cjs");
const { createInboxPopoverLifecycle } = require("./inbox-popover-lifecycle.cjs");
const { buildInboxUrl, enforceWorkspaceContext, normalizeInboxRequest, normalizeWorkspaceContext } = require("./inbox-ipc.cjs");
const {
  createWorkspaceContextCoordinator,
  configurationHttpResult,
  extensionLoadFailureState,
  normalizeConfigurationResult,
} = require("./workspace-context.cjs");
const {
  PRODUCTION_FEED_CONFIG,
  createInitialUpdateState,
  createUpdateRuntime,
  normalizeReleaseUrl,
} = require("./update-runtime.cjs");
const {
  ERP_ZOOM_MIN,
  ERP_ZOOM_MAX,
  ERP_ZOOM_STEP,
  loadAppearancePreference,
  loadErpZoomPreference,
  normalizeErpZoomPercent,
  saveAppearancePreference,
  saveErpZoomPreference,
} = require("./desktop-preferences.cjs");

const SHELL_TOP_HEIGHT = 80;
const DESKTOP_ICON_PATH = path.join(__dirname, "assets", "lworkstation.ico");
const INBOX_POPOVER_MIN_HEIGHT = 43;
const INBOX_POPOVER_MAX_HEIGHT = 220;
const INBOX_POPOVER_WIDTH = 175;
const UPDATE_POPOVER_MIN_HEIGHT = 168;
const UPDATE_POPOVER_MAX_HEIGHT = 420;
const UPDATE_POPOVER_WIDTH = 324;
const DEV_URL = process.env.SHOPEERS_DESKTOP_DEV_URL;
const VISUAL_SMOKE = process.env.SHOPEERS_DESKTOP_VISUAL_SMOKE === "1";
const visualDimension = (name, fallback, min, max) => VISUAL_SMOKE
  ? Math.max(min, Math.min(max, Number(process.env[name]) || fallback))
  : fallback;
const views = new Map();
const attachedViews = new Set();
const tabState = {
  workspace: { id: "workspace", title: "Lworkstation", status: "ready", url: DEV_URL || "" },
  erp: { id: "erp", title: "ERP", status: "loading", url: "https://www.zhuolinkeji.cn/" },
  "1688": { id: "1688", title: "1688", status: "loading", url: "https://www.1688.com/" },
};
let mainWindow;
let inboxPopoverWindow;
let updatePopoverWindow;
let activeTab = "workspace";
let inboxService;
const inboxCapability = crypto.randomBytes(32).toString("base64url");
const workspaceContextCoordinator = createWorkspaceContextCoordinator();
let activeWorkspaceContext = null;
let shutdownPromise = null;
let shutdownComplete = false;
let shellAppearance = loadAppearancePreference({
  userDataPath: app.getPath("userData"),
  fallback: nativeTheme.shouldUseDarkColors ? "dark" : "light",
});
let inboxPopoverHeight = INBOX_POPOVER_MIN_HEIGHT;
const inboxPopoverLifecycle = createInboxPopoverLifecycle();
let inboxPopoverToggleIntentAt = 0;
const updatePopoverLifecycle = createInboxPopoverLifecycle();
let updatePopoverToggleIntentAt = 0;
let updatePopoverHeight = UPDATE_POPOVER_MIN_HEIGHT;
let updatePopoverAnchor = { x: 132, y: 4, width: 70, height: 28 };
let erpZoomPercent = loadErpZoomPreference({ userDataPath: app.getPath("userData") });
const smokeReportPath = process.env.SHOPEERS_DESKTOP_SMOKE_REPORT;
const smokeRequiresUpdateCheck = process.env.SHOPEERS_DESKTOP_SMOKE_REQUIRE_UPDATE_CHECK === "1";
const smokeRequiresErpV2 = process.env.SHOPEERS_DESKTOP_SMOKE_ERP_V2 === "1";
const updateSmokeReportPath = process.env.SHOPEERS_DESKTOP_UPDATE_SMOKE_REPORT;
let updateRuntime = null;
let updateState = createInitialUpdateState({ currentVersion: app.getVersion(), enabled: app.isPackaged });
let updateInstallInvocationCount = 0;
let inboxState = {
  status: "stopped",
  ownership: "none",
  port: Number(process.env.SHOPEERS_ERP_INBOX_PORT || 8790),
  message: "ERP 收件服务尚未启动",
  flow: { status: "idle", tone: "muted", label: "等待 ERP 请求", message: "收件服务尚未启动。" },
};

protocol.registerSchemesAsPrivileged([{
  scheme: "shopeers",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

function projectPath(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(__dirname, "..", ...parts);
}

function openInExternalChrome(url) {
  const candidates = process.platform === "win32" ? [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
  ] : [];
  const chrome = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (chrome) {
    spawn(chrome, ["--new-window", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return Promise.resolve({ browser: "chrome" });
  }
  return shell.openExternal(url).then(() => ({ browser: "default" }));
}

function setStatus(tabId, patch) {
  Object.assign(tabState[tabId], patch);
  publishState();
}

function publishNavigationState(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  publishState();
}

function publicState() {
  const tabs = {};
  for (const [id, state] of Object.entries(tabState)) {
    const view = views.get(id);
    const history = navigationState(view?.webContents);
    tabs[id] = {
      ...state,
      url: view?.webContents.getURL() || state.url,
      ...history,
    };
  }
  return {
    activeTab,
    tabs,
    update: { ...updateState },
    inbox: { ...inboxState },
    inboxPopoverOpen: Boolean(inboxPopoverWindow && !inboxPopoverWindow.isDestroyed()),
    updatePopoverOpen: Boolean(updatePopoverWindow && !updatePopoverWindow.isDestroyed()),
    appearance: shellAppearance,
    version: app.getVersion(),
    erpZoom: { percent: erpZoomPercent, min: ERP_ZOOM_MIN, max: ERP_ZOOM_MAX, step: ERP_ZOOM_STEP },
  };
}

function publishState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = publicState();
  mainWindow.webContents.send("desktop:state", state);
  if (inboxPopoverWindow && !inboxPopoverWindow.isDestroyed() && !inboxPopoverWindow.webContents.isDestroyed()) {
    inboxPopoverWindow.webContents.send("desktop:inbox-popover-state", state);
  }
  if (updatePopoverWindow && !updatePopoverWindow.isDestroyed() && !updatePopoverWindow.webContents.isDestroyed()) {
    updatePopoverWindow.webContents.send("desktop:update-popover-state", state);
  }
}

function reportPreferenceWriteFailure(preference, error) {
  const detail = error?.message || String(error);
  console.warn(`桌面${preference}偏好暂未保存，当前会话设置仍然有效：${detail}`);
}

function resizeViews() {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  for (const [id, view] of views) {
    const shouldAttach = id === activeTab;
    const isAttached = attachedViews.has(id);
    if (shouldAttach && !isAttached) {
      mainWindow.contentView.addChildView(view);
      attachedViews.add(id);
    } else if (!shouldAttach && isAttached) {
      mainWindow.contentView.removeChildView(view);
      attachedViews.delete(id);
    }
    if (shouldAttach) {
      const contentTop = SHELL_TOP_HEIGHT;
      view.setBounds({
        x: 0,
        y: contentTop,
        width,
        height: Math.max(0, height - contentTop),
      });
    }
  }
}

function focusInboxStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.focus();
  mainWindow.webContents.executeJavaScript("document.querySelector('#inbox-status')?.focus()", true).catch(() => {});
}

function inboxPopoverSnapshot() {
  const popup = inboxPopoverWindow;
  return {
    open: Boolean(popup && !popup.isDestroyed()),
    visible: Boolean(popup && !popup.isDestroyed() && popup.isVisible()),
    focused: Boolean(popup && !popup.isDestroyed() && popup.isFocused()),
    generation: popup?.__inboxPopoverGeneration || null,
    windowCount: BrowserWindow.getAllWindows().length,
  };
}

function updatePopoverSnapshot() {
  const popup = updatePopoverWindow;
  return {
    open: Boolean(popup && !popup.isDestroyed()),
    visible: Boolean(popup && !popup.isDestroyed() && popup.isVisible()),
    focused: Boolean(popup && !popup.isDestroyed() && popup.isFocused()),
    generation: popup?.__updatePopoverGeneration || null,
    windowCount: BrowserWindow.getAllWindows().length,
  };
}

function focusUpdateStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.focus();
  mainWindow.webContents.executeJavaScript("document.querySelector('#update-status')?.focus()", true).catch(() => {});
}

function normalizeUpdatePopoverAnchor(anchor) {
  const [windowWidth] = mainWindow?.getContentSize?.() || [1024];
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  return {
    x: Math.max(8, Math.min(windowWidth - 40, number(anchor?.x, updatePopoverAnchor.x))),
    y: Math.max(0, Math.min(36, number(anchor?.y, updatePopoverAnchor.y))),
    width: Math.max(24, Math.min(140, number(anchor?.width, updatePopoverAnchor.width))),
    height: Math.max(24, Math.min(36, number(anchor?.height, updatePopoverAnchor.height))),
  };
}

function positionUpdatePopover() {
  if (!mainWindow || mainWindow.isDestroyed() || !updatePopoverWindow || updatePopoverWindow.isDestroyed()) return;
  const [windowWidth, windowHeight] = mainWindow.getContentSize();
  const [screenX, screenY] = mainWindow.getPosition();
  const width = Math.min(UPDATE_POPOVER_WIDTH, Math.max(280, windowWidth - 24));
  const targetX = updatePopoverAnchor.x + updatePopoverAnchor.width - width;
  updatePopoverWindow.setBounds({
    x: screenX + Math.max(8, Math.min(windowWidth - width - 8, targetX)),
    y: screenY + Math.max(4, Math.min(windowHeight - updatePopoverHeight - 8, updatePopoverAnchor.y + updatePopoverAnchor.height + 4)),
    width,
    height: updatePopoverHeight,
  });
}

function closeUpdatePopover({ returnFocus = true } = {}) {
  const popup = updatePopoverWindow;
  const generation = popup?.__updatePopoverGeneration;
  updatePopoverToggleIntentAt = 0;
  updatePopoverWindow = null;
  updatePopoverLifecycle.close(generation);
  if (popup && !popup.isDestroyed()) {
    popup.removeAllListeners("blur");
    popup.close();
  }
  publishState();
  if (returnFocus) focusUpdateStatus();
  return { ok: true, open: false };
}

function openUpdatePopover(anchor) {
  updatePopoverAnchor = normalizeUpdatePopoverAnchor(anchor);
  if (updatePopoverWindow && !updatePopoverWindow.isDestroyed()) {
    closeUpdatePopover();
    return { ok: true, open: false };
  }
  updatePopoverToggleIntentAt = 0;
  updatePopoverHeight = UPDATE_POPOVER_MIN_HEIGHT;
  updatePopoverWindow = new BrowserWindow({
    parent: mainWindow,
    width: UPDATE_POPOVER_WIDTH,
    height: updatePopoverHeight,
    minWidth: 280,
    maxWidth: UPDATE_POPOVER_WIDTH,
    minHeight: UPDATE_POPOVER_MIN_HEIGHT,
    maxHeight: UPDATE_POPOVER_MAX_HEIGHT,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,
    show: false,
    title: "Lworkstation 更新",
    backgroundColor: shellAppearance === "dark" ? "#18212c" : "#ffffff",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "update-popover-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const popup = updatePopoverWindow;
  const generation = updatePopoverLifecycle.open();
  popup.__updatePopoverGeneration = generation;
  popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popup.webContents.on("will-navigate", (event) => event.preventDefault());
  popup.on("blur", () => {
    setTimeout(() => {
      if (updatePopoverWindow !== popup || !updatePopoverLifecycle.isCurrent(generation) || popup.isDestroyed() || popup.isFocused()) return;
      if (Date.now() - updatePopoverToggleIntentAt < 300) return;
      closeUpdatePopover();
    }, 50);
  });
  popup.on("closed", () => {
    if (updatePopoverWindow === popup && updatePopoverLifecycle.isCurrent(generation)) {
      updatePopoverLifecycle.close(generation);
      updatePopoverWindow = null;
      publishState();
      focusUpdateStatus();
    }
  });
  popup.webContents.on("did-finish-load", () => {
    if (updatePopoverWindow !== popup || !updatePopoverLifecycle.isCurrent(generation) || popup.isDestroyed()) return;
    positionUpdatePopover();
    popup.webContents.send("desktop:update-popover-state", publicState());
    popup.show();
    popup.focus();
  });
  popup.loadFile(path.join(__dirname, "update-popover.html"), { query: { appearance: shellAppearance } });
  positionUpdatePopover();
  publishState();
  return { ok: true, open: true };
}

function positionInboxPopover() {
  if (!mainWindow || mainWindow.isDestroyed() || !inboxPopoverWindow || inboxPopoverWindow.isDestroyed()) return;
  const [windowWidth] = mainWindow.getContentSize();
  const [screenX, screenY] = mainWindow.getPosition();
  const width = Math.min(INBOX_POPOVER_WIDTH, Math.max(168, windowWidth - 24));
  inboxPopoverWindow.setBounds({
    x: screenX + 8,
    y: screenY + 36,
    width,
    height: inboxPopoverHeight,
  });
}

function closeInboxPopover({ returnFocus = true } = {}) {
  const popup = inboxPopoverWindow;
  const generation = popup?.__inboxPopoverGeneration;
  inboxPopoverToggleIntentAt = 0;
  inboxPopoverWindow = null;
  inboxPopoverLifecycle.close(generation);
  if (popup && !popup.isDestroyed()) {
    popup.removeAllListeners("blur");
    popup.close();
  }
  publishState();
  if (returnFocus) focusInboxStatus();
  return { ok: true, open: false };
}

async function shutdownDesktop() {
  updateRuntime?.stop();

  const service = inboxService;
  inboxService = null;
  await service?.stop({ wait: true });

  const popup = inboxPopoverWindow;
  inboxPopoverWindow = null;
  if (popup && !popup.isDestroyed()) popup.destroy();

  const updatePopup = updatePopoverWindow;
  updatePopoverWindow = null;
  if (updatePopup && !updatePopup.isDestroyed()) updatePopup.destroy();

  for (const [tabId, view] of views) {
    if (attachedViews.has(tabId) && mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.contentView.removeChildView(view); } catch (_) { /* already detached */ }
    }
    if (!view.webContents.isDestroyed()) view.webContents.destroy();
  }
  attachedViews.clear();
  views.clear();
  cleanupRuntimeExtensionStagingSync({ userDataPath: app.getPath("userData") });
}

function openInboxPopover() {
  if (inboxPopoverWindow && !inboxPopoverWindow.isDestroyed()) {
    closeInboxPopover();
    return { ok: true, open: false };
  }
  inboxPopoverToggleIntentAt = 0;
  inboxPopoverHeight = INBOX_POPOVER_MIN_HEIGHT;
  inboxPopoverWindow = new BrowserWindow({
    parent: mainWindow,
    width: INBOX_POPOVER_WIDTH,
    height: inboxPopoverHeight,
    minWidth: 168,
    maxWidth: INBOX_POPOVER_WIDTH,
    minHeight: INBOX_POPOVER_MIN_HEIGHT,
    maxHeight: INBOX_POPOVER_MAX_HEIGHT,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,
    show: false,
    title: "ERP 通道",
    backgroundColor: shellAppearance === "dark" ? "#18212c" : "#ffffff",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "inbox-popover-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const popup = inboxPopoverWindow;
  const generation = inboxPopoverLifecycle.open();
  popup.__inboxPopoverGeneration = generation;
  popup.on("blur", () => {
    setTimeout(() => {
      if (inboxPopoverWindow !== popup || !inboxPopoverLifecycle.isCurrent(generation) || popup.isDestroyed() || popup.isFocused()) return;
      if (Date.now() - inboxPopoverToggleIntentAt < 300) return;
      closeInboxPopover();
    }, 50);
  });
  popup.on("closed", () => {
    if (inboxPopoverWindow === popup && inboxPopoverLifecycle.isCurrent(generation)) {
      inboxPopoverLifecycle.close(generation);
      inboxPopoverWindow = null;
      publishState();
      focusInboxStatus();
    }
  });
  popup.webContents.on("did-finish-load", () => {
    if (inboxPopoverWindow !== popup || !inboxPopoverLifecycle.isCurrent(generation) || popup.isDestroyed()) return;
    positionInboxPopover();
    popup.webContents.send("desktop:inbox-popover-state", publicState());
    popup.show();
    popup.focus();
  });
  popup.loadFile(path.join(__dirname, "inbox-popover.html"), { query: { appearance: shellAppearance } });
  positionInboxPopover();
  publishState();
  return { ok: true, open: true };
}

async function runPopoverSmokeToggle() {
  const trace = [];
  const waitFor = async (predicate, timeout = 4000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Boolean(predicate());
  };
  const record = (action, result) => {
    trace.push({ action, result, open: publicState().inboxPopoverOpen });
  };

  // Close before the first load completes to exercise the stale did-finish-load path.
  const firstOpen = openInboxPopover();
  record("first-open", firstOpen);
  const firstClose = closeInboxPopover({ returnFocus: false });
  record("first-close-before-load", { ...firstClose, closed: firstClose?.open === false });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const staleClosed = !publicState().inboxPopoverOpen;

  const secondOpen = openInboxPopover();
  record("second-open", secondOpen);
  const secondShown = await waitFor(() => Boolean(inboxPopoverWindow && !inboxPopoverWindow.isDestroyed() && inboxPopoverWindow.isVisible()));
  const secondBounds = secondShown ? inboxPopoverWindow.getBounds() : null;
  trace.push({ action: "second-shown", open: publicState().inboxPopoverOpen, visible: secondShown, bounds: secondBounds });
  const secondClose = closeInboxPopover({ returnFocus: false });
  record("second-close", { ...secondClose, closed: secondClose?.open === false });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const finalOpen = publicState().inboxPopoverOpen;
  return {
    ok: staleClosed && secondShown && !finalOpen,
    cycles: 2,
    staleClosed,
    secondShown,
    secondBounds,
    finalOpen,
    trace,
  };
}

async function runPopoverDomClickSmoke() {
  const trace = [];
  const waitFor = async (predicate, timeout = 4000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Boolean(predicate());
  };
  const record = (action, extra = {}) => trace.push({ action, ...extra, ...inboxPopoverSnapshot(), stateOpen: publicState().inboxPopoverOpen });
  const clickStatus = (delayAfterPointerDown = 0) => mainWindow.webContents.executeJavaScript(`(async () => {
    const button = document.querySelector("#inbox-status");
    if (!button) return { ok: false, error: "#inbox-status not found" };
    button.focus();
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    if (${delayAfterPointerDown} > 0) await new Promise((resolve) => setTimeout(resolve, ${delayAfterPointerDown}));
    button.click();
    return { ok: true };
  })()`, true);

  closeInboxPopover({ returnFocus: false });
  await new Promise((resolve) => setTimeout(resolve, 100));
  record("dom-before-first-click");
  const firstClick = await clickStatus();
  record("dom-first-click", { ipc: firstClick });
  const firstShown = await waitFor(() => inboxPopoverSnapshot().visible);
  record("dom-first-shown", { firstShown });

  // A physical click focuses the shell before its click handler invokes IPC.
  // Waiting past the blur grace period makes the former ordering bug deterministic.
  inboxPopoverWindow?.blur();
  record("dom-before-second-click-after-blur");
  const secondClick = await clickStatus(75);
  record("dom-second-click", { ipc: secondClick });
  await new Promise((resolve) => setTimeout(resolve, 650));
  const final = inboxPopoverSnapshot();
  record("dom-final", { final });
  closeInboxPopover({ returnFocus: false });
  return {
    ok: firstShown && !final.open && !final.visible && final.windowCount <= 1,
    firstShown,
    final,
    trace,
  };
}

async function runUpdatePopoverDomClickSmoke() {
  const trace = [];
  const waitFor = async (predicate, timeout = 4000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Boolean(predicate());
  };
  const record = (action, extra = {}) => trace.push({ action, ...extra, ...updatePopoverSnapshot(), stateOpen: publicState().updatePopoverOpen });
  const clickStatus = (delayAfterPointerDown = 0) => mainWindow.webContents.executeJavaScript(`(async () => {
    const button = document.querySelector("#update-status");
    if (!button) return { ok: false, error: "#update-status not found" };
    button.focus();
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    if (${delayAfterPointerDown} > 0) await new Promise((resolve) => setTimeout(resolve, ${delayAfterPointerDown}));
    button.click();
    return { ok: true };
  })()`, true);

  const staleOpen = openUpdatePopover({ x: 118, y: 4, width: 70, height: 28 });
  record("stale-open", { result: staleOpen });
  const staleClose = closeUpdatePopover({ returnFocus: false });
  record("stale-close-before-load", { result: staleClose });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const staleClosed = !updatePopoverSnapshot().open;

  const firstClick = await clickStatus();
  record("dom-first-click", { ipc: firstClick });
  const firstShown = await waitFor(() => updatePopoverSnapshot().visible);
  record("dom-first-shown", { firstShown });
  updatePopoverWindow?.blur();
  record("dom-before-second-click-after-blur");
  const secondClick = await clickStatus(75);
  record("dom-second-click", { ipc: secondClick });
  await new Promise((resolve) => setTimeout(resolve, 650));
  const final = updatePopoverSnapshot();
  record("dom-final", { final });
  closeUpdatePopover({ returnFocus: false });
  return {
    ok: staleClosed && firstShown && !final.open && !final.visible && final.windowCount <= 1,
    staleClosed,
    firstShown,
    final,
    trace,
  };
}

function setActiveTab(tabId) {
  if (!views.has(tabId)) return { ok: false, error: "未知标签" };
  activeTab = tabId;
  resizeViews();
  publishState();
  return { ok: true };
}

function hardenSession(targetSession) {
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  targetSession.setPermissionCheckHandler(() => false);
}

async function buildRemoteView(tabId, partition, extensionDirectory) {
  const tabSession = session.fromPartition(partition, { cache: true });
  hardenSession(tabSession);
  const view = new WebContentsView({
    webPreferences: {
      session: tabSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  views.set(tabId, view);
  if (tabId === "erp") view.webContents.setZoomFactor(erpZoomPercent / 100);

  view.webContents.setWindowOpenHandler(({ url }) => {
    const decision = resolveRemotePopup(tabId, url);
    if (decision.action === "navigate") {
      setImmediate(() => navigateRemoteView(tabId, decision.url, "新窗口"));
    } else {
      setStatus(tabId, { notice: `已阻止站外新窗口：${url}` });
    }
    return { action: "deny" };
  });
  view.webContents.on("will-navigate", (event, target) => {
    const url = typeof target === "string" ? target : target.url;
    const normalized = normalizeAllowedRemoteUrl(tabId, url);
    if (!normalized) {
      event.preventDefault();
      setStatus(tabId, { blockedUrl: url, notice: `已阻止站外跳转：${url}` });
    } else if (normalized !== url) {
      event.preventDefault();
      setImmediate(() => navigateRemoteView(tabId, normalized, "安全跳转"));
    }
  });
  view.webContents.on("will-redirect", (event, target) => {
    const url = typeof target === "string" ? target : target.url;
    const normalized = normalizeAllowedRemoteUrl(tabId, url);
    if (!normalized) {
      event.preventDefault();
      setStatus(tabId, { blockedUrl: url, notice: `已阻止站外登录跳转：${url}` });
    } else if (normalized !== url) {
      event.preventDefault();
      setImmediate(() => navigateRemoteView(tabId, normalized, "登录跳转"));
    }
  });
  view.webContents.on("did-navigate", (_event, url, _httpResponseCode, _httpStatusText, isMainFrame) => {
    if (isMainFrame) setStatus(tabId, { status: "ready", url, error: null, notice: null });
  });
  view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) setStatus(tabId, { status: "ready", url, error: null, notice: null });
  });
  view.webContents.on("did-stop-loading", () => publishNavigationState(view.webContents));
  view.webContents.on("did-finish-load", () => {
    if (tabId === "erp") view.webContents.setZoomFactor(erpZoomPercent / 100);
  });
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      setStatus(tabId, { status: "error", url: validatedURL, error: `页面加载失败：${errorDescription} (${errorCode})` });
    }
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    setStatus(tabId, { status: "error", error: `内置页面进程已退出：${details.reason}` });
  });

  await loadExtension(tabId, tabSession, extensionDirectory);
  navigateRemoteView(tabId, tabState[tabId].url, "初始页面");
  return view;
}

function navigateRemoteView(tabId, rawUrl, source = "地址栏") {
  const url = normalizeAllowedRemoteUrl(tabId, rawUrl);
  const view = views.get(tabId);
  if (!url || !view) return { ok: false, error: "只允许当前标签的受控站内地址" };
  setStatus(tabId, { status: "loading", url, error: null, notice: `${source}正在加载` });
  view.webContents.loadURL(url).catch((error) => {
    setStatus(tabId, { status: "error", url, error: `页面无法打开：${error.message}`, notice: null });
  });
  return { ok: true, url };
}

async function loadExtension(tabId, tabSession, extensionDirectory) {
  const extension = { status: "loading", path: extensionDirectory, message: null };
  setStatus(tabId, { extension });
  let nextExtension;
  try {
    const runtimeDirectory = await prepareRuntimeExtension({
      sourceDirectory: projectPath("integrations", extensionDirectory),
      port: inboxState.port,
      runtimeId: tabId,
      userDataPath: app.getPath("userData"),
    });
    const loaded = await tabSession.loadExtension(runtimeDirectory, { allowFileAccess: true });
    nextExtension = { ...extension, status: "loaded", id: loaded.id, name: loaded.name, path: runtimeDirectory };
    setStatus(tabId, { extension: nextExtension });
    const contextToConfigure = activeWorkspaceContext || workspaceContextCoordinator.getPendingContext();
    if (contextToConfigure) {
      await configureExtensionStorage(tabId, tabSession, loaded.id, contextToConfigure);
      workspaceContextCoordinator.recordConfigured(tabId, loaded.id, contextToConfigure);
    }
  } catch (error) {
    if (nextExtension) {
      workspaceContextCoordinator.forget(tabId);
      activeWorkspaceContext = workspaceContextCoordinator.getCommittedContext();
      setStatus(tabId, { extension: extensionLoadFailureState(extension, nextExtension, error) });
    } else {
      setStatus(tabId, { extension: extensionLoadFailureState(extension, null, error) });
    }
  }
}

async function configureExtensionStorage(tabId, tabSession, extensionId, context) {
  if (!tabSession || !extensionId || !context?.workspaceId) throw new Error("缺少受控工作区上下文，扩展收件配置已拒绝。");
  const popupPath = tabId === "erp" ? "popup/popup.html" : "popup.html";
  const configWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      session: tabSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await configWindow.loadURL(`chrome-extension://${extensionId}/${popupPath}`);
    const serialized = JSON.stringify(extensionStorageConfig({
      port: inboxState.port,
      capability: inboxCapability,
      workspaceId: context.workspaceId,
    }));
    const configured = await configWindow.webContents.executeJavaScript(
      `(async () => { await chrome.storage.local.set(${serialized}); return true; })()`,
      true,
    );
    if (configured !== true) throw new Error("扩展安全收件配置未确认写入。");
  } finally {
    if (!configWindow.isDestroyed()) configWindow.destroy();
  }
}

async function configureLoadedExtensions(context) {
  const targets = ["erp", "1688"].map((tabId) => {
    const extension = tabState[tabId].extension;
    const view = views.get(tabId);
    return {
      tabId,
      extension,
      extensionId: extension?.id,
      session: view?.webContents?.session,
    };
  });
  const result = await workspaceContextCoordinator.apply(context, targets, async (target, targetContext = context) => {
    try {
      await configureExtensionStorage(target.tabId, target.session, target.extensionId, targetContext);
      setStatus(target.tabId, { extension: { ...target.extension, status: "loaded", message: null } });
    } catch (error) {
      setStatus(target.tabId, { extension: { ...target.extension, status: "failed", message: `安全收件配置失败：${error.message}` } });
      throw error;
    }
  });
  if (result.ok) activeWorkspaceContext = result.committedContext;
  else activeWorkspaceContext = workspaceContextCoordinator.getCommittedContext();
  return normalizeConfigurationResult(result);
}

function createWorkspaceView(url) {
  setStatus("workspace", { status: "loading", url, error: null });
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "workspace-preload.cjs"),
      additionalArguments: [`--shopeers-version=${app.getVersion()}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  views.set("workspace", view);
  view.webContents.on("did-start-navigation", (_event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) setStatus("workspace", { status: "loading", url, error: null, notice: null });
  });
  const blockDisallowedNavigation = (event, targetUrl) => {
    if (isAllowedWorkspaceUrl(targetUrl, DEV_URL || "")) return;
    event.preventDefault();
    setStatus("workspace", { status: "error", blockedUrl: targetUrl, error: "已阻止工作站主框架跳转到非受控地址。" });
  };
  view.webContents.on("will-navigate", (event, targetUrl) => blockDisallowedNavigation(event, targetUrl));
  view.webContents.on("will-redirect", (event, targetUrl) => blockDisallowedNavigation(event, targetUrl));
  view.webContents.on("did-navigate", (_event, url, _httpResponseCode, _httpStatusText, isMainFrame) => {
    if (isMainFrame) setStatus("workspace", { status: "ready", url, error: null, notice: null });
  });
  view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) setStatus("workspace", { status: "ready", url, error: null, notice: null });
  });
  view.webContents.on("did-stop-loading", () => publishNavigationState(view.webContents));
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) setStatus("workspace", { status: "error", url: validatedURL, error: `工作站加载失败：${errorDescription}` });
  });
  view.webContents.loadURL(url).then(() => setStatus("workspace", { status: "ready", url })).catch((error) => {
    setStatus("workspace", { status: "error", error: error.message });
  });
}

async function requestJson(pathname, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const query = options.query || {};
  const route = pathname;
  const requestUrl = buildInboxUrl(inboxState.port, { route, method, query, body: options.body ?? null });
  const headers = {
    ...(options.headers && typeof options.headers === "object" ? options.headers : {}),
    authorization: `Bearer ${inboxCapability}`,
  };
  if (options.body != null) headers["content-type"] = "application/json";
  const response = await net.fetch(requestUrl, {
    ...options,
    method,
    headers,
    ...(options.body == null ? {} : { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || `ERP 收件服务返回 HTTP ${response.status}`), {
    status: response.status,
    code: payload.error || payload.code || "INBOX_REQUEST_FAILED",
  });
  return payload;
}

async function runErpV2SmokeFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const requestId = `DESKTOP-SMOKE-${suffix}`;
  const platformSku = `DESKTOP-SKU-${suffix}`;
  const platformSkc = `DESKTOP-SKC-${suffix}`;
  const warehouseSku = `DESKTOP-WH-${suffix}`;
  const ledgerId = `DESKTOP-LEDGER-${suffix}`;
  const workspaceId = "workspace-default";
  const extensionConfiguration = await configureLoadedExtensions({ workspaceId, memberId: "desktop-smoke-member", visibility: "workspace" });
  const extensionConfigurationResponse = configurationHttpResult(extensionConfiguration);
  if (extensionConfigurationResponse.status !== 200) throw new Error(`Packaged smoke 扩展安全配置失败：${extensionConfigurationResponse.failures.join(",") || "没有可确认的已加载扩展"}`);
  const selectionStatusProbe = await requestJson("/selection/v1/status");
  const requestedAt = new Date().toISOString();
  const expectedSkus = [{ platformSku, platformSkc, warehouseSku }];
  const headers = { "content-type": "application/json" };
  await requestJson("/erp/v1/requests", {
    method: "POST",
    headers,
    body: JSON.stringify({
      request: {
        id: requestId,
        workspaceId,
        ledgerId,
        requestedAt,
        platformSkcs: [{ platformSkc }],
      },
      expectedSkus,
    }),
  });
  const deliveryCapturedAt = new Date(Date.now() + 100).toISOString();
  const bridgePath = tabState.erp.extension?.path && path.join(tabState.erp.extension.path, "src", "shopeers-bridge.js");
  if (!bridgePath || !fs.existsSync(bridgePath)) throw new Error("Packaged smoke 找不到 ERP 运行时 bridge。");
  const requestContextPath = tabState.erp.extension?.path && path.join(tabState.erp.extension.path, "src", "request-context.js");
  if (!requestContextPath || !fs.existsSync(requestContextPath)) throw new Error("Packaged smoke 找不到 ERP 请求上下文模块。");
  const listeners = new Map();
  let runtimeMessageHandler = null;
  const storage = new Map();
  storage.set("shopeersErpInboxBaseUrl", `http://127.0.0.1:${inboxState.port}`);
  storage.set("shopeersErpInboxCapability", inboxCapability);
  storage.set("shopeersErpWorkspaceId", workspaceId);
  const localStorage = {
    getItem: (key) => storage.get(String(key)) ?? null,
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: (key) => storage.delete(String(key)),
  };
  const windowMock = {
    localStorage,
    dispatchEvent: () => true,
    location: { href: "https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html" },
    addEventListener: (type, listener) => listeners.set(type, listener),
    setTimeout,
  };
  const chromeMock = {
    storage: { local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : []).map((key) => [key, storage.get(key)])),
      set: async (values) => { for (const [key, value] of Object.entries(values || {})) storage.set(key, value); },
      remove: async (keys) => { for (const key of (Array.isArray(keys) ? keys : [])) storage.delete(key); },
    } },
    runtime: {
      onMessage: { addListener: (listener) => { runtimeMessageHandler = listener; } },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      getManifest: () => ({ version: "8.0.15" }),
      lastError: null,
      sendMessage: (message, callback) => {
        if (typeof runtimeMessageHandler !== "function") {
          callback?.({ ok: false, status: "failed", message: "后台未就绪" });
          return;
        }
        let responded = false;
        const sendResponse = (value) => { responded = true; callback?.(value); };
        Promise.resolve(runtimeMessageHandler(message, {
          tab: { url: windowMock.location.href },
          frameId: 0,
        }, sendResponse)).then((keepAlive) => {
          if (keepAlive !== true && !responded) sendResponse({ ok: false, status: "failed", message: "后台无响应" });
        }).catch((error) => sendResponse({ ok: false, status: "failed", message: error.message }));
      },
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
  };
  const context = vm.createContext({
    __SHOPEERS_ERP_BACKGROUND_TEST__: true,
    window: windowMock,
    localStorage,
    document: { body: null, documentElement: { dataset: {} }, getElementById: () => null },
    navigator: {
      userAgent: "Lworkstation packaged smoke",
      locks: {
        request: async (_name, _options, callback) => callback({ name: "packaged-smoke-lock" }),
      },
    },
    URL,
    AbortController,
    chrome: chromeMock,
    fetch: (url, options) => net.fetch(url, options),
    console,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
  });
  vm.runInContext(fs.readFileSync(requestContextPath, "utf8"), context, { filename: requestContextPath });
  const backgroundPath = tabState.erp.extension?.path && path.join(tabState.erp.extension.path, "src", "background.js");
  if (!backgroundPath || !fs.existsSync(backgroundPath)) throw new Error("Packaged smoke 找不到 ERP 运行时后台模块。");
  vm.runInContext(fs.readFileSync(backgroundPath, "utf8"), context, { filename: backgroundPath });
  vm.runInContext(fs.readFileSync(bridgePath, "utf8"), context, { filename: bridgePath });
  const bridge = context.window.ShopeersErpDeliveryBridge;
  if (!bridge || typeof bridge.submit !== "function") throw new Error("ERP 运行时 bridge 未加载提交接口。");
  const deliveryResult = await bridge.submit({
      requestId,
      ledgerId,
      workspaceId,
      expectedSkus,
      querySkcs: [platformSkc],
      queryCapturedAt: deliveryCapturedAt,
      registeredBefore: deliveryCapturedAt,
      results: [{
        platformSkc,
        warehouseSku,
        mappings: [{ platformSku, platformSkc }],
        name: "桌面 v2 烟测商品",
        unitCost: 5.5,
        totalQty: 2,
        totalPrice: 11,
        selectedRecordIds: [`RECORD-${suffix}`],
      }],
      meta: { requestId, ledgerId, workspaceId, expectedSkus, querySkcs: [platformSkc], queryCapturedAt: deliveryCapturedAt, registeredBefore: deliveryCapturedAt, sourceFormat: "desktop-packaged-smoke", evidenceComplete: true },
      warehouseEvidence: {
        formatVersion: 2,
        warehouses: [{
          warehouseSku,
          evidenceComplete: true,
          purchaseRecords: [{
            recordId: `RECORD-${suffix}`,
            warehouseSku,
            productName: "桌面 v2 烟测商品",
            quantity: 2,
            unitPrice: 5.5,
            totalPrice: 11,
            purchaseDate: "2026-07-15",
            eligible: true,
            selectedForPreview: true,
          }],
          excludedRecords: [],
          sourceWarnings: [],
        }],
        excludedOrders: [],
        excludedDetails: [],
        detailFailures: [],
        mappingFailures: [],
      },
    });
  const selectionBackgroundPath = tabState["1688"].extension?.path && path.join(tabState["1688"].extension.path, "background.js");
  if (!selectionBackgroundPath || !fs.existsSync(selectionBackgroundPath)) throw new Error("Packaged smoke 找不到 1688 运行时后台模块。");
  const selectionRequests = [];
  const selectionRuntimeStorage = new Map([
    ["shopeersErpInboxBaseUrl", `http://127.0.0.1:${inboxState.port}`],
    ["shopeersErpInboxCapability", inboxCapability],
    ["shopeersErpWorkspaceId", workspaceId],
  ]);
  const selectionChrome = {
    storage: { local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : []).map((key) => [key, selectionRuntimeStorage.get(key)])),
      set: async (values) => { for (const [key, value] of Object.entries(values || {})) selectionRuntimeStorage.set(key, value); },
    } },
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      getManifest: () => ({ version: "1.2.1" }),
      lastError: null,
    },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  };
  const selectionBackgroundSource = fs.readFileSync(selectionBackgroundPath, "utf8");
  const startupInvocation = "\nreportInstalled();";
  const startupInvocationIndex = selectionBackgroundSource.lastIndexOf(startupInvocation);
  if (startupInvocationIndex < 0) throw new Error("1688 运行时未找到启动 heartbeat。");
  const selectionSmokeBackgroundSource = `${selectionBackgroundSource.slice(0, startupInvocationIndex)}
globalThis.__SELECTION_WORKBENCH_EXTENSION_STARTUP_PROMISE__ = reportInstalled();${selectionBackgroundSource.slice(startupInvocationIndex + startupInvocation.length)}`;
  const selectionContext = vm.createContext({
    __SELECTION_WORKBENCH_EXTENSION_TEST__: true,
    chrome: selectionChrome,
    URL,
    Headers,
    AbortController,
    fetch: (url, options) => {
      const headers = Object.fromEntries(new Headers(options?.headers || {}).entries());
      selectionRequests.push({ url: String(url), headers });
      return net.fetch(url, options);
    },
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(selectionSmokeBackgroundSource, selectionContext, { filename: selectionBackgroundPath });
  const selectionApi = selectionContext.__SELECTION_WORKBENCH_EXTENSION_TEST_API__;
  if (!selectionApi || typeof selectionApi.reportInstalled !== "function") throw new Error("1688 运行时 heartbeat 接口未加载。");
  const selectionHeartbeatResult = await selectionContext.__SELECTION_WORKBENCH_EXTENSION_STARTUP_PROMISE__;
  const selectionRequest = selectionRequests.at(-1);
  const selectionHeartbeat = {
    ok: selectionHeartbeatResult === true
      && selectionRequest?.url === `http://127.0.0.1:${inboxState.port}/selection/v1/extension-status`
      && selectionRequest.headers.authorization === `Bearer ${inboxCapability}`
      && selectionRequest.headers["x-shopeers-workspace-id"] === workspaceId,
    requestCount: selectionRequests.length,
  };
  const runSelectionNegativeCase = async (storageValues, label) => {
    const requests = [];
    const storage = new Map(Object.entries(storageValues || {}));
    const negativeContext = vm.createContext({
      __SELECTION_WORKBENCH_EXTENSION_TEST__: true,
      chrome: { ...selectionChrome, storage: { local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : []).map((key) => [key, storage.get(key)])),
        set: async () => {},
      } } },
      URL,
      Headers,
      AbortController,
      fetch: (url, options) => {
        requests.push({ url: String(url), options });
        return net.fetch(url, options);
      },
      console,
      setTimeout,
      clearTimeout,
    });
    vm.runInContext(selectionSmokeBackgroundSource, negativeContext, { filename: `${selectionBackgroundPath}:${label}` });
    const result = await negativeContext.__SELECTION_WORKBENCH_EXTENSION_STARTUP_PROMISE__;
    return { rejected: result === false && requests.length === 0, requestCount: requests.length };
  };
  const selectionNegativeCases = [
    {},
    { shopeersErpInboxBaseUrl: `http://127.0.0.1:${inboxState.port}`, shopeersErpInboxCapability: "short", shopeersErpWorkspaceId: workspaceId },
    { shopeersErpInboxBaseUrl: `http://192.0.2.1:${inboxState.port}`, shopeersErpInboxCapability: inboxCapability, shopeersErpWorkspaceId: workspaceId },
    { shopeersErpInboxBaseUrl: `http://127.0.0.1:${inboxState.port}`, shopeersErpInboxCapability: inboxCapability, shopeersErpWorkspaceId: "" },
  ];
  const selectionNegativeResults = await Promise.all(selectionNegativeCases.map((values, index) => runSelectionNegativeCase(values, `negative-${index + 1}`)));
  selectionHeartbeat.failClosed = selectionNegativeResults.every((result) => result.rejected);
  selectionHeartbeat.failClosedCount = selectionNegativeResults.filter((result) => result.rejected).length;
  if (!selectionHeartbeat.ok || !selectionHeartbeat.failClosed) throw new Error(`Packaged smoke 1688 storage transport failed: ${JSON.stringify(selectionHeartbeat)}`);
  const deadline = Date.now() + 15000;
  let status;
  do {
    await new Promise((resolve) => setTimeout(resolve, 250));
    status = await requestJson("/erp/v1/status");
  } while (status.latestBatch?.requestId !== requestId && Date.now() < deadline);
  while (status.latestBatch?.status !== "acknowledged" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    status = await requestJson("/erp/v1/status");
  }
  return {
    ok: status.latestBatch?.requestId === requestId && status.latestBatch?.status === "acknowledged",
    requestId,
    transport: "runtime-extension-bridge",
    delivery: deliveryResult,
    selectionHeartbeat: {
      ok: selectionHeartbeat.ok,
      requestCount: selectionHeartbeat.requestCount,
      failClosed: selectionHeartbeat.failClosed,
      failClosedCount: selectionHeartbeat.failClosedCount,
    },
    selectionStatusProbe: {
      ok: selectionStatusProbe?.ok === true,
      application: selectionStatusProbe?.application || null,
    },
    status,
  };
}

async function writeUpdateSmokeReport() {
  if (!updateSmokeReportPath) return;
  const phase = process.env.SHOPEERS_DESKTOP_UPDATE_SMOKE_PHASE || "postpone";
  const trace = [];
  const record = (action, extra = {}) => {
    trace.push({ action, at: Date.now(), state: updateRuntime?.snapshot() || { ...updateState }, ...extra });
    fs.writeFileSync(updateSmokeReportPath, JSON.stringify({ completed: false, phase, trace }, null, 2), "utf8");
  };
  const waitForState = async (predicate, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = updateRuntime?.snapshot() || updateState;
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return updateRuntime?.snapshot() || updateState;
  };

  const startup = await waitForState((state) => ["error", "available", "current"].includes(state.status));
  record("startup-check-settled");
  let retryCheck = null;
  if (startup.status === "error") {
    retryCheck = await checkForDesktopUpdates();
    record("manual-check-retry", { result: retryCheck });
  }
  const available = await waitForState((state) => state.status === "available");
  record("available-held");
  await new Promise((resolve) => setTimeout(resolve, 350));
  record("before-explicit-download");

  let canceled = null;
  let firstDownloadResult = null;
  if (phase === "postpone") {
    const firstDownload = downloadDesktopUpdate();
    record("first-download-requested");
    const progressing = await waitForState((state) => state.status === "downloading" && state.progress > 0);
    record("first-download-progress", { progress: progressing.progress });
    canceled = cancelDesktopUpdate();
    record("first-download-cancel", { result: canceled });
    firstDownloadResult = await firstDownload;
    await waitForState((state) => state.status === "canceled");
    record("first-download-canceled", { result: firstDownloadResult });
  }

  const downloadResult = await downloadDesktopUpdate();
  const downloaded = await waitForState((state) => state.status === "downloaded", 90000);
  record("download-complete", { result: downloadResult });
  let postponeResult = null;
  let installResult = null;
  const installCountBeforeAction = updateInstallInvocationCount;
  if (phase === "postpone") {
    postponeResult = postponeDesktopUpdate();
    record("postpone", { result: postponeResult });
  } else {
    installResult = await installDownloadedUpdate();
    record("explicit-install", { result: installResult });
  }

  const report = {
    ok: available.status === "available"
      && downloaded.status === "downloaded"
      && (phase !== "postpone" || (canceled?.ok && firstDownloadResult?.canceled && postponeResult?.ok && updateInstallInvocationCount === 0))
      && (phase !== "install" || (installResult?.installInvoked && updateInstallInvocationCount === 1)),
    phase,
    packaged: app.isPackaged,
    currentVersion: app.getVersion(),
    feedUrl: updateRuntime?.feedUrl || null,
    updaterOptions: {
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      allowPrerelease: autoUpdater.allowPrerelease,
      channel: autoUpdater.channel,
      disableDifferentialDownload: autoUpdater.disableDifferentialDownload,
    },
    smokeCache: {
      electron: app.getPath("cache"),
      localAppData: process.env.LOCALAPPDATA || null,
    },
    startupStatus: startup.status,
    retryCheck,
    availableHeldMs: 350,
    canceled,
    firstDownloadResult,
    downloadResult,
    postponeResult,
    installResult,
    installCountBeforeAction,
    installInvocationCount: updateInstallInvocationCount,
    finalState: updateRuntime?.snapshot() || updateState,
    trace,
  };
  fs.writeFileSync(updateSmokeReportPath, JSON.stringify(report, null, 2), "utf8");
  app.quit();
}

async function writeSmokeReport() {
  if (!smokeReportPath) return;
  const deadline = Date.now() + 20000;
  const workspace = views.get("workspace")?.webContents;
  while (workspace?.isLoadingMainFrame() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  while (smokeRequiresUpdateCheck && ["idle", "checking"].includes(updateState.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  let erpV2Fixture = null;
  if (smokeRequiresErpV2) {
    erpV2Fixture = await runErpV2SmokeFixture();
    await inboxService?.refresh();
  }
  const popoverToggleSmoke = await runPopoverSmokeToggle();
  const popoverDomClickSmoke = await runPopoverDomClickSmoke();
  const updatePopoverDomClickSmoke = await runUpdatePopoverDomClickSmoke();
  const tabSwitches = [];
  for (const tabId of ["erp", "1688", "workspace"]) {
    setActiveTab(tabId);
    tabSwitches.push({
      activeTab,
      attachedViews: [...attachedViews],
      bounds: views.get(tabId)?.getBounds() || null,
      zoomFactor: views.get(tabId)?.webContents.getZoomFactor() || null,
    });
  }
  const state = publicState();
  const extensionFileText = (extensionPath, relativePath) => {
    try { return fs.readFileSync(path.join(extensionPath, relativePath), "utf8"); } catch (_) { return ""; }
  };
  const erpBridgeText = extensionFileText(state.tabs.erp.extension?.path, path.join("src", "shopeers-bridge.js"));
  const erpBackgroundText = extensionFileText(state.tabs.erp.extension?.path, path.join("src", "background.js"));
  const selectionBackgroundText = extensionFileText(state.tabs["1688"].extension?.path, "background.js");
  const selectionPopupText = extensionFileText(state.tabs["1688"].extension?.path, "popup.js");
  const isolatedViews = tabSwitches.every((entry) => entry.attachedViews.length === 1 && entry.attachedViews[0] === entry.activeTab);
  const report = {
    ok: state.tabs.workspace.status === "ready" && Boolean(state.tabs.workspace.url) && isolatedViews && popoverToggleSmoke.ok && popoverDomClickSmoke.ok && updatePopoverDomClickSmoke.ok && (!smokeRequiresErpV2 || erpV2Fixture?.ok),
    packaged: app.isPackaged,
    applicationName: app.getName(),
    executableName: path.basename(process.execPath),
    packagedResources: {
      desktopIcon: fs.existsSync(DESKTOP_ICON_PATH),
      shell: fs.existsSync(path.join(__dirname, "shell.html")),
      workspacePreload: fs.existsSync(path.join(__dirname, "workspace-preload.cjs")),
    },
    version: state.version,
    electron: process.versions.electron,
    workspace: state.tabs.workspace,
    erp: state.tabs.erp,
    selection1688: state.tabs["1688"],
    update: state.update,
    inbox: state.inbox,
    erpZoom: state.erpZoom,
    extensionRuntime: {
      port: inboxState.port,
      root: runtimeRoot({ userDataPath: app.getPath("userData") }),
      erpPath: state.tabs.erp.extension?.path || null,
      selectionPath: state.tabs["1688"].extension?.path || null,
      erpBridgeDynamic: erpBridgeText.includes(`127.0.0.1:${inboxState.port}`),
      erpBridgeHardcoded: erpBridgeText.includes("127.0.0.1:8790/erp/v1/cost-results"),
      erpStorageKey: erpBridgeText.includes("__SHOPEERS_ERP_INBOX_BASE_URL__") && erpBackgroundText.includes("shopeersErpInboxBaseUrl"),
      selectionStorageContract: ["shopeersErpInboxBaseUrl", "shopeersErpInboxCapability", "shopeersErpWorkspaceId"]
        .every((key) => selectionBackgroundText.includes(key) && selectionPopupText.includes(key))
        && !selectionBackgroundText.includes("127.0.0.1:8790/selection/v1")
        && !selectionPopupText.includes("127.0.0.1:8790/selection/v1")
        && !selectionBackgroundText.includes("targetAddressSpace")
        && !selectionPopupText.includes("targetAddressSpace"),
      selectionHeartbeatCompatible: !selectionBackgroundText.includes("targetAddressSpace") && !selectionPopupText.includes("targetAddressSpace"),
      storageConfigured: workspaceContextCoordinator.getState(["erp", "1688"].map((tabId) => ({
        tabId,
        extensionId: tabState[tabId].extension?.id,
        session: views.get(tabId)?.webContents?.session,
      }))).storageConfigured,
    },
    erpV2Fixture,
    popoverToggleSmoke,
    popoverDomClickSmoke,
    updatePopoverDomClickSmoke,
    tabSwitches,
  };
  fs.writeFileSync(smokeReportPath, JSON.stringify(report, null, 2), "utf8");
  app.quit();
}

function readUpdateSettings({ allowLoopback = false } = {}) {
  if (allowLoopback && process.env.SHOPEERS_DESKTOP_UPDATE_URL) {
    return {
      enabled: true,
      feedConfig: {
        provider: "generic",
        url: process.env.SHOPEERS_DESKTOP_UPDATE_URL,
        channel: process.env.SHOPEERS_DESKTOP_UPDATE_CHANNEL === "beta" ? "beta" : "latest",
      },
    };
  }
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, "update-config.json")
    : path.join(__dirname, "update-config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { enabled: config.enabled === true, feedConfig: config };
  } catch (_) {
    return { enabled: false, feedConfig: PRODUCTION_FEED_CONFIG };
  }
}

function configureAutoUpdater() {
  const allowLoopback = process.env.SHOPEERS_DESKTOP_UPDATE_SMOKE === "1";
  const settings = readUpdateSettings({ allowLoopback });
  updateRuntime = createUpdateRuntime({
    updater: autoUpdater,
    CancellationToken,
    currentVersion: app.getVersion(),
    enabled: app.isPackaged && settings.enabled,
    feedConfig: settings.feedConfig,
    allowLoopback,
    onState: (state) => {
      updateState = state;
      publishState();
    },
  });
  updateState = updateRuntime.snapshot();
  publishState();
  if (app.isPackaged) updateRuntime.start();
}

function isUpdateSender(event) {
  return event.sender === mainWindow?.webContents || event.sender === updatePopoverWindow?.webContents;
}

function checkForDesktopUpdates() {
  return updateRuntime?.check({ silent: false }) || Promise.resolve({ ok: false, error: "更新服务尚未初始化" });
}

function downloadDesktopUpdate() {
  return updateRuntime?.download() || Promise.resolve({ ok: false, error: "更新服务尚未初始化" });
}

function cancelDesktopUpdate() {
  return updateRuntime?.cancel() || { ok: false, error: "更新服务尚未初始化" };
}

function postponeDesktopUpdate() {
  const result = updateRuntime?.postpone() || { ok: false, error: "更新服务尚未初始化" };
  if (result.ok) closeUpdatePopover();
  return result;
}

function openDesktopReleaseNotes() {
  const releaseUrl = normalizeReleaseUrl(updateState.release?.releaseUrl);
  if (!releaseUrl) return Promise.resolve({ ok: false, error: "当前没有可打开的发布说明" });
  return shell.openExternal(releaseUrl).then(() => ({ ok: true })).catch(() => ({ ok: false, error: "无法打开发布说明" }));
}

async function installDownloadedUpdate() {
  if (updateState.status !== "downloaded") return { ok: false, error: "更新尚未下载完成" };
  updateInstallInvocationCount += 1;
  if (process.env.SHOPEERS_DESKTOP_UPDATE_SMOKE === "1") return { ok: true, installInvoked: true, smoke: true };
  closeUpdatePopover({ returnFocus: false });
  await shutdownDesktop();
  shutdownComplete = true;
  autoUpdater.quitAndInstall(false, true);
  return { ok: true, installInvoked: true };
}

function registerProductionFrontend() {
  const root = projectPath("frontend");
  protocol.handle("shopeers", (request) => {
    const requestPath = decodeURIComponent(new URL(request.url).pathname);
    const candidate = path.resolve(root, `.${requestPath}`);
    const relative = path.relative(root, candidate);
    const isInsideRoot = !relative.startsWith("..") && !path.isAbsolute(relative);
    const file = isInsideRoot && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(root, "index.html");
    return net.fetch(pathToFileURL(file).href);
  });
}

async function createWindow() {
  if (!DEV_URL) registerProductionFrontend();
  const workspaceUrl = DEV_URL || "shopeers://workstation/";
  tabState.workspace.url = workspaceUrl;
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: visualDimension("SHOPEERS_DESKTOP_VISUAL_WIDTH", 1440, 980, 1920),
    height: visualDimension("SHOPEERS_DESKTOP_VISUAL_HEIGHT", 960, 700, 1200),
    minWidth: 980,
    minHeight: 700,
    title: "Lworkstation",
    icon: DESKTOP_ICON_PATH,
    backgroundColor: shellAppearance === "dark" ? "#0e1319" : "#eef2f6",
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: shellAppearance === "dark" ? "#161c24" : "#f7f9fc",
      symbolColor: shellAppearance === "dark" ? "#d7e0ea" : "#566273",
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await mainWindow.loadFile(path.join(__dirname, "shell.html"), { query: { appearance: shellAppearance } });
  const inboxScript = app.isPackaged
    ? path.join(process.resourcesPath, "runtime", "erp-inbox-server.mjs")
    : projectPath("tools", "erp-inbox-server.mjs");
  inboxService = createInboxServiceController({
    executable: process.execPath,
    scriptPath: inboxScript,
    spoolPath: process.env.SHOPEERS_ERP_INBOX_FILE || path.join(app.getPath("userData"), "runtime", "erp-inbox.json"),
    port: inboxState.port,
    capability: inboxCapability,
    runAsNode: true,
    onState: (state) => {
      inboxState = state;
      publishState();
    },
  });
  await inboxService.start();
  createWorkspaceView(workspaceUrl);
  resizeViews();
  mainWindow.show();
  configureAutoUpdater();
  if (updateSmokeReportPath) {
    await writeUpdateSmokeReport();
    return;
  }
  await buildRemoteView("erp", "persist:erp", "erp-assistant-extension");
  await buildRemoteView("1688", "persist:1688", "1688-selection-extension");
  mainWindow.on("resize", () => { resizeViews(); positionInboxPopover(); positionUpdatePopover(); });
  mainWindow.on("move", () => { positionInboxPopover(); positionUpdatePopover(); });
  mainWindow.on("closed", () => {
    closeInboxPopover({ returnFocus: false });
    closeUpdatePopover({ returnFocus: false });
    mainWindow = null;
  });
  resizeViews();
  publishState();
  await writeSmokeReport();
}

ipcMain.handle("desktop:get-state", () => publicState());
ipcMain.handle("desktop:request-inbox", async (event, input) => {
  if (event.sender !== views.get("workspace")?.webContents) {
    return { status: 403, body: { error: "UNTRUSTED_INBOX_SENDER", message: "仅允许工作站页面访问本机收件接口。" } };
  }
  let request;
  try {
    request = normalizeInboxRequest(input);
  } catch (error) {
    return { status: error.status || 400, body: { error: error.code || "INVALID_INBOX_REQUEST", message: error.message } };
  }
  if (request.route === "/selection/v1/context" && request.method === "POST") {
    let context;
    try {
      context = normalizeWorkspaceContext(request.body?.value);
    } catch (error) {
      return { status: error.status || 400, body: { error: error.code || "INVALID_WORKSPACE_CONTEXT", message: error.message } };
    }
    const configuration = await configureLoadedExtensions(context);
    const configurationResponse = configurationHttpResult(configuration);
    if (configurationResponse.status !== 200) return configurationResponse;
  }
  try {
    request = enforceWorkspaceContext(request, workspaceContextCoordinator.getCommittedContext());
  } catch (error) {
    return { status: error.status || 400, body: { error: error.code || "INVALID_INBOX_REQUEST", message: error.message } };
  }
  let responseBody;
  try {
    responseBody = await requestJson(request.route, {
      method: request.method,
      query: request.query,
      body: request.body?.value ?? null,
    });
  } catch (error) {
    return {
      status: Number(error.status) || 502,
      body: { error: error.code || "INBOX_REQUEST_FAILED", message: error.message || "本机收件请求失败。" },
    };
  }
  return { status: 200, body: responseBody };
});
ipcMain.handle("desktop:switch-tab", (_event, tabId) => setActiveTab(tabId));
ipcMain.on("desktop:inbox-popover-toggle-intent", (event) => {
  if (event.sender !== mainWindow?.webContents) return;
  inboxPopoverToggleIntentAt = Date.now();
});
ipcMain.handle("desktop:toggle-inbox-popover", (event) => {
  if (event.sender !== mainWindow?.webContents) return { ok: false, error: "无效的壳层请求" };
  return openInboxPopover();
});
ipcMain.handle("desktop:get-inbox-popover-state", (event) => {
  if (event.sender !== inboxPopoverWindow?.webContents) return { ok: false, error: "无效的浮窗请求" };
  return publicState();
});
ipcMain.handle("desktop:close-inbox-popover", (event) => {
  if (event.sender !== inboxPopoverWindow?.webContents) return { ok: false, error: "无效的浮窗请求" };
  closeInboxPopover();
  return { ok: true, open: false };
});
ipcMain.handle("desktop:resize-inbox-popover", (event, requestedHeight) => {
  if (event.sender !== inboxPopoverWindow?.webContents) return { ok: false, error: "无效的浮窗请求" };
  inboxPopoverHeight = Math.min(INBOX_POPOVER_MAX_HEIGHT, Math.max(INBOX_POPOVER_MIN_HEIGHT, Math.ceil(Number(requestedHeight) || 0)));
  positionInboxPopover();
  return { ok: true, height: inboxPopoverHeight };
});
ipcMain.on("desktop:update-popover-toggle-intent", (event) => {
  if (event.sender !== mainWindow?.webContents) return;
  updatePopoverToggleIntentAt = Date.now();
});
ipcMain.handle("desktop:toggle-update-popover", (event, anchor) => {
  if (event.sender !== mainWindow?.webContents) return { ok: false, error: "无效的壳层请求" };
  return openUpdatePopover(anchor);
});
ipcMain.handle("desktop:get-update-popover-state", (event) => {
  if (event.sender !== updatePopoverWindow?.webContents) return { ok: false, error: "无效的更新浮窗请求" };
  return publicState();
});
ipcMain.handle("desktop:close-update-popover", (event) => {
  if (event.sender !== updatePopoverWindow?.webContents) return { ok: false, error: "无效的更新浮窗请求" };
  return closeUpdatePopover();
});
ipcMain.handle("desktop:resize-update-popover", (event, requestedHeight) => {
  if (event.sender !== updatePopoverWindow?.webContents) return { ok: false, error: "无效的更新浮窗请求" };
  updatePopoverHeight = Math.min(UPDATE_POPOVER_MAX_HEIGHT, Math.max(UPDATE_POPOVER_MIN_HEIGHT, Math.ceil(Number(requestedHeight) || 0)));
  positionUpdatePopover();
  return { ok: true, height: updatePopoverHeight };
});
ipcMain.handle("desktop:back", () => {
  if (activeTab === "workspace") return { ok: false, error: "工作站使用页面内导航" };
  const view = views.get(activeTab);
  const result = navigateHistory(view?.webContents, "back");
  setTimeout(publishState, result.ok ? 50 : 0);
  return result;
});
ipcMain.handle("desktop:forward", () => {
  if (activeTab === "workspace") return { ok: false, error: "工作站使用页面内导航" };
  const view = views.get(activeTab);
  const result = navigateHistory(view?.webContents, "forward");
  setTimeout(publishState, result.ok ? 50 : 0);
  return result;
});
ipcMain.handle("desktop:refresh", () => views.get(activeTab)?.webContents.reload());
ipcMain.handle("desktop:open-external", () => {
  if (activeTab === "workspace") return { ok: false, error: "工作站页面不能外部打开" };
  const url = views.get(activeTab)?.webContents.getURL();
  if (!url || !normalizeAllowedRemoteUrl(activeTab, url)) return { ok: false, error: "当前地址不允许外部打开" };
  return openInExternalChrome(url).then((result) => ({ ok: true, ...result }));
});
ipcMain.handle("desktop:adjust-erp-zoom", (event, delta) => {
  if (event.sender !== mainWindow?.webContents) return { ok: false, error: "无效的壳层请求" };
  if (activeTab !== "erp") return { ok: false, error: "ERP 缩放仅在 ERP 标签可用" };
  const adjustment = Number(delta);
  if (![ERP_ZOOM_STEP, -ERP_ZOOM_STEP].includes(adjustment)) return { ok: false, error: "无效的 ERP 缩放步进" };
  const next = normalizeErpZoomPercent(erpZoomPercent + adjustment);
  erpZoomPercent = next;
  const view = views.get("erp");
  if (view && !view.webContents.isDestroyed()) view.webContents.setZoomFactor(erpZoomPercent / 100);
  let persistenceError = null;
  try {
    saveErpZoomPreference({ userDataPath: app.getPath("userData"), percent: erpZoomPercent });
  } catch (error) {
    persistenceError = error;
    reportPreferenceWriteFailure("ERP 缩放", error);
  }
  publishState();
  if (persistenceError) {
    return { ok: false, percent: erpZoomPercent, error: "缩放已应用，但暂时无法保存；下次启动可能恢复原设置" };
  }
  return { ok: true, percent: erpZoomPercent };
});
ipcMain.handle("desktop:check-update", (event) => isUpdateSender(event) ? checkForDesktopUpdates() : { ok: false, error: "无效的更新请求" });
ipcMain.handle("desktop:download-update", (event) => isUpdateSender(event) ? downloadDesktopUpdate() : { ok: false, error: "无效的更新请求" });
ipcMain.handle("desktop:cancel-update", (event) => isUpdateSender(event) ? cancelDesktopUpdate() : { ok: false, error: "无效的更新请求" });
ipcMain.handle("desktop:postpone-update", (event) => isUpdateSender(event) ? postponeDesktopUpdate() : { ok: false, error: "无效的更新请求" });
ipcMain.handle("desktop:install-update", (event) => isUpdateSender(event) ? installDownloadedUpdate() : { ok: false, error: "无效的更新请求" });
ipcMain.handle("desktop:open-release-notes", (event) => isUpdateSender(event) ? openDesktopReleaseNotes() : { ok: false, error: "无效的更新请求" });
ipcMain.handle("desktop:retry-extension", async (_event, tabId) => {
  const map = { erp: "erp-assistant-extension", "1688": "1688-selection-extension" };
  if (!map[tabId]) return { ok: false, error: "该标签没有扩展" };
  await loadExtension(tabId, session.fromPartition(`persist:${tabId}`, { cache: true }), map[tabId]);
  return { ok: true };
});

ipcMain.on("workspace:appearance", (event, appearance) => {
  if (event.sender !== views.get("workspace")?.webContents) return;
  shellAppearance = appearance === "dark" ? "dark" : "light";
  try {
    saveAppearancePreference({ userDataPath: app.getPath("userData"), appearance: shellAppearance });
  } catch (error) {
    reportPreferenceWriteFailure("外观", error);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitleBarOverlay({
      color: shellAppearance === "dark" ? "#161c24" : "#f7f9fc",
      symbolColor: shellAppearance === "dark" ? "#d7e0ea" : "#566273",
    });
    mainWindow.setBackgroundColor(shellAppearance === "dark" ? "#0e1319" : "#eef2f6");
  }
  if (inboxPopoverWindow && !inboxPopoverWindow.isDestroyed()) {
    inboxPopoverWindow.setBackgroundColor(shellAppearance === "dark" ? "#18212c" : "#ffffff");
  }
  if (updatePopoverWindow && !updatePopoverWindow.isDestroyed()) {
    updatePopoverWindow.setBackgroundColor(shellAppearance === "dark" ? "#18212c" : "#ffffff");
  }
  publishState();
});

app.setAppUserModelId("com.shopeers.workstation");
app.whenReady().then(createWindow).catch((error) => {
  console.error("桌面应用启动失败：", error);
  dialog.showErrorBox("Lworkstation 无法启动", error?.message || String(error));
  app.quit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownPromise) return;
  shutdownPromise = shutdownDesktop()
    .catch((error) => console.error("桌面退出清理失败：", error))
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});
