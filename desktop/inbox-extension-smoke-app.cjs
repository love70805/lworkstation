const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const resources = process.env.ERP_NATIVE_RESOURCES || root;
const runtime = process.env.ERP_NATIVE_RESOURCES ? path.join(resources, 'app.asar') : __dirname;
const { createInboxServiceController, installExtensionInboxTransport } = require(path.join(runtime, 'inbox-service.cjs'));
const { prepareRuntimeExtension, extensionStorageConfig } = require(path.join(runtime, 'extension-runtime.cjs'));
const output = process.env.INBOX_EXTENSION_OUTPUT, profile = process.env.INBOX_EXTENSION_PROFILE;
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const capability = 'SYNTHETIC-EXTENSION-CAPABILITY-20261025';
let controller, popup, external;
const checks = [], requests = [];
async function listen(port = 0) {
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url, credential: Boolean(request.headers.authorization) });
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}
async function close(server) {
  if (!server) return;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
const evaluate = code => popup.webContents.executeJavaScript(code);
const heartbeat = () => evaluate('__SHOPEERS_ERP_BACKGROUND_TEST_API__.reportInstalled().catch(error => ({ status: error.status, error: error.code }))');
const browserFetch = (route, optionsExpression = '{}') => evaluate(`(async () => {
  const config = await chrome.storage.local.get(null), options = ${optionsExpression};
  const response = await fetch(config.shopeersErpInboxBaseUrl + ${JSON.stringify(route)}, {
    ...options, headers: { authorization: 'Bearer ' + config.shopeersErpInboxCapability, ...options.headers }
  });
  return { status: response.status, payload: response.status === 204 ? null : await response.json() };
})()`);
app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    external = await listen();
    const port = external.address().port;
    controller = createInboxServiceController({ executable: process.execPath, runAsNode: true,
      scriptPath: path.join(resources, process.env.ERP_NATIVE_RESOURCES ? 'runtime/erp-inbox-server.mjs' : 'tools/erp-inbox-server.mjs'), spoolPath: path.join(profile, 'inbox.json'),
      port, capability, pollIntervalMs: 60_000 });
    assert.equal((await controller.start()).conflict, true);
    const target = session.fromPartition('persist:inbox-extension-smoke');
    installExtensionInboxTransport(target, () => controller);
    installExtensionInboxTransport(target, () => controller); // A recreated ERP view shares its session.
    const directory = await prepareRuntimeExtension({ sourceDirectory: path.join(resources, 'integrations/erp-assistant-extension'),
      port, runtimeId: 'erp', userDataPath: profile });
    const extension = await target.extensions.loadExtension(directory, { allowFileAccess: true });
    const source = await fs.readFile(path.join(runtime, 'main.cjs'), 'utf8');
    const begin = source.indexOf('async function configureExtensionStorage('), end = source.indexOf('\nfunction extensionTargets()', begin);
    assert.ok(begin > 0 && end > begin);
    const configure = new Function('canCreateRemoteView', 'BrowserWindow', 'inboxState', 'inboxCapability', 'extensionStorageConfig',
      source.slice(begin, end) + '; return configureExtensionStorage;')(
      () => true, BrowserWindow, { ...controller.getState(), port }, capability, extensionStorageConfig);
    await configure('erp', target, extension.id, { workspaceId: 'SYNTHETIC-WORKSPACE' });
    popup = new BrowserWindow({ show: false, webPreferences: { session: target, sandbox: true, contextIsolation: true } });
    await popup.loadURL(`chrome-extension://${extension.id}/popup/popup.html`);
    const background = await fs.readFile(path.join(resources, 'integrations/erp-assistant-extension/src/background.js'), 'utf8');
    // Run the original heartbeat through native chrome.storage/fetch with a
    // deterministic trigger; the full native ERP smoke also covers worker events.
    await evaluate('globalThis.__SHOPEERS_ERP_BACKGROUND_TEST__ = true;\n' + background);
    const conflictCount = requests.length;
    assert.deepEqual(await heartbeat(), { status: 503, error: 'INBOX_SERVICE_UNAVAILABLE' });
    assert.equal(requests.length, conflictCount);
    assert.ok(requests.every(request => !request.credential));
    checks.push('conflict: native original heartbeat sends no bearer or HTTP business request');
    assert.equal((await browserFetch('/ordinary-http', "{ headers: { authorization: '' } }")).status, 200, 'unrelated HTTP still uses the session network');
    assert.ok(requests.every(request => !request.credential));
    await close(external); external = null;
    assert.equal((await controller.retry()).ok, true);
    assert.equal((await heartbeat()).accepted, true);
    assert.equal((await browserFetch('/erp/v1/status')).payload.application, 'shopeers-erp-inbox');
    checks.push('managed: native GET and original POST body pass identity-verified transport');
    const missing = await browserFetch('/erp/v1/status', "{ headers: { authorization: '' } }");
    assert.equal(missing.status, 401); assert.equal(missing.payload.error, 'UNAUTHORIZED');
    assert.equal((await browserFetch('/erp/v1/workspace-reset', "{ method: 'POST', body: '{}' }")).status, 403);
    assert.equal((await browserFetch('/erp/v1/unknown')).status, 404);
    const invalid = await browserFetch('/erp/v1/extension-status', "{ method: 'POST', body: '{}' }");
    assert.equal(invalid.status, 400); assert.equal(invalid.payload.error, 'INVALID_EXTENSION_STATUS');
    assert.equal((await browserFetch('/erp/v1/status', "{ method: 'OPTIONS' }")).status, 204);
    const large = await browserFetch('/erp/v1/extension-status', "{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extensionId: 'synthetic-large', version: '1', padding: 'x'.repeat(6 * 1024 * 1024) }) }");
    assert.equal(large.status, 202); assert.equal(large.payload.accepted, true);
    const tooLarge = await browserFetch('/erp/v1/extension-status', "{ method: 'POST', body: 'x'.repeat(25 * 1024 * 1024 + 1) }");
    assert.equal(tooLarge.status, 413);
    checks.push('HTTP compatibility: 202/204/400/401/403/404, 6 MiB body accepted, over 25 MiB rejected');
    await controller.stop({ wait: true });
    external = await listen(port);
    const stoppedCount = requests.length;
    assert.deepEqual(await heartbeat(), { status: 503, error: 'INBOX_SERVICE_UNAVAILABLE' });
    assert.equal(requests.length, stoppedCount);
    await close(external); external = null;
    assert.equal((await controller.retry()).ok, true);
    assert.equal((await heartbeat()).accepted, true);
    checks.push('stop/port takeover: no-send; retry: native heartbeat recovers');
    assert.equal(BrowserWindow.getAllWindows().filter(window => window.isVisible()).length, 0);
    await fs.writeFile(path.join(output, 'inbox-extension-checks.json'), JSON.stringify({ ok: true, electron: process.versions.electron,
      visibleWindows: 0, checks, externalRequests: requests, synthetic: true }, null, 2));
    console.log(JSON.stringify({ ok: true, checks }));
  } catch (error) {
    exitCode = 1;
    await fs.writeFile(path.join(output, 'inbox-extension-checks.json'), JSON.stringify({ ok: false, checks, message: error.message, stack: error.stack }, null, 2));
    console.error(error);
  } finally {
    popup?.destroy(); await controller?.stop({ wait: true }); await close(external); app.exit(exitCode);
  }
});
