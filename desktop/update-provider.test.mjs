import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { AppUpdater } = require("electron-updater/out/AppUpdater");
const { BaseUpdater } = require("electron-updater/out/BaseUpdater");
const { GitHubProvider } = require("electron-updater/out/providers/GitHubProvider");
const { CancellationToken } = require("electron-updater");
const { createUpdateRuntime, PRODUCTION_FEED_CONFIG } = require("./update-runtime.cjs");
const { versionChannel, canUpdate } = require("./update-policy.cjs");

const atom = (tags) => `<feed>${tags.map(tag => `<entry><title>${tag}</title><link href="https://github.com/love70805/lworkstation/releases/tag/v${tag}"/><content>fixture</content></entry>`).join("")}</feed>`;
const yaml = (version) => `version: ${version}\nfiles:\n  - url: Lworkstation-${version}.exe\n    sha512: Zml4dHVyZQ==\n    size: 10\npath: Lworkstation-${version}.exe\nsha512: Zml4dHVyZQ==\n`;

function fixture(current, { channel = versionChannel(current), tags = ["0.3.0", "0.2.7-beta.2"], latest = "0.3.0", metadata, missing = false, enabled = true } = {}) {
  const updater = new AppUpdater(null, { version: current, isPackaged: true, whenReady: async () => {} });
  updater.logger = { info() {}, warn() {}, error() {} };
  updater.getOrCreateStagingUserId = async () => "00000000-0000-4000-8000-000000000000";
  const requests = [];
  updater.httpExecutor = { request: async (options) => {
    const request = options.path;
    requests.push(request);
    if (request.endsWith(".atom")) return atom(tags);
    if (request.endsWith("/latest")) return JSON.stringify({ tag_name: `v${latest}` });
    if (missing) throw new Error("404 missing channel metadata");
    const tag = /\/download\/v([^/]+)\//.exec(request)?.[1];
    assert.ok(tag, `unexpected request: ${request}`);
    return yaml(metadata ?? tag);
  } };
  let downloads = 0;
  updater.doDownloadUpdate = async ({ updateInfoAndProvider }) => {
    downloads++;
    updateInfoAndProvider.provider.resolveFiles(updateInfoAndProvider.info);
    updater.emit("update-downloaded", updateInfoAndProvider.info);
    return ["fixture-only.exe"];
  };
  const runtime = createUpdateRuntime({ updater, CancellationToken, currentVersion: current, enabled,
    feedConfig: { ...PRODUCTION_FEED_CONFIG, channel } });
  return { updater, runtime, requests, downloads: () => downloads };
}

// Exercise the installed upstream branch: beta currently selects a newer stable.
{
  const f = fixture("0.2.6-beta.7");
  const upstream = new GitHubProvider({ ...PRODUCTION_FEED_CONFIG, channel: "beta" }, f.updater,
    { platform: "win32", executor: f.updater.httpExecutor });
  assert.equal((await upstream.getLatestVersion()).version, "0.3.0");
}
for (const [current, target] of [["0.2.6", "0.3.0"], ["0.2.6-beta.7", "0.2.7-beta.2"]]) {
  const f = fixture(current);
  assert.equal(f.updater.allowDowngrade, false, "reset channel setter side effect");
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal((await f.runtime.check()).available, true);
  assert.equal(f.runtime.snapshot().availableVersion, target);
  assert.equal(f.downloads(), 0);
  assert.equal(f.runtime.canInstall(), false);
  assert.equal((await f.runtime.download()).downloaded, true);
  assert.equal(f.downloads(), 1);
  assert.equal(f.runtime.canInstall(), true);
  f.updater.downloadedUpdateHelper = { versionInfo: { version: current } };
  assert.equal(f.runtime.canInstall(), false, "cached installer must match accepted target");
  f.updater.downloadedUpdateHelper = null;
  f.runtime.postpone();
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  f.updater.updateInfoAndProvider.info.version = current;
  assert.equal(f.runtime.canInstall(), false, "install rechecks internal target");
  if (current.includes("beta")) assert.ok(f.requests.every(p => !p.includes("latest")));
}

for (const [current, target] of [
  ["0.2.6", "0.2.7-beta.1"], ["0.2.6-beta.7", "0.3.0"],
  ["0.2.6", "0.2.6"], ["0.2.6", "0.2.5"],
  ["0.2.6-beta.7", "0.2.6-beta.7"], ["0.2.6-beta.7", "0.2.6-beta.6"],
]) {
  const f = fixture(current, { latest: target, tags: [target] });
  await f.runtime.check();
  assert.equal((await f.runtime.download()).ok, false);
  assert.equal(f.runtime.canInstall(), false);
  assert.equal(f.downloads(), 0);
  assert.equal(await f.updater.isUpdateAvailable({ version: target }), false);
}
for (const options of [
  { tags: ["0.3.0", "0.4.0-alpha.1"] }, { missing: true }, { metadata: "0.3.0" }, { metadata: "invalid" },
]) {
  const f = fixture("0.2.6-beta.7", options);
  assert.equal((await f.runtime.check()).ok, false);
  assert.equal((await f.runtime.download()).ok, false);
  assert.ok(f.requests.every(p => !p.includes("latest")), "never fall back to latest");
}
for (const [current, channel] of [["0.2.6-beta.7", "latest"], ["0.2.6", "beta"], ["0.2.6-alpha.1", "beta"], ["0.2.6", "wrong"]]) {
  const f = fixture(current, { channel });
  f.runtime.start();
  assert.equal((await f.runtime.check()).ok, false);
  assert.equal(f.runtime.snapshot().status, "disabled");
  assert.equal(f.requests.length, 0);
}
{
  const f = fixture("0.2.6", { enabled: false });
  f.runtime.start();
  await f.runtime.check();
  assert.equal(f.requests.length, 0);
}
{
  const f = fixture("0.2.6");
  await f.runtime.check();
  f.updater.updateInfoAndProvider.info.version = "0.4.0-beta.1";
  assert.equal((await f.runtime.download()).ok, false);
  assert.equal(f.downloads(), 0, "guard runs before download");
}
{
  const f = fixture("0.2.6");
  await f.runtime.check();
  f.updater.doDownloadUpdate = async () => { f.updater.emit("update-downloaded", { version: "0.4.0-beta.1" }); return []; };
  assert.equal((await f.runtime.download()).ok, false);
  assert.equal(f.runtime.canInstall(), false, "downloaded event must match accepted target");
}
assert.equal(canUpdate("0.2.6-beta.9", "0.2.6-beta.10", "beta"), true);
assert.equal(canUpdate("0.2.6+one", "0.2.6+two", "latest"), false);
assert.equal(versionChannel("0.2.6-beta.01"), null);
assert.equal(versionChannel("v0.2.6"), null);
assert.equal(versionChannel("0.2.6-rc.1"), null);
{
  const f = fixture("0.2.6");
  f.updater.app.onQuit = () => assert.fail("must not register an automatic installer");
  BaseUpdater.prototype.addQuitHandler.call(f.updater);
}
console.log("desktop real provider/update chain fixtures passed (no network or actual installation)");
