// Test-only: actual main process, native windows/tray and inbox; never packaged.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
if (!process.env.SHOPEERS_DESKTOP_SMOKE_USER_DATA || !process.env.DESKTOP_EXPERIENCE_SMOKE) throw new Error('isolated smoke required');
electron.app.whenReady().then(() => {
  for (const current of [electron.session.defaultSession, electron.session.fromPartition('persist:erp'), electron.session.fromPartition('persist:1688')]) {
    current.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1' });
    });
  }
});
class CapturedTray extends electron.Tray {
  constructor(icon) {
    if (process.env.DESKTOP_EXPERIENCE_SMOKE === 'no-tray') throw new Error('synthetic tray failure');
    super(icon); globalThis.__tray = this;
  }
  setContextMenu(menu) { globalThis.__trayMenu = menu; super.setContextMenu(menu); }
}
const filename = path.join(__dirname, 'main.cjs');
const candidate = new Module(filename, module);
candidate.filename = filename;
candidate.paths = module.paths;
candidate.require = name => name === 'electron' ? { ...electron, Tray: CapturedTray, Menu: {
  setApplicationMenu: value => electron.Menu.setApplicationMenu(value),
  buildFromTemplate: value => {
    const menu = electron.Menu.buildFromTemplate(value);
    if (value[0]?.label === '打开 Lworkstation') globalThis.__trayMenu = menu;
    return menu;
  },
} } : module.require(name);
const source = fs.readFileSync(filename, 'utf8');
// Shorten only this isolated fault-injection test; production keeps 8 seconds.
const testSource = process.env.DESKTOP_EXPERIENCE_SMOKE === 'recovery'
  ? source.replace('createWorkspaceRecovery({', 'createWorkspaceRecovery({ timeoutMs: 500,') : source;
candidate._compile(testSource + `
globalThis.__recoveryTrace = [];
for (const method of ['ready', 'fail', 'start']) {
  const original = startup[method];
  startup[method] = (...args) => { globalThis.__recoveryTrace.push({time:Date.now(),method,args}); return original(...args); };
}
globalThis.__experience = {
 state: publicState,
 lifecycle: () => desktopLifecycle.getState(),
 window: () => mainWindow,
 workspace: () => views.get('workspace').webContents,
 switchTab: setActiveTab,
 restore: restoreWorkspaceSurface,
 recovery: workspaceRecovery,
 retry: retryWorkspace,
 view: () => views.get('workspace'),
 holdProbe: () => {
   const contents = views.get('workspace').webContents;
   const original = contents.send.bind(contents), held = [];
   contents.send = (channel, ...args) => { globalThis.__recoveryTrace.push({time:Date.now(),held:channel}); return channel === 'workspace:probe' ? held.push([channel, ...args]) : original(channel, ...args); };
   globalThis.__releaseProbe = () => { contents.send = original; held.forEach(args => original(...args)); };
 },
 releaseProbe: () => globalThis.__releaseProbe(),
 inbox: () => inboxService?.getOwnedPid(),
 backgroundRoundTrip: runErpV2SmokeFixture,
 fail: () => views.get('workspace').webContents.loadURL(DEV_URL + '/retry-test').catch(() => {}),
 timeout: () => startup.start(),
 updateExit: () => {
   updateRuntime = {canInstall: () => true, stop() {}};
   autoUpdater.quitAndInstall = () => app.quit();
   return installDownloadedUpdate();
 },
};
`, filename);
