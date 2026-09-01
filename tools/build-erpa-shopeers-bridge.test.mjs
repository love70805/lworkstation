import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID, webcrypto } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const execFileAsync = promisify(execFile);
const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(toolsRoot, "..");
const generator = path.join(toolsRoot, "build-erpa-shopeers-bridge.mjs");
const extensionRoot = path.join(workspaceRoot, "integrations", "erp-assistant-extension");
const sourcePath = (name) => path.join(extensionRoot, "src", name);
const capability = "test-capability-0123456789-abcdefghijklmnopqrstuvwxyz";
const sender = {
  frameId: 0,
  tab: { url: "https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html?tab=cost" },
};

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
}

async function loadBackground({ fetchImpl, storageSeed = {}, timeoutMs = 25, maxAttempts = 1 } = {}) {
  const storage = { ...jsonClone(storageSeed) };
  const runtimeListeners = [];
  const logs = [];
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const selected = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (Object.hasOwn(storage, key)) selected[key] = jsonClone(storage[key]);
          }
          return selected;
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) storage[key] = jsonClone(value);
        },
      },
    },
    runtime: {
      getManifest: () => ({ version: "8.0.14" }),
      onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} },
    },
  };
  const context = vm.createContext({
    __SHOPEERS_ERP_BACKGROUND_TEST__: true,
    AbortController,
    URL,
    chrome,
    console: {
      error: (...args) => logs.push(["error", ...args]),
      info: (...args) => logs.push(["info", ...args]),
      warn: (...args) => logs.push(["warn", ...args]),
    },
    crypto: { randomUUID, subtle: webcrypto.subtle },
    fetch: fetchImpl || (async () => response(500, { error: "UNEXPECTED_FETCH" })),
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Promise,
  });
  let source = await readFile(sourcePath("background.js"), "utf8");
  source = source
    .replace("const MAX_ATTEMPTS = 3;", `const MAX_ATTEMPTS = ${maxAttempts};`)
    .replace("const RETRY_DELAYS_MS = [500, 1500];", "const RETRY_DELAYS_MS = [0, 0];")
    .replace("const LOOPBACK_REQUEST_TIMEOUT_MS = 4000;", `const LOOPBACK_REQUEST_TIMEOUT_MS = ${timeoutMs};`);
  vm.runInContext(source, context);
  return {
    api: context.__SHOPEERS_ERP_BACKGROUND_TEST_API__,
    logs,
    runtimeListeners,
    storage,
  };
}

function requestRecord() {
  return {
    requestId: "ERP-REQ-SECURE",
    ledgerId: "LEDGER-2026-08",
    workspaceId: "workspace-secure",
    status: "registered",
    registeredAt: "2026-08-29T00:00:00.000Z",
    platformSkcs: ["st260608151900573902683"],
    expectedSkus: [{
      platformSku: "I3mqgejkr1vhv7",
      platformSkc: "st260608151900573902683",
    }],
  };
}

function resultInput(overrides = {}) {
  return {
    resultDeliveryId: "ERP-RESULT-SECURE-1",
    createdAt: "2026-08-29T00:01:00.000Z",
    queryCapturedAt: "2026-08-29T00:01:00.000Z",
    querySkcs: ["st260608151900573902683"],
    results: [{
      warehouseSku: "SH25092037232977233-Y",
      unitCost: 3.2,
      totalQty: 12,
      mappings: [
        { platformSku: "I3mqgejkr1vhv7", platformSkc: "st260608151900573902683" },
        { platformSku: "I0mr8u67we1unj", platformSkc: "st260608151900573902683" },
      ],
    }],
    warehouseEvidence: {
      formatVersion: 2,
      warehouses: [{
        warehouseSku: "SH25092037232977233-Y",
        purchaseRecords: [{ quantity: 12, unitPrice: 3.2 }],
        excludedRecords: [],
        sourceWarnings: [],
      }],
      excludedOrders: [],
      excludedDetails: [],
      detailFailures: [],
      mappingFailures: [],
    },
    meta: {
      querySkcs: ["st260608151900573902683"],
      endpoint: "http://attacker.invalid:9999",
      token: "page-token-must-not-survive",
      requestId: "ERP-REQ-FORGED",
      ledgerId: "LEDGER-FORGED",
      workspaceId: "workspace-forged",
      expectedSkus: [{ platformSku: "FORGED", platformSkc: "FORGED" }],
    },
    endpoint: "http://attacker.invalid:9999",
    capability: "page-capability-must-not-survive",
    requestId: "ERP-REQ-FORGED",
    ledgerId: "LEDGER-FORGED",
    workspaceId: "workspace-forged",
    ...overrides,
  };
}

async function verifyManifestAndGenerator() {
  const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.version, "8.0.14");
  assert.deepEqual(manifest.permissions.sort(), ["alarms", "storage"]);
  assert.equal(manifest.content_scripts.length, 2);
  const main = manifest.content_scripts.find((entry) => entry.world === "MAIN");
  const isolated = manifest.content_scripts.find((entry) => !entry.world);
  assert.deepEqual(main.js, ["src/query-hook.js"]);
  assert.equal(main.all_frames, false);
  assert.deepEqual(isolated.js, [
    "src/result-policy.js",
    "src/request-context.js",
    "src/shopeers-bridge.js",
    "src/content.js",
  ]);
  assert.equal(isolated.all_frames, false);
  assert.ok(!isolated.js.includes("src/inbox-config.js"));

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "shopeers-erpa-secure-"));
  const sourceDir = path.join(fixtureRoot, "source");
  const outputDir = path.join(fixtureRoot, "output");
  try {
    await mkdir(path.join(sourceDir, "src"), { recursive: true });
    await writeFile(path.join(sourceDir, "manifest.json"), JSON.stringify({
      manifest_version: 3,
      version: "8.0.0",
      permissions: [],
      host_permissions: ["https://*.zhuolinkeji.cn/*"],
      content_scripts: [{ matches: ["https://*.zhuolinkeji.cn/*"], js: ["src/content.js"], world: "MAIN" }],
    }), "utf8");
    await writeFile(path.join(sourceDir, "src", "content.js"), "window.dispatchEvent(new CustomEvent('shopeers:erp-v8-cost-result'));", "utf8");
    await execFileAsync(process.execPath, [generator, sourceDir, outputDir], { windowsHide: true });
    const generatedManifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const generatedContent = await readFile(path.join(outputDir, "src", "content.js"), "utf8");
    const generatedBackground = await readFile(path.join(outputDir, "src", "background.js"), "utf8");
    assert.deepEqual(generatedManifest.content_scripts, manifest.content_scripts);
    assert.deepEqual(generatedManifest.background, { service_worker: "src/background.js" });
    assert.ok(generatedManifest.permissions.includes("alarms"));
    assert.ok(generatedManifest.permissions.includes("storage"));
    assert.doesNotMatch(generatedContent, /shopeers:erp-v8-cost-result/);
    assert.match(generatedBackground, /authorization:\s*`Bearer/);
    await assert.rejects(() => readFile(path.join(outputDir, "src", "inbox-config.js"), "utf8"));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function verifyPublishedPackage() {
  const packageName = "ERP-Assistant-v8.0.14-shopeers-bridge";
  const publicRoot = path.join(workspaceRoot, "frontend", "public", "integrations", "erp-assistant");
  const publicDir = path.join(publicRoot, packageName);
  const publicZip = path.join(publicRoot, `${packageName}.zip`);
  const verifyRoot = async (root) => {
    const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
    const main = manifest.content_scripts.find((entry) => entry.world === "MAIN");
    const isolated = manifest.content_scripts.find((entry) => !entry.world);
    assert.deepEqual(main.js, ["src/query-hook.js"]);
    assert.equal(main.all_frames, false);
    assert.deepEqual(isolated.js, ["src/result-policy.js", "src/request-context.js", "src/shopeers-bridge.js", "src/content.js"]);
    assert.equal(isolated.all_frames, false);
    const background = await readFile(path.join(root, "src", "background.js"), "utf8");
    const content = await readFile(path.join(root, "src", "content.js"), "utf8");
    const bridge = await readFile(path.join(root, "src", "shopeers-bridge.js"), "utf8");
    assert.match(background, /shopeersErpWorkspaceId/);
    assert.match(background, /shopeersErpInboxCapability/);
    assert.doesNotMatch(background, /DEFAULT_INBOX_BASE_URL/);
    assert.doesNotMatch(`${background}\n${content}\n${bridge}`, /shopeers:erp-v8-cost-result/);
    await assert.rejects(() => readFile(path.join(root, "src", "inbox-config.js"), "utf8"));
  };

  await verifyRoot(publicDir);
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), "shopeers-erpa-public-zip-"));
  try {
    await execFileAsync("tar", ["-xf", publicZip, "-C", extractRoot], { windowsHide: true });
    await verifyRoot(extractRoot);
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}

async function verifyWorldBoundary() {
  const queryHook = await readFile(sourcePath("query-hook.js"), "utf8");
  const content = await readFile(sourcePath("content.js"), "utf8");
  const bridge = await readFile(sourcePath("shopeers-bridge.js"), "utf8");
  const background = await readFile(sourcePath("background.js"), "utf8");
  const appSource = await readFile(path.join(workspaceRoot, "frontend", "src", "App.jsx"), "utf8");
  assert.doesNotMatch(content, /shopeers:erp-v8-cost-result/);
  assert.doesNotMatch(content, /127\.0\.0\.1|localhost|shopeersErpInboxCapability|Authorization:\s*`Bearer/);
  assert.doesNotMatch(bridge, /fetch\s*\(|localStorage|sessionStorage|dataset|127\.0\.0\.1|localhost/);
  assert.doesNotMatch(bridge, /addEventListener\(['"]shopeers:erp-v8-cost-result/);
  assert.match(background, /shopeersErpInboxCapability/);
  assert.match(background, /authorization:\s*`Bearer \$\{capability\}`/);
  assert.match(background, /stripUntrustedControl/);
  assert.doesNotMatch(appSource, /addEventListener\(["']message["']|BroadcastChannel\(["']shopeers-erp-cost/);

  const target = eventTarget();
  const captured = [];
  target.addEventListener("shopeers:erp-v8-query-captured", (event) => captured.push(event.detail));
  const nativeFetchCalls = [];
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  function Xhr() {}
  Xhr.prototype.open = function (...args) { this.args = args; };
  const pageWindow = Object.assign(target, {
    location: { href: "https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html" },
    fetch: async (...args) => { nativeFetchCalls.push(args); return { ok: true }; },
    XMLHttpRequest: Xhr,
  });
  vm.runInNewContext(queryHook, { window: pageWindow, CustomEvent, URL });
  await pageWindow.fetch("https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-1&token=page-secret&endpoint=http://attacker.invalid");
  await pageWindow.fetch("https://www.zhuolinkeji.cn/unrelated?token=secret");
  const xhr = new pageWindow.XMLHttpRequest();
  xhr.open("GET", "/purchase/purchase/v1/purchase-order-page?sku=SKC-2");
  assert.equal(nativeFetchCalls.length, 2);
  assert.equal(captured.length, 2);
  assert.deepEqual(Object.keys(captured[0]), ["url"]);
  assert.equal(new URL(captured[0].url).searchParams.get("sku"), "SKC-1");
  assert.doesNotMatch(JSON.stringify(captured), /capability|authorization|requestId|ledgerId|workspaceId/i);
  assert.doesNotMatch(JSON.stringify(captured), /page-secret|attacker\.invalid/i);

  const isolatedTarget = eventTarget();
  const sent = [];
  const isolatedWindow = Object.assign(isolatedTarget, {});
  const isolatedContext = {
    window: isolatedWindow,
    CustomEvent,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(jsonClone(message));
          callback({ ok: true, status: "success", resultDeliveryId: message.payload?.resultDeliveryId });
        },
      },
    },
  };
  vm.runInNewContext(bridge, isolatedContext);
  isolatedWindow.dispatchEvent(new CustomEvent("shopeers:erp-v8-cost-result", {
    detail: resultInput({ endpoint: "http://attacker.invalid", token: "forged" }),
  }));
  assert.equal(sent.length, 0, "an arbitrary page event must not trigger trusted delivery");
  await isolatedWindow.ShopeersErpDeliveryBridge.submit(resultInput());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "shopeers.erp.submitCostResult");
}

async function verifyBackgroundSecurityAndDelivery() {
  const calls = [];
  const background = await loadBackground({
    storageSeed: {
      shopeersErpInboxBaseUrl: "http://127.0.0.1:8790",
      shopeersErpInboxCapability: capability,
      shopeersErpWorkspaceId: "workspace-secure",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init: { ...init, body: init.body } });
      const pathname = new URL(url).pathname;
      if (pathname === "/erp/v1/requests") return response(200, { records: [requestRecord()] });
      if (pathname === "/erp/v1/cost-results") return response(202, { deliveryId: "DELIVERY-1", batchId: "BATCH-1" });
      if (pathname === "/erp/v1/extension-status") return response(200, { ok: true });
      return response(404, { error: "NOT_FOUND" });
    },
  });
  await assert.rejects(
    () => background.api.submitCostResult(resultInput(), { frameId: 1, tab: sender.tab }),
    (error) => error.code === "ERP_UNTRUSTED_SENDER",
  );
  const delivered = await background.api.submitCostResult(resultInput(), sender);
  assert.equal(delivered.ok, true);
  const getCall = calls.find((call) => new URL(call.url).pathname === "/erp/v1/requests");
  const postCall = calls.find((call) => new URL(call.url).pathname === "/erp/v1/cost-results");
  assert.equal(new URL(getCall.url).searchParams.get("workspaceId"), "workspace-secure");
  assert.equal(getCall.init.headers.authorization, `Bearer ${capability}`);
  assert.equal(postCall.init.headers.authorization, `Bearer ${capability}`);
  assert.equal(new URL(postCall.url).origin, "http://127.0.0.1:8790");
  const posted = JSON.parse(postCall.init.body);
  assert.equal(posted.requestId, "ERP-REQ-SECURE");
  assert.equal(posted.ledgerId, "LEDGER-2026-08");
  assert.equal(posted.workspaceId, "workspace-secure");
  assert.equal(posted.rows.find((row) => row.platformSku === "I3mqgejkr1vhv7").ledgerScopeRole, "expected");
  assert.equal(posted.rows.find((row) => row.platformSku === "I0mr8u67we1unj").ledgerScopeRole, "auxiliary");
  assert.doesNotMatch(JSON.stringify(posted), /attacker\.invalid|page-token|page-capability|ERP-REQ-FORGED|LEDGER-FORGED|workspace-forged/);
  assert.deepEqual(background.storage.shopeersErpPendingCostResultsV2, []);
  assert.doesNotMatch(JSON.stringify(background.storage.shopeersErpPendingCostResultsV2), new RegExp(capability));
  assert.doesNotMatch(JSON.stringify(background.logs), new RegExp(capability));

  calls.length = 0;
  await background.api.reportInstalled({ ready: true, sender });
  const statusBody = JSON.parse(calls.find((call) => new URL(call.url).pathname === "/erp/v1/extension-status").init.body);
  assert.equal(statusBody.pageUrl, sender.tab.url);
  assert.equal(statusBody.context, "extension-isolated");
}

async function verifyAtomicRuntimeConfigurationAndWorkspaceBinding() {
  for (const [label, storageSeed] of [
    ["missing base URL", { shopeersErpInboxCapability: capability, shopeersErpWorkspaceId: "workspace-secure" }],
    ["invalid base URL", { shopeersErpInboxBaseUrl: "http://attacker.invalid:8790", shopeersErpInboxCapability: capability, shopeersErpWorkspaceId: "workspace-secure" }],
    ["missing capability", { shopeersErpInboxBaseUrl: "http://127.0.0.1:8790", shopeersErpWorkspaceId: "workspace-secure" }],
    ["missing workspace", { shopeersErpInboxBaseUrl: "http://127.0.0.1:8790", shopeersErpInboxCapability: capability }],
  ]) {
    let fetchCount = 0;
    const background = await loadBackground({
      storageSeed,
      fetchImpl: async () => {
        fetchCount += 1;
        return response(500, { error: "UNEXPECTED_FETCH" });
      },
    });
    const result = await background.api.submitCostResult(resultInput({ resultDeliveryId: `ERP-RESULT-CONFIG-${label.replaceAll(" ", "-")}` }), sender);
    assert.equal(result.code, "ERP_INBOX_NOT_CONFIGURED", label);
    assert.equal(fetchCount, 0, label);
  }

  const otherWorkspaceRequest = { ...requestRecord(), requestId: "ERP-REQ-OTHER", workspaceId: "workspace-other" };
  const selectedPosts = [];
  const background = await loadBackground({
    storageSeed: {
      shopeersErpInboxBaseUrl: "http://127.0.0.1:8790",
      shopeersErpInboxCapability: capability,
      shopeersErpWorkspaceId: "workspace-secure",
    },
    fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/erp/v1/requests") return response(200, { records: [otherWorkspaceRequest, requestRecord()] });
      if (pathname === "/erp/v1/cost-results") {
        selectedPosts.push(JSON.parse(init.body));
        return response(202, { deliveryId: "DELIVERY-WORKSPACE", batchId: "BATCH-WORKSPACE" });
      }
      return response(404, { error: "NOT_FOUND" });
    },
  });
  const delivered = await background.api.submitCostResult(resultInput({ resultDeliveryId: "ERP-RESULT-WORKSPACE-SELECT" }), sender);
  assert.equal(delivered.ok, true);
  assert.equal(selectedPosts[0].requestId, "ERP-REQ-SECURE");
  assert.equal(selectedPosts[0].workspaceId, "workspace-secure");

  let crossWorkspacePosts = 0;
  const missing = await loadBackground({
    storageSeed: {
      shopeersErpInboxBaseUrl: "http://127.0.0.1:8790",
      shopeersErpInboxCapability: capability,
      shopeersErpWorkspaceId: "workspace-secure",
    },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/erp/v1/requests") return response(200, { records: [otherWorkspaceRequest] });
      crossWorkspacePosts += 1;
      return response(202, {});
    },
  });
  const notFound = await missing.api.submitCostResult(resultInput({ resultDeliveryId: "ERP-RESULT-WORKSPACE-NOT-FOUND" }), sender);
  assert.equal(notFound.code, "ERP_REQUEST_NOT_FOUND");
  assert.equal(crossWorkspacePosts, 0);
}

async function verifyPendingWorkspaceSnapshotCannotRebind() {
  const storageSeed = {
    shopeersErpInboxBaseUrl: "http://127.0.0.1:8790",
    shopeersErpInboxCapability: capability,
    shopeersErpWorkspaceId: "workspace-secure",
  };
  let mode = "offline-a";
  const calls = [];
  const background = await loadBackground({
    storageSeed,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const pathname = new URL(url).pathname;
      if (mode === "offline-a") return response(503, { error: "TEMPORARY_UNAVAILABLE" });
      if (mode === "workspace-b") {
        if (pathname === "/erp/v1/requests") return response(200, { records: [{ ...requestRecord(), requestId: "ERP-REQ-B", workspaceId: "workspace-b" }] });
        throw new Error("workspace B must not receive an ERP delivery owned by workspace A");
      }
      if (pathname === "/erp/v1/requests") return response(200, { records: [requestRecord()] });
      if (pathname === "/erp/v1/cost-results") return response(202, { deliveryId: "DELIVERY-RETURN-A", batchId: "BATCH-RETURN-A" });
      return response(404, { error: "NOT_FOUND" });
    },
  });

  const captured = await background.api.submitCostResult(resultInput({ resultDeliveryId: "ERP-RESULT-WORKSPACE-SNAPSHOT" }), sender);
  assert.equal(captured.status, "cached");
  assert.equal(background.storage.shopeersErpPendingCostResultsV2[0].workspaceId, "workspace-secure");
  const attemptsAfterCapture = background.storage.shopeersErpPendingCostResultsV2[0].attemptsTotal;

  background.storage.shopeersErpWorkspaceId = "workspace-b";
  mode = "workspace-b";
  calls.length = 0;
  await background.api.flushPending();
  assert.equal(calls.length, 0, "a pending workspace A result must not query or post to workspace B");
  assert.equal(background.storage.shopeersErpPendingCostResultsV2[0].workspaceId, "workspace-secure");
  assert.equal(background.storage.shopeersErpPendingCostResultsV2[0].attemptsTotal, attemptsAfterCapture);

  background.storage.shopeersErpWorkspaceId = "workspace-secure";
  mode = "workspace-a";
  calls.length = 0;
  await background.api.flushPending();
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/erp/v1/requests", "/erp/v1/cost-results"]);
  assert.equal(JSON.parse(calls[1].init.body).workspaceId, "workspace-secure");
  assert.deepEqual(background.storage.shopeersErpPendingCostResultsV2, []);

  const hydratedA = {
    resultDeliveryId: "ERP-RESULT-HYDRATED-A",
    createdAt: "2026-08-29T00:01:00.000Z",
    queryCapturedAt: "2026-08-29T00:01:00.000Z",
    registeredBefore: "2026-08-29T00:01:00.000Z",
    attemptsTotal: 2,
    querySkcs: ["ST260608151900573902683"],
    requestId: "ERP-REQ-SECURE",
    ledgerId: "LEDGER-2026-08",
    workspaceId: "workspace-secure",
    expectedSkus: requestRecord().expectedSkus,
    rows: [{
      warehouseSku: "SH25092037232977233-Y",
      platformSku: "I3mqgejkr1vhv7",
      platformSkc: "st260608151900573902683",
      evidenceRef: "SH25092037232977233-Y",
      unitCost: 3.2,
      previewUnitCost: 3.2,
      ledgerScopeRole: "expected",
    }],
    sourceMeta: {},
    warehouseEvidence: resultInput().warehouseEvidence,
  };
  let blockedFetches = 0;
  const blockedHydrated = await loadBackground({
    storageSeed: { ...storageSeed, shopeersErpWorkspaceId: "workspace-b", shopeersErpPendingCostResultsV2: [hydratedA] },
    fetchImpl: async () => { blockedFetches += 1; return response(500, {}); },
  });
  await blockedHydrated.api.flushPending();
  assert.equal(blockedFetches, 0);
  assert.deepEqual(blockedHydrated.storage.shopeersErpPendingCostResultsV2, [hydratedA]);

  const missingWorkspace = { ...hydratedA, resultDeliveryId: "ERP-RESULT-MISSING-WORKSPACE" };
  delete missingWorkspace.workspaceId;
  const blockedMissing = await loadBackground({
    storageSeed: { ...storageSeed, shopeersErpPendingCostResultsV2: [missingWorkspace] },
    fetchImpl: async () => { blockedFetches += 1; return response(500, {}); },
  });
  await blockedMissing.api.flushPending();
  assert.equal(blockedFetches, 0);
  assert.deepEqual(blockedMissing.storage.shopeersErpPendingCostResultsV2, [missingWorkspace]);
}

async function verifyWorkspaceSwitchAfterHydrationRestoresAttemptCount() {
  let getCount = 0;
  let postCount = 0;
  let background;
  background = await loadBackground({
    storageSeed: {
      shopeersErpInboxBaseUrl: "http://127.0.0.1:8790",
      shopeersErpInboxCapability: capability,
      shopeersErpWorkspaceId: "workspace-secure",
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/erp/v1/requests") {
        getCount += 1;
        background.storage.shopeersErpWorkspaceId = "workspace-b";
        return response(200, { records: [requestRecord()] });
      }
      if (pathname === "/erp/v1/cost-results") {
        postCount += 1;
        return response(202, { deliveryId: "DELIVERY-RACE-RECOVERED", batchId: "BATCH-RACE-RECOVERED" });
      }
      return response(404, { error: "NOT_FOUND" });
    },
  });

  const input = resultInput({ resultDeliveryId: "ERP-RESULT-WORKSPACE-RACE" });
  const blocked = await background.api.submitCostResult(input, sender);
  assert.equal(blocked.status, "cached");
  assert.equal(blocked.code, "ERP_WORKSPACE_CONTEXT_CHANGED");
  assert.equal(getCount, 1);
  assert.equal(postCount, 0);
  assert.equal(blocked.attemptsTotal, 0);
  assert.equal(background.storage.shopeersErpPendingCostResultsV2[0].attemptsTotal, 0);
  assert.equal(background.storage.shopeersErpPendingCostResultsV2[0].workspaceId, "workspace-secure");

  background.storage.shopeersErpWorkspaceId = "workspace-secure";
  const recovered = await background.api.submitCostResult(input, sender);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.attemptsTotal, 1);
  assert.equal(getCount, 1, "hydrated context should be reused after returning to workspace A");
  assert.equal(postCount, 1);
  assert.deepEqual(background.storage.shopeersErpPendingCostResultsV2, []);
}

async function verifyRetryRestartAndConflicts() {
  let requestGets = 0;
  const postIds = [];
  let posts = 0;
  const storageSeed = {
    shopeersErpInboxBaseUrl: "http://127.0.0.1:8790",
    shopeersErpInboxCapability: capability,
    shopeersErpWorkspaceId: "workspace-secure",
  };
  const retryBackground = await loadBackground({
    storageSeed,
    maxAttempts: 2,
    fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/erp/v1/requests") {
        requestGets += 1;
        return response(200, { records: [requestRecord()] });
      }
      if (pathname === "/erp/v1/cost-results") {
        posts += 1;
        postIds.push(JSON.parse(init.body).resultDeliveryId);
        if (posts === 1) throw new TypeError("accepted response lost");
        return response(202, { deliveryId: "DELIVERY-RETRY", batchId: "BATCH-RETRY", idempotent: true });
      }
      return response(200, {});
    },
  });
  const retryResult = await retryBackground.api.submitCostResult(resultInput(), sender);
  assert.equal(retryResult.ok, true);
  assert.equal(requestGets, 1, "hydrated request context must be reused across retries");
  assert.deepEqual(postIds, ["ERP-RESULT-SECURE-1", "ERP-RESULT-SECURE-1"]);
  assert.deepEqual(retryBackground.storage.shopeersErpPendingCostResultsV2, []);

  const hydratedRecord = {
    resultDeliveryId: "ERP-RESULT-RESTART",
    createdAt: "2026-08-29T00:01:00.000Z",
    queryCapturedAt: "2026-08-29T00:01:00.000Z",
    registeredBefore: "2026-08-29T00:01:00.000Z",
    attemptsTotal: 1,
    querySkcs: ["ST260608151900573902683"],
    requestId: "ERP-REQ-SECURE",
    ledgerId: "LEDGER-2026-08",
    workspaceId: "workspace-secure",
    expectedSkus: requestRecord().expectedSkus,
    rows: [{
      warehouseSku: "SH25092037232977233-Y",
      platformSku: "I3mqgejkr1vhv7",
      platformSkc: "st260608151900573902683",
      evidenceRef: "SH25092037232977233-Y",
      unitCost: 3.2,
      previewUnitCost: 3.2,
      ledgerScopeRole: "expected",
    }],
    sourceMeta: {},
    warehouseEvidence: resultInput().warehouseEvidence,
  };
  const restartBackground = await loadBackground({
    storageSeed: { ...storageSeed, shopeersErpPendingCostResultsV2: [hydratedRecord] },
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/erp/v1/cost-results");
      return response(202, { deliveryId: "DELIVERY-RESTART", batchId: "BATCH-RESTART" });
    },
  });
  await restartBackground.api.flushPending();
  assert.deepEqual(restartBackground.storage.shopeersErpPendingCostResultsV2, []);

  const conflictBackground = await loadBackground({
    storageSeed,
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/erp/v1/requests") return response(200, { records: [requestRecord()] });
      return response(409, { error: "ERP_RESULT_DELIVERY_CONFLICT", message: "delivery conflict" });
    },
  });
  const conflict = await conflictBackground.api.submitCostResult(resultInput(), sender);
  assert.equal(conflict.status, "failed");
  assert.deepEqual(conflictBackground.storage.shopeersErpPendingCostResultsV2, []);
}

async function verifyTimeoutAndInvalidJsonReleaseOwner() {
  let mode = "hang";
  let posts = 0;
  const background = await loadBackground({
    timeoutMs: 15,
    storageSeed: {
      shopeersErpInboxBaseUrl: "http://127.0.0.1:8790",
      shopeersErpInboxCapability: capability,
      shopeersErpWorkspaceId: "workspace-secure",
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/erp/v1/requests") return response(200, { records: [requestRecord()] });
      posts += 1;
      if (mode === "hang") return { ok: true, status: 202, json: () => new Promise(() => {}) };
      if (mode === "invalid") return { ok: true, status: 202, json: async () => { throw new SyntaxError("truncated"); } };
      return response(202, { deliveryId: "DELIVERY-RECOVERED", batchId: "BATCH-RECOVERED" });
    },
  });
  const timedOut = await background.api.submitCostResult(resultInput(), sender);
  assert.equal(timedOut.status, "cached");
  mode = "success";
  const recovered = await background.api.submitCostResult(resultInput(), sender);
  assert.equal(recovered.ok, true, "same delivery must recover after body timeout releases its owner");

  mode = "invalid";
  const invalidInput = resultInput({ resultDeliveryId: "ERP-RESULT-INVALID-JSON" });
  const invalid = await background.api.submitCostResult(invalidInput, sender);
  assert.equal(invalid.status, "cached");
  mode = "success";
  const invalidRecovered = await background.api.submitCostResult(invalidInput, sender);
  assert.equal(invalidRecovered.ok, true, "invalid JSON must not leave the delivery owner locked");
  assert.ok(posts >= 4);
}

await verifyManifestAndGenerator();
await verifyPublishedPackage();
await verifyWorldBoundary();
await verifyBackgroundSecurityAndDelivery();
await verifyAtomicRuntimeConfigurationAndWorkspaceBinding();
await verifyPendingWorkspaceSnapshotCannotRebind();
await verifyWorkspaceSwitchAfterHydrationRestoresAttemptCount();
await verifyRetryRestartAndConflicts();
await verifyTimeoutAndInvalidJsonReleaseOwner();

console.log("ERP Assistant secure bridge contract tests passed.");
