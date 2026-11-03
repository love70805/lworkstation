const { app, BrowserWindow, WebContentsView, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {pathToFileURL}=require('node:url');
const root = path.resolve(__dirname, '..');
const resources = process.env.ERP_NATIVE_RESOURCES || root;
const runtime = process.env.ERP_NATIVE_RESOURCES ? path.join(resources, 'app.asar') : __dirname;
const { prepareRuntimeExtension, extensionStorageConfig } = require(path.join(runtime, 'extension-runtime.cjs'));
const { createInboxServiceController, installExtensionInboxTransport } = require(path.join(runtime, 'inbox-service.cjs'));
const { createWorkspaceErpCollector } = require(path.join(runtime, 'erp-workspace-collector.cjs'));
const out = path.resolve(process.env.ERP_NATIVE_OUTPUT);
const profile = path.join(out, `isolated-profile-${Date.now()}`);
console.log('Native isolated profile: '+profile);
const port = Number(process.env.ERP_NATIVE_PORT || 23874);
const capability = 'synthetic-native-extension-capability-0123456789';
const workspaceId = 'native-qa';
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], failures = [], timings = [], requests = [];
let inbox, host, view, popup, collector, collectorView, automaticLoginRequired = false, permissionRequired = false;
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
  inbox = createInboxServiceController({ executable: process.execPath, scriptPath: script, runAsNode: true,
    port, capability, spoolPath: path.join(profile, 'inbox.json') });
  assert.equal((await inbox.start()).ok, true);
  await waitFor(async () => { try { return await call('status'); } catch { return false; } }, 'inbox start');
}
async function stopInbox() { await inbox?.stop({ wait: true }); }
const evaluate = code => view.webContents.executeJavaScript(code);
const purchase = 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html';
app.whenReady().then(async () => {
  try {
    await fs.mkdir(profile, { recursive: true });
    await startInbox();
    await call('requests', { request: { id: 'NATIVE-R', workspaceId, ledgerId: 'NATIVE-L', ledgerPeriod: '2026-09', platformSkcs: [{ platformSkc: 'SKC-A' }] }, expectedSkus: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }] });
    const ses = session.fromPartition('persist:native-erp');
    installExtensionInboxTransport(ses, () => inbox);
    ses.serviceWorkers.on('console-message', (_event, details) => { if (details?.level === 'error') failures.push(details.message); });
    ses.protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.searchParams.has('lworkstationRequest') && automaticLoginRequired) return new Response('<!doctype html><html><body><input type="password"></body></html>', { headers: { 'content-type': 'text/html' } });
      if (!url.pathname.startsWith('/purchase/')) return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><h1>隔离原生 ERP</h1>' + (url.pathname === '/view/console/index.html' ? '<iframe id="procurement" style="width:100%;height:720px" src="/view/system/purchaseOrderModule/purchasingManagement.html"></iframe>' : '') + (url.pathname === '/login.html' ? '<input type="password" aria-label="ERP 密码">' : '') + '</body></html>', { headers: { 'content-type': 'text/html' } });
      requests.push(url.pathname);
      if (permissionRequired && url.pathname.endsWith('product-info-sku')) return new Response(JSON.stringify({ code: -40102, msg: '校验用户店铺权限失败！' }), { headers: { 'content-type': 'application/json' } });
      const data = url.pathname.endsWith('purchase-order-page') ? [{ purchaseOrderId: 'PO-A' }]
        : url.pathname.endsWith('purchase-order-details') ? [{ purchaseOrderDetailId: 'D-A', itemId: 'WH-A', tradeName: '原生隔离商品', creationTime: '2026-08-20', purchaseQuantity: 2, purchaseUnitPrice: 4 }]
          : url.pathname.endsWith('product-page') ? [{ itemId: 'WH-A' }] : url.pathname.endsWith('product-info-sku') ? [{ associatedProductId: 'WH-A', barcodeSkcid: 'SKC-A', barcodeSkuid: 'SKU-A' }] : [];
      return new Response(JSON.stringify({ code: 0, count: data.length, data }), { headers: { 'content-type': 'application/json' } });
    });
    const directory = await prepareRuntimeExtension({ sourceDirectory: path.join(resources, 'integrations/erp-assistant-extension'), userDataPath: profile, port, runtimeId: 'erp' });
    const loaded = await ses.extensions.loadExtension(directory, { allowFileAccess: true });
    popup = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
    await popup.loadURL(`chrome-extension://${loaded.id}/popup/popup.html`);
    await popup.webContents.executeJavaScript(`chrome.storage.local.set(${JSON.stringify(extensionStorageConfig({ port, capability, workspaceId, desktopTaskUi: false }))})`);
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
    const {createInboxDisk}=await import(pathToFileURL(path.join(resources,process.env.ERP_NATIVE_RESOURCES?'runtime/erp-inbox-disk.mjs':'tools/erp-inbox-disk.mjs')).href);
    const persisted=(await createInboxDisk(path.join(profile,'inbox.json')).load()).map(entry=>entry.metadata);
    assert.ok(persisted.some(item => item.kind === 'batch' && item.deliveryId === delivered.deliveryId));
    checks.push({ name: 'real MAIN query hook, procurement reads, SKU mapping, native chrome.storage checkpoint, native background delivery, durable v2 evidence', unitCost: 4 });
    const previousTasks = await call(`collection-tasks?workspaceId=${workspaceId}`);
    for (const task of previousTasks.tasks ?? []) if (!['stopped','completed','invalidated'].includes(task.status)) await call(`collection-tasks/${task.taskId}/control`, { workspaceId, action: 'stop' });
    await pause(1200);
    await call('requests', { request: { id: 'NATIVE-AUTO-R', workspaceId, ledgerId: 'NATIVE-AUTO-L', ledgerPeriod: '2026-09', platformSkcs: [{ platformSkc: 'SKC-A' }] }, expectedSkus: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }] });
    await evaluate(`document.body.insertAdjacentHTML('beforeend','<input id="keep-foreground" value="前台原查询"><select id="keep-page"><option>20</option><option selected>100</option></select>')`);
    const foregroundUrl = view.webContents.getURL();
    const foregroundCache = await evaluate(`JSON.parse(localStorage.getItem('erpAssistantV8_latest_cost_result_v7'))?.results`);
    automaticLoginRequired = true;
    collector = createWorkspaceErpCollector({
      getContext: () => ({ workspaceId }),
      requestInbox: input => inbox.requestInbox(input),
      createView: async url => {
        const hidden = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
        collectorView = hidden;
        hidden.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
        await hidden.webContents.loadURL(url);
        return hidden;
      },
    });
    const waiting = await collector.start({ workspaceId, ledgerId: 'NATIVE-AUTO-L', requestId: 'NATIVE-AUTO-R' });
    assert.equal(waiting.status, 'waiting_login');
    automaticLoginRequired = false;
    await collector.sessionChanged();
    const automatic = await waitFor(async () => { const result = await call(`cost-batches?workspaceId=${workspaceId}`); return (result.batches ?? result.records)?.find(item => item.requestId === 'NATIVE-AUTO-R'); }, 'workspace-only collection without a query or clipboard', 45000);
    assert.equal(automatic.envelope.batch.rows[0].unitCost, 4);
    assert.equal(automatic.envelope.batch.evidenceStatus, 'complete');
    assert.equal(view.webContents.getURL(), foregroundUrl);
    assert.equal(await evaluate(`document.querySelector('#keep-foreground').value`), '前台原查询');
    assert.equal(await evaluate(`document.querySelector('#keep-page').value`), '100');
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('erpAssistantV8_latest_cost_result_v7'))?.results`), foregroundCache);
    await collector.sessionChanged();
    assert.equal(collector.snapshot().status, 'session_changed');
    await assert.rejects(collector.start({ workspaceId, ledgerId: 'NATIVE-AUTO-L', requestId: 'NATIVE-AUTO-R' }), { code: 'ERP_SESSION_CHANGED' });
    await call('requests', { request: { id: 'NATIVE-AUTO-RELOGIN', workspaceId, ledgerId: 'NATIVE-AUTO-L', ledgerPeriod: '2026-09',
      replaceLedgerScope: true, supersedesRequestId: 'NATIVE-AUTO-R', platformSkcs: [{ platformSkc: 'SKC-A' }] }, expectedSkus: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }] });
    await collector.start({ workspaceId, ledgerId: 'NATIVE-AUTO-L', requestId: 'NATIVE-AUTO-RELOGIN' });
    const restarted = await waitFor(async () => (await call(`cost-batches?workspaceId=${workspaceId}`)).records?.find(item => item.requestId === 'NATIVE-AUTO-RELOGIN'), 'new native task delivers after login session changes', 45000);
    assert.equal(restarted.envelope.batch.rows[0].unitCost, 4);
    assert.ok((await call(`cost-batches?workspaceId=${workspaceId}`)).records.some(item => item.deliveryId === automatic.deliveryId), 'old durable receipt stays available');
    checks.push({ name: 'changed login stops the old native task; a fresh registration restarts collection and preserves earlier receipts' });
    await collector.stop();
    await call('requests', { request: { id: 'NATIVE-PERMISSION', workspaceId, ledgerId: 'NATIVE-PERMISSION-L', ledgerPeriod: '2026-09', platformSkcs: [{ platformSkc: 'SKC-A' }] }, expectedSkus: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }] });
    permissionRequired = true;
    const permissionInput = { workspaceId, ledgerId: 'NATIVE-PERMISSION-L', requestId: 'NATIVE-PERMISSION' };
    await collector.start(permissionInput);
    const pausedPermission = await waitFor(async () => (await call(`collection-tasks?workspaceId=${workspaceId}`)).tasks?.find(task => task.requestId === permissionInput.requestId && task.status === 'paused'), 'native permission failure pauses the task');
    assert.equal(pausedPermission.pauseReason?.code, 'ERP_PERMISSION_REQUIRED');
    assert.equal(pausedPermission.batches[0].status, 'pending');
    assert.ok(!(await call(`cost-batches?workspaceId=${workspaceId}`)).records?.some(item => item.requestId === permissionInput.requestId), 'permission failure cannot deliver partial costs');
    await collector.poll();
    assert.equal(collector.snapshot().status, 'paused');
    permissionRequired = false;
    await collector.start(permissionInput);
    const permissionReceipt = await waitFor(async () => (await call(`cost-batches?workspaceId=${workspaceId}`)).records?.find(item => item.requestId === permissionInput.requestId), 'native permission recovery continues without logging in again');
    assert.equal(permissionReceipt.envelope.batch.rows[0].unitCost, 4);
    const resumedPermission = (await call(`collection-tasks?workspaceId=${workspaceId}`)).tasks.find(task => task.requestId === permissionInput.requestId);
    assert.equal(resumedPermission.taskId, pausedPermission.taskId);
    assert.equal(resumedPermission.pauseReason, undefined);
    assert.ok((await call(`cost-batches?workspaceId=${workspaceId}`)).records.some(item => item.deliveryId === automatic.deliveryId));
    checks.push({ name: 'native HTTP 200 permission failure pauses with pending costs, closes hidden view, resumes the same task without another login and preserves earlier receipts' });
    await collector.stop(); collector.dispose(); collector = null;
    checks.push({ name: 'workspace launch, first-login wait/resume, real hidden native collector, fixed scope, complete delivery and unchanged foreground URL/form/pagination/result cache', unitCost: 4 });
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
    await popup.webContents.executeJavaScript(`chrome.storage.local.set(${JSON.stringify(extensionStorageConfig({ port, capability, workspaceId }))})`);
    await view.webContents.loadURL('https://www.zhuolinkeji.cn/view/console/index.html');
    await waitFor(() => evaluate('Boolean(document.querySelector(".erpa-task-preview"))'), 'managed progress preview mounted');
    await evaluate('document.querySelector("#erpa-cost-trigger").click()');
    await waitFor(() => evaluate('document.querySelector(".erpa-task-body").textContent.includes("个 SKC")'), 'managed preview reads the durable task API from ERP home');
    assert.equal(await evaluate('document.querySelector("#erpa-recalculate,#erpa-copy")'), null);
    assert.equal(await evaluate('document.querySelector("#procurement")?.contentDocument?.querySelectorAll("#erpa-cost-root").length'), 0, 'managed iframe has no duplicate or legacy assistant');
    const previewReads = requests.length;
    await evaluate('document.querySelector("#erpa-cost-trigger").click(); document.querySelector("#erpa-cost-trigger").click()');
    await pause(3500);
    assert.equal(requests.length, previewReads, 'opening and polling progress does not issue ERP purchase reads');
    checks.push({ name: 'built-in managed preview uses native task list on ERP home, one nonmodal entry, no legacy controls or ERP business reads' });
    assert.deepEqual(failures, []);
    const result = { ok: true, electron: process.versions.electron, nativeChromeApis: true, packagedResources: Boolean(process.env.ERP_NATIVE_RESOURCES), fixture: true, checks, maxStatusMs: Math.max(...timings.filter(item => item.route === 'status').map(item => item.ms)), requests, limitations: ['ERP HTTP responses are isolated fixtures; native extension APIs, renderer, storage, messages and server are real.'] };
    await fs.writeFile(path.join(out, 'erp-native-checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    const collectorState = collector?.snapshot();
    const tasks = inbox ? await call(`collection-tasks?workspaceId=${workspaceId}`).catch(() => null) : null;
    let collectorBody='';
    try { if (collectorView && !collectorView.webContents.isDestroyed()) collectorBody=await collectorView.webContents.executeJavaScript('document.body.innerText').catch(()=>''); } catch { /* Closed test view. */ }
    await fs.writeFile(path.join(out, 'erp-native-checks.json'), JSON.stringify({ ok: false, checks, failures, message: error.message, stack: error.stack, collectorState, tasks, collectorBody, body: view && !view.webContents.isDestroyed() ? await evaluate('document.body.innerText').catch(() => '') : '' }, null, 2));
    process.exitCode = 1;
  } finally {
    collector?.dispose();
    if (view && !view.webContents.isDestroyed()) view.webContents.close(); host?.destroy(); popup?.destroy(); await stopInbox(); app.exit(process.exitCode || 0);
  }
});
