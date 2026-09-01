import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CancellationToken } = require("electron-updater");
const {
  PRODUCTION_FEED_CONFIG,
  UPDATE_INTERVAL_MS,
  createUpdateRuntime,
  isPrereleaseVersion,
  normalizeFeedConfig,
  normalizeFeedUrl,
  normalizeReleaseUrl,
  sanitizeError,
  sanitizeUpdateInfo,
} = require("./update-runtime.cjs");
const legacyPrivateRepo = ["shopeers", "workstation"].join("-");

assert.deepEqual(normalizeFeedConfig(PRODUCTION_FEED_CONFIG), PRODUCTION_FEED_CONFIG);
assert.deepEqual(normalizeFeedConfig({ provider: "github", owner: "love70805", repo: "lworkstation" }), PRODUCTION_FEED_CONFIG);
assert.deepEqual(normalizeFeedConfig({ enabled: false, ...PRODUCTION_FEED_CONFIG }), PRODUCTION_FEED_CONFIG);
assert.deepEqual(
  normalizeFeedConfig({ ...PRODUCTION_FEED_CONFIG, channel: "beta" }, { allowPrerelease: true }),
  { ...PRODUCTION_FEED_CONFIG, channel: "beta" },
);
assert.equal(normalizeFeedConfig({ ...PRODUCTION_FEED_CONFIG, channel: "beta" }), null);
assert.equal(normalizeFeedConfig({ ...PRODUCTION_FEED_CONFIG, token: "secret" }), null);
assert.equal(normalizeFeedConfig({ provider: "github", owner: "other", repo: "lworkstation" }), null);
assert.equal(normalizeFeedConfig({ provider: "github", owner: "love70805", repo: legacyPrivateRepo }), null);
assert.equal(normalizeFeedConfig({ provider: "generic", url: "https://github.com/love70805/lworkstation/releases/latest/download" }), null);
assert.equal(normalizeFeedUrl("https://github.com/love70805/lworkstation/releases/latest/download"), null);
assert.equal(normalizeFeedUrl("http://127.0.0.1:3210"), null);
assert.equal(normalizeFeedUrl("http://127.0.0.1:3210", { allowLoopback: true }), "http://127.0.0.1:3210");
assert.deepEqual(normalizeFeedConfig("http://127.0.0.1:3210", { allowLoopback: true }), { provider: "generic", url: "http://127.0.0.1:3210", channel: "latest" });
assert.deepEqual(
  normalizeFeedConfig({ provider: "generic", url: "http://127.0.0.1:3210", channel: "beta" }, { allowLoopback: true, allowPrerelease: true }),
  { provider: "generic", url: "http://127.0.0.1:3210", channel: "beta" },
);
assert.equal(normalizeFeedConfig({ provider: "generic", url: "http://127.0.0.1:3210", channel: "beta" }, { allowLoopback: true }), null);
assert.equal(isPrereleaseVersion("0.2.6-beta.1"), true);
assert.equal(isPrereleaseVersion("0.2.5"), false);
assert.equal(normalizeReleaseUrl("https://github.com/love70805/lworkstation/releases/tag/v0.2.6-beta.1"), "https://github.com/love70805/lworkstation/releases/tag/v0.2.6-beta.1");
assert.equal(normalizeReleaseUrl(`https://github.com/love70805/${legacyPrivateRepo}/releases/tag/v0.2.6-beta.1`), null);
assert.equal(normalizeReleaseUrl("https://example.com/releases/v0.2.6"), null);
assert.equal(UPDATE_INTERVAL_MS, 4 * 60 * 60 * 1000);

const sanitized = sanitizeUpdateInfo({
  version: "0.2.6",
  files: [{ size: 1024 }, { size: 2048 }],
  releaseDate: "2026-08-26T10:00:00.000Z",
  releaseNotes: "<b>修复</b> [详情](https://example.com)",
});
assert.equal(sanitized.size, 2048);
assert.equal(sanitized.notes, "修复 详情");
assert.match(sanitized.releaseUrl, /^https:\/\/github\.com\/love70805\/lworkstation\/releases\/tag\/v0\.2\.6$/);
assert.doesNotMatch(sanitizeError(new Error("C:\\Users\\demo\\secret.exe failed")), /Users|secret\.exe/);
assert.equal(sanitizeError(new Error('503 Service Unavailable "method: GET url: https://example.invalid/latest.yml"')), "更新服务暂时不可用，请稍后重试");
assert.equal(sanitizeError(new Error('Cannot find channel "latest.yml" update info: HttpError: 404')), "暂未找到可用更新，请稍后重试");

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.failFirstCheck = true;
    this.cancelFirstDownload = true;
  }

  setFeedURL(value) { this.feed = value; }

  async checkForUpdates() {
    this.checkCalls += 1;
    this.emit("checking-for-update");
    if (this.failFirstCheck) {
      this.failFirstCheck = false;
      throw new Error("temporary update failure");
    }
    const info = {
      version: "0.2.6-beta.2",
      files: [{ url: "Lworkstation-Setup-0.2.6-beta.2.exe", size: 4096 }],
      releaseDate: "2026-08-26T10:00:00.000Z",
      releaseNotes: "beta 测试更新链验证",
    };
    this.emit("update-available", info);
    return { updateInfo: info };
  }

  downloadUpdate(token) {
    this.downloadCalls += 1;
    if (this.cancelFirstDownload) {
      this.cancelFirstDownload = false;
      return token.createPromise((_resolve, _reject, onCancel) => {
        this.emit("download-progress", { percent: 12 });
        onCancel(() => this.emit("update-cancelled", { version: "0.2.6-beta.2" }));
      });
    }
    this.emit("download-progress", { percent: 64 });
    this.emit("update-downloaded", { version: "0.2.6-beta.2" });
    return Promise.resolve(["C:\\ignored\\update.exe"]);
  }
}

const productionUpdater = new FakeUpdater();
const disabledProductionRuntime = createUpdateRuntime({
  updater: productionUpdater,
  CancellationToken,
  currentVersion: "0.2.5",
  enabled: false,
  feedConfig: PRODUCTION_FEED_CONFIG,
});
assert.deepEqual(productionUpdater.feed, PRODUCTION_FEED_CONFIG);
assert.equal(disabledProductionRuntime.snapshot().status, "disabled");
assert.equal(productionUpdater.allowPrerelease, false);
assert.equal(productionUpdater.channel, "latest");
disabledProductionRuntime.start();
assert.equal(productionUpdater.checkCalls, 0, "disabled production config must not schedule update requests");

const stableBetaUpdater = new FakeUpdater();
const stableBetaRuntime = createUpdateRuntime({
  updater: stableBetaUpdater,
  CancellationToken,
  currentVersion: "0.2.5",
  enabled: true,
  feedConfig: { ...PRODUCTION_FEED_CONFIG, channel: "beta" },
});
assert.equal(stableBetaRuntime.snapshot().status, "disabled", "stable 0.2.5 must not opt into prerelease updates");
assert.equal(stableBetaUpdater.allowPrerelease, false);

const githubBetaUpdater = new FakeUpdater();
const githubBetaRuntime = createUpdateRuntime({
  updater: githubBetaUpdater,
  CancellationToken,
  currentVersion: "0.2.6-beta.1",
  enabled: true,
  feedConfig: { ...PRODUCTION_FEED_CONFIG, channel: "beta" },
});
assert.equal(githubBetaRuntime.snapshot().status, "idle");
assert.deepEqual(githubBetaUpdater.feed, { ...PRODUCTION_FEED_CONFIG, channel: "beta" });
assert.equal(githubBetaUpdater.allowPrerelease, true);
assert.equal(githubBetaUpdater.channel, "beta");

const updater = new FakeUpdater();
const observed = [];
let scheduledInterval = null;
const runtime = createUpdateRuntime({
  updater,
  CancellationToken,
  currentVersion: "0.2.6-beta.1",
  enabled: true,
  feedConfig: { provider: "generic", url: "http://127.0.0.1:3210", channel: "beta" },
  allowLoopback: true,
  onState: (state) => observed.push(state),
  now: () => Date.parse("2026-08-26T12:00:00.000Z"),
  setIntervalFn: (callback, delay) => { scheduledInterval = { callback, delay }; return scheduledInterval; },
  clearIntervalFn: () => { scheduledInterval = null; },
});

assert.equal(updater.autoDownload, false);
assert.equal(updater.autoInstallOnAppQuit, false);
assert.equal(updater.allowPrerelease, true, "installed beta builds must allow the controlled beta channel");
assert.equal(updater.channel, "beta");
assert.equal(updater.feed.url, "http://127.0.0.1:3210");

const failedCheck = await runtime.check();
assert.equal(failedCheck.ok, false);
assert.equal(runtime.snapshot().status, "error");
assert.equal(runtime.snapshot().retryAction, "check");

const successfulCheck = await runtime.check();
assert.equal(successfulCheck.ok, true);
assert.equal(runtime.snapshot().status, "available");
assert.equal(runtime.snapshot().availableVersion, "0.2.6-beta.2");
assert.equal(updater.downloadCalls, 0, "available updates must not auto-download");

const firstDownload = runtime.download();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(runtime.snapshot().status, "downloading");
assert.equal(runtime.snapshot().progress, 12);
assert.equal(runtime.cancel().ok, true);
assert.equal((await firstDownload).canceled, true);
assert.equal(runtime.snapshot().status, "canceled");

const retryDownload = await runtime.download();
assert.equal(retryDownload.ok, true);
assert.equal(runtime.snapshot().status, "downloaded");
assert.equal(runtime.snapshot().progress, 100);
assert.equal(updater.downloadCalls, 2);
assert.equal(runtime.postpone().ok, true);
assert.match(runtime.snapshot().message, /稍后/);

runtime.start();
assert.equal(scheduledInterval.delay, UPDATE_INTERVAL_MS);
runtime.stop();
assert.equal(scheduledInterval, null);
assert.ok(observed.some((state) => state.status === "available"));
assert.ok(observed.some((state) => state.status === "canceled"));
assert.ok(observed.some((state) => state.status === "downloaded"));

console.log("desktop update runtime tests passed");
