import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { extensionStorageConfig, INBOX_STORAGE_KEYS, prepareRuntimeExtension } = require("./extension-runtime.cjs");

const config = extensionStorageConfig({ port: 23456, capability: "x".repeat(43), workspaceId: "workspace-1" });
assert.deepEqual(Object.keys(config).sort(), [...INBOX_STORAGE_KEYS].sort());
assert.deepEqual(config, {
  shopeersErpInboxBaseUrl: "http://127.0.0.1:23456",
  shopeersErpInboxCapability: "x".repeat(43),
  shopeersErpWorkspaceId: "workspace-1",
  shopeersErpDesktopTaskUi: true,
});
assert.throws(() => extensionStorageConfig({ port: 23456, capability: "short", workspaceId: "workspace-1" }), /配置无效/);
assert.throws(() => extensionStorageConfig({ port: 23456, capability: "x".repeat(43), workspaceId: "" }), /配置无效/);
console.log("desktop extension runtime storage contract tests passed");

await assert.rejects(prepareRuntimeExtension({ runtimeId: "1688", sourceDirectory: "unused", userDataPath: "unused" }), /参数无效/);

// Inject Windows directory-lock failures while all file operations stay in a
// synthetic profile. A failed promotion must preserve a complete usable copy.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-runtime-'));
const originalRename = fs.rename, originalRemove = fs.rm;
async function fixture(name) {
  const userDataPath = path.join(root, name);
  const sourceDirectory = path.join(userDataPath, 'source');
  const runtime = path.join(userDataPath, 'Lworkstation-runtime-extensions');
  const target = path.join(runtime, 'erp'), previous = path.join(runtime, '.previous-erp');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'new.js'), 'new runtime');
  await fs.writeFile(path.join(target, 'old.js'), 'old runtime');
  return { target, previous, runtime, options: { sourceDirectory, userDataPath, runtimeId: 'erp', port: 23456 } };
}
const busy = () => Object.assign(new Error('synthetic directory lock'), { code: 'EBUSY' });
try {
  const untouched = await fixture('cannot-move-current');
  let attempts = 0;
  fs.rename = async (from, to) => {
    if (from === untouched.target) { attempts++; throw busy(); }
    return originalRename(from, to);
  };
  await assert.rejects(prepareRuntimeExtension(untouched.options), { code: 'EBUSY' });
  assert.equal(attempts, 5);
  assert.equal(await fs.readFile(path.join(untouched.target, 'old.js'), 'utf8'), 'old runtime');
  assert.deepEqual(await fs.readdir(untouched.runtime), ['erp']);
  fs.rename = originalRename;

  const rollback = await fixture('cannot-promote');
  fs.rename = async (from, to) => {
    if (path.basename(from).startsWith('.staging-')) throw busy();
    return originalRename(from, to);
  };
  await assert.rejects(prepareRuntimeExtension(rollback.options), { code: 'EBUSY' });
  assert.equal(await fs.readFile(path.join(rollback.target, 'old.js'), 'utf8'), 'old runtime');
  assert.deepEqual(await fs.readdir(rollback.runtime), ['erp']);
  fs.rename = originalRename;

  const retained = await fixture('cannot-restore');
  fs.rename = async (from, to) => {
    if (path.basename(from).startsWith('.staging-') || from === retained.previous) throw busy();
    return originalRename(from, to);
  };
  await assert.rejects(prepareRuntimeExtension(retained.options), { code: 'EBUSY' });
  assert.equal(await fs.readFile(path.join(retained.previous, 'old.js'), 'utf8'), 'old runtime');
  fs.rename = originalRename;

  const cleanup = await fixture('partial-old-cleanup');
  let promoted = false;
  fs.rename = async (from, to) => {
    await originalRename(from, to);
    if (path.basename(from).startsWith('.staging-') && to === cleanup.target) promoted = true;
  };
  fs.rm = async (target, options) => {
    if (target === cleanup.previous && promoted) {
      await fs.unlink(path.join(cleanup.previous, 'old.js'));
      throw busy();
    }
    return originalRemove(target, options);
  };
  assert.equal(await prepareRuntimeExtension(cleanup.options), cleanup.target);
  assert.equal(await fs.readFile(path.join(cleanup.target, 'new.js'), 'utf8'), 'new runtime');
  console.log('Extension replacement preserves the current runtime, rolls back failed promotion, retains failed rollback and tolerates partial cleanup.');
} finally {
  fs.rename = originalRename;
  fs.rm = originalRemove;
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'extension-runtime-')));
  await originalRemove(root, { recursive: true, force: true });
}
