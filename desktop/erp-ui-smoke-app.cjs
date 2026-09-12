// Test-only instrumentation of the actual main process. Never packaged.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
if (!process.env.SHOPEERS_DESKTOP_SMOKE_USER_DATA || !process.env.DESKTOP_ERP_UI_SMOKE) throw new Error('isolated smoke required');
electron.app.whenReady().then(() => {
  for (const current of [electron.session.defaultSession, electron.session.fromPartition('persist:erp'), electron.session.fromPartition('persist:1688')]) {
    current.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1' });
    });
  }
});
const filename = path.join(__dirname, 'main.cjs');
const source = fs.readFileSync(filename, 'utf8');
// Reuse the shipped bridge/background VM adapter, NOT the fixture's request POST.
// Fail closed if its anchors change. Registration and publication belong to React UI.
const start = source.indexOf('  const listeners = new Map();', source.indexOf('async function runErpV2SmokeFixture'));
const end = source.indexOf('  const deliveryResult = await bridge.submit(', start);
if (start < 0 || end < start) throw new Error('bridge harness anchors changed');
const candidate = new Module(filename, module);
candidate.filename = filename;
candidate.paths = module.paths;
candidate._compile(source + `
globalThis.__erpUi = {
 state: publicState,
 window: () => mainWindow,
 workspace: () => views.get('workspace').webContents,
 submit: async (payload) => {
  const workspaceId = payload.workspaceId;
  const bridgePath = path.join(tabState.erp.extension.path, 'src', 'shopeers-bridge.js');
  const requestContextPath = path.join(tabState.erp.extension.path, 'src', 'request-context.js');
  ${source.slice(start, end)}
  const response = await bridge.submit(payload);
  return JSON.parse(JSON.stringify(response));
 },
};
`, filename);
