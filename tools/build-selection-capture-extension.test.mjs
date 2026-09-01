import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "shopeers-selection-extension-"));
const outputRoot = path.join(fixtureRoot, "output");

try {
  await execFileAsync(process.execPath, [path.join(repoRoot, "tools/build-selection-capture-extension.mjs"), path.join(repoRoot, "integrations/1688-selection-extension"), outputRoot], { windowsHide: true });
  const packageDir = path.join(outputRoot, "Shopeers-1688-Capture-v1.2.1");
  const manifest = JSON.parse(await readFile(path.join(packageDir, "manifest.json"), "utf8"));
  const background = await readFile(path.join(packageDir, "background.js"), "utf8");
  const popup = await readFile(path.join(packageDir, "popup.js"), "utf8");
  assert.equal(manifest.version, "1.2.1");
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(manifest.host_permissions.includes("http://localhost/*"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.match(background, /\/captures/);
  assert.match(background, /shopeersErpInboxBaseUrl/);
  assert.match(background, /shopeersErpInboxCapability/);
  assert.match(background, /shopeersErpWorkspaceId/);
  assert.doesNotMatch(background, /shopeersSelectionRuntime/);
  assert.match(background, /chrome\.storage\.local\.get/);
  assert.match(background, /Authorization/);
  assert.match(background, /MIN_CAPABILITY_LENGTH/);
  assert.doesNotMatch(background, /127\.0\.0\.1:8790\/selection\/v1/);
  assert.match(background, /validateCaptureSender/);
  assert.match(background, /reportInstalled\('', \{strict: true\}\)/);
  assert.match(popup, /chrome\.permissions\.contains/);
  assert.match(popup, /chrome\.permissions\.request/);
  assert.match(popup, /chrome\.storage\.local\.get/);
  assert.match(popup, /shopeersErpInboxBaseUrl/);
  assert.match(popup, /shopeersErpInboxCapability/);
  assert.match(popup, /shopeersErpWorkspaceId/);
  assert.doesNotMatch(popup, /shopeersSelectionRuntime/);
  assert.doesNotMatch(popup, /127\.0\.0\.1:8790\/selection\/v1/);
  assert.doesNotMatch(background, /targetAddressSpace/);
  console.log("1688 selection capture extension build test passed");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
