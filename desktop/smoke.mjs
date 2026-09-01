import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const executable = process.env.SHOPEERS_DESKTOP_SMOKE_EXECUTABLE
  ? path.resolve(process.env.SHOPEERS_DESKTOP_SMOKE_EXECUTABLE)
  : path.join(root, "release", "win-unpacked", "Lworkstation.exe");
const reportPath = path.join(os.tmpdir(), `shopeers-desktop-smoke-${process.pid}.json`);
const inboxSpoolPath = path.join(os.tmpdir(), `shopeers-desktop-smoke-inbox-${process.pid}.json`);
const userDataPath = path.join(os.tmpdir(), `shopeers-desktop-smoke-user-data-${process.pid}`);
const cachePath = path.join(userDataPath, "cache");
const inboxPort = 20790 + Math.floor(Math.random() * 800);
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

const updateServer = http.createServer((request, response) => {
  const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
  if (requestPath !== "/latest.yml") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "text/yaml" });
  response.end([
    `version: ${version}`,
    "files:",
    "  - url: Lworkstation-placeholder.exe",
    "    sha512: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "    size: 1",
    "path: Lworkstation-placeholder.exe",
    "sha512: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "releaseDate: '2026-08-11T00:00:00.000Z'",
    "",
  ].join("\n"));
});
await new Promise((resolve) => updateServer.listen(0, "127.0.0.1", resolve));
const updateUrl = `http://127.0.0.1:${updateServer.address().port}/`;

if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);
fs.mkdirSync(cachePath, { recursive: true });
const child = spawn(executable, [], {
  env: {
    ...process.env,
    SHOPEERS_DESKTOP_SMOKE_REPORT: reportPath,
    SHOPEERS_DESKTOP_SMOKE_REQUIRE_UPDATE_CHECK: "1",
    SHOPEERS_DESKTOP_SMOKE_ERP_V2: "1",
    SHOPEERS_DESKTOP_UPDATE_SMOKE: "1",
    SHOPEERS_DESKTOP_UPDATE_URL: updateUrl,
    SHOPEERS_ERP_INBOX_PORT: String(inboxPort),
    SHOPEERS_ERP_INBOX_FILE: inboxSpoolPath,
    SHOPEERS_DESKTOP_SMOKE_USER_DATA: userDataPath,
    SHOPEERS_DESKTOP_SMOKE_CACHE: cachePath,
  },
  stdio: "ignore",
  windowsHide: true,
});
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertSafeSmokeUserDataPath(target) {
  const resolved = path.resolve(target);
  const tempRoot = path.resolve(os.tmpdir());
  const name = path.basename(resolved);
  if (path.dirname(resolved).toLowerCase() !== tempRoot.toLowerCase()
    || !/^shopeers-desktop-smoke-user-data-\d+$/.test(name)) {
    throw new Error(`拒绝清理非 smoke 临时目录：${resolved}`);
  }
  return resolved;
}

async function removeSmokeUserData() {
  const target = assertSafeSmokeUserDataPath(userDataPath);
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!fs.existsSync(target)) return;
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
      if (!fs.existsSync(target)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`清理 smoke userData 失败（已重试 20 次）：${lastError?.message || target}`);
}

let report;
let processError = null;
try {
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Packaged desktop smoke test timed out"));
    }, 30000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (exitCode !== 0) throw new Error(`Packaged desktop exited with code ${exitCode}`);
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (error) {
  processError = error;
} finally {
  if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  if (fs.existsSync(inboxSpoolPath)) fs.unlinkSync(inboxSpoolPath);
  updateServer.close();
}

let validationError = processError;
if (!validationError) {
  try {
    if (!report) throw new Error("Packaged desktop smoke report is missing");
    const isolatedViews = report.tabSwitches?.every((entry) => entry.attachedViews.length === 1 && entry.attachedViews[0] === entry.activeTab);
    const fixture = report.erpV2Fixture;
    const runtime = report.extensionRuntime || {};
    if (!report.ok
      || !report.packaged
      || report.applicationName !== "shopeers-desktop"
      || report.executableName !== "Lworkstation.exe"
      || !report.packagedResources?.desktopIcon
      || !report.packagedResources?.shell
      || !report.packagedResources?.workspacePreload
      || report.version !== version
      || report.update.status !== "current"
      || !report.popoverToggleSmoke?.ok
      || !report.popoverDomClickSmoke?.ok
      || report.popoverDomClickSmoke?.final?.open !== false
      || report.popoverDomClickSmoke?.final?.visible !== false
      || report.popoverDomClickSmoke?.final?.windowCount > 1
      || report.popoverToggleSmoke?.cycles !== 2
      || report.popoverToggleSmoke?.staleClosed !== true
      || report.popoverToggleSmoke?.secondShown !== true
      || report.popoverToggleSmoke?.secondBounds?.width > 176
      || report.popoverToggleSmoke?.secondBounds?.height > 44
      || report.popoverToggleSmoke?.finalOpen !== false
      || !isolatedViews
      || report.inbox?.status !== "online"
      || report.inbox?.flow?.status !== "workspace_received"
      || report.inbox?.latestBatch?.status !== "acknowledged"
      || fixture?.status?.latestBatch?.sourceFormatVersion !== 2
      || fixture?.status?.latestBatch?.evidenceStatus !== "complete"
      || fixture?.status?.latestBatch?.status !== "acknowledged"
      || fixture?.transport !== "runtime-extension-bridge"
      || fixture?.selectionHeartbeat?.ok !== true
      || fixture?.selectionHeartbeat?.failClosed !== true
      || fixture?.selectionHeartbeat?.failClosedCount < 3
      || fixture?.selectionHeartbeat?.requestCount !== 1
      || report.erpZoom?.percent !== 80
      || report.erpZoom?.min !== 70
      || report.erpZoom?.max !== 120
      || report.tabSwitches?.find((entry) => entry.activeTab === "erp")?.zoomFactor !== 0.8
      || report.tabSwitches?.some((entry) => entry.bounds?.height <= 0)
      || runtime.port === 8790
      || runtime.root !== path.join(userDataPath, "Lworkstation-runtime-extensions")
      || runtime.erpPath !== path.join(runtime.root, "erp")
      || runtime.selectionPath !== path.join(runtime.root, "1688")
      || !runtime.erpPath
      || !runtime.selectionPath
      || !runtime.erpBridgeDynamic
      || runtime.erpBridgeHardcoded
      || !runtime.erpStorageKey
      || !runtime.selectionStorageContract
      || !runtime.selectionHeartbeatCompatible) {
      throw new Error(`Packaged desktop smoke test failed: ${JSON.stringify(report)}`);
    }
    if (!runtime.storageConfigured) {
      throw new Error(`Packaged desktop smoke test failed: ${JSON.stringify(report)}`);
    }
    const runtimeEntries = fs.readdirSync(runtime.root, { withFileTypes: true }).map((entry) => entry.name);
    if (!fs.existsSync(runtime.erpPath)
      || !fs.existsSync(runtime.selectionPath)
      || runtimeEntries.some((name) => name.startsWith(".staging-") || name.startsWith(".previous-"))) {
      throw new Error(`Packaged desktop runtime extension boundary check failed: ${JSON.stringify({ runtime, runtimeEntries })}`);
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    validationError = error;
  }
}

let cleanupError = null;
try {
  await removeSmokeUserData();
} catch (error) {
  cleanupError = error;
}
if (validationError && cleanupError) throw new AggregateError([validationError, cleanupError], "Packaged desktop smoke failed and cleanup also failed");
if (validationError) throw validationError;
if (cleanupError) throw cleanupError;
