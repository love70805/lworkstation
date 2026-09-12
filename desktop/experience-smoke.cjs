const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-experience-'));
const executablePath = process.env.DESKTOP_EXPERIENCE_ELECTRON || 'C:/Users/Administrator/Desktop/Lworkstation/desktop/node_modules/electron/dist/electron.exe';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let failRequests = false;
const server = http.createServer((req, res) => {
  if (req.url === '/retry-test' && failRequests) { req.socket.destroy(); return; }
  setTimeout(() => res.end('<!doctype html><html><body><div id="root"><main class="app-shell">Synthetic workspace</main></div></body></html>'), 600);
});
let application;
async function wait(check) { const end=Date.now()+30000; while(Date.now()<end) {if(await check()) return; await delay(100);} throw new Error('smoke timeout'); }
async function launch(mode, appearance) {
  const profile=path.join(output,mode+'-'+appearance); fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'desktop-preferences.json'),JSON.stringify({appearance}));
  const env={...process.env,DESKTOP_EXPERIENCE_SMOKE:mode,SHOPEERS_DESKTOP_DEV_URL:`http://127.0.0.1:${server.address().port}`,SHOPEERS_DESKTOP_SMOKE_USER_DATA:profile,SHOPEERS_DESKTOP_SMOKE_CACHE:path.join(profile,'cache'),SHOPEERS_ERP_INBOX_FILE:path.join(profile,'inbox.json'),SHOPEERS_ERP_INBOX_PORT:String(22500+Math.floor(Math.random()*1000))};
  delete env.ELECTRON_RUN_AS_NODE; delete env.SHOPEERS_DESKTOP_UPDATE_SMOKE;
  application=await _electron.launch({executablePath,args:[path.join(__dirname,'experience-smoke-app.cjs')],env});
  await wait(()=>application.evaluate(()=>Boolean(globalThis.__experience?.window())));
  return env;
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  for(const appearance of ['light','dark']) {
    const env=await launch('normal',appearance);
    await wait(()=>application.evaluate(()=>globalThis.__experience.window().isVisible()));
    const shell=await application.firstWindow();
    await shell.screenshot({path:path.join(output,`startup-${appearance}.png`)});
    await application.evaluate(()=>globalThis.__experience.window().close());
    await wait(()=>application.evaluate(()=>globalThis.__experience.state().startup.status==='ready'));
    assert.equal(await application.evaluate(()=>globalThis.__experience.window().isVisible()),false,'finishing startup must not undo close-to-tray');
    await application.evaluate(()=>globalThis.__tray.emit('click'));
    const pid=await application.evaluate(()=>globalThis.__experience.inbox()); assert.ok(pid);
    await application.evaluate(()=>globalThis.__experience.window().close());
    assert.equal(await application.evaluate(()=>globalThis.__experience.window().isVisible()),false);
    assert.equal(await application.evaluate(()=>globalThis.__experience.workspace().isDestroyed()),false);
    const inbox=await application.evaluate(()=>globalThis.__experience.backgroundRoundTrip()); assert.ok(inbox);
    await application.evaluate(()=>globalThis.__tray.emit('click'));
    assert.equal(await application.evaluate(()=>globalThis.__experience.window().isVisible()),true);
    await application.evaluate(()=>globalThis.__experience.window().close());
    const second=spawn(executablePath,[path.join(__dirname,'experience-smoke-app.cjs')],{env,windowsHide:true,stdio:'ignore'});
    const exit=await new Promise((resolve,reject)=>{second.once('exit',resolve);setTimeout(()=>{if(second.exitCode===null){second.kill();reject(new Error('second instance hung'));}},15000).unref();}); assert.equal(exit,0);
    await wait(()=>application.evaluate(()=>globalThis.__experience.window().isVisible()));
    assert.equal(await application.evaluate(()=>globalThis.__experience.state().startup.status),'ready');
    failRequests = true;
    await application.evaluate(()=>globalThis.__experience.fail());
    await wait(()=>application.evaluate(()=>globalThis.__experience.state().startup.status==='error'));
    await shell.screenshot({path:path.join(output,`startup-error-${appearance}.png`)});
    failRequests = false;
    await shell.locator('#startup-retry').click();
    await wait(()=>application.evaluate(()=>globalThis.__experience.state().startup.status==='ready'));
    if(appearance==='light') {
      await application.evaluate(()=>globalThis.__experience.timeout());
      await delay(30100);
      assert.equal(await application.evaluate(()=>globalThis.__experience.state().startup.status),'error');
      await shell.screenshot({path:path.join(output,'startup-timeout.png')});
      await shell.locator('#startup-retry').click();
      await wait(()=>application.evaluate(()=>globalThis.__experience.state().startup.status==='ready'));
    }
    const closed=application.waitForEvent('close');
    if(appearance==='dark') await application.evaluate(()=>{void globalThis.__experience.updateExit();});
    else await application.evaluate(()=>globalThis.__trayMenu.items.at(-1).click());
    await closed; application=null;
    assert.throws(()=>process.kill(pid,0),'inbox child must exit');
  }
  await launch('no-tray','light');
  await wait(()=>application.evaluate(()=>globalThis.__experience.state().startup.status==='ready'));
  assert.equal(await application.evaluate(()=>globalThis.__experience.lifecycle().trayAvailable),false);
  const closed=application.waitForEvent('close'); await application.evaluate(()=>globalThis.__experience.window().close()); await closed; application=null;
  for(const mode of ['preference','session-end','quit-startup']) {
    await launch(mode,'light');
    await wait(()=>application.evaluate(()=>Boolean(globalThis.__trayMenu)));
    if(mode!=='quit-startup') await wait(()=>application.evaluate(()=>globalThis.__experience.state().startup.status==='ready'));
    const closed=application.waitForEvent('close');
    if(mode==='preference') await application.evaluate(()=>{globalThis.__trayMenu.items[2].submenu.items[1].click();globalThis.__experience.window().close();});
    if(mode==='session-end') await application.evaluate(()=>globalThis.__experience.window().emit('session-end'));
    if(mode==='quit-startup') await application.evaluate(()=>globalThis.__trayMenu.items.at(-1).click());
    await closed; application=null;
    if(mode==='preference') assert.equal(JSON.parse(fs.readFileSync(path.join(output,'preference-light','desktop-preferences.json'))).closeBehavior,'quit');
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks:['native close/hide and tray restore including startup','same-profile second instance','hidden renderer and real ERP inbox round trip','explicit quit cleanup','intercepted updater exits process without hiding','actual network failure retry','30-second startup timeout retry','tray failure close exits','persisted close preference','simulated session-end event quits','quit during startup'],output},null,2));
  console.log(output);
})().catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);console.error(error);process.exitCode=1;}).finally(async()=>{if(application) await application.evaluate(({app})=>app.quit()).catch(()=>{});server.close();});
