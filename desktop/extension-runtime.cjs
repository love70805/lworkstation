const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const RUNTIME_DIRECTORY = "Lworkstation-runtime-extensions";
const ALLOWED_RUNTIME_IDS = new Set(["erp", "1688"]);
const INBOX_STORAGE_KEYS = Object.freeze([
  "shopeersErpInboxBaseUrl",
  "shopeersErpInboxCapability",
  "shopeersErpWorkspaceId",
]);

function extensionStorageConfig({ port, capability, workspaceId } = {}) {
  const numericPort = Number(port);
  const normalizedCapability = String(capability || "").trim();
  const normalizedWorkspaceId = String(workspaceId || "").trim();
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535
    || normalizedCapability.length < 32 || !normalizedWorkspaceId) {
    throw new Error("扩展安全收件配置无效。");
  }
  return Object.freeze({
    shopeersErpInboxBaseUrl: `http://127.0.0.1:${numericPort}`,
    shopeersErpInboxCapability: normalizedCapability,
    shopeersErpWorkspaceId: normalizedWorkspaceId,
  });
}

function runtimeRoot({ userDataPath } = {}) {
  if (!userDataPath) throw new Error("缺少桌面应用数据目录。");
  return path.join(path.resolve(userDataPath), RUNTIME_DIRECTORY);
}

function assertInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("扩展运行时路径越界。");
}

async function replacePortInDirectory(directory, port) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) throw new Error("扩展运行时端口无效。");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await replacePortInDirectory(target, numericPort);
      continue;
    }
    if (!entry.isFile() || !/[.](json|js|html|css)$/.test(entry.name)) continue;
    const source = await fs.readFile(target, "utf8");
    const rewritten = source.replace(/http:\/\/127\.0\.0\.1:\d+/g, `http://127.0.0.1:${numericPort}`);
    if (rewritten !== source) await fs.writeFile(target, rewritten, "utf8");
  }
}

async function injectRuntimeContract(directory, port, runtimeId) {
  const baseUrl = `http://127.0.0.1:${Number(port)}`;
  if (runtimeId === "erp") {
    const backgroundPath = path.join(directory, "src", "background.js");
    const bridgePath = path.join(directory, "src", "shopeers-bridge.js");
    const manifestPath = path.join(directory, "manifest.json");
    const config = "";
    if (fsSync.existsSync(backgroundPath)) {
      const source = await fs.readFile(backgroundPath, "utf8");
      if (config && !source.includes("shopeersErpInboxBaseUrl")) await fs.writeFile(backgroundPath, `${config}${source}`, "utf8");
    }
    if (fsSync.existsSync(bridgePath)) {
      const source = await fs.readFile(bridgePath, "utf8");
      const marker = `window.__SHOPEERS_ERP_INBOX_BASE_URL__ = ${JSON.stringify(baseUrl)};`;
      if (!source.includes("__SHOPEERS_ERP_INBOX_BASE_URL__")) await fs.writeFile(bridgePath, `${marker}\n${source}`, "utf8");
    }
    if (fsSync.existsSync(manifestPath)) {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifest.permissions = [...new Set([...(manifest.permissions || []), "storage"])]
        .sort((left, right) => left.localeCompare(right));
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
  }
  if (runtimeId === "1688") {
    const bootstrap = `
;(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const baseKey = 'shopeersErpInboxBaseUrl';
  const capabilityKey = 'shopeersErpInboxCapability';
  const workspaceKey = 'shopeersErpWorkspaceId';
  async function runtimeFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    let parsed;
    try { parsed = new URL(String(rawUrl || '')); } catch { return nativeFetch(input, init); }
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.startsWith('/selection/v1/')) {
      return nativeFetch(input, init);
    }
    const stored = await chrome.storage.local.get([baseKey, capabilityKey, workspaceKey]);
    const baseUrl = String(stored[baseKey] || '').trim();
    const capability = String(stored[capabilityKey] || '').trim();
    const workspaceId = String(stored[workspaceKey] || '').trim();
    let base;
    try { base = new URL(baseUrl); } catch { throw new Error('SHOPEERS_INBOX_NOT_CONFIGURED'); }
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)
      || capability.length < 32 || !workspaceId) {
      throw new Error('SHOPEERS_INBOX_NOT_CONFIGURED');
    }
    parsed.protocol = base.protocol;
    parsed.hostname = base.hostname;
    parsed.port = base.port;
    const headers = new Headers(init.headers || {});
    headers.set('authorization', 'Bearer ' + capability);
    headers.set('x-shopeers-workspace-id', workspaceId);
    return nativeFetch(parsed.href, { ...init, headers });
  }
  globalThis.fetch = runtimeFetch;
})();
`;
    for (const relativePath of ["background.js", "popup.js"]) {
      const target = path.join(directory, relativePath);
      if (!fsSync.existsSync(target)) continue;
      const source = await fs.readFile(target, "utf8");
      if (!source.includes("SHOPEERS_INBOX_NOT_CONFIGURED")) await fs.writeFile(target, `${bootstrap}${source}`, "utf8");
    }
  }
}

async function prepareRuntimeExtension({ sourceDirectory, port, runtimeId, userDataPath } = {}) {
  if (!sourceDirectory || !ALLOWED_RUNTIME_IDS.has(runtimeId)) throw new Error("扩展运行时参数无效。");
  const root = runtimeRoot({ userDataPath });
  const target = path.join(root, runtimeId);
  const staging = path.join(root, `.staging-${runtimeId}-${process.pid}`);
  const previous = path.join(root, `.previous-${runtimeId}`);
  for (const candidate of [target, staging, previous]) assertInsideRoot(root, candidate);

  await fs.mkdir(root, { recursive: true });
  await fs.rm(staging, { recursive: true, force: true });
  await fs.cp(sourceDirectory, staging, { recursive: true, force: true });
  await replacePortInDirectory(staging, port);
  await injectRuntimeContract(staging, port, runtimeId);

  await fs.rm(previous, { recursive: true, force: true });
  let movedPrevious = false;
  try {
    if (fsSync.existsSync(target)) {
      await fs.rename(target, previous);
      movedPrevious = true;
    }
    await fs.rename(staging, target);
    await fs.rm(previous, { recursive: true, force: true });
    return target;
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    if (movedPrevious && fsSync.existsSync(previous)) await fs.rename(previous, target).catch(() => {});
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function cleanupRuntimeExtensionStagingSync({ userDataPath } = {}) {
  const root = runtimeRoot({ userDataPath });
  if (!fsSync.existsSync(root)) return;
  for (const entry of fsSync.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || (!entry.name.startsWith(".staging-") && !entry.name.startsWith(".previous-"))) continue;
    const target = path.join(root, entry.name);
    assertInsideRoot(root, target);
    try { fsSync.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (_) { /* best effort */ }
  }
}

module.exports = {
  cleanupRuntimeExtensionStagingSync,
  prepareRuntimeExtension,
  replacePortInDirectory,
  runtimeRoot,
  extensionStorageConfig,
  INBOX_STORAGE_KEYS,
};
