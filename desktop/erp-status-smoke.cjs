const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const output = process.env.ERP_STARTUP_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-erp-status-'));
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-erp-status-profile-'));
const workspaceServer = http.createServer((_req, res) => res.end('<!doctype html><html><body><div id="root">隔离工作站</div></body></html>'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let application;
const checks = [];
async function wait(check, name) { const end = Date.now() + 35000; while (Date.now() < end) { if (await check()) return; await delay(100); } throw new Error('Timeout: ' + name + '\n' + JSON.stringify(await application.evaluate(() => globalThis.__erpStatusSmoke?.state()))); }
async function shellRun(code) { return application.evaluate((_, code) => globalThis.__erpStatusSmoke.window().webContents.executeJavaScript(code), code); }
async function green() { return shellRun("document.querySelector('#inbox-status').dataset.status === 'success'"); }
(async () => {
  await new Promise(resolve => workspaceServer.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, DESKTOP_ERP_STATUS_SMOKE: '1', SHOPEERS_DESKTOP_DEV_URL: `http://127.0.0.1:${workspaceServer.address().port}`, SHOPEERS_DESKTOP_SMOKE_USER_DATA: profile, SHOPEERS_DESKTOP_SMOKE_CACHE: path.join(profile, 'cache'), SHOPEERS_ERP_INBOX_FILE: path.join(profile, 'inbox.json'), SHOPEERS_ERP_INBOX_PORT: String(27000 + Math.floor(Math.random() * 1000)) };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    application = await _electron.launch({ executablePath: process.env.DESKTOP_EXPERIENCE_ELECTRON || path.join(__dirname, 'node_modules/electron/dist/electron.exe'), args: [path.join(__dirname, 'erp-status-smoke-app.cjs')], env, timeout: 30000 });
    await wait(() => application.evaluate(() => Boolean(globalThis.__erpStatusSmoke?.erp() && globalThis.__erpStatusSmoke.state().tabs.erp.extension?.id)), 'real ERP extension load');
    assert.equal(await application.evaluate(() => globalThis.__erpStatusSmoke.state().activeTab), 'workspace');
    assert.equal(await application.evaluate(() => globalThis.__erpStatusSmoke.window().isVisible()), false);
    assert.equal(await green(), false, 'extension load before runtime configuration does not claim ready');
    assert.equal((await application.evaluate(() => globalThis.__erpStatusSmoke.configure())).ok, true);
    await application.evaluate(async () => { globalThis.__erpStatusSmoke.ready(); await globalThis.__erpStatusSmoke.erp().reload(); });
    await wait(green, 'real isolated -> extension background -> authenticated inbox -> shell ready');
    const ready = await application.evaluate(() => globalThis.__erpStatusSmoke.state());
    assert.equal(ready.activeTab, 'workspace');
    assert.equal(ready.inbox.latestExtension.context, 'extension-isolated');
    assert.equal(ready.inbox.latestExtension.sessionState, 'authenticated');
    assert.equal(ready.inbox.latestExtension.queryAvailable, false);
    assert.equal(await application.evaluate(() => globalThis.__erpStatusFixture.calls.some(value => value.startsWith('/purchase/'))), false, 'cold detection never requests purchase APIs');
    checks.push('hidden actual desktop stays on workspace; real MV3 loadExtension, MAIN session replay, isolated bridge and managed inbox handshake turn the lamp green without purchase');
    await application.evaluate(async () => { for(let i=0;i<5;i++) await globalThis.__erpStatusSmoke.poll(); });
    assert.equal(await shellRun("!!document.querySelector('#erp-ready-notice, #erp-status-hint')"), false);
    await shellRun("(()=>{const lamp=document.querySelector('#inbox-status');lamp.click();lamp.dispatchEvent(new MouseEvent('mouseenter'));lamp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));lamp.focus();})()");
    assert.equal(await application.evaluate(() => globalThis.__erpStatusSmoke.windows()),1);
    assert.equal(await shellRun("document.querySelector('#inbox-status').title"),'');
    assert.equal(await shellRun("document.querySelector('#inbox-status').tabIndex"),-1);
    checks.push('repeated genuine status events and mouse/keyboard dispatch produce no status panel, tooltip, toast or child window');
    await application.evaluate(() => globalThis.__erpStatusSmoke.expire());
    assert.equal(await green(), false, 'stale status immediately revokes green');
    await application.evaluate(() => globalThis.__erpStatusSmoke.erp().executeJavaScript("window.dispatchEvent(new Event('online'))"));
    await wait(green, 'online event fresh handshake');
    await application.evaluate(() => globalThis.__erpStatusSmoke.restartInbox());
    await wait(async () => !(await green()), 'inbox restart rejects old persisted readiness');
    await application.evaluate(() => globalThis.__erpStatusSmoke.erp().executeJavaScript("window.dispatchEvent(new Event('online'))"));
    await wait(green, 'inbox restart automatic handshake recovery');
    checks.push('expiry and real managed inbox restart revoke old green; fresh communication recovers without repeating notice');
    await application.evaluate(async () => { globalThis.__erpStatusFixture.mode = 'login'; await globalThis.__erpStatusSmoke.erp().loadURL('https://www.zhuolinkeji.cn/login.html'); });
    await wait(async () => !(await green()) && (await shellRun("document.querySelector('#inbox-status').getAttribute('aria-label')")).includes('请先登录'), 'known login state');
    checks.push('real login fixture page and 401 response never report green');
    await application.evaluate(async () => { globalThis.__erpStatusFixture.mode = 'authenticated'; await globalThis.__erpStatusSmoke.erp().loadURL('https://www.zhuolinkeji.cn/'); });
    await wait(green, 'root homepage authentication recovery');
    await application.evaluate(async () => { await globalThis.__erpStatusSmoke.setTab('erp'); await globalThis.__erpStatusSmoke.setTab('workspace'); });
    assert.equal(await green(), true);
    for (const appearance of ['light', 'dark']) {
      await application.evaluate((_, value) => globalThis.__erpStatusSmoke.appearance(value), appearance);
      await wait(async () => await shellRun('document.documentElement.dataset.appearance') === appearance, 'actual shell appearance');
      await application.evaluate(() => globalThis.__erpStatusSmoke.window().setContentSize(1024, 880));
      await delay(300);
      const png = await application.evaluate(async () => (await globalThis.__erpStatusSmoke.window().webContents.capturePage()).toPNG().toString('base64'));
      fs.writeFileSync(path.join(output, `erp-lamp-${appearance}.png`), Buffer.from(png, 'base64'));
    }
    checks.push('ERP/workspace switch retains handshake; 1024px light/dark passive lamp DOM checked');
    fs.writeFileSync(path.join(output, 'desktop-status-checks.json'), JSON.stringify({ ok: true, checks, limitation: 'Real Electron extension and managed inbox against isolated ERP HTML/API fixtures; no live account or business data. Windows remain hidden, so native visible-window focus was not claimed.' }, null, 2));
    console.log(JSON.stringify({ ok: true, output, checks }, null, 2));
  } finally { if (application) await application.close(); await new Promise(resolve => workspaceServer.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
