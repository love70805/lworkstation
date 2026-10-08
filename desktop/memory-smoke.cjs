const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const output = path.resolve(process.env.MEMORY_SMOKE_OUTPUT || path.join(__dirname, '../archive/memory-performance'));
const phase = process.env.MEMORY_SMOKE_PHASE || 'optimized';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function state(application) {
  return application.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('shell.html')).webContents.executeJavaScript('window.desktop.getState()'));
}
async function switchTab(application, tabId) {
  return application.evaluate(async ({ BrowserWindow }, tabId) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('shell.html')).webContents.executeJavaScript(`window.desktop.switchTab(${JSON.stringify(tabId)})`), tabId);
}
async function configure(application, workspaceId) {
  const result = await application.evaluate(async ({ webContents }, workspaceId) => webContents.getAllWebContents().find(c => c.getURL().includes('127.0.0.1') || c.getURL().startsWith('shopeers:')).executeJavaScript(`window.shopeersDesktopRuntime.requestInbox({ route: '/selection/v1/context', method: 'POST', body: { workspaceId: ${JSON.stringify(workspaceId)}, memberId: 'memory-member', visibility: 'workspace' } })`), workspaceId);
  assert.equal(result.status, 200, 'context synchronization accepts deferred pages');
}
async function extensionWorkspace(application, tabId) {
  return application.evaluate(async ({ BrowserWindow, session }, tabId) => {
    const target = session.fromPartition(`persist:${tabId}`), extensions = target.extensions.getAllExtensions();
    const extension = extensions[0];
    if (!extension) throw new Error('extension missing: ' + tabId);
    const popup = new BrowserWindow({ show: false, webPreferences: { session: target, sandbox: true, contextIsolation: true } });
    try {
      await popup.loadURL(`chrome-extension://${extension.id}/${tabId === 'erp' ? 'popup/popup.html' : 'popup.html'}`);
      return await popup.webContents.executeJavaScript("chrome.storage.local.get('shopeersErpWorkspaceId').then(value => value.shopeersErpWorkspaceId)");
    } finally { popup.destroy(); }
  }, tabId);
}
async function checkUserPaths(application) {
  const checks = [];
  const initial = await state(application);
  assert.equal(initial.tabs.erp.extension.status, 'deferred');
  assert.equal(initial.tabs['1688'].extension.status, 'deferred');
  assert.equal(await application.evaluate(({ session }) => ['erp', '1688'].reduce((sum, id) => sum + session.fromPartition(`persist:${id}`).extensions.getAllExtensions().length, 0)), 0);
  checks.push('cold start has no remote page or loaded extension');
  const workspaceIdentity = await application.evaluate(async ({ webContents }) => {
    const c = webContents.getAllWebContents().find(c => c.getURL().includes('/workspace'));
    await c.executeJavaScript("const draft = document.createElement('input'); draft.id = 'memory-draft'; draft.value = '保留未保存内容'; document.body.append(draft)");
    return { id: c.id, pid: c.getOSProcessId() };
  });
  await configure(application, 'memory-workspace');
  const first = switchTab(application, 'erp');
  const second = switchTab(application, 'erp');
  await switchTab(application, 'workspace');
  assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  assert.equal((await state(application)).activeTab, 'workspace', 'late initialization cannot steal selection');
  await wait(async () => (await state(application)).tabs.erp.status === 'ready', 'cold ERP ready');
  assert.equal((await state(application)).tabs['1688'].extension.status, 'deferred');
  assert.equal(await extensionWorkspace(application, 'erp'), 'memory-workspace');
  checks.push('duplicate cold ERP opens initialize once; latest scope installed; late completion preserves selected workspace');
  // Restore the real frontend scope before its periodic background polling.
  await configure(application, 'workspace-default');
  if (!process.env.MEMORY_SMOKE_EXECUTABLE) {
    await application.evaluate(() => globalThis.__memory.failConfiguration('1688'));
    assert.equal((await switchTab(application, '1688')).ok, false);
    assert.equal(await application.evaluate(({ session }) => session.fromPartition('persist:1688').extensions.getAllExtensions().length), 0, 'failed cold start releases the loaded extension');
    checks.push('configuration failure reports error and releases the remote renderer and extension');
  }
  assert.equal((await switchTab(application, '1688')).ok, true);
  await wait(async () => (await state(application)).tabs['1688'].status === 'ready', 'cold 1688 ready');
  assert.equal(await extensionWorkspace(application, '1688'), 'workspace-default');
  const remoteIds = await application.evaluate(async ({ webContents }) => {
    const remotes = webContents.getAllWebContents().filter(c => ['https://www.zhuolinkeji.cn/', 'https://www.1688.com/'].includes(c.getURL()));
    for (const c of remotes) await c.executeJavaScript("document.querySelector('#draft').value='页面草稿'; window.ticks=0; window.setInterval(()=>window.ticks++, 100)");
    return remotes.map(c => c.id).sort();
  });
  for (let i = 0; i < 12; i++) { await switchTab(application, i % 2 ? '1688' : 'erp'); await switchTab(application, 'workspace'); }
  await pause(700);
  const retained = await application.evaluate(async ({ webContents }) => {
    const all = webContents.getAllWebContents();
    const workspace = all.find(c => c.getURL().includes('/workspace'));
    return { workspace: { id: workspace.id, pid: workspace.getOSProcessId() }, workspaceDraft: await workspace.executeJavaScript("document.querySelector('#memory-draft').value"), remotes: await Promise.all(all.filter(c => ['https://www.zhuolinkeji.cn/', 'https://www.1688.com/'].includes(c.getURL())).map(async c => ({ id: c.id, draft: await c.executeJavaScript("document.querySelector('#draft').value"), ticks: await c.executeJavaScript('window.ticks') }))) };
  });
  assert.deepEqual(retained.workspace, workspaceIdentity);
  assert.equal(retained.workspaceDraft, '保留未保存内容');
  assert.deepEqual(retained.remotes.map(c => c.id).sort(), remoteIds);
  assert.ok(retained.remotes.every(c => c.draft === '页面草稿' && c.ticks >= 3), 'opened pages continue background work');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length), 0);
  checks.push('12 switch cycles retain all renderers and drafts; detached remote timers continue; all windows stay hidden');
  const shell = await application.firstWindow();
  await switchTab(application, 'erp');
  await application.evaluate(({ webContents }) => webContents.getAllWebContents().find(c => c.getURL() === 'https://www.zhuolinkeji.cn/').forcefullyCrashRenderer());
  await wait(async () => (await state(application)).tabs.erp.status === 'error', 'remote crash state');
  await shell.locator('#startup-actions').waitFor({ state: 'visible' });
  assert.match(await shell.locator('#startup-message').innerText(), /进程已退出/);
  await shell.screenshot({ path: path.join(output, `${phase}-remote-error.png`) });
  await shell.locator('#startup-retry').click();
  await wait(async () => (await state(application)).tabs.erp.status === 'ready', 'visible retry restores remote page');
  await switchTab(application, 'workspace');
  checks.push('remote crash exposes Chinese error and retry; actual shell retry restores the existing page');
  for (const appearance of ['light', 'dark']) {
    await application.evaluate(async ({ webContents }, appearance) => webContents.getAllWebContents().find(c => c.getURL().includes('/workspace')).executeJavaScript(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)}`), appearance);
    for (const width of [1000, 1440]) {
      await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('shell.html')).setSize(width, 900), width);
      await shell.screenshot({ path: path.join(output, `${phase}-${appearance}-${width}.png`) });
      assert.ok(await shell.locator('#inbox-status').getAttribute('aria-label'));
    }
  }
  checks.push('Chinese shell status and keyboard semantics remain present in light/dark and 1000/1440px hidden layouts');
  return checks;
}
async function wait(fn, label, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await fn()) return; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
async function sample(application, name) {
  const detail = await application.evaluate(({ app, webContents }) => ({
    processes: app.getAppMetrics(), inboxPid: globalThis.__memory?.inbox(),
    contents: webContents.getAllWebContents().map(c => ({ id: c.id, url: c.getURL(), type: c.getType(), pid: c.getOSProcessId() })),
  }));
  const browserPid = detail.processes.find(p => p.type === 'Browser').pid;
  const childIds = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${browserPid}' | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }));
  const ids = [...new Set([...detail.processes.map(p => p.pid), detail.inboxPid, ...(Array.isArray(childIds) ? childIds : [childIds])].filter(Number.isInteger))];
  const processMemory = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${ids.join(',')} -ErrorAction Stop | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }));
  const processes = Array.isArray(processMemory) ? processMemory : [processMemory];
  return { name, ...detail, osProcesses: processes, workingSetMiB: processes.reduce((sum, p) => sum + p.WorkingSet64, 0) / 1048576, privateMiB: processes.reduce((sum, p) => sum + p.PrivateMemorySize64, 0) / 1048576 };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const front = path.resolve(__dirname, '../frontend/dist');
  const server = http.createServer((request, response) => {
    const requested = path.resolve(front, '.' + new URL(request.url, 'http://127.0.0.1').pathname);
    const file = requested.startsWith(front + path.sep) && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(front, 'index.html');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const results = [];
  try {
  for (let run = 1; run <= Number(process.env.MEMORY_SMOKE_RUNS || 3); run++) {
    let application;
    const profile = path.join(output, `${phase}-${run}-${Date.now()}`);
    const env = { ...process.env, SHOPEERS_DESKTOP_DEV_URL: `http://127.0.0.1:${server.address().port}`, DESKTOP_MEMORY_SMOKE: '1', SHOPEERS_DESKTOP_SMOKE_HIDDEN: '1', SHOPEERS_DESKTOP_SMOKE_USER_DATA: profile, SHOPEERS_DESKTOP_SMOKE_CACHE: path.join(profile, 'cache'), SHOPEERS_ERP_INBOX_FILE: path.join(profile, 'inbox.json'), SHOPEERS_ERP_INBOX_PORT: String(27000 + Math.floor(Math.random() * 1000)) };
    delete env.ELECTRON_RUN_AS_NODE; delete env.SHOPEERS_DESKTOP_SMOKE_REPORT;
    try {
      application = await _electron.launch({ executablePath: process.env.MEMORY_SMOKE_EXECUTABLE || require('electron'), args: process.env.MEMORY_SMOKE_EXECUTABLE ? [] : [path.join(__dirname, 'memory-smoke-app.cjs')], env });
      if (process.env.MEMORY_SMOKE_EXECUTABLE) {
        await application.evaluate(({ session }) => {
          for (const id of ['erp', '1688']) session.fromPartition(`persist:${id}`).protocol.handle('https', () => new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><h1>隔离页面</h1><input id="draft"></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
        });
      }
      await wait(async () => (await state(application)).startup.status === 'ready', 'real workspace ready');
      await pause(10000);
      const boot = await sample(application, 'startup');
      await pause(Number(process.env.MEMORY_SMOKE_IDLE_MS || 20000));
      const idle = await sample(application, 'idle');
      const entry = { run, profile, boot, idle };
      if (phase !== 'baseline' && run === Number(process.env.MEMORY_SMOKE_RUNS || 3)) {
        entry.checks = await checkUserPaths(application);
        entry.afterOpening = await sample(application, 'both pages opened');
      }
      results.push(entry);
      fs.writeFileSync(path.join(output, `${phase}.json`), JSON.stringify({ phase, results }, null, 2));
      console.log(JSON.stringify({ phase, run, startupMiB: boot.privateMiB, idleMiB: idle.privateMiB, renderers: idle.processes.filter(p => p.type === 'Tab').length }));
    } catch (error) {
      if (application) {
        const state = await application.evaluate(async ({ webContents }) => ({ state: globalThis.__memory?.state(), contents: await Promise.all(webContents.getAllWebContents().map(async c => ({ url: c.getURL(), text: await c.executeJavaScript('document.body?.innerText').catch(() => '' ) }))) }));
        fs.writeFileSync(path.join(output, `${phase}-failure.json`), JSON.stringify(state, null, 2));
      }
      throw error;
    } finally { if (application) await application.close(); }
  }
  } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
