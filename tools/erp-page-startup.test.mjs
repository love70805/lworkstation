import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const frontendRequire = createRequire(path.join(workspaceRoot, 'frontend', 'package.json'));
const { Window } = await import(pathToFileURL(frontendRequire.resolve('happy-dom')).href);
const sourceRoot = path.join(workspaceRoot, 'integrations/erp-assistant-extension/src');
const purchasePath = '/view/system/purchaseOrderModule/purchasingManagement.html';
const origin = 'https://www.zhuolinkeji.cn';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const sources = await Promise.all(['query-hook.js', 'result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'desktop-task-preview.js', 'content.js'].map(file => readFile(path.join(sourceRoot, file), 'utf8')));

async function createPage(url, { topWindow, connected = true, earlySessionResponse = false, desktopTaskUi = false,
  storagePending = false, shortStorageTimeout = false, taskRecords = null, html = '' } = {}) {
  const window = new Window({ url });
  if (html) window.document.body.innerHTML = html;
  if (topWindow) Object.defineProperty(window, 'top', { value: topWindow });
  const messages = [], calls = [], intervals = [], storageCallbacks = [], storageListeners = [];
  let storageReads = 0;
  const setInterval = window.setInterval.bind(window);
  window.setInterval = (...args) => { intervals.push(args); return setInterval(...args); };
  if (shortStorageTimeout) {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => schedule(callback, ms === 1500 ? 5 : ms, ...args);
  }
  window.chrome = { runtime: {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(JSON.parse(JSON.stringify(message)));
      if (message.type === 'shopeers.erp.collectionTask' && message.payload.control === 'claim') return callback({ ok: false, code: 'ERP_TASK_ALREADY_CLAIMED', message: 'isolated claim boundary' });
      callback(connected ? { ok: true, status: 'success', tasks: taskRecords ?? [{ executionTarget: 'desktop', ledgerPeriod: '2026-10', status: 'running', summary: { total: 231, collected: 30, delivered: 25, adopted: 107 }, batches: [] }] } : { ok: false, status: 'failed' });
    },
  } };
  window.chrome.storage = { local: { get: (_keys, callback) => {
    storageReads++;
    if (storagePending) storageCallbacks.push(callback);
    else callback({ shopeersErpDesktopTaskUi: desktopTaskUi });
  } }, onChanged: { addListener: listener => storageListeners.push(listener) } };
  window.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, clone() { return this; }, json: async () => ({ code: 0, data: [], count: 0 }) };
  };
  window.eval(sources[0]);
  if (earlySessionResponse) { await window.fetch('/permission/user/current'); await tick(); }
  for (const source of sources.slice(1)) window.eval(source);
  await tick();
  return { window, messages, calls, intervals, get storageReads() { return storageReads; },
    resolveStorage(value = desktopTaskUi) { for (const callback of storageCallbacks.splice(0)) callback({ shopeersErpDesktopTaskUi: value }); },
    setStoragePending(value) { storagePending = value; },
    setDesktopMode(value) {
      desktopTaskUi = value;
      for (const listener of storageListeners) listener({ shopeersErpDesktopTaskUi: { newValue: value } }, 'local');
    },
    async destroy() { await window.happyDOM.abort(); window.close(); } };
}

export async function verifyErpPageStartup() {
  const lateConfig = await createPage(origin + purchasePath, { desktopTaskUi: true, storagePending: true, shortStorageTimeout: true,
    html: '<div class="layui-laypage-limits"><select id="keep-page"><option value="50">50</option><option value="100" selected>100</option></select></div>' });
  try {
    assert.ok(lateConfig.window.document.querySelector('.erpa-task-preview'), 'unknown configuration initializes a passive preview after a bounded wait');
    assert.equal(lateConfig.window.document.querySelector('#erpa-recalculate'), null);
    assert.equal(lateConfig.window.document.querySelector('#keep-page').value, '100', 'unknown configuration never changes the foreground query');
    lateConfig.resolveStorage(); await tick();
    assert.ok(lateConfig.window.document.querySelector('.erpa-task-preview'), 'a late configuration callback restores the managed preview');
    assert.equal(lateConfig.window.document.querySelector('#keep-page').value, '100');
    assert.equal(lateConfig.window.document.querySelector('#erpa-recalculate'), null);
    lateConfig.setDesktopMode(false); await tick();
    assert.ok(lateConfig.window.document.querySelector('#erpa-recalculate'));
    lateConfig.setDesktopMode(true); await tick();
    assert.equal(lateConfig.window.document.querySelectorAll('.erpa-task-preview').length, 1);
    assert.equal(lateConfig.window.document.querySelectorAll('#erpa-cost-trigger').length, 1);
    assert.deepEqual(lateConfig.intervals.map(([,ms])=>ms).toSorted((a,b)=>a-b), [3000,15000], 'configuration changes keep one pair of timers');
    for (const source of sources) lateConfig.window.eval(source);
    assert.deepEqual(lateConfig.intervals.map(([,ms])=>ms).toSorted((a,b)=>a-b), [3000,15000]);
  } finally { await lateConfig.destroy(); }

  const configRace = await createPage(origin + '/view/console/index.html', { storagePending: true, shortStorageTimeout: true });
  try {
    configRace.setDesktopMode(true); configRace.resolveStorage(false); await tick();
    assert.ok(configRace.window.document.querySelector('.erpa-task-preview'), 'an old callback cannot overwrite a newer configuration event');
  } finally { await configRace.destroy(); }

  const configRetry = await createPage(origin + '/view/console/index.html', { desktopTaskUi: true, storagePending: true, shortStorageTimeout: true });
  try {
    configRetry.setStoragePending(false);
    configRetry.intervals.find(([,ms])=>ms===3000)[0](); await tick();
    assert.ok(configRetry.window.document.querySelector('.erpa-task-preview'), 'missing callbacks retry using the existing task timer');
    assert.equal(configRetry.storageReads, 2);
    assert.equal(configRetry.intervals.length, 2);
  } finally { await configRetry.destroy(); }

  const tasks = [{ taskId: 'BOUND-TASK', requestId: 'BOUND-REQUEST', resumeRequestId: 'OLD-INTENT', executionTarget: 'desktop',
    status: 'ready', catalogMode: 'on_demand', executionProtocol: 2, filters: { sku: 'SKC-A' }, queryCapturedAt: new Date().toISOString() }];
  const oldCollector = await createPage(origin + purchasePath + '?lworkstationRequest=BOUND-REQUEST&lworkstationResume=OLD-INTENT', { storagePending: true, taskRecords: tasks });
  try {
    assert.equal(oldCollector.storageReads, 0, 'a bound hidden collector does not wait for preview configuration');
    const claims = () => oldCollector.messages.filter(message=>message.payload?.control==='claim');
    assert.equal(claims().length, 1, 'the exact execution intent is claimed immediately after document initialization');
    assert.equal(claims()[0].payload.resumeRequestId, 'OLD-INTENT');
    assert.equal(claims()[0].payload.catalogMode, 'on_demand', 'claim inherits the task policy');
    tasks[0].resumeRequestId = 'NEW-INTENT';
    oldCollector.intervals.find(([,ms])=>ms===3000)[0](); await tick();
    assert.equal(claims().length, 1, 'an old page cannot claim a newly fenced intent after reading it');
    assert.equal(oldCollector.calls.length, 0);
  } finally { await oldCollector.destroy(); }

  for (const intent of ['', 'NEW-INTENT']) {
    const collector = await createPage(origin + purchasePath + '?lworkstationRequest=BOUND-REQUEST' + (intent ? '&lworkstationResume=' + intent : ''), { storagePending: true, taskRecords: tasks });
    try {
      const claims = collector.messages.filter(message=>message.payload?.control==='claim');
      assert.equal(claims.length, intent ? 1 : 0, 'only the replacement page with the current execution intent can claim');
      assert.equal(collector.storageReads, 0);
    } finally { await collector.destroy(); }
  }

  const desktop = await createPage(origin + '/view/console/index.html', { desktopTaskUi: true });
  try {
    assert.ok(desktop.window.document.querySelector('.erpa-task-preview'));
    desktop.window.document.getElementById('erpa-cost-trigger').click();
    await tick();
    assert.match(desktop.window.document.querySelector('.erpa-task-body').textContent, /25 \/ 231.*107 个 SKU/);
    assert.equal(desktop.window.document.querySelector('#erpa-recalculate,#erpa-search,#erpa-targets'), null);
    desktop.window.history.pushState({}, '', purchasePath);
    desktop.window.dispatchEvent(new desktop.window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: origin + '/purchase/purchase/v1/purchase-order-page?sku=FOREGROUND' } }));
    desktop.window.dispatchEvent(new desktop.window.Event('pageshow'));
    await tick();
    assert.equal(desktop.calls.length, 0, 'managed preview never issues ERP business reads or changes foreground pagination');
    assert.ok(desktop.messages.filter(message => message.type === 'shopeers.erp.collectionTask').every(message => message.payload.action === 'list'));
    desktop.window.document.getElementById('erpa-cost-root').remove();
    await tick();
    assert.equal(desktop.window.document.querySelectorAll('.erpa-task-preview').length, 1, 'managed preview repairs after body replacement');
  } finally { await desktop.destroy(); }
  const early = await createPage(origin + '/', { earlySessionResponse: true });
  try {
    assert.ok(early.messages.some(message => message.type === 'shopeers.erp.reportStatus' && message.payload.sessionState === 'authenticated'), 'root homepage session response before isolated init is replayed through the real bridge');
    assert.equal(early.calls.length, 1, 'session detection adds no business or login queries');
    await early.window.fetch('/user/logout'); await tick();
    assert.equal(early.messages.at(-1).payload.sessionState, 'login_required', 'observed successful logout revokes the earlier authenticated state');
    await early.window.fetch('/permission/user/current'); await tick();
    assert.equal(early.messages.at(-1).payload.sessionState, 'authenticated', 'a new observed session response restores authentication without cached session state');
  } finally { await early.destroy(); }
  const page = await createPage(origin + '/view/console/index.html');
  const { window, calls, messages, intervals } = page;
  try {
    assert.equal(window.document.querySelectorAll('#erpa-cost-trigger').length, 1, 'home cold start provides one assistant entry');
    assert.deepEqual(intervals.map(([, ms]) => ms).toSorted((a,b) => a-b), [3000, 15000], 'one task-intent poll and one status heartbeat per document');
    window.document.querySelector('#erpa-cost-trigger').click();
    assert.ok(window.document.querySelector('#erpa-cost-root').classList.contains('erpa-open'));
    assert.match(window.document.querySelector('#erpa-page-context').textContent, /助手已加载.*工作台已连接.*请进入采购管理/);
    assert.equal(window.document.querySelector('#erpa-page-context a').href, origin + purchasePath);
    assert.equal(calls.length, 0, 'opening from home does not query purchase APIs');
    assert.ok(messages.some(message => message.type === 'shopeers.erp.reportStatus'));
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled, true);

    for (const source of sources) window.eval(source);
    assert.equal(window.document.querySelectorAll('#erpa-cost-trigger').length, 1);
    assert.deepEqual(intervals.map(([, ms]) => ms).toSorted((a,b) => a-b), [3000, 15000], 're-injection duplicates neither task polling nor status heartbeats');

    window.history.pushState({}, '', purchasePath);
    assert.match(window.document.querySelector('#erpa-page-context').textContent, /请先在采购管理点击/);
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://attacker.invalid/purchase/purchase/v1/purchase-order-page?sku=BAD' } }));
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled, true, 'foreign API signals do not enable collection');
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: origin + '/purchase/purchase/v1/purchase-order-page?sku=SKC-1' } }));
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled, false);

    window.history.pushState({}, '', '/view/system/orderManagement/orderList.html');
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled, true);
    window.history.replaceState({}, '', purchasePath);
    assert.match(window.document.querySelector('#erpa-statusbar').textContent, /等待采购页面查询/, 'return never reuses a stale query snapshot');
    window.localStorage.setItem('erpAssistantV8_latest_cost_result_v7', JSON.stringify({
      timestamp: Date.now(), results: [], meta: { filters: {} },
      capturedUrl: origin + '/purchase/purchase/v1/purchase-order-page?sku=OLD-CACHED',
      queryCapturedAt: new Date().toISOString(), resultDeliveryId: 'ERP-RESULT-OLD-CACHED',
    }));
    window.document.querySelector('#erpa-cost-root').remove();
    window.document.querySelector('#erpa-cost-trigger').remove();
    await tick();
    assert.equal(window.document.querySelectorAll('#erpa-cost-trigger').length, 1, 'body replacement repairs one entry');
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled, true, 'repair after a route change never revives a cached query snapshot');
    window.dispatchEvent(new window.Event('pageshow'));
    window.dispatchEvent(new window.Event('online'));
    await tick();
    assert.deepEqual(intervals.map(([, ms]) => ms).toSorted((a,b) => a-b), [3000, 15000]);
  } finally { await page.destroy(); }

  const login = await createPage(origin + '/login.html', { connected: false });
  try {
    login.window.document.querySelector('#erpa-cost-trigger').click();
    assert.match(login.window.document.querySelector('#erpa-page-context').textContent, /工作台暂未连接.*请先登录/);
    assert.equal(login.window.document.querySelector('#erpa-page-context a'), null);
    assert.equal(login.calls.length, 0, 'login guidance neither bypasses login nor issues business reads');
  } finally { await login.destroy(); }

  const topPage = await createPage(origin + '/view/console/index.html');
  const purchaseFrame = await createPage(origin + purchasePath, { topWindow: topPage.window });
  try {
    assert.equal(purchaseFrame.window.document.querySelector('#erpa-cost-trigger'), null, 'purchase iframe has no duplicate floating entry');
    assert.ok(purchaseFrame.window.document.querySelector('#erpa-cost-root'));
    purchaseFrame.window.dispatchEvent(new purchaseFrame.window.MessageEvent('message', { source: topPage.window, origin, data: { type: 'shopeers.erp.openCostPreview' } }));
    assert.ok(purchaseFrame.window.document.querySelector('#erpa-cost-root').classList.contains('erpa-open'), 'top entry can open purchase frame');
    assert.equal(purchaseFrame.calls.length, 0, 'frame without captured query opens guidance only');
    purchaseFrame.window.history.pushState({}, '', '/view/system/orderManagement/orderList.html');
    assert.equal(purchaseFrame.window.document.querySelector('#erpa-cost-root').classList.contains('erpa-open'), false);
    purchaseFrame.window.history.pushState({}, '', purchasePath);
    assert.equal(purchaseFrame.window.document.querySelectorAll('#erpa-cost-root').length, 1);
    const before = purchaseFrame.messages.length;
    purchaseFrame.window.dispatchEvent(new purchaseFrame.window.MessageEvent('message', { source: topPage.window, origin: 'https://attacker.invalid', data: { type: 'shopeers.erp.openCostPreview' } }));
    assert.equal(purchaseFrame.messages.length, before, 'foreign frame commands are ignored');
  } finally { await purchaseFrame.destroy(); await topPage.destroy(); }

  const refreshed = await createPage(origin + '/view/system/orderManagement/orderList.html');
  try {
    assert.equal(refreshed.window.document.querySelectorAll('#erpa-cost-trigger').length, 1, 'refresh on a non-purchase page initializes the assistant');
    assert.equal(refreshed.calls.length, 0);
  } finally { await refreshed.destroy(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyErpPageStartup();
  console.log('ERP home, SPA, login, refresh, iframe and duplicate-init startup tests passed.');
}
