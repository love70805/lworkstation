import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { loadUpdateFixtureConfig, metadataAssetNames } = require("./update-fixture-config.cjs");
const testConfig = loadUpdateFixtureConfig(root);
const sourceVersion = testConfig.sourceVersion;
const targetVersion = testConfig.targetVersion;
const targetInstallerName = testConfig.targetArtifactName;
const sourceRoot = path.join(root, "release-test", sourceVersion);
const sourceExecutable = path.join(sourceRoot, "win-unpacked", "Lworkstation.exe");
const sourcePackagedConfig = path.join(sourceRoot, "win-unpacked", "resources", "update-config.json");
const feedRoot = path.join(root, "release-test", targetVersion);
const targetInstaller = path.join(feedRoot, targetInstallerName);
const metadataPath = path.join(feedRoot, testConfig.metadataFile);
const userDataPath = path.join(os.tmpdir(), `lworkstation-update-smoke-user-data-${process.pid}`);
const requests = [];
let metadataFailuresRemaining = 1;
let slowInstallerRequestsRemaining = 1;

for (const file of [sourceExecutable, sourcePackagedConfig, targetInstaller, `${targetInstaller}.blockmap`, metadataPath, path.join(feedRoot, "SHA256.txt")]) {
  if (!fs.existsSync(file)) throw new Error(`请先运行 pnpm --dir desktop build:update-fixtures，缺少：${file}`);
}
if (JSON.stringify(JSON.parse(fs.readFileSync(sourcePackagedConfig, "utf8"))) !== JSON.stringify(testConfig.betaConfig)) {
  throw new Error("beta.1 源包没有启用受控 beta 更新通道");
}
const metadataContents = fs.readFileSync(metadataPath, "utf8");
const metadataAssets = metadataAssetNames(metadataContents);
if (metadataAssets.length < 2 || metadataAssets.some((name) => name !== targetInstallerName)) {
  throw new Error(`${testConfig.metadataFile} 资产名与磁盘文件不一致：${JSON.stringify(metadataAssets)}`);
}

function contentType(file) {
  if (file.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (file.endsWith(".blockmap")) return "application/octet-stream";
  return "application/vnd.microsoft.portable-executable";
}

function serveFile(request, response, file, { slow = false } = {}) {
  const stat = fs.statSync(file);
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(stat.size - 1, Number(range[2])) : stat.size - 1;
  const length = Math.max(0, end - start + 1);
  response.writeHead(range ? 206 : 200, {
    "content-type": contentType(file),
    "content-length": length,
    "accept-ranges": "bytes",
    ...(range ? { "content-range": `bytes ${start}-${end}/${stat.size}` } : {}),
  });
  if (request.method === "HEAD") { response.end(); return; }
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 128 * 1024 });
  if (!slow) { stream.pipe(response); return; }
  stream.on("data", (chunk) => {
    stream.pause();
    if (!response.destroyed) response.write(chunk);
    setTimeout(() => stream.resume(), 12);
  });
  stream.on("end", () => { if (!response.destroyed) response.end(); });
  stream.on("error", () => response.destroy());
  response.on("close", () => stream.destroy());
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\//, "");
  requests.push({ at: Date.now(), method: request.method, pathname, range: request.headers.range || null });
  if (pathname === testConfig.metadataFile && metadataFailuresRemaining > 0) {
    metadataFailuresRemaining -= 1;
    response.writeHead(503, { "content-type": "text/plain" }).end("temporary smoke failure");
    return;
  }
  const safeName = path.basename(pathname);
  if (safeName !== pathname) {
    response.writeHead(404).end();
    return;
  }
  const localFile = path.join(feedRoot, safeName);
  if (!fs.existsSync(localFile) || !fs.statSync(localFile).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const slow = safeName === targetInstallerName && request.method === "GET" && slowInstallerRequestsRemaining-- > 0;
  serveFile(request, response, localFile, { slow });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const updateUrl = `http://127.0.0.1:${server.address().port}`;
const legacyAliasName = `Lworkstation Setup ${targetVersion}.exe`;
const legacyAliasResponse = await fetch(`${updateUrl}/${encodeURIComponent(legacyAliasName)}`);
if (legacyAliasResponse.status !== 404) {
  server.close();
  throw new Error(`更新 smoke 禁止把旧资产名映射到新安装包：${legacyAliasResponse.status}`);
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function runPhase(phase, index) {
  const reportPath = path.join(os.tmpdir(), `lworkstation-update-smoke-${process.pid}-${phase}.json`);
  const cachePath = path.join(userDataPath, "update-cache", phase);
  const requestStartIndex = requests.length;
  fs.mkdirSync(cachePath, { recursive: true });
  const child = spawn(sourceExecutable, [], {
    env: {
      ...process.env,
      SHOPEERS_DESKTOP_UPDATE_SMOKE: "1",
      SHOPEERS_DESKTOP_UPDATE_SMOKE_PHASE: phase,
      SHOPEERS_DESKTOP_UPDATE_SMOKE_REPORT: reportPath,
      SHOPEERS_DESKTOP_UPDATE_URL: updateUrl,
      SHOPEERS_DESKTOP_UPDATE_CHANNEL: testConfig.channel,
      SHOPEERS_DESKTOP_SMOKE_USER_DATA: userDataPath,
      SHOPEERS_DESKTOP_SMOKE_CACHE: cachePath,
      SHOPEERS_ERP_INBOX_PORT: String(21900 + ((process.pid + index) % 500)),
      SHOPEERS_ERP_INBOX_FILE: path.join(userDataPath, `erp-inbox-${phase}.json`),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let childOutput = "";
  const appendOutput = (chunk) => {
    childOutput = `${childOutput}${chunk}`.slice(-12000);
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      const checkpoint = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "no checkpoint";
      reject(new Error(`Update smoke ${phase} timed out\nCheckpoint: ${checkpoint}\nChild output: ${childOutput || "none"}\nRequests: ${JSON.stringify(requests, null, 2)}`));
    }, 150000);
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  if (exitCode !== 0) throw new Error(`Update smoke ${phase} exited with code ${exitCode}\n${childOutput}`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.requests = requests.slice(requestStartIndex);
  report.expectedSmokeCachePath = cachePath;
  fs.unlinkSync(reportPath);
  return report;
}

let postponeReport;
let installReport;
try {
  postponeReport = await runPhase("postpone", 1);
  installReport = await runPhase("install", 2);
} finally {
  server.close();
}

const successfulMetadata = requests.find((entry, index) => entry.pathname === testConfig.metadataFile && index > 0);
const explicitDownloadAt = postponeReport.trace.find((entry) => entry.action === "first-download-requested")?.at;
const explicitInstallDownloadAt = installReport.trace.find((entry) => entry.action === "before-explicit-download")?.at;
const postponeInstallerRequests = postponeReport.requests.filter((entry) => entry.pathname === targetInstallerName && entry.method === "GET");
const installInstallerRequests = installReport.requests.filter((entry) => entry.pathname === targetInstallerName && entry.method === "GET");
if (!postponeReport.ok
  || postponeReport.currentVersion !== sourceVersion
  || postponeReport.startupStatus !== "error"
  || postponeReport.updaterOptions.autoDownload !== false
  || postponeReport.updaterOptions.autoInstallOnAppQuit !== false
  || postponeReport.updaterOptions.allowPrerelease !== true
  || postponeReport.updaterOptions.channel !== "beta"
  || postponeReport.canceled?.ok !== true
  || postponeReport.firstDownloadResult?.canceled !== true
  || postponeReport.postponeResult?.ok !== true
  || postponeReport.installInvocationCount !== 0
  || postponeReport.finalState?.status !== "downloaded"
  || !installReport.ok
  || installReport.currentVersion !== sourceVersion
  || installReport.installInvocationCount !== 1
  || installReport.installResult?.installInvoked !== true
  || !successfulMetadata
  || postponeReport.smokeCache?.electron !== postponeReport.expectedSmokeCachePath
  || postponeReport.smokeCache?.localAppData !== postponeReport.expectedSmokeCachePath
  || installReport.smokeCache?.electron !== installReport.expectedSmokeCachePath
  || installReport.smokeCache?.localAppData !== installReport.expectedSmokeCachePath
  || postponeReport.expectedSmokeCachePath === installReport.expectedSmokeCachePath
  || postponeInstallerRequests.length < 2
  || installInstallerRequests.length < 1
  || postponeInstallerRequests.some((entry) => entry.at < explicitDownloadAt)
  || installInstallerRequests.some((entry) => entry.at < explicitInstallDownloadAt)) {
  throw new Error(`Packaged update smoke failed: ${JSON.stringify({ postponeReport, installReport, requests }, null, 2)}`);
}

const targetHash = crypto.createHash("sha256").update(fs.readFileSync(targetInstaller)).digest("hex").toUpperCase();
const recordedHashes = new Map(fs.readFileSync(path.join(feedRoot, "SHA256.txt"), "utf8")
  .trim()
  .split(/\r?\n/)
  .map((line) => {
    const match = line.match(/^([A-F0-9]{64})\s{2}(.+)$/);
    return match ? [match[2], match[1]] : [];
  })
  .filter((entry) => entry.length === 2));
if (recordedHashes.get(targetInstallerName) !== targetHash
  || !recordedHashes.has(`${targetInstallerName}.blockmap`)
  || !recordedHashes.has(testConfig.metadataFile)) {
  throw new Error(`测试更新产物校验失败: ${JSON.stringify({ targetHash, recordedHashes: Object.fromEntries(recordedHashes) })}`);
}

let cleanupError = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    fs.rmSync(userDataPath, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
    cleanupError = null;
    break;
  } catch (error) {
    cleanupError = error;
    await delay(150);
  }
}
if (cleanupError) throw cleanupError;

console.log(JSON.stringify({
  ok: true,
  sourceVersion,
  targetVersion,
  testChannel: testConfig.channel,
  metadataFile: testConfig.metadataFile,
  repository: testConfig.repository,
  targetInstaller,
  targetInstallerName,
  targetHash,
  legacyAliasStatus: legacyAliasResponse.status,
  postpone: postponeReport,
  install: installReport,
  requests,
}, null, 2));
