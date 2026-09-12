const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lworkstation-theme-'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let application;
async function wait(fn) { const until=Date.now()+30000; while(Date.now()<until){if(await fn())return; await delay(100);} throw new Error('theme smoke timeout'); }
(async()=>{
 const evidence=[];
 for(const theme of ['light','dark']) {
  const profile=path.join(root,theme);fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'desktop-preferences.json'),JSON.stringify({appearance:theme}));
  const env={...process.env,DESKTOP_EXPERIENCE_SMOKE:'theme',SHOPEERS_DESKTOP_DEV_URL:'http://127.0.0.1:5188',SHOPEERS_DESKTOP_SMOKE_USER_DATA:profile,SHOPEERS_DESKTOP_SMOKE_CACHE:path.join(profile,'cache'),SHOPEERS_ERP_INBOX_FILE:path.join(profile,'inbox.json'),SHOPEERS_ERP_INBOX_PORT:String(24000+Math.floor(Math.random()*1000))};delete env.ELECTRON_RUN_AS_NODE;
  application=await _electron.launch({executablePath:process.env.DESKTOP_EXPERIENCE_ELECTRON||'C:/Users/Administrator/Desktop/Lworkstation/desktop/node_modules/electron/dist/electron.exe',args:[path.join(__dirname,'experience-smoke-app.cjs')],env});
  await wait(()=>application.evaluate(()=>globalThis.__experience?.state().startup.status==='ready'));
  const run=code=>application.evaluate((_,code)=>globalThis.__experience.workspace().executeJavaScript(code),code);
  await wait(()=>run("Boolean(document.querySelector('.appearance-control button'))"));
  assert.equal(await run('document.documentElement.dataset.appearance'),theme);
  assert.equal(await application.evaluate(()=>globalThis.__experience.state().appearance),theme);
  await run(`const table=document.createElement('table');table.id='theme-stress-table';table.className='profit-table';table.innerHTML='<tbody>'+Array.from({length:1000},(_,i)=>'<tr><td>合成 '+i+'</td><td>0.1234</td><td>100.00</td></tr>').join('')+'</tbody>';document.querySelector('.app-shell main, .app-shell').append(table);`);
  await run(`window.__themeMetrics={longTasks:[],frames:[]};try {new PerformanceObserver(list=>__themeMetrics.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'})}catch{}; window.__themeLast=performance.now(); window.__themeMeasure=true;function tick(now){if(!__themeMeasure)return;__themeMetrics.frames.push(now-__themeLast);__themeLast=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);`);
  for(let i=0;i<11;i++){await run("document.querySelector('.appearance-control button').click()");await delay(25);}
  await delay(250);
  const target=theme==='light'?'dark':'light';
  assert.equal(await run('document.documentElement.dataset.appearance'),target);
  assert.equal(await application.evaluate(()=>globalThis.__experience.state().appearance),target);
  assert.deepEqual(await run('document.getAnimations().map(a=>({type:a.constructor.name,name:a.animationName,tag:a.effect?.target?.tagName,property:a.transitionProperty,target:a.effect?.target?.outerHTML?.slice(0,300)}))'),[]);
  const metrics=await run('window.__themeMeasure=false;__themeMetrics');
  await run("document.querySelector('#theme-stress-table').remove()");
  for(const [width,height] of [[1024,768],[1280,800],[390,780]]) {
   await application.evaluate((_,size)=>{const win=globalThis.__experience.window();win.setMinimumSize(300,500);win.setContentSize(...size);},[width,height]);await delay(250);
   assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
   const png=await application.evaluate(async()=> (await globalThis.__experience.workspace().capturePage()).toPNG().toString('base64'));
   fs.writeFileSync(path.join(root,`${theme}-to-${target}-${width}.png`),Buffer.from(png,'base64'));
  }
  await application.evaluate(async()=>{const wc=globalThis.__experience.workspace();wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});});
  assert.equal(await run("matchMedia('(prefers-reduced-motion: reduce)').matches"),true);
  await run("document.querySelector('.appearance-control button').click()");await delay(30);
  assert.deepEqual(await run('document.getAnimations().map(a=>({type:a.constructor.name,name:a.animationName,tag:a.effect?.target?.tagName,property:a.transitionProperty,target:a.effect?.target?.outerHTML?.slice(0,300)}))'),[]);
  await run("document.querySelector('.app-shell').animate=undefined;document.querySelector('.appearance-control button').click()");await delay(30);
  assert.equal(await run('document.documentElement.dataset.appearance'),target);
  evidence.push({initial:theme,final:target,metrics,reducedMotion:true,fallback:true});
  const closed=application.waitForEvent('close');await application.evaluate(({app})=>app.quit());await closed;application=null;
 }
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({ok:true,evidence},null,2));console.log(root);
})().catch(error=>{fs.writeFileSync(path.join(root,'error.txt'),error.stack);console.error(error);process.exitCode=1;}).finally(async()=>{if(application)await application.evaluate(({app})=>app.quit()).catch(()=>{});});
