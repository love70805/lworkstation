// Isolated instrumentation of the actual desktop main process; never packaged.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
if (!process.env.SHOPEERS_DESKTOP_SMOKE_USER_DATA || process.env.DESKTOP_ERP_STATUS_SMOKE !== '1') throw new Error('isolated status smoke required');
globalThis.__qaWindows = [];
globalThis.__nativeWindowCount = () => globalThis.__qaWindows.filter(w => !w.isDestroyed()).length;
globalThis.__erpStatusFixture = { mode: 'authenticated', calls: [] };
electron.dialog.showErrorBox = (title, message) => { console.error(title + ': ' + message); };
electron.app.whenReady().then(async () => {
  for (const partition of ['persist:erp', 'persist:1688']) {
    const current = electron.session.fromPartition(partition);
    await current.protocol.handle('https', request => {
      const url = new URL(request.url);
      globalThis.__erpStatusFixture.calls.push(url.pathname);
      if (url.hostname.endsWith('zhuolinkeji.cn') && url.pathname === '/permission/user/current') {
        const loggedIn = globalThis.__erpStatusFixture.mode === 'authenticated';
        return new Response(JSON.stringify({ code: loggedIn ? 0 : 401, data: loggedIn ? { fixture: true } : null }), { status: loggedIn ? 200 : 401, headers: { 'content-type': 'application/json' } });
      }
      return new Response('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><h1>隔离 ERP 首页</h1>' + (globalThis.__erpStatusFixture.mode === 'login' ? '<input type="password" aria-label="ERP 密码">' : '') + '<script>fetch("/permission/user/current")</script></body></html>', { headers: { 'content-type': 'text/html' } });
    });
  }
});
class HiddenWindow extends electron.BrowserWindow { constructor(options) { super(options); globalThis.__qaWindows.push(this); } show() {} showInactive() {} focus() {} }
const filename = path.join(__dirname, 'main.cjs');
const candidate = new Module(filename, module);
candidate.filename = filename;
candidate.paths = Module._nodeModulePaths(path.dirname(filename));
const desktopRequire = Module.createRequire(filename);
candidate.require = name => name === 'electron' ? { ...electron, BrowserWindow: HiddenWindow } : desktopRequire(name);
candidate._compile(fs.readFileSync(filename, 'utf8') + `
globalThis.__erpStatusSmoke = {
  state: publicState,
  window: () => mainWindow,
  erp: () => views.get('erp')?.webContents,
  windows: () => globalThis.__nativeWindowCount(),
  configure: () => configureLoadedExtensions({ workspaceId: 'erp-status-fixture', memberId: 'fixture-member', visibility: 'workspace' }),
  poll: () => inboxService.refresh(),
  restartInbox: () => inboxService.retry(),
  setTab: setActiveTab,
  ready: () => startup.ready(),
  appearance: value => { shellAppearance = value; publishState(); },
  expire: () => { inboxState.latestExtension.lastSeenAt = new Date(Date.now() - 46000).toISOString(); publishState(); },
};
`, filename);
