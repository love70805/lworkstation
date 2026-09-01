import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pkg = JSON.parse(read("package.json"));
const releasePlan = JSON.parse(read("release-plan.json"));
assert.equal(pkg.main, "main.cjs");
assert.equal(pkg.version, releasePlan.version);
assert.equal(pkg.name, "shopeers-desktop");
assert.equal(pkg.build.appId, "com.shopeers.workstation");
assert.equal(pkg.build.productName, "Lworkstation");
assert.equal(pkg.build.win.executableName, "Lworkstation");
assert.equal(pkg.build.win.artifactName, "Lworkstation Setup ${version}.${ext}");
assert.equal(pkg.build.win.icon, "assets/lworkstation.ico");
assert.equal(pkg.build.nsis.shortcutName, "Lworkstation");
assert.equal(pkg.build.nsis.uninstallDisplayName, "Lworkstation ${version}");
assert.ok(pkg.build.files.includes("workspace-navigation.cjs"));
for (const key of ["installerIcon", "installerHeaderIcon", "uninstallerIcon"]) assert.equal(pkg.build.nsis[key], "assets/lworkstation.ico");
assert.match(pkg.scripts.build, /pnpm brand:icons/);
assert.match(pkg.scripts.build, /electronDist=\.\/node_modules\/electron\/dist/);
assert.ok(pkg.dependencies["electron-updater"]);
assert.ok(pkg.dependencies.lucide);
for (const file of ["main.cjs", "desktop-preferences.cjs", "extension-runtime.cjs", "extension-runtime.test.mjs", "workspace-context.cjs", "workspace-context.test.mjs", "workspace-navigation.cjs", "workspace-navigation.test.mjs", "inbox-ipc.cjs", "inbox-ipc.test.mjs", "generate-brand-assets.cjs", "navigation-history.cjs", "inbox-service.cjs", "inbox-service.test.mjs", "remote-navigation.cjs", "preload.cjs", "workspace-preload.cjs", "shell.html", "shell.css", "shell-state.cjs", "shell.js", "inbox-popover.html", "inbox-popover.css", "inbox-popover.js", "inbox-popover-preload.cjs", "inbox-popover-lifecycle.cjs", "update-runtime.cjs", "update-runtime.test.mjs", "update-popover.html", "update-popover.css", "update-popover.js", "update-popover-preload.cjs", "build-update-fixtures.mjs", "update-smoke.mjs", "update-fixture-config.cjs", "update-fixture-after-pack.cjs", "smoke.mjs", "update-config.json", "update-beta-config.json", "update-test-config.json", "UPDATE_RELEASE_CHECKLIST.md", "release-plan.json", "organize-release.mjs", "release-artifacts.mjs", "release-artifacts.test.mjs", "release-check.mjs", "assets/lworkstation.png", "assets/lworkstation.ico"]) assert.ok(fs.existsSync(path.join(root, file)), file);
const masterSource = fs.readFileSync(path.join(root, "../frontend/public/assets/brand/l7-app-icon-master.svg"), "utf8").replace(/\r\n/g, "\n");
assert.equal(crypto.createHash("sha256").update(masterSource).digest("hex").toUpperCase(), "07A556FA1A57EC9E147138CFA97443214FF63AB0E67CB4B3AD10EB4A5708DA53");
const png = fs.readFileSync(path.join(root, "assets/lworkstation.png"));
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(png.readUInt32BE(16), 1024);
assert.equal(png.readUInt32BE(20), 1024);
assert.match(read("generate-brand-assets.cjs"), /transparent:\s*true/);
assert.match(read("generate-brand-assets.cjs"), /backgroundColor:\s*"#00000000"/);
const ico = fs.readFileSync(path.join(root, "assets/lworkstation.ico"));
assert.equal(ico.readUInt16LE(0), 0);
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 7);
const icoSizes = [];
for (let index = 0; index < 7; index += 1) {
  const entry = 6 + index * 16;
  const size = ico.readUInt8(entry) || 256;
  const height = ico.readUInt8(entry + 1) || 256;
  const length = ico.readUInt32LE(entry + 8);
  const offset = ico.readUInt32LE(entry + 12);
  assert.equal(height, size);
  assert.equal(ico.subarray(offset, offset + 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(offset + length <= ico.length, true);
  icoSizes.push(size);
}
assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256]);
const main = read("main.cjs");
assert.doesNotMatch(read("shell.html"), /id="fallback"/);
assert.doesNotMatch(read("shell.css"), /\.fallback/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /sandbox:\s*true/);
assert.match(main, /persist:erp/);
assert.match(main, /persist:1688/);
assert.match(main, /loadExtension/);
assert.match(main, /setWindowOpenHandler/);
assert.match(main, /navigateRemoteView\(tabId, decision\.url, "新窗口"\)/);
assert.match(main, /removeChildView/);
assert.match(main, /const SHELL_TOP_HEIGHT = 80/);
assert.match(main, /DESKTOP_ICON_PATH = path\.join\(__dirname, "assets", "lworkstation\.ico"\)/);
assert.match(main, /icon: DESKTOP_ICON_PATH/);
assert.match(main, /app\.setAppUserModelId\("com\.shopeers\.workstation"\)/);
assert.doesNotMatch(main, /SHELL_STATUS_HEIGHT/);
assert.match(main, /const INBOX_POPOVER_MIN_HEIGHT = 43/);
assert.match(main, /const INBOX_POPOVER_MAX_HEIGHT = 220/);
assert.match(main, /const INBOX_POPOVER_WIDTH = 175/);
assert.match(main, /const contentTop = SHELL_TOP_HEIGHT/);
assert.match(main, /height - contentTop/);
assert.match(main, /reportPreferenceWriteFailure/);
assert.match(main, /缩放已应用，但暂时无法保存/);
assert.match(main, /try \{\s*saveAppearancePreference/);
assert.match(main, /parent: mainWindow/);
assert.match(main, /skipTaskbar: true/);
assert.match(main, /minHeight: INBOX_POPOVER_MIN_HEIGHT/);
assert.match(main, /minWidth: 168/);
assert.match(main, /maxHeight: INBOX_POPOVER_MAX_HEIGHT/);
assert.match(main, /inbox-popover-preload\.cjs/);
assert.match(main, /createInboxPopoverLifecycle/);
assert.match(main, /inboxPopoverLifecycle\.isCurrent\(generation\)/);
assert.match(main, /inboxPopoverLifecycle\.close\(generation\)/);
assert.match(main, /popup\.isDestroyed\(\)\) return;/);
assert.match(main, /runPopoverSmokeToggle/);
assert.match(main, /first-close-before-load/);
assert.match(main, /second-shown/);
assert.match(main, /secondBounds/);
assert.match(read("smoke.mjs"), /popoverToggleSmoke/);
assert.match(read("smoke.mjs"), /secondBounds\?\.width > 176/);
assert.match(read("smoke.mjs"), /secondBounds\?\.height > 44/);
assert.match(main, /positionInboxPopover/);
assert.match(main, /titleBarStyle:\s*"hidden"/);
assert.match(main, /titleBarOverlay/);
assert.match(main, /height:\s*36/);
assert.match(main, /openInExternalChrome/);
assert.match(main, /autoUpdater\.quitAndInstall/);
assert.doesNotMatch(main, /autoUpdater\.autoDownload\s*=\s*true/);
assert.doesNotMatch(main, /autoUpdater\.autoInstallOnAppQuit\s*=\s*true/);
assert.match(read("update-runtime.cjs"), /updater\.autoDownload = false/);
assert.match(read("update-runtime.cjs"), /updater\.autoInstallOnAppQuit = false/);
assert.match(read("update-runtime.cjs"), /4 \* 60 \* 60 \* 1000/);
assert.match(pkg.scripts["build:update-fixtures"], /build-update-fixtures\.mjs/);
assert.match(pkg.scripts["smoke:update"], /update-smoke\.mjs/);
assert.match(read("update-smoke.mjs"), /targetInstallerName = testConfig\.targetArtifactName/);
assert.doesNotMatch(read("update-smoke.mjs"), /targetFeedInstallerName|safeName === target.*\? targetInstaller/);
assert.match(read("update-smoke.mjs"), /const localFile = path\.join\(feedRoot, safeName\)/);
assert.match(read("update-smoke.mjs"), /SHOPEERS_DESKTOP_UPDATE_CHANNEL: testConfig\.channel/);
assert.match(read("update-smoke.mjs"), /updaterOptions\.allowPrerelease !== true/);
assert.match(read("update-smoke.mjs"), /updaterOptions\.channel !== "beta"/);
assert.match(read("update-smoke.mjs"), /legacyAliasResponse\.status !== 404/);
assert.match(read("build-update-fixtures.mjs"), /release-test/);
assert.match(read("update-smoke.mjs"), /release-test/);
assert.doesNotMatch(read("build-update-fixtures.mjs"), /release-internal|internal\.\d/);
assert.doesNotMatch(read("update-smoke.mjs"), /release-internal|internal\.\d/);
assert.match(main, /app\.setPath\("cache", smokeCachePath\)/);
assert.match(main, /process\.env\.LOCALAPPDATA = smokeCachePath/);
assert.match(read("update-smoke.mjs"), /SHOPEERS_DESKTOP_SMOKE_CACHE: cachePath/);
assert.match(read("update-smoke.mjs"), /postponeInstallerRequests\.length < 2/);
assert.match(read("update-smoke.mjs"), /installInstallerRequests\.length < 1/);
assert.match(read("smoke.mjs"), /SHOPEERS_DESKTOP_SMOKE_CACHE: cachePath/);
const updateConfig = JSON.parse(read("update-config.json"));
assert.deepEqual(updateConfig, { enabled: false, provider: "github", owner: "love70805", repo: "lworkstation", private: false, channel: "latest" });
assert.doesNotMatch(read("update-config.json"), /shopeers\.invalid|token/i);
const betaUpdateConfig = JSON.parse(read("update-beta-config.json"));
assert.deepEqual(betaUpdateConfig, { enabled: true, provider: "github", owner: "love70805", repo: "lworkstation", private: false, channel: "beta" });
assert.doesNotMatch(read("update-beta-config.json"), /token/i);
const updateTestConfig = JSON.parse(read("update-test-config.json"));
assert.deepEqual(updateTestConfig, {
  enabled: false,
  purpose: "beta-smoke-only",
  channel: "beta",
  releaseType: "prerelease",
  sourceVersion: "0.2.6-beta.1",
  targetVersion: "0.2.6-beta.2",
  artifactPattern: "Lworkstation-Setup-${version}.${ext}",
  metadataFile: "beta.yml",
  betaConfigFile: "update-beta-config.json",
  feed: "loopback-only",
  repository: {
    owner: "love70805",
    repo: "lworkstation",
    sourceTag: "v0.2.6-beta.1",
    targetTag: "v0.2.6-beta.2",
  },
  status: "prepared-not-published",
});
const { loadUpdateFixtureConfig } = createRequire(import.meta.url)("./update-fixture-config.cjs");
const loadedFixtureConfig = loadUpdateFixtureConfig(root);
assert.equal(loadedFixtureConfig.sourceArtifactName, "Lworkstation-Setup-0.2.6-beta.1.exe");
assert.equal(loadedFixtureConfig.targetArtifactName, "Lworkstation-Setup-0.2.6-beta.2.exe");
assert.equal(pkg.build.files.includes("update-beta-config.json"), false, "beta config must not enter stable app.asar");
assert.equal(pkg.build.extraResources.some((resource) => resource.from === "update-beta-config.json"), false, "stable packages must not embed beta config");
assert.match(main, /allowLoopback && process\.env\.SHOPEERS_DESKTOP_UPDATE_URL/);
assert.match(main, /SHOPEERS_DESKTOP_UPDATE_CHANNEL === "beta"/);
assert.match(main, /enabled: app\.isPackaged && settings\.enabled/);
assert.match(main, /updateState = updateRuntime\.snapshot\(\)/);
assert.match(main, /protocol\.registerSchemesAsPrivileged/);
assert.match(main, /protocol\.handle\("shopeers"/);
assert.doesNotMatch(main, /createServer\(/);
assert.match(main, /createInboxServiceController/);
assert.match(main, /SHOPEERS_DESKTOP_SMOKE_ERP_V2/);
assert.match(read("preload.cjs"), /desktop:check-update/);
for (const channel of ["download-update", "cancel-update", "postpone-update", "install-update", "open-release-notes"]) assert.match(read("preload.cjs"), new RegExp(`desktop:${channel}`));
assert.match(main, /isUpdateSender/);
assert.match(main, /event\.sender === mainWindow\?\.webContents \|\| event\.sender === updatePopoverWindow\?\.webContents/);
assert.doesNotMatch(main, /desktop:retry-inbox|desktop:open-cost-matching/);
assert.doesNotMatch(read("preload.cjs"), /retryInbox|openCostMatching/);
assert.match(read("workspace-preload.cjs"), /shopeersDesktopRuntime/);
assert.match(read("workspace-preload.cjs"), /--shopeers-version=/);
assert.match(read("workspace-preload.cjs"), /workspace:appearance/);
assert.doesNotMatch(read("workspace-preload.cjs"), /desktop:(?:check|download|cancel|postpone|install)-update|open-release-notes|updatePopover/);
assert.match(main, /workspace-preload\.cjs/);
assert.match(main, /--shopeers-version=/);
assert.match(main, /desktop:request-inbox/);
assert.match(main, /inboxCapability/);
assert.match(read("inbox-service.cjs"), /SHOPEERS_ERP_INBOX_CAPABILITY/);
assert.match(read("shell.html"), /lucide\.min\.js/);
assert.match(read("shell.html"), /id="inbox-status"/);
assert.match(read("shell.html"), /id="app-version"/);
assert.match(read("shell.html"), /id="update-status"/);
assert.match(read("shell.html"), /id="erp-zoom"/);
assert.match(read("shell.html"), /id="erp-zoom-label"/);
assert.doesNotMatch(read("shell.html"), /class="statusbar"|经营工作站|经营管理中心|id="inbox-label"/);
assert.match(read("shell.html"), /data-action="back"/);
assert.match(read("shell.html"), /data-action="forward"/);
assert.match(read("shell.html"), /Lworkstation/);
assert.match(main, /desktop:back/);
assert.match(main, /desktop:forward/);
assert.match(main, /navigateHistory/);
assert.doesNotMatch(main, /webContents\.canGoBack\(/);
assert.doesNotMatch(main, /webContents\.canGoForward\(/);
assert.match(read("preload.cjs"), /desktop:back/);
assert.match(read("preload.cjs"), /desktop:forward/);
assert.match(read("preload.cjs"), /desktop:toggle-inbox-popover/);
assert.match(read("preload.cjs"), /desktop:inbox-popover-toggle-intent/);
assert.match(read("shell.js"), /pointerdown/);
assert.match(read("preload.cjs"), /desktop:adjust-erp-zoom/);
assert.match(read("shell.js"), /runDesktopAction/);
assert.match(read("shell.js"), /dataset\.activeTab/);
assert.match(read("shell.js"), /backAction\.hidden = workspaceActive/);
assert.match(read("shell.js"), /getAddressPresentation/);
assert.match(read("shell.js"), /toggleInboxPopover/);
assert.match(main, /runPopoverDomClickSmoke/);
assert.match(main, /desktop:inbox-popover-toggle-intent/);
assert.match(read("smoke.mjs"), /popoverDomClickSmoke/);
assert.match(main, /runUpdatePopoverDomClickSmoke/);
assert.match(read("smoke.mjs"), /SHOPEERS_DESKTOP_UPDATE_SMOKE/);
assert.match(read("shell.js"), /adjustErpZoom/);
assert.match(read("shell.js"), /erpZoom\.hidden = .*state\.activeTab !== "erp"/);
assert.match(read("shell.js"), /erpZoomLabel\.textContent = `\$\{zoom\.percent\}%`/);
assert.doesNotMatch(read("shell.js"), /pageStatus|extensionStatus|updateLabel|statusDot/);
assert.match(read("shell.css"), /height:\s*80px/);
assert.match(read("shell.css"), /height:\s*44px/);
assert.match(read("shell.css"), /#erp-zoom-label\s*\{[^}]*min-width:\s*36px/);
assert.match(read("shell.css"), /@media \(max-width:\s*1199px\)[\s\S]*?#erp-zoom-label\s*\{[^}]*min-width:\s*30px/);
assert.doesNotMatch(read("shell.css"), /\.erp-zoom-label/);
assert.doesNotMatch(read("shell.css"), /\.statusbar|\.page-state|#page-status|#update-action|\.app-version/);
assert.doesNotMatch(read("shell.html"), /id="inbox-popover"|inbox-retry|inbox-open-cost|最近变化|请求标识|批次标识/);
assert.doesNotMatch(read("shell.js"), /desktop\.navigate|window\.desktop\.navigate/);
assert.doesNotMatch(read("preload.cjs"), /desktop:navigate/);
assert.doesNotMatch(main, /ipcMain\.handle\("desktop:navigate"/);
assert.doesNotMatch(read("shell.html"), /Lworkstation 内部工作站/);
assert.doesNotMatch(read("shell.js"), /activeTabState\?\.title \|\| "工作站就绪"/);
assert.doesNotMatch(read("shell.html"), /外部 Chrome/);
assert.match(read("shell.css"), /-webkit-app-region:\s*drag/);
assert.match(read("shell.css"), /html\[data-appearance="dark"\]/);
assert.ok(pkg.build.files.includes("shell-state.cjs"));
assert.ok(pkg.build.files.includes("desktop-preferences.cjs"));
assert.ok(pkg.build.files.includes("assets/lworkstation.ico"));
assert.ok(fs.existsSync(path.join(root, "UPDATE_RELEASE_CHECKLIST.md")));
assert.match(read("UPDATE_RELEASE_CHECKLIST.md"), /0\.2\.5 -> 0\.2\.6-beta\.1/);
assert.match(read("UPDATE_RELEASE_CHECKLIST.md"), /0\.2\.6-beta\.1 -> 0\.2\.6-beta\.2/);
assert.match(read("UPDATE_RELEASE_CHECKLIST.md"), /beta\.yml/);
assert.match(read("UPDATE_RELEASE_CHECKLIST.md"), /Lworkstation-Setup-0\.2\.6-beta\.1\.exe/);
assert.match(read("UPDATE_RELEASE_CHECKLIST.md"), /Lworkstation-Setup-0\.2\.6-beta\.2\.exe/);
assert.match(read("UPDATE_RELEASE_CHECKLIST.md"), /不支持软件内发现/);
assert.doesNotMatch(read("UPDATE_RELEASE_CHECKLIST.md"), /Lworkstation Setup 0\.2\.6-beta\.1/);
for (const file of ["inbox-popover.html", "inbox-popover.css", "inbox-popover.js", "inbox-popover-preload.cjs"]) assert.ok(pkg.build.files.includes(file), file);
for (const file of ["update-runtime.cjs", "update-popover.html", "update-popover.css", "update-popover.js", "update-popover-preload.cjs"]) assert.ok(pkg.build.files.includes(file), file);
assert.deepEqual(pkg.build.publish[0], { provider: "github", owner: "love70805", repo: "lworkstation", releaseType: "release" });
const legacyPrivateRepo = ["shopeers", "workstation"].join("-");
for (const file of [
  "package.json",
  "update-config.json",
  "update-beta-config.json",
  "update-test-config.json",
  "update-fixture-config.cjs",
  "update-runtime.cjs",
  "UPDATE_RELEASE_CHECKLIST.md",
]) {
  assert.equal(read(file).includes(legacyPrivateRepo), false, `${file} must not target the archived private repository`);
}
assert.ok(pkg.build.extraResources.some((resource) => resource.to === "runtime/erp-inbox-server.mjs"));
assert.ok(pkg.build.files.includes("extension-runtime.cjs"));
assert.ok(pkg.build.files.includes("inbox-ipc.cjs"));
assert.ok(pkg.build.files.includes("workspace-context.cjs"));
for (const file of [
  "../integrations/1688-selection-extension/background.js",
  "../integrations/1688-selection-extension/popup.js",
  "../frontend/public/integrations/1688-selection/Shopeers-1688-Capture-v1.2.1/background.js",
  "../frontend/public/integrations/1688-selection/Shopeers-1688-Capture-v1.2.1/popup.js",
]) assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /targetAddressSpace/);
assert.match(read("main.cjs"), /selectionStorageContract/);
assert.match(read("smoke.mjs"), /selectionStorageContract/);
assert.match(read("main.cjs"), /selectionHeartbeat/);
assert.match(read("smoke.mjs"), /failClosed/);
assert.match(read("smoke.mjs"), /storageConfigured/);
const shellHtml = read("shell.html");
assert.ok(shellHtml.indexOf("./shell-state.cjs") < shellHtml.indexOf("./shell.js"));
const popoverHtml = read("inbox-popover.html");
assert.ok(popoverHtml.indexOf("./shell-state.cjs") < popoverHtml.indexOf("./inbox-popover.js"));
assert.match(read("inbox-popover.css"), /max-height:\s*min\(220px,\s*calc\(100vh\s*-\s*8px\)\)/);
assert.match(read("inbox-popover.css"), /\.popover-card\s*\{[\s\S]*?overflow:\s*auto/);
assert.match(read("inbox-popover.css"), /body\s*\{\s*padding:\s*4px/);
assert.match(read("inbox-popover.css"), /min-height:\s*35px/);
assert.match(read("inbox-popover.css"), /padding:\s*6px\s+8px/);
assert.match(read("inbox-popover.js"), /Escape/);
assert.match(read("inbox-popover.js"), /inboxPopover\.close/);
assert.match(read("inbox-popover.js"), /inboxPopover\.resize/);
assert.match(read("inbox-popover.js"), /scrollHeight\s*\|\|\s*0\)\s*\+\s*6/);
assert.doesNotMatch(read("inbox-popover.html"), /popover-close|data-lucide="x"/);
const { createInboxPopoverLifecycle } = createRequire(import.meta.url)("./inbox-popover-lifecycle.cjs");
const popoverLifecycle = createInboxPopoverLifecycle();
const firstPopover = popoverLifecycle.open();
assert.equal(popoverLifecycle.isCurrent(firstPopover), true);
assert.equal(popoverLifecycle.close(firstPopover), true);
assert.equal(popoverLifecycle.isCurrent(firstPopover), false);
assert.equal(popoverLifecycle.close(firstPopover), false);
const secondPopover = popoverLifecycle.open();
assert.notEqual(secondPopover, firstPopover);
assert.equal(popoverLifecycle.isCurrent(firstPopover), false);
assert.equal(popoverLifecycle.close(firstPopover), false);
assert.equal(popoverLifecycle.isCurrent(secondPopover), true);
assert.match(main, /if \(inboxPopoverWindow && !inboxPopoverWindow\.isDestroyed\(\)\) \{\s*closeInboxPopover\(\);\s*return \{ ok: true, open: false \};/);
assert.doesNotMatch(main, /set-shell-overlay-inset|shellOverlayInset/);
const require = createRequire(import.meta.url);
const {
  cleanupRuntimeExtensionStagingSync,
  extensionStorageConfig,
  prepareRuntimeExtension,
  replacePortInDirectory,
  runtimeRoot,
} = require("./extension-runtime.cjs");
const extensionConfig = extensionStorageConfig({ port: 23125, capability: "x".repeat(43), workspaceId: "workspace-1" });
assert.deepEqual(Object.keys(extensionConfig).sort(), ["shopeersErpInboxBaseUrl", "shopeersErpInboxCapability", "shopeersErpWorkspaceId"].sort());
assert.throws(() => extensionStorageConfig({ port: 23125, capability: "short", workspaceId: "workspace-1" }), /配置无效/);
const { normalizeAllowedRemoteUrl, resolveRemotePopup } = require("./remote-navigation.cjs");
const { navigationState, navigateHistory } = require("./navigation-history.cjs");
const {
  classifyErpState,
  getAddressPresentation,
  getPopoverPresentation,
  shouldReturnFocusOnPopoverClose,
} = require("./shell-state.cjs");
const {
  ERP_ZOOM_DEFAULT,
  loadAppearancePreference,
  loadErpZoomPreference,
  normalizeErpZoomPercent,
  saveAppearancePreference,
  saveErpZoomPreference,
} = require("./desktop-preferences.cjs");
assert.deepEqual(classifyErpState({ status: "online" }, { status: "idle", tone: "success" }), { tone: "success", label: "", aria: "ERP 通道正常" });
assert.deepEqual(classifyErpState({ status: "online" }), { tone: "warning", label: "处理中", aria: "ERP 通道处理中" });
assert.deepEqual(classifyErpState({ status: "online" }, { status: "unknown", tone: "success" }), { tone: "warning", label: "处理中", aria: "ERP 通道处理中" });
assert.deepEqual(classifyErpState({}, {}), { tone: "warning", label: "处理中", aria: "ERP 通道处理中" });
assert.equal(classifyErpState({ status: "online" }, { status: "workspace_received", tone: "success" }).tone, "warning");
assert.equal(classifyErpState({ status: "online", latestBatch: { evidenceStatus: "legacy_partial" } }, { status: "idle", tone: "success" }).tone, "warning");
assert.equal(classifyErpState({ status: "online" }, { status: "batch_received", tone: "info" }).tone, "warning");
assert.equal(classifyErpState({ status: "online" }, { status: "idle", tone: "warning" }).tone, "warning");
assert.equal(classifyErpState({ status: "error", message: "服务错误", latestTransportError: { message: "传输错误" } }, { status: "delivery_error", tone: "danger", message: "投递失败" }).aria, "ERP 通道异常：投递失败");
assert.deepEqual(getAddressPresentation("workspace", { url: "shopeers://workstation/" }), { readOnly: true, value: "内部工作站" });
assert.deepEqual(getAddressPresentation("erp", { url: "https://www.zhuolinkeji.cn/" }), { readOnly: true, value: "https://www.zhuolinkeji.cn/" });
assert.deepEqual(getPopoverPresentation({ status: "online" }, { status: "idle", tone: "success" }), { status: "通道正常", error: "", showStatus: true, showError: false });
assert.deepEqual(getPopoverPresentation({ status: "error", message: "服务错误" }, { status: "delivery_error", tone: "danger", message: "投递失败" }), { status: "", error: "投递失败", showStatus: false, showError: true });
for (const reason of ["button", "outside", "escape"]) assert.equal(shouldReturnFocusOnPopoverClose(reason), true);
assert.equal(ERP_ZOOM_DEFAULT, 80);
assert.equal(normalizeErpZoomPercent(0), 70);
assert.equal(normalizeErpZoomPercent(74), 70);
assert.equal(normalizeErpZoomPercent(85), 90);
assert.equal(normalizeErpZoomPercent(999), 120);
const preferencesFixture = fs.mkdtempSync(path.join(root, "desktop-preferences-test-"));
assert.equal(loadErpZoomPreference({ userDataPath: preferencesFixture }), 80);
assert.equal(saveErpZoomPreference({ userDataPath: preferencesFixture, percent: 100 }), 100);
assert.equal(loadErpZoomPreference({ userDataPath: preferencesFixture }), 100);
assert.equal(saveAppearancePreference({ userDataPath: preferencesFixture, appearance: "dark" }), "dark");
assert.equal(loadAppearancePreference({ userDataPath: preferencesFixture, fallback: "light" }), "dark");
const preferencePath = path.join(preferencesFixture, "desktop-preferences.json");
const failingOperations = new Proxy(fs, {
  get(target, property) {
    if (property !== "renameSync") return Reflect.get(target, property);
    return (source, destination) => {
      if (source.includes(".tmp-") && destination === preferencePath) throw new Error("simulated replacement failure");
      return target.renameSync(source, destination);
    };
  },
});
assert.throws(
  () => saveAppearancePreference({ userDataPath: preferencesFixture, appearance: "light", operations: failingOperations }),
  /simulated replacement failure/
);
assert.equal(loadAppearancePreference({ userDataPath: preferencesFixture, fallback: "light" }), "dark");
assert.equal(loadErpZoomPreference({ userDataPath: preferencesFixture }), 100);
fs.rmSync(preferencesFixture, { recursive: true, force: true });
const historyCalls = [];
const history = {
  back: true,
  forward: false,
  canGoBack() { return this.back; },
  canGoForward() { return this.forward; },
  goBack() { historyCalls.push("back"); this.back = false; this.forward = true; },
  goForward() { historyCalls.push("forward"); this.back = true; this.forward = false; },
};
assert.deepEqual(navigationState({ navigationHistory: history }), { canGoBack: true, canGoForward: false });
assert.deepEqual(navigateHistory({ navigationHistory: history }, "back"), { ok: true });
assert.deepEqual(navigationState({ navigationHistory: history }), { canGoBack: false, canGoForward: true });
assert.deepEqual(navigateHistory({ navigationHistory: history }, "forward"), { ok: true });
assert.deepEqual(historyCalls, ["back", "forward"]);
assert.equal(navigateHistory(null, "back").ok, false);
assert.match(read("workspace-preload.cjs"), /requestInbox/);
assert.doesNotMatch(read("workspace-preload.cjs"), /erpInboxUrl|selectionCaptureUrl|inboxApiVersion|127\.0\.0\.1/);
const runtimeFixture = fs.mkdtempSync(path.join(root, "runtime-extension-test-"));
const runtimeSource = path.join(runtimeFixture, "source");
const runtimeUserData = path.join(runtimeFixture, "user-data");
fs.mkdirSync(runtimeSource, { recursive: true });
fs.writeFileSync(path.join(runtimeSource, "manifest.json"), JSON.stringify({ host_permissions: ["http://127.0.0.1:8790/*"] }), "utf8");
fs.writeFileSync(path.join(runtimeSource, "bridge.js"), "const endpoint = 'http://127.0.0.1:8790/erp/v1/cost-results';", "utf8");
fs.mkdirSync(path.join(runtimeSource, "src"), { recursive: true });
fs.writeFileSync(path.join(runtimeSource, "src", "background.js"), "chrome.runtime.onStartup.addListener(() => {});", "utf8");
fs.writeFileSync(path.join(runtimeSource, "src", "shopeers-bridge.js"), "const endpoint = 'http://127.0.0.1:8790/erp/v1/cost-results';", "utf8");
await replacePortInDirectory(runtimeSource, 23123);
assert.match(fs.readFileSync(path.join(runtimeSource, "manifest.json"), "utf8"), /127\.0\.0\.1:23123/);
const firstRuntimePath = await prepareRuntimeExtension({ sourceDirectory: runtimeSource, port: 23124, runtimeId: "erp", userDataPath: runtimeUserData });
const secondRuntimePath = await prepareRuntimeExtension({ sourceDirectory: runtimeSource, port: 23125, runtimeId: "erp", userDataPath: runtimeUserData });
assert.equal(firstRuntimePath, path.join(runtimeRoot({ userDataPath: runtimeUserData }), "erp"));
assert.equal(secondRuntimePath, firstRuntimePath);
assert.match(fs.readFileSync(path.join(secondRuntimePath, "bridge.js"), "utf8"), /127\.0\.0\.1:23125/);
assert.match(fs.readFileSync(path.join(secondRuntimePath, "src", "shopeers-bridge.js"), "utf8"), /__SHOPEERS_ERP_INBOX_BASE_URL__/);
assert.doesNotMatch(fs.readFileSync(path.join(secondRuntimePath, "src", "background.js"), "utf8"), /shopeersErpInboxCapability/);
assert.match(fs.readFileSync(path.join(secondRuntimePath, "manifest.json"), "utf8"), /"storage"/);
const stagingPath = path.join(runtimeRoot({ userDataPath: runtimeUserData }), ".staging-erp-test");
const outsidePath = path.join(runtimeUserData, "outside-must-remain");
fs.mkdirSync(stagingPath, { recursive: true });
fs.mkdirSync(outsidePath, { recursive: true });
cleanupRuntimeExtensionStagingSync({ userDataPath: runtimeUserData });
assert.equal(fs.existsSync(stagingPath), false);
assert.equal(fs.existsSync(outsidePath), true);
fs.rmSync(runtimeFixture, { recursive: true, force: true });
assert.equal(normalizeAllowedRemoteUrl("1688", "http://detail.1688.com/offer/123.html"), "https://detail.1688.com/offer/123.html");
assert.equal(normalizeAllowedRemoteUrl("1688", "https://login.taobao.com/member/login.jhtml"), "https://login.taobao.com/member/login.jhtml");
assert.equal(normalizeAllowedRemoteUrl("1688", "javascript:alert(1)"), null);
assert.equal(normalizeAllowedRemoteUrl("1688", "https://1688.com.example.com/"), null);
assert.equal(normalizeAllowedRemoteUrl("erp", "https://www.zhuolinkeji.cn/"), "https://www.zhuolinkeji.cn/");
assert.deepEqual(resolveRemotePopup("1688", "http://detail.1688.com/offer/123.html"), { action: "navigate", url: "https://detail.1688.com/offer/123.html" });
assert.deepEqual(resolveRemotePopup("1688", "https://example.com/"), { action: "block", url: null });
for (const manifest of ["../integrations/erp-assistant-extension/manifest.json", "../integrations/1688-selection-extension/manifest.json"]) {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, manifest), "utf8"));
  assert.equal(parsed.manifest_version, 3);
}
console.log("desktop POC static verification passed");
