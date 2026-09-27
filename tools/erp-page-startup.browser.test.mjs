import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const extension = fileURLToPath(new URL('../integrations/erp-assistant-extension/', import.meta.url));
const source = (await Promise.all(['query-hook.js', 'result-policy.js', 'request-context.js', 'shopeers-bridge.js', 'content.js'].map(file => readFile(path.join(extension, 'src', file), 'utf8')))).join('\n');
const css = await readFile(path.join(extension, 'src/content.css'), 'utf8');
const origin = 'https://www.zhuolinkeji.cn';
const purchasePath = '/view/system/purchaseOrderModule/purchasingManagement.html';
const checks = [];
const browser = await chromium.launch({ executablePath: process.env.ERP_STARTUP_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 880 } });
const captured = [];
await context.exposeBinding('recordExtensionMessage', ({ frame }, message) => {
  captured.push({ pageUrl: frame.url(), message });
  return { ok: true, status: 'success' };
});
await context.addInitScript({ content: `window.chrome = {runtime: {lastError:null, sendMessage(message, callback) { window.recordExtensionMessage(message).then(callback); }}};\n${source}` });
await context.route(origin + '/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/purchase/')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, count: 0, data: [] }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body><h1>隔离 ERP 路由</h1>${url.pathname === '/view/console/index.html' ? `<iframe id="procurement" title="采购管理" style="display:none;width:100%;height:720px" src="${purchasePath}"></iframe>` : ''}${url.pathname === '/login.html' ? '<input type="password" aria-label="ERP 密码">' : ''}</body></html>` });
});
const page = await context.newPage();
try {
  await page.goto(origin + '/view/console/index.html');
  await page.locator('#erpa-cost-trigger').waitFor();
  await page.locator('#erpa-cost-trigger').focus();
  await page.keyboard.press('Enter');
  await page.locator('#erpa-cost-root.erpa-open').waitFor();
  await page.getByText(/助手已加载.*工作台已连接/).waitFor();
  assert.equal(captured.filter(entry => entry.message.type === 'shopeers.erp.submitCostResult').length, 0);
  assert.equal(await page.locator('#erpa-recalculate').isDisabled(), true);
  checks.push('home cold start, keyboard activation and actual runtime bridge response');
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 880 });
    const bounds = await page.locator('.erpa-panel').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.width <= width);
    assert.equal(await page.locator('#erpa-page-context a').isVisible(), true);
    if (process.env.ERP_STARTUP_QA_OUTPUT) {
      await mkdir(process.env.ERP_STARTUP_QA_OUTPUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.ERP_STARTUP_QA_OUTPUT, `erp-home-${width}.png`) });
    }
  }
  checks.push('1024/1280/1440 guidance panel stays inside window');
  await page.keyboard.press('Escape');
  const frame = page.frames().find(entry => new URL(entry.url()).pathname === purchasePath);
  assert.ok(frame);
  assert.equal(await frame.locator('#erpa-cost-trigger').count(), 0);
  await page.locator('#procurement').evaluate(element => { element.style.display = 'block'; });
  await page.locator('#erpa-cost-trigger').click();
  await frame.locator('#erpa-cost-root.erpa-open').waitFor();
  assert.equal(await page.locator('#erpa-cost-root').isVisible(), false, 'top panel is closed while purchase iframe panel opens');
  assert.equal(await frame.locator('#erpa-recalculate').isDisabled(), true);
  checks.push('one top entry routes to visible purchase iframe with no duplicate trigger');
  await frame.locator('#erpa-close').click();
  await page.locator('#procurement').evaluate(element => { element.style.display = 'none'; });
  await page.locator('#erpa-cost-trigger').click();
  await page.locator('#erpa-cost-root.erpa-open').waitFor();
  checks.push('hidden purchase iframe cannot capture top assistant activation');

  await page.goto(origin + purchasePath);
  await page.locator('#erpa-cost-trigger').waitFor();
  await page.evaluate(async () => { await fetch('/purchase/purchase/v1/purchase-order-page?sku=SKC-ROUTE'); });
  assert.equal(await page.locator('#erpa-recalculate').isDisabled(), false);
  await page.evaluate(() => history.pushState({}, '', '/view/system/orderManagement/orderList.html'));
  assert.equal(await page.locator('#erpa-recalculate').isDisabled(), true);
  await page.evaluate(() => history.back());
  await page.waitForURL(origin + purchasePath);
  assert.equal(await page.locator('#erpa-recalculate').isDisabled(), true);
  await page.locator('#erpa-cost-trigger').click();
  await page.getByText(/请先在采购管理点击/).waitFor();
  await page.evaluate(() => history.replaceState({}, '', '/view/console/orders.html'));
  await page.reload();
  await page.locator('#erpa-cost-trigger').waitFor();
  assert.equal(await page.locator('#erpa-cost-trigger').count(), 1);
  checks.push('real MAIN fetch hook, SPA exit, history back and non-purchase refresh require a fresh query');
  await page.goto(origin + '/login.html');
  await page.locator('#erpa-cost-trigger').click();
  await page.getByText(/请先登录 ERP/).waitFor();
  assert.equal(await page.locator('#erpa-page-context a').count(), 0);
  checks.push('login guidance stays visible and does not initiate business activity');

  const result = { ok: true, browser: await browser.version(), checks, limitation: 'Isolated supported-route fixtures with mocked extension runtime; no live ERP login or user business data used.' };
  if (process.env.ERP_STARTUP_QA_OUTPUT) await writeFile(path.join(process.env.ERP_STARTUP_QA_OUTPUT, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
