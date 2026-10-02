import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sourceRoot = path.join(root, 'integrations/erp-assistant-extension/src');
const source = (await Promise.all(['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js'].map(file => readFile(path.join(sourceRoot, file), 'utf8')))).join('\n');
const css = await readFile(path.join(sourceRoot, 'content.css'), 'utf8');
const output = path.join(root, 'archive/release-0.3.7/erp-recovery'); await mkdir(output, { recursive: true });
const checkpoint = { requestId: 'SYN-RECOVERY', workspaceId: 'SYN-WORKSPACE', ledgerPeriod: '2026-08', platformSkcs: ['SKC-A', 'SKC-B'], completedTargets: ['SKC-A'], filters: { sku: 'SKC-A' }, queryCapturedAt: '2026-09-01T00:00:00.000Z', resultDeliveryId: 'ERP-RESULT-SYN-RECOVERY' };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const requests = [], messages = [], errors = [], checks = [];
await context.exposeBinding('recoveryMessage', (_, message) => {
  messages.push(message);
  if (message.type === 'shopeers.erp.collectionCheckpoint') return message.payload.action === 'list' ? { ok: true, records: [checkpoint] } : { ok: true, checkpoint, reuseEvidence: false };
  if (message.type === 'shopeers.erp.previewContext') return { ok: true, ...checkpoint };
  return { ok: true };
});
await context.addInitScript({ content: `window.chrome={runtime:{sendMessage(message,done){window.recoveryMessage(message).then(done)}}};\n${source}` });
await context.route('https://www.zhuolinkeji.cn/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/purchase/')) {
    requests.push(url.pathname);
    // A pending request deliberately tests the visible cancel path. Abort and
    // context shutdown release it; no network request reaches the real ERP.
    return;
  }
  await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}</style><body>隔离 ERP 恢复测试</body></html>` });
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html');
  await page.locator('#erpa-cost-trigger').click();
  await page.getByRole('button', { name: '继续未完成采集', exact: true }).waitFor();
  assert.equal(requests.length, 0);
  assert.match(await page.locator('#erpa-task-status').innerText(), /待继续.*1\/2/);
  for (const scheme of ['light', 'dark']) for (const width of [1440, 1000, 390]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.erpa-panel').getBoundingClientRect();
      return { width: innerWidth, panelLeft: panel.left, panelRight: panel.right,
        buttons: [...document.querySelectorAll('.erpa-toolbar button')].filter(item => !item.hidden).map(item => { const r = item.getBoundingClientRect(); return { text: item.textContent, width: r.width, left: r.left, right: r.right, overflow: item.scrollWidth > item.clientWidth + 2 }; }), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(layout.overflow, false);
    assert.ok(layout.panelLeft >= 0 && layout.panelRight <= width);
    assert.ok(layout.buttons.every(button => !button.overflow && button.left >= 0 && button.right <= width), JSON.stringify(layout));
    await page.screenshot({ path: path.join(output, `${scheme}-${width}.png`) });
    checks.push({ scheme, width, readableButtons: layout.buttons.length });
  }
  const resume = page.getByRole('button', { name: '继续未完成采集', exact: true });
  await resume.focus(); await page.keyboard.press('Enter');
  await page.locator('#erpa-loading').waitFor({ state: 'visible' });
  assert.ok(messages.some(message => message.type === 'shopeers.erp.collectionCheckpoint' && message.payload.action === 'restore'));
  const started = performance.now(); await page.getByRole('button', { name: '取消核算', exact: true }).click();
  await page.locator('#erpa-loading').waitFor({ state: 'hidden' });
  const cancelMs = Math.round(performance.now() - started); assert.ok(cancelMs < 1000);
  assert.match(await page.locator('#erpa-task-status').innerText(), /待继续/);
  assert.equal(messages.some(message => message.type === 'shopeers.erp.submitCostResult'), false);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({ checks, cancelMs, keyboardResume: true, businessNetwork: false, realAccountCollection: false }, null, 2));
  console.log(JSON.stringify({ checks, cancelMs, keyboardResume: true, realAccountCollection: false }));
} finally { await browser.close(); }
