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
const sources = await Promise.all(['query-hook.js', 'result-policy.js', 'request-context.js', 'shopeers-bridge.js', 'content.js'].map(file => readFile(path.join(sourceRoot, file), 'utf8')));

async function createPage(url, { topWindow, connected = true, earlySessionResponse = false } = {}) {
  const window = new Window({ url });
  if (topWindow) Object.defineProperty(window, 'top', { value: topWindow });
  const messages = [], calls = [], intervals = [];
  const setInterval = window.setInterval.bind(window);
  window.setInterval = (...args) => { intervals.push(args); return setInterval(...args); };
  window.chrome = { runtime: {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(JSON.parse(JSON.stringify(message)));
      callback(connected ? { ok: true, status: 'success' } : { ok: false, status: 'failed' });
    },
  } };
  window.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, clone() { return this; }, json: async () => ({ code: 0, data: [], count: 0 }) };
  };
  window.eval(sources[0]);
  if (earlySessionResponse) { await window.fetch('/permission/user/current'); await tick(); }
  for (const source of sources.slice(1)) window.eval(source);
  await tick();
  return { window, messages, calls, intervals, async destroy() { await window.happyDOM.abort(); window.close(); } };
}

export async function verifyErpPageStartup() {
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
    assert.equal(intervals.length, 1, 'one status heartbeat per document');
    window.document.querySelector('#erpa-cost-trigger').click();
    assert.ok(window.document.querySelector('#erpa-cost-root').classList.contains('erpa-open'));
    assert.match(window.document.querySelector('#erpa-page-context').textContent, /助手已加载.*工作台已连接.*请进入采购管理/);
    assert.equal(window.document.querySelector('#erpa-page-context a').href, origin + purchasePath);
    assert.equal(calls.length, 0, 'opening from home does not query purchase APIs');
    assert.ok(messages.some(message => message.type === 'shopeers.erp.reportStatus'));
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled, true);

    for (const source of sources) window.eval(source);
    assert.equal(window.document.querySelectorAll('#erpa-cost-trigger').length, 1);
    assert.equal(intervals.length, 1, 're-injection does not duplicate listeners or heartbeats');

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
    window.localStorage.setItem('erpAssistantV8_latest_cost_result_v6', JSON.stringify({
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
    assert.equal(intervals.length, 1);
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
