const card = document.querySelector(".update-card");
const message = document.querySelector("#update-message");
const stateBadge = document.querySelector("#update-state");
const currentVersion = document.querySelector("#current-version");
const latestRow = document.querySelector("#latest-row");
const latestVersion = document.querySelector("#latest-version");
const sizeRow = document.querySelector("#size-row");
const packageSize = document.querySelector("#package-size");
const dateRow = document.querySelector("#date-row");
const releaseDate = document.querySelector("#release-date");
const progressRow = document.querySelector("#progress-row");
const progressBar = document.querySelector("#progress-bar");
const progressValue = document.querySelector("#progress-value");
const notesSection = document.querySelector("#notes-section");
const releaseNotes = document.querySelector("#release-notes");
const releaseNotesAction = document.querySelector("#release-notes-action");
const actions = [...document.querySelectorAll("[data-update-action]")];
let latestState = null;
let actionPending = false;

const statusLabels = {
  disabled: "未启用",
  idle: "待检查",
  checking: "检查中",
  current: "最新",
  available: "可更新",
  downloading: "下载中",
  canceled: "已取消",
  downloaded: "待安装",
  error: "异常",
};

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "--";
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function requestResize() {
  const height = Math.ceil(card?.scrollHeight || 0) + 8;
  if (height > 0) void window.updatePopover.resize(height);
}

function render(state) {
  if (!state?.update) return;
  latestState = state;
  document.documentElement.dataset.appearance = state.appearance === "dark" ? "dark" : "light";
  const update = state.update;
  const release = update.release || {};
  currentVersion.textContent = update.currentVersion ? `v${String(update.currentVersion).replace(/^v/i, "")}` : "--";
  message.textContent = update.message || "更新状态不可用";
  stateBadge.textContent = statusLabels[update.status] || "未知";
  stateBadge.dataset.tone = update.status === "error" ? "danger" : ["available", "downloading", "downloaded"].includes(update.status) ? "primary" : "muted";

  latestRow.hidden = !update.availableVersion;
  latestVersion.textContent = update.availableVersion ? `v${String(update.availableVersion).replace(/^v/i, "")}` : "--";
  sizeRow.hidden = !release.size;
  packageSize.textContent = formatBytes(release.size);
  dateRow.hidden = !release.releaseDate;
  releaseDate.textContent = formatDate(release.releaseDate);

  progressRow.hidden = update.status !== "downloading";
  const progress = Math.max(0, Math.min(100, Number(update.progress || 0)));
  progressBar.style.width = `${progress}%`;
  progressValue.textContent = `${Math.round(progress)}%`;

  notesSection.hidden = !release.notes && !release.releaseUrl;
  releaseNotes.hidden = !release.notes;
  releaseNotes.textContent = release.notes || "";
  releaseNotesAction.hidden = !release.releaseUrl;

  actions.forEach((button) => { button.hidden = true; button.disabled = actionPending; });
  const show = (...names) => names.forEach((name) => {
    const button = actions.find((entry) => entry.dataset.updateAction === name);
    if (button) { button.hidden = false; button.disabled = actionPending; }
  });
  if (["idle", "current"].includes(update.status)) show("check");
  if (update.status === "available") show("download");
  if (update.status === "downloading") show("cancel");
  if (update.status === "canceled") show("retry");
  if (update.status === "error") show("retry");
  if (update.status === "downloaded") show("postpone", "install");
  requestResize();
}

async function runAction(name) {
  if (actionPending) return;
  actionPending = true;
  render(latestState);
  try {
    if (name === "check") await window.updatePopover.check();
    if (name === "download") await window.updatePopover.download();
    if (name === "cancel") await window.updatePopover.cancel();
    if (name === "retry") {
      if (latestState?.update?.retryAction === "download") await window.updatePopover.download();
      else await window.updatePopover.retry();
    }
    if (name === "install") await window.updatePopover.install();
    if (name === "postpone") await window.updatePopover.postpone();
  } finally {
    actionPending = false;
    if (latestState) render(latestState);
  }
}

actions.forEach((button) => button.addEventListener("click", () => { void runAction(button.dataset.updateAction); }));
releaseNotesAction.addEventListener("click", () => { void window.updatePopover.openReleaseNotes(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  void window.updatePopover.close();
});
window.updatePopover.onState(render);
window.updatePopover.getState().then(render);
window.addEventListener("load", () => { card?.focus(); requestResize(); });
