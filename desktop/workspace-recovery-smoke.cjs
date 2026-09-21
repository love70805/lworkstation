// Actual Electron view lifecycle with an isolated profile and loopback-only fixture.
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const output = process.env.WORKSPACE_RECOVERY_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-recovery-'));
fs.mkdirSync(output, {recursive:true});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let requests = 0, application;
const checks = [];
const server = http.createServer((req,res) => {
  requests++;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><head><style>body{font:20px sans-serif;padding:32px;background:#eef2f8;color:#142038}input{padding:16px}</style></head><body><div id="root"><main class="app-shell"><h1>工作站恢复验收</h1><p>切换 ERP / 1688 后保留当前页面和未保存输入</p><input id="draft" value=""></main></div></body></html>');
});
async function wait(check, name, timeout=20000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {if(await check()) return; await delay(100);}
  throw Error('timeout: '+name);
}
const evaluate = (fn,arg) => application.evaluate(fn,arg);
const ready = () => wait(()=>evaluate(()=>globalThis.__experience.state().startup.status==='ready'),'workspace ready');
async function retry(shell) { await shell.locator('#startup-retry').click(); await ready(); }
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=path.join(output,'profile'); fs.mkdirSync(profile,{recursive:true});
  const env={...process.env,DESKTOP_EXPERIENCE_SMOKE:'recovery',SHOPEERS_DESKTOP_DEV_URL:`http://127.0.0.1:${server.address().port}`,SHOPEERS_DESKTOP_SMOKE_USER_DATA:profile,SHOPEERS_DESKTOP_SMOKE_CACHE:path.join(profile,'cache'),SHOPEERS_ERP_INBOX_FILE:path.join(profile,'inbox.json'),SHOPEERS_ERP_INBOX_PORT:String(24000+Math.floor(Math.random()*1000))};
  delete env.ELECTRON_RUN_AS_NODE; delete env.SHOPEERS_DESKTOP_UPDATE_SMOKE;
  application=await _electron.launch({executablePath:process.env.DESKTOP_EXPERIENCE_ELECTRON || require('electron'),args:[path.join(__dirname,'experience-smoke-app.cjs')],env});
  await wait(()=>evaluate(()=>Boolean(globalThis.__experience?.window()?.isVisible())),'window');
  await ready(); const shell=await application.firstWindow();
  const original=await evaluate(()=>({id:globalThis.__experience.workspace().id,pid:globalThis.__experience.workspace().getOSProcessId()}));
  await evaluate(()=>globalThis.__experience.workspace().executeJavaScript("history.pushState({}, '', '/profit?month=2026-08');document.querySelector('#draft').value='11111.25'"));
  const loaded=requests;
  for(let i=0;i<12;i++) {
    await evaluate(i=>{const x=globalThis.__experience;x.switchTab(i%2?'1688':'erp');x.window().minimize();},i);
    await delay(100);
    await evaluate(()=>{const x=globalThis.__experience;x.window().restore();x.window().show();x.switchTab('workspace');});
    await delay(150);
    assert.equal(await evaluate(()=>globalThis.__experience.view().getVisible()),true);
    assert.equal(await evaluate(()=>globalThis.__experience.state().startup.status),'ready');
  }
  assert.deepEqual(await evaluate(()=>({id:globalThis.__experience.workspace().id,pid:globalThis.__experience.workspace().getOSProcessId()})),original);
  assert.equal(await evaluate(()=>globalThis.__experience.workspace().executeJavaScript("document.querySelector('#draft').value")),'11111.25');
  assert.equal(requests,loaded,'healthy return does not reload');
  const restored = await evaluate(()=>globalThis.__experience.workspace().capturePage().then(img=>img.toPNG().toString('base64')));
  fs.writeFileSync(path.join(output,'restored.png'),Buffer.from(restored,'base64'));
  checks.push('12 ERP/1688 + minimize/restore cycles: visible, same renderer, route and draft preserved, no reload');
  await evaluate(()=>{const x=globalThis.__experience;x.switchTab('erp');return x.workspace().executeJavaScript("document.querySelector('#root').replaceChildren()");});
  await evaluate(()=>globalThis.__experience.switchTab('workspace'));
  await wait(()=>evaluate(()=>globalThis.__experience.state().startup.status==='error'),'blank DOM detected');
  await shell.screenshot({path:path.join(output,'blank-retry.png')});
  await retry(shell);
  assert.match(await evaluate(()=>globalThis.__experience.workspace().getURL()),/\/profit\?month=2026-08$/);
  checks.push('blank root detected on return; native retry keeps valid route');
  await evaluate(()=>{const x=globalThis.__experience;x.switchTab('1688');x.window().minimize();x.workspace().forcefullyCrashRenderer();});
  await wait(()=>evaluate(()=>globalThis.__experience.state().startup.status==='error'),'crash detected');
  await evaluate(()=>{const x=globalThis.__experience;x.window().restore();x.window().show();x.switchTab('workspace');});
  await retry(shell); checks.push('background renderer crash + minimized window: retry restores workspace');
  await evaluate(()=>{const x=globalThis.__experience;x.switchTab('erp');x.workspace().close();});
  await wait(()=>evaluate(()=>!globalThis.__experience.workspace() || globalThis.__experience.workspace().isDestroyed()),'WebContents closed');
  await evaluate(()=>globalThis.__experience.switchTab('workspace'));
  await wait(()=>evaluate(()=>globalThis.__experience.state().startup.status==='error'),'destroyed detected');
  await retry(shell); checks.push('destroyed WebContents: shell remains usable, retry recreates view');
  // Delay the actual preload probe to deterministically exercise the timeout.
  await evaluate(()=>globalThis.__experience.workspace().executeJavaScript("document.querySelector('#draft').value='retain-after-delay'"));
  await evaluate(()=>{const x=globalThis.__experience;x.switchTab('erp');x.holdProbe();});
  await evaluate(()=>globalThis.__experience.switchTab('workspace'));
  await wait(()=>evaluate(()=>globalThis.__experience.state().startup.status==='error'),'unresponsive timeout',12000);
  await shell.screenshot({path:path.join(output,'unresponsive-retry.png')});
  await evaluate(()=>globalThis.__experience.releaseProbe());
  await ready();
  assert.equal(await evaluate(()=>globalThis.__experience.workspace().executeJavaScript("document.querySelector('#draft').value")),'retain-after-delay');
  checks.push('delayed probe: bounded error feedback, late actual preload reply restores same unsaved draft');
  await evaluate(()=>{const x=globalThis.__experience;x.switchTab('erp');x.holdProbe();x.switchTab('workspace');});
  await wait(()=>evaluate(()=>globalThis.__experience.state().startup.status==='error'),'second timeout',12000);
  await evaluate(()=>{const x=globalThis.__experience;x.switchTab('1688');x.window().minimize();x.releaseProbe();});
  await delay(100);
  await evaluate(()=>{const x=globalThis.__experience;x.window().restore();x.window().show();x.switchTab('workspace');});
  await ready();
  assert.equal(await evaluate(()=>globalThis.__experience.workspace().executeJavaScript("document.querySelector('#draft').value")),'retain-after-delay');
  checks.push('timeout then tab change/minimize: new foreground probe restores same draft');
  await evaluate(()=>globalThis.__experience.workspace().executeJavaScript("location.href='https://example.invalid/blocked'"));
  await delay(500);
  assert.equal(await evaluate(()=>globalThis.__experience.state().startup.status),'ready');
  assert.match(await evaluate(()=>globalThis.__experience.workspace().getURL()),/127\.0\.0\.1/);
  checks.push('blocked external navigation preserves healthy workspace');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,output,note:'Synthetic lifecycle and fault injection; no claim of reproducing the user\'s original intermittent machine-specific fault.'},null,2));
  console.log(JSON.stringify({ok:true,checks,output},null,2));
})().catch(async error=>{console.error(error);if(application)console.log(await evaluate(()=>({trace:globalThis.__recoveryTrace,state:globalThis.__experience.state().startup,visible:globalThis.__experience.window().isVisible(),minimized:globalThis.__experience.window().isMinimized()})));fs.writeFileSync(path.join(output,'error.txt'),error.stack);process.exitCode=1;}).finally(async()=>{if(application)await application.evaluate(({app})=>app.quit()).catch(()=>{});server.close();});
