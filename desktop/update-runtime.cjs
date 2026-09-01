const RELEASES_ORIGIN = "https://github.com";
const RELEASES_PATH_PREFIX = "/love70805/lworkstation/releases/";
const PRODUCTION_FEED_CONFIG = Object.freeze({
  provider: "github",
  owner: "love70805",
  repo: "lworkstation",
  private: false,
  channel: "latest",
});
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

function normalizeFeedUrl(value, { allowLoopback = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch (_) {
    return null;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const hostname = parsed.hostname.toLowerCase();
  const loopback = ["127.0.0.1", "localhost"].includes(hostname);
  if (allowLoopback && loopback && ["http:", "https:"].includes(parsed.protocol)) {
    return parsed.href.replace(/\/$/, "");
  }
  return null;
}

function normalizeFeedConfig(value, { allowLoopback = false, allowPrerelease = false } = {}) {
  if (typeof value === "string") {
    const url = normalizeFeedUrl(value, { allowLoopback });
    return url ? { provider: "generic", url, channel: "latest" } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const channel = value.channel == null ? "latest" : value.channel;
  if (channel !== "latest" && !(allowPrerelease && channel === "beta")) return null;
  if (value.provider === "generic") {
    const url = normalizeFeedUrl(value.url, { allowLoopback });
    return url ? { provider: "generic", url, channel } : null;
  }
  if (
    value.provider !== "github"
    || value.owner !== PRODUCTION_FEED_CONFIG.owner
    || value.repo !== PRODUCTION_FEED_CONFIG.repo
    || value.private === true
    || (value.host != null && value.host !== "github.com")
    || value.token != null
  ) return null;
  return { ...PRODUCTION_FEED_CONFIG, channel };
}

function isPrereleaseVersion(value) {
  return /^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z][0-9A-Za-z.-]*$/.test(String(value || ""));
}

function normalizeReleaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.origin !== RELEASES_ORIGIN) return null;
  if (!parsed.pathname.startsWith(RELEASES_PATH_PREFIX)) return null;
  return parsed.href;
}

function plainText(value, maxLength = 320) {
  const raw = Array.isArray(value)
    ? value.map((entry) => typeof entry === "string" ? entry : entry?.note || "").join("\n")
    : String(value || "");
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeError(error) {
  const message = plainText(error?.message || error || "未知更新错误", 240);
  if (/Cannot find channel .*update info|\b404\b/i.test(message)) return "暂未找到可用更新，请稍后重试";
  if (/\b5\d\d\b|ECONN|ENOTFOUND|ETIMEDOUT|timeout/i.test(message)) return "更新服务暂时不可用，请稍后重试";
  return message
    .replace(/\s*["']?method:\s*(?:GET|HEAD|POST)\b.*$/i, "")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[本地路径]")
    .replace(/file:\/\/\S+/gi, "[本地路径]");
}

function normalizeSize(info) {
  const sizes = (info?.files || []).map((file) => Number(file?.size || 0)).filter((size) => Number.isFinite(size) && size > 0);
  return sizes.length ? Math.max(...sizes) : null;
}

function releaseUrlForVersion(version) {
  const safeVersion = String(version || "").trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(safeVersion)) return null;
  return `${RELEASES_ORIGIN}${RELEASES_PATH_PREFIX}tag/v${encodeURIComponent(safeVersion)}`;
}

function sanitizeUpdateInfo(info = {}) {
  const version = plainText(info.version, 64);
  return {
    version: version || null,
    size: normalizeSize(info),
    releaseDate: Number.isNaN(Date.parse(info.releaseDate || "")) ? null : new Date(info.releaseDate).toISOString(),
    notes: plainText(info.releaseNotes, 320),
    releaseUrl: normalizeReleaseUrl(info.releaseUrl) || releaseUrlForVersion(version),
  };
}

function createInitialUpdateState({ currentVersion, enabled }) {
  return {
    status: enabled ? "idle" : "disabled",
    currentVersion,
    availableVersion: null,
    progress: 0,
    message: enabled ? "尚未检查更新" : "更新检查尚未启用",
    release: null,
    retryAction: null,
    lastCheckedAt: null,
  };
}

function createUpdateRuntime({
  updater,
  CancellationToken,
  currentVersion,
  enabled,
  feedConfig,
  feedUrl,
  allowLoopback = false,
  onState = () => {},
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const currentIsPrerelease = isPrereleaseVersion(currentVersion);
  const safeFeedConfig = normalizeFeedConfig(feedConfig ?? feedUrl, {
    allowLoopback,
    allowPrerelease: currentIsPrerelease,
  });
  let state = createInitialUpdateState({ currentVersion, enabled: enabled && Boolean(safeFeedConfig) });
  let checkPromise = null;
  let downloadPromise = null;
  let downloadToken = null;
  let schedule = null;
  let cancelRequested = false;

  const publish = (patch) => {
    state = { ...state, ...patch };
    onState({ ...state, release: state.release ? { ...state.release } : null });
    return state;
  };
  const snapshot = () => ({ ...state, release: state.release ? { ...state.release } : null });

  if (enabled && !safeFeedConfig) {
    publish({ status: "disabled", message: "更新源配置无效", retryAction: null });
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowPrerelease = currentIsPrerelease && safeFeedConfig?.channel === "beta";
  updater.disableDifferentialDownload = allowLoopback;
  updater.channel = safeFeedConfig?.channel || "latest";
  if (safeFeedConfig) updater.setFeedURL(safeFeedConfig);

  updater.on("checking-for-update", () => publish({ status: "checking", message: "正在检查更新", retryAction: null }));
  updater.on("update-not-available", () => publish({
    status: "current",
    availableVersion: null,
    progress: 0,
    message: "已是最新版本",
    release: null,
    retryAction: null,
    lastCheckedAt: new Date(now()).toISOString(),
  }));
  updater.on("update-available", (info) => {
    const release = sanitizeUpdateInfo(info);
    publish({
      status: "available",
      availableVersion: release.version,
      progress: 0,
      message: `发现新版本 ${release.version || ""}`.trim(),
      release,
      retryAction: null,
      lastCheckedAt: new Date(now()).toISOString(),
    });
  });
  updater.on("download-progress", (progress) => {
    if (state.status !== "downloading" || cancelRequested) return;
    const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent || 0))));
    publish({ progress: percent, message: `正在下载 ${percent}%` });
  });
  updater.on("update-cancelled", () => {
    cancelRequested = true;
    publish({ status: "canceled", progress: 0, message: "下载已取消", retryAction: "download" });
  });
  updater.on("update-downloaded", (info) => {
    if (cancelRequested) return;
    const release = state.release || sanitizeUpdateInfo(info);
    publish({
      status: "downloaded",
      availableVersion: release.version,
      progress: 100,
      message: "更新已下载，可重启安装",
      release,
      retryAction: null,
    });
  });
  updater.on("error", (error) => {
    if (cancelRequested) return;
    const retryAction = state.status === "downloading" ? "download" : "check";
    publish({ status: "error", message: sanitizeError(error), retryAction });
  });

  async function check({ silent = false } = {}) {
    if (state.status === "disabled") return { ok: false, error: state.message };
    if (downloadPromise || state.status === "downloaded") return { ok: false, error: "当前状态不能检查更新" };
    if (checkPromise) return checkPromise;
    if (!silent) publish({ status: "checking", message: "正在检查更新", retryAction: null });
    checkPromise = updater.checkForUpdates()
      .then((result) => ({ ok: true, available: state.status === "available", result: Boolean(result) }))
      .catch((error) => {
        publish({ status: "error", message: sanitizeError(error), retryAction: "check" });
        return { ok: false, error: sanitizeError(error) };
      })
      .finally(() => { checkPromise = null; });
    return checkPromise;
  }

  async function download() {
    if (downloadPromise) return downloadPromise;
    if (!["available", "canceled"].includes(state.status) && !(state.status === "error" && state.retryAction === "download")) {
      return { ok: false, error: "当前没有可下载的更新" };
    }
    cancelRequested = false;
    downloadToken = new CancellationToken();
    publish({ status: "downloading", progress: 0, message: "准备下载更新", retryAction: null });
    downloadPromise = updater.downloadUpdate(downloadToken)
      .then(() => cancelRequested
        ? { ok: false, canceled: true }
        : { ok: state.status === "downloaded", downloaded: state.status === "downloaded" })
      .catch((error) => {
        if (cancelRequested || downloadToken?.cancelled) {
          publish({ status: "canceled", progress: 0, message: "下载已取消", retryAction: "download" });
          return { ok: false, canceled: true };
        }
        publish({ status: "error", message: sanitizeError(error), retryAction: "download" });
        return { ok: false, error: sanitizeError(error) };
      })
      .finally(() => {
        downloadToken?.dispose?.();
        downloadToken = null;
        downloadPromise = null;
      });
    return downloadPromise;
  }

  function cancel() {
    if (state.status !== "downloading" || !downloadToken) return { ok: false, error: "当前没有下载任务" };
    cancelRequested = true;
    downloadToken.cancel();
    publish({ status: "canceled", progress: 0, message: "下载已取消", retryAction: "download" });
    return { ok: true, canceled: true };
  }

  function postpone() {
    if (state.status !== "downloaded") return { ok: false, error: "更新尚未下载完成" };
    publish({ message: "更新已下载，可稍后重启安装" });
    return { ok: true, postponed: true };
  }

  function start() {
    if (state.status === "disabled") return;
    void check({ silent: true });
    schedule = setIntervalFn(() => { void check({ silent: true }); }, UPDATE_INTERVAL_MS);
  }

  function stop() {
    if (schedule) clearIntervalFn(schedule);
    schedule = null;
    if (downloadToken) cancel();
  }

  return {
    get feedUrl() { return safeFeedConfig?.url || null; },
    get feedConfig() { return safeFeedConfig ? { ...safeFeedConfig } : null; },
    snapshot,
    check,
    download,
    cancel,
    postpone,
    start,
    stop,
  };
}

module.exports = {
  PRODUCTION_FEED_CONFIG,
  UPDATE_INTERVAL_MS,
  createInitialUpdateState,
  createUpdateRuntime,
  isPrereleaseVersion,
  normalizeFeedConfig,
  normalizeFeedUrl,
  normalizeReleaseUrl,
  plainText,
  sanitizeError,
  sanitizeUpdateInfo,
};
