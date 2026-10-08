// Isolated instrumentation of the real source entry point; never packaged.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
if (!process.env.SHOPEERS_DESKTOP_SMOKE_USER_DATA || !process.env.DESKTOP_MEMORY_SMOKE) throw new Error('isolated memory smoke required');
electron.app.whenReady().then(() => {
  for (const id of ['erp', '1688']) {
    const target = electron.session.fromPartition(`persist:${id}`);
    target.protocol.handle('https', () => new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><h1>隔离页面</h1><input id="draft"></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  }
});
const filename = path.join(__dirname, 'main.cjs');
const candidate = new Module(filename, module);
candidate.filename = filename;
candidate.paths = module.paths;
candidate._compile(fs.readFileSync(filename, 'utf8') + `
const realConfiguration = configureExtensionStorage;
let failedConfiguration = null;
configureExtensionStorage = async (tabId, ...args) => {
  if (failedConfiguration === tabId) { failedConfiguration = null; throw new Error('synthetic configuration failure'); }
  return realConfiguration(tabId, ...args);
};
globalThis.__memory = { state: publicState, switchTab: setActiveTab, views, inbox: () => inboxService?.getOwnedPid(), configure: configureLoadedExtensions, failConfiguration: tabId => { failedConfiguration = tabId; } };
`, filename);
