// Isolated renderer fixture; no public feed, download, or installer is invoked.
if (process.type === "renderer") {
  const { ipcRenderer } = require("electron");
  window.__actions = [];
  window.updatePopover = Object.fromEntries(["check", "download", "cancel", "retry", "install", "postpone", "close", "openReleaseNotes"].map(name => [name, async () => { window.__actions.push(name); }]));
  window.updatePopover.resize = height => ipcRenderer.invoke("fixture:resize", height);
  window.updatePopover.onState = () => {};
  window.updatePopover.getState = async () => ({ update: { status: "idle", currentVersion: "0.2.10", message: "尚未检查更新" } });
} else {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const assert = require("node:assert/strict");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "lworkstation-popover-"));
  app.setPath("userData", path.join(output, "profile"));
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 296, height: 340, show: false, frame: false,
      webPreferences: { preload: __filename, contextIsolation: false, nodeIntegration: true, backgroundThrottling: false } });
    ipcMain.handle("fixture:resize", (_event, height) => window.setContentSize(296, Math.max(132, Math.min(340, height))));
    await window.loadFile(path.join(__dirname, "update-popover.html"));
    const cases = { idle: ["check"], checking: [], current: ["check"], available: ["download"], downloading: ["cancel"], canceled: ["retry"], downloaded: ["install", "postpone"], error: ["retry"], disabled: [] };
    const evidence = [];
    for (const appearance of ["light", "dark"]) {
      for (const [status, actions] of Object.entries(cases)) {
        const state = { appearance, update: { status, currentVersion: "0.2.10-beta.12", availableVersion: ["available", "downloading", "canceled", "downloaded"].includes(status) ? "0.2.11-beta.1" : null,
          message: status === "error" ? "更新服务暂时不可用，请稍后重试。".repeat(5) : "更新状态与操作验证", progress: 52, retryAction: status === "canceled" ? "download" : "check",
          release: { notes: "更新说明".repeat(50), size: 100000, releaseDate: "2026-09-10", releaseUrl: "https://github.com/love70805/lworkstation/releases/" } } };
        await window.webContents.executeJavaScript(`render(${JSON.stringify(state)})`);
        await new Promise(resolve => setTimeout(resolve, 100));
        const layout = await window.webContents.executeJavaScript(`({actions:[...document.querySelectorAll('[data-update-action]')].filter(b=>!b.hidden).map(b=>b.dataset.updateAction).sort(), channel:document.querySelector('#update-channel').textContent, overflow:card.scrollWidth>card.clientWidth, verticalOverflow:card.scrollHeight>card.clientHeight})`);
        assert.deepEqual(layout.actions, actions.toSorted());
        assert.equal(layout.channel, "Beta");
        assert.equal(layout.overflow, false);
        if (["idle", "current", "downloaded"].includes(status)) assert.equal(layout.verticalOverflow, false, `${status}: short content must not scroll`);
        for (const action of actions) await window.webContents.executeJavaScript(`runAction(${JSON.stringify(action)})`);
        await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        if (["idle", "downloaded", "error"].includes(status)) fs.writeFileSync(path.join(output, `${appearance}-${status}.png`), (await window.webContents.capturePage()).toPNG());
        evidence.push({ appearance, status, ...layout, size: window.getSize() });
        if (status === "downloaded") {
          const collapsedHeight = window.getSize()[1];
          await window.webContents.executeJavaScript("notesSection.open = true; requestResize()");
          await new Promise(resolve => setTimeout(resolve, 150));
          const expanded = await window.webContents.executeJavaScript(`({notesScroll:releaseNotes.scrollHeight>releaseNotes.clientHeight, reachable:[...document.querySelectorAll('[data-update-action]')].filter(b=>!b.hidden).every(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight-4;})})`);
          assert.equal(expanded.notesScroll, true);
          assert.equal(expanded.reachable, true);
          await window.webContents.executeJavaScript("notesSection.open = false; requestResize()");
          await new Promise(resolve => setTimeout(resolve, 150));
          assert.equal(await window.webContents.executeJavaScript("card.scrollHeight<=card.clientHeight"), true);
          assert.equal(window.getSize()[1], collapsedHeight);
        }
      }
    }
    const invoked = await window.webContents.executeJavaScript("window.__actions");
    for (const action of ["check", "download", "cancel", "retry", "install", "postpone"]) assert.ok(invoked.includes(action));
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ ok: true, evidence, invoked }, null, 2));
    console.log(`Popover renderer smoke passed: ${output}`);
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}
