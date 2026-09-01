const tabs = [...document.querySelectorAll("[data-tab]")];
const address = document.querySelector("#address");
const addressShell = document.querySelector(".address-shell");
const appVersion = document.querySelector("#app-version");
const inboxAction = document.querySelector("#inbox-status");
const updateAction = document.querySelector("#update-status");
const erpLive = document.querySelector("#erp-live");
const erpZoom = document.querySelector("#erp-zoom");
const erpZoomLabel = document.querySelector("#erp-zoom-label");
const externalAction = document.querySelector('[data-action="external"]');
const backAction = document.querySelector('[data-action="back"]');
const forwardAction = document.querySelector('[data-action="forward"]');
const {
  classifyErpState,
  getAddressPresentation,
} = window.LworkstationShellState;
let latestState;
let lastErpAnnouncement = "";
let actionFeedbackTimer;

window.lucide?.createIcons();

function render(state) {
  if (!state) return;
  latestState = state;
  document.documentElement.dataset.appearance = state.appearance === "dark" ? "dark" : "light";
  document.documentElement.dataset.activeTab = state.activeTab || "workspace";
  const version = state.version || "浏览器环境";
  appVersion.textContent = version === "浏览器环境" ? version : `v${String(version).replace(/^v/i, "")}`;
  const update = state.update || {};
  const updateStatus = update.status || "disabled";
  const hasUpdate = ["available", "downloading", "downloaded", "canceled", "error"].includes(updateStatus);
  updateAction.dataset.status = updateStatus;
  updateAction.classList.toggle("has-update", hasUpdate);
  updateAction.setAttribute("aria-expanded", String(Boolean(state.updatePopoverOpen)));
  updateAction.setAttribute("aria-label", update.message ? `Lworkstation ${version}，${update.message}` : `Lworkstation ${version} 更新`);
  updateAction.title = updateAction.getAttribute("aria-label");

  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === state.activeTab;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });

  const activeTabState = state.tabs?.[state.activeTab];
  const workspaceActive = state.activeTab === "workspace";
  backAction.hidden = workspaceActive;
  forwardAction.hidden = workspaceActive;
  externalAction.hidden = workspaceActive;
  backAction.disabled = workspaceActive || !activeTabState?.canGoBack;
  forwardAction.disabled = workspaceActive || !activeTabState?.canGoForward;
  const addressPresentation = getAddressPresentation(state.activeTab, activeTabState);
  address.readOnly = addressPresentation.readOnly;
  address.setAttribute("aria-readonly", "true");
  address.value = addressPresentation.value;
  addressShell.classList.toggle("internal", workspaceActive);
  address.title = activeTabState?.error || addressPresentation.value;

  const inbox = state.inbox || {};
  const flow = inbox.flow || {};
  const presentation = classifyErpState(inbox, flow);
  const inboxPopoverOpen = Boolean(state.inboxPopoverOpen);
  inboxAction.dataset.status = presentation.tone;
  inboxAction.setAttribute("aria-expanded", String(inboxPopoverOpen));
  inboxAction.title = presentation.aria;
  inboxAction.setAttribute("aria-label", presentation.aria);
  if (lastErpAnnouncement && lastErpAnnouncement !== presentation.aria) erpLive.textContent = presentation.aria;
  lastErpAnnouncement = presentation.aria;
  const zoom = state.erpZoom || { percent: 80, min: 70, max: 120 };
  erpZoom.hidden = !state.activeTab || state.activeTab !== "erp";
  erpZoomLabel.textContent = `${zoom.percent}%`;
  erpZoom.querySelectorAll("[data-zoom]").forEach((button) => {
    const delta = Number(button.dataset.zoom);
    button.disabled = (delta < 0 && zoom.percent <= zoom.min) || (delta > 0 && zoom.percent >= zoom.max);
  });
}

function showActionFeedback(message) {
  erpLive.textContent = message;
  clearTimeout(actionFeedbackTimer);
  actionFeedbackTimer = setTimeout(() => {
    if (erpLive.textContent === message) erpLive.textContent = "";
  }, 2800);
}

async function runDesktopAction(action, failureMessage) {
  try {
    const result = await action();
    if (result?.ok === false) showActionFeedback(result.error || failureMessage);
    return result;
  } catch (error) {
    showActionFeedback(error?.message || failureMessage);
    return { ok: false, error: error?.message || failureMessage };
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {
    void runDesktopAction(() => window.desktop.switchTab(tab.dataset.tab), "无法切换页面");
  });
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
});

document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
  const action = button.dataset.action;
  if (action === "back") await runDesktopAction(() => window.desktop.back(), "当前页面无法后退");
  if (action === "forward") await runDesktopAction(() => window.desktop.forward(), "当前页面无法前进");
  if (action === "refresh") await runDesktopAction(() => window.desktop.refresh(), "当前页面无法刷新");
  if (action === "external") await runDesktopAction(() => window.desktop.openExternal(), "无法在外部浏览器打开当前页面");
}));

erpZoom.querySelectorAll("[data-zoom]").forEach((button) => button.addEventListener("click", () => {
  void runDesktopAction(() => window.desktop.adjustErpZoom(Number(button.dataset.zoom)), "无法调整 ERP 页面缩放");
}));

inboxAction.addEventListener("pointerdown", () => { window.desktop.noteInboxPopoverToggleIntent(); });
inboxAction.addEventListener("click", () => { void window.desktop.toggleInboxPopover(); });
updateAction.addEventListener("pointerdown", () => { window.desktop.noteUpdatePopoverToggleIntent(); });
updateAction.addEventListener("click", () => {
  const rect = updateAction.getBoundingClientRect();
  void window.desktop.toggleUpdatePopover({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
});

window.desktop.onState(render);
window.desktop.getState().then(render);
