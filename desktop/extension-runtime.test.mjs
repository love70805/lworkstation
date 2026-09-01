import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extensionStorageConfig, INBOX_STORAGE_KEYS } = require("./extension-runtime.cjs");

const config = extensionStorageConfig({ port: 23456, capability: "x".repeat(43), workspaceId: "workspace-1" });
assert.deepEqual(Object.keys(config).sort(), [...INBOX_STORAGE_KEYS].sort());
assert.deepEqual(config, {
  shopeersErpInboxBaseUrl: "http://127.0.0.1:23456",
  shopeersErpInboxCapability: "x".repeat(43),
  shopeersErpWorkspaceId: "workspace-1",
});
assert.throws(() => extensionStorageConfig({ port: 23456, capability: "short", workspaceId: "workspace-1" }), /配置无效/);
assert.throws(() => extensionStorageConfig({ port: 23456, capability: "x".repeat(43), workspaceId: "" }), /配置无效/);
console.log("desktop extension runtime storage contract tests passed");
