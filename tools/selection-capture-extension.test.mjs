import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backgroundSource = await readFile(path.join(repoRoot, "integrations/1688-selection-extension/background.js"), "utf8");
assert.doesNotMatch(backgroundSource, /targetAddressSpace/);

function loadBackground(runtimeConfig, responses = {}) {
  const fetchCalls = [];
  let storedConfig = runtimeConfig || {};
  const chrome = {
    storage: { local: { get: async () => storedConfig } },
    runtime: {
      getManifest: () => ({ version: "1.2.1" }),
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
  };
  const context = {
    chrome,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      const response = responses[String(url)] ?? { ok: true, payload: { ok: true, context: {} } };
      return {
        ok: response.ok !== false,
        json: async () => response.payload ?? {},
      };
    },
    __SELECTION_WORKBENCH_EXTENSION_TEST__: true,
  };
  vm.runInNewContext(backgroundSource, context, { filename: "background.js" });
  return { api: context.__SELECTION_WORKBENCH_EXTENSION_TEST_API__, fetchCalls, setRuntimeConfig: (next) => { storedConfig = next; } };
}

const capability = "capability-012345678901234567890123456789";
const validConfig = {
  shopeersErpInboxBaseUrl: "http://127.0.0.1:21999",
  shopeersErpInboxCapability: capability,
  shopeersErpWorkspaceId: "workspace-a",
};

for (const runtimeConfig of [
  undefined,
  { ...validConfig, shopeersErpInboxBaseUrl: "https://127.0.0.1:21999" },
  { ...validConfig, shopeersErpInboxBaseUrl: "http://evil.example:21999" },
  { ...validConfig, shopeersErpInboxCapability: "short" },
  { ...validConfig, shopeersErpWorkspaceId: "" },
  { shopeersErpInboxCapability: capability, shopeersErpWorkspaceId: "workspace-a" },
]) {
  const { api, fetchCalls } = loadBackground(runtimeConfig);
  assert.equal(api.normalizeRuntimeConfig(runtimeConfig), null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls.length, 0);
}

const { api, fetchCalls } = loadBackground(validConfig, {
  "http://127.0.0.1:21999/selection/v1/status": { ok: true, payload: { ok: true } },
  "http://127.0.0.1:21999/selection/v1/extension-status": { ok: true, payload: { ok: true } },
  "http://127.0.0.1:21999/selection/v1/captures": { ok: true, payload: { ok: true } },
});
await api.testConnection();
await api.reportInstalled("https://order.1688.com/order/confirm.html", { strict: true });
await api.sendCapture({
  schemaVersion: 1,
  source: "1688",
  requestId: "extension-vm-test",
  workspaceId: "forged-workspace",
  ownerId: "forged-member",
  visibility: "private",
  capability,
  product: { name: "测试商品" },
});

assert.equal(fetchCalls.length, 4);
assert.deepEqual(fetchCalls.map(({ url }) => url), [
  "http://127.0.0.1:21999/selection/v1/extension-status",
  "http://127.0.0.1:21999/selection/v1/status",
  "http://127.0.0.1:21999/selection/v1/extension-status",
  "http://127.0.0.1:21999/selection/v1/captures",
]);
assert.equal(fetchCalls.filter(({ url }) => url.endsWith("/context")).length, 0);
for (const { options } of fetchCalls) assert.equal(options.headers.Authorization, `Bearer ${capability}`);
assert.equal(JSON.stringify(fetchCalls.at(-1).options.body).includes(capability), false);
const sentEnvelope = JSON.parse(fetchCalls.at(-1).options.body);
assert.equal(sentEnvelope.workspaceId, undefined);
assert.equal(sentEnvelope.ownerId, undefined);
assert.equal(sentEnvelope.visibility, undefined);
assert.equal(sentEnvelope.capability, undefined);
console.log("1688 selection capture extension transport test passed");

const rotatedCapability = "rotated-capability-012345678901234567890";
const rotated = loadBackground(validConfig, {
  "http://127.0.0.1:21999/selection/v1/status": { ok: true, payload: { ok: true } },
});
await rotated.api.testConnection();
rotated.setRuntimeConfig({ ...validConfig, shopeersErpInboxCapability: rotatedCapability });
await rotated.api.testConnection();
assert.equal(rotated.fetchCalls.at(-2).options.headers.Authorization, `Bearer ${capability}`);
assert.equal(rotated.fetchCalls.at(-1).options.headers.Authorization, `Bearer ${rotatedCapability}`);

const desktopStorageFixture = {
  shopeersErpInboxBaseUrl: "http://127.0.0.1:23456",
  shopeersErpInboxCapability: "x".repeat(43),
  shopeersErpWorkspaceId: "workspace-1",
};
const normalizedDesktopFixture = api.normalizeRuntimeConfig(desktopStorageFixture);
assert.equal(normalizedDesktopFixture.baseUrl, "http://127.0.0.1:23456/selection/v1");
assert.equal(normalizedDesktopFixture.capability, "x".repeat(43));
assert.equal(normalizedDesktopFixture.workspaceId, "workspace-1");
