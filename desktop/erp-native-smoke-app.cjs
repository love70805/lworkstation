const { app, BrowserWindow, WebContentsView, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const resources = process.env.ERP_NATIVE_RESOURCES || root;
const runtime = process.env.ERP_NATIVE_RESOURCES ? path.join(resources, 'app.asar') : __dirname;
const { prepareRuntimeExtension, extensionStorageConfig } = require(path.join(runtime, 'extension-runtime.cjs'));
const out = path.resolve(process.env.ERP_NATIVE_OUTPUT);
const profile = path.join(out, `isolated-profile-${Date.now()}`);
const port = Number(process.env.ERP_NATIVE_PORT || 23874);
const capability = 'synthetic-native-extension-capability-0123456789';
const workspaceId = 'native-qa';
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], failures = [], timings = [], requests = [];
let child, host, view, popup;
async function call(route, body) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/erp/v1/${route}`, { headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(4000) });
  const result = await response.json();
  assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(result)}`);
  timings.push({ route, ms: Math.round(performance.now() - started) });
  return result;
}
async function waitFor(fn, label, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error('Native condition timed out: ' + label);
}
async function startInbox() {
  const script = path.join(resources, process.env.ERP_NATIVE_RESOURCES ? 'runtime/erp-inbox-server.mjs' : 'tools/erp-inbox-server.mjs');
  child = spawn(process.execPath, [script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SHOPEERS_ERP_INBOX_PORT: String(port), SHOPEERS_ERP_INBOX_FILE: path.join(profile, 'inbox.json'), SHOPEERS_ERP_INBOX_CAPABILITY: capability } });
  await waitFor(async () => { try { return await call('status'); } catch { return false; } }, 'inbox start');
}
async function stopInbox() { if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
const evaluate = code => view.webContents.executeJavaScript(code);
const purchase = 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html';
app.whenReady().then(async () => {
  try {
    await fs.mkdir(profile, { recursive: true });
    await startInbox();
    await call('requests', { request: { id: 'NATIVE-R', workspaceId, ledgerId: 'NATIVE-L', ledgerPeriod: '2026-09', platformSkcs: [{ platformSkc: 'SKC-A' }] }, expectedSkus: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }] });
    const ses = session.fromPartition('persist:native-erp');
    ses.serviceWorkers.on('console-message', (_event, details) => { if (details?.level === 'error') failures.push(details.message); });
    ses.protocol.handle('https', request => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/purchase/')) return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><h1>隔离原生 ERP</h1>' + (url.pathname === '/view/console/index.html' ? '<iframe id="procurement" style="width:100%;height:720px" src="/view/system/purchaseOrderModule/purchasingManagement.html"></iframe>' : '') + (url.pathname === '/login.html' ? '<input type="password" aria-label="ERP 密码">' : '') + '</body></html>', { headers: { 'content-type': 'text/html' } });
      requests.push(url.pathname);
      const data = url.pathname.endsWith('purchase-order-page') ? [{ purchaseOrderId: 'PO-A' }]
        : url.pathname.endsWith('purchase-order-details') ? [{ purchaseOrderDetailId: 'D-A', itemId: 'WH-A', tradeName: '原生隔离商品', creationTime: '2026-08-20', purchaseQuantity: 2, purchaseUnitPrice: 4 }]
          : url.pathname.endsWith('product-info-sku') ? [{ associatedProductId: 'WH-A', barcodeSkcid: 'SKC-A', barcodeSkuid: 'SKU-A' }] : [];
      return new Response(JSON.stringify({ code: 0, count: data.length, data }), { headers: { 'content-type': 'application/json' } });
    });
    const directory = await prepareRuntimeExtension({ sourceDirectory: path.join(resources, 'integrations/erp-assistant-extension'), userDataPath: profile, port, runtimeId: 'erp' });
    const loaded = await ses.extensions.loadExtension(directory, { allowFileAccess: true });
    popup = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
    await popup.loadURL(`chrome-extension://${loaded.id}/popup/popup.html`);
    await popup.webContents.executeJavaScript(`chrome.storage.local.set(${JSON.stringify(extensionStorageConfig({ port, capability, workspaceId }))})`);
    host = new BrowserWindow({ show: false, width: 1280, height: 900 });
    view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    host.contentView.addChildView(view); view.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
    view.webContents.on('console-message', (_event, level, message) => { if (level >= 3) failures.push(message); });
    const cold = performance.now();
    await view.webContents.loadURL(purchase);
    await waitFor(() => evaluate('Boolean(document.querySelector("#erpa-cost-trigger"))'), 'assistant mounted');
    await evaluate('document.querySelector("#erpa-cost-trigger").click()');
    await waitFor(() => evaluate('document.body.innerText.includes("工作台已连接")'), 'native assistant connected');
    checks.push({ name: 'cold open, native storage/runtime/background handshake', ms: Math.round(performance.now() - cold) });
    for (let attempt = 0; attempt < 3; attempt++) {
      await view.webContents.loadURL(purchase);
      await waitFor(() => evaluate('Boolean(document.querySelector("#erpa-cost-trigger"))'), 'refresh mount');
      await evaluate('document.querySelector("#erpa-cost-trigger").click()');
      await waitFor(() => evaluate('document.body.innerText.includes("工作台已连接")'), 'refresh handshake');
      assert.equal(await evaluate('document.querySelector("#erpa-recalculate").disabled'), true, 'refresh requires a fresh ERP query');
      const states = await Promise.all(Array.from({ length: 12 }, () => call('status')));
      assert.ok(states.every(value => value.latestExtension?.ready && value.latestExtension.context === 'extension-isolated'));
    }
    checks.push({ name: 'three real page refreshes and 36 concurrent connection refreshes' });
    await evaluate('document.querySelector("#erpa-close").click()');
    await evaluate('fetch("/purchase/purchase/v1/purchase-order-page?sku=SKC-A&storeId=STORE-A").then(response=>response.json())');
    await evaluate('document.querySelector("#erpa-cost-trigger").click()');
    const delivered = await waitFor(async () => { const value = await call(`cost-batches?workspaceId=${workspaceId}`); return value.batches?.find(item => item.requestId === 'NATIVE-R') || value.records?.find(item => item.requestId === 'NATIVE-R'); }, 'real native cost collection and delivery', 45000);
    assert.equal(delivered.envelope.batch.rows[0].unitCost, 4);
    assert.equal(delivered.envelope.batch.rows[0].platformSku, 'SKU-A');
    assert.equal(delivered.envelope.batch.evidenceStatus, 'complete');
    const persisted = JSON.parse(await fs.readFile(path.join(profile, 'inbox.json'), 'utf8'));
    assert.ok(persisted.some(item => item.kind === 'batch' && item.deliveryId === delivered.deliveryId));
    checks.push({ name: 'real MAIN query hook, procurement reads, SKU mapping, native chrome.storage checkpoint, native background delivery, durable v2 evidence', unitCost: 4 });
    // Selecting another workspace detaches the remote view in the real shell.
    host.contentView.removeChildView(view);
    const ages = [], until = Date.now() + Number(process.env.ERP_NATIVE_IDLE_MS || 100000);
    while (Date.now() < until) { const state = await call('status'); assert.equal(state.latestExtension?.ready, true); ages.push(Date.now() - Date.parse(state.latestExtension.lastSeenAt)); await pause(2000); }
    assert.ok(Math.max(...ages) < 45000, 'background heartbeat stays inside the actual shell freshness deadline');
    checks.push({ name: 'detached view background heartbeat', durationMs: Number(process.env.ERP_NATIVE_IDLE_MS || 100000), maxAgeMs: Math.max(...ages) });
    await stopInbox();
    await pause(16000);
    await startInbox();
    await waitFor(async () => (await call('status')).latestExtension?.ready, 'automatic reconnect after inbox restart', 25000);
    const restored = await call(`cost-batches?workspaceId=${workspaceId}`);
    assert.ok((restored.records || restored.batches).some(item => item.deliveryId === delivered.deliveryId), 'restart preserves delivered evidence');
    checks.push({ name: 'offline interval, automatic native reconnect and preserved evidence' });
    await view.webContents.loadURL('https://www.zhuolinkeji.cn/view/console/index.html');
    await waitFor(() => evaluate('Boolean(document.querySelector("#erpa-cost-trigger")) && Boolean(document.querySelector("#procurement")?.contentDocument?.querySelector("#erpa-cost-root"))'), 'home and real isolated iframe mounted');
    await evaluate('document.querySelector("#erpa-cost-trigger").click()');
    await waitFor(() => evaluate('document.querySelector("#procurement").contentDocument.querySelector("#erpa-cost-root").classList.contains("erpa-open")'), 'top activation routed to native purchase iframe');
    assert.equal(await evaluate('document.querySelector("#erpa-cost-root").classList.contains("erpa-open")'), false);
    assert.equal(await evaluate('document.querySelector("#procurement").contentDocument.querySelectorAll("#erpa-cost-trigger").length'), 0);
    checks.push({ name: 'native homepage activation routes into isolated purchase iframe with one entry' });
    await view.webContents.loadURL('https://www.zhuolinkeji.cn/login.html');
    await waitFor(() => evaluate('Boolean(document.querySelector("#erpa-cost-trigger"))'), 'login mounted');
    await evaluate('document.querySelector("#erpa-cost-trigger").click()');
    await waitFor(() => evaluate('document.body.innerText.includes("请先登录 ERP")'), 'actual login guidance');
    assert.equal(await evaluate('document.querySelector("#erpa-recalculate").disabled'), true);
    checks.push({ name: 'native login state blocks collection with explicit guidance' });
    assert.deepEqual(failures, []);
    const result = { ok: true, electron: process.versions.electron, nativeChromeApis: true, packagedResources: Boolean(process.env.ERP_NATIVE_RESOURCES), fixture: true, checks, maxStatusMs: Math.max(...timings.filter(item => item.route === 'status').map(item => item.ms)), requests, limitations: ['ERP HTTP responses are isolated fixtures; native extension APIs, renderer, storage, messages and server are real.'] };
    await fs.writeFile(path.join(out, 'erp-native-checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await fs.writeFile(path.join(out, 'erp-native-checks.json'), JSON.stringify({ ok: false, checks, failures, message: error.message, stack: error.stack, body: view && !view.webContents.isDestroyed() ? await evaluate('document.body.innerText').catch(() => '') : '' }, null, 2));
    process.exitCode = 1;
  } finally {
    if (view && !view.webContents.isDestroyed()) view.webContents.close(); host?.destroy(); popup?.destroy(); await stopInbox(); app.exit(process.exitCode || 0);
  }
});
