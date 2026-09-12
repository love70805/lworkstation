const { app, BrowserWindow, session } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const origin=process.env.WORKSPACE_SMOKE_ORIGIN||'http://127.0.0.1:5188';
if(new URL(origin).hostname!=='127.0.0.1') throw new Error('loopback only');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'lworkstation-workspace-ledger-'));
app.setPath('userData',path.join(output,'profile'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url);callback({cancel:['http:','https:'].includes(url.protocol)&&url.origin!==origin});});
 const window=new BrowserWindow({width:1024,height:768,useContentSize:true,show:false,frame:false,webPreferences:{backgroundThrottling:false}});
 const run=code=>window.webContents.executeJavaScript(code);
 async function wait(code){const end=Date.now()+25000;while(Date.now()<end){if(await run("Boolean("+code+")"))return;await delay(100);}throw new Error('Timeout '+code+' '+await run('document.body.innerText.slice(0,1200)'));}
 async function capture(name){await delay(220);await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());}
 async function overview(state){
  await wait("document.body.innerText.includes('经营概览') && !document.querySelector('.workspace-load-state')");
  for(const theme of ['light','dark']) {
   await run(`(async()=>{const {applyAppearance}=await import('/src/lib/appearance.js');applyAppearance('${theme}',{animate:false});})()`);
   for(const [width,height] of [[1024,768],[1280,800],[390,780]]) {
    window.setContentSize(width,height);await delay(250);
    assert.equal(await run('document.querySelectorAll(".app-shell").length'),1);
    assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
    for(const title of ['经营概览','月度账本管理','最近活动','当前待办','商品成本观察','健康状态','快捷操作']) assert.ok(await run(`document.body.innerText.includes(${JSON.stringify(title)})`));
    assert.equal(await run("document.body.innerText.includes('FOREIGN-SECRET') || document.body.innerText.includes('2099-12')"),false);
    assert.deepEqual(await run("[...document.querySelectorAll('.side-navigation a')].map(a=>a.textContent.trim())"),['工作区首页','选品工作台','利润核算','系统诊断与备份']);
    await capture(`${state}-${theme}-${width}`);
    await run("document.querySelector('.workspace-daily-trend').scrollIntoView({block:'start'})");await capture(`${state}-${theme}-${width}-trend`);await run('scrollTo(0,0)');
   }
  }
 }
 await window.loadURL(origin+'/workspace');await wait("document.body.innerText.includes('还没有月度账本')");await overview('empty');
 assert.equal(await run("(async()=>{const {db}=await import('/src/data/database.js');return db.ledgers.count()})()"),0);
 const ids=await run(`(async()=>{
 const {db,createOrGetMonthlyLedger,getActiveMemberContext}=await import('/src/data/database.js');const member=await getActiveMemberContext();const ids=[];
 for(const period of ['2026-09','2026-08','2026-07','2026-06','2026-05','2026-04']) {
  const ledger=await createOrGetMonthlyLedger({workspaceId:member.workspaceId,period});ids.push(ledger.id);
  await db.ledgers.update(ledger.id,{costSummary:{missingCount:3},summary:{revenue:16,quantity:4}});
  await db.salesRows.bulkPut(Array.from({length:4},(_,i)=>({id:period+'-'+i,ledgerId:ledger.id,workspaceId:member.workspaceId,store:i%2?'乙店':'甲店',platformSku:'SKU-'+i,platformSkc:'SKC-1',attribute:'合成属性',quantity:i===1?0:2,quantityExact:i===1?'0':'2',amount:i===1?0:5,amountExact:i===1?'0':'5',penalty:0,sourceAddedDate:i===2?null:i===3?(period==='2026-04'?period+'-02':'2026-10-01'):period+'-01',dateStatus:i===2?'missing':i===3?(period==='2026-04'?'valid':'out_of_period'):'valid',timezone:'Asia/Shanghai',unitPriceRaw:'2.5',activityRaw:'合成活动',activityStatus:'known'})));
 }
 await db.salesRows.where('ledgerId').equals(ids[4]).delete();
 await db.ledgers.update(ids[4],{summary:{},costSummary:{}});
 await db.ledgers.put({id:'FOREIGN',workspaceId:'foreign',period:'2099-12',status:'draft'});
 await db.auditEvents.put({id:'FOREIGN-AUDIT',workspaceId:'foreign',action:'created',after:{period:'FOREIGN-SECRET'},createdAt:'2099-12-01'});
 return ids;
 })()`);
 await window.loadURL(origin+'/workspace?ledger='+encodeURIComponent(ids[0])+'&store=甲店');
 await wait("document.querySelector('[aria-label=首页核算月份]')?.options.length===6 && document.querySelector('.sales-analytics')?.innerText.includes('甲店')");
 await wait("document.querySelector('.sales-analytics')?.innerText.includes('缺少有效月内添加日期')");
 await overview('partial');
 assert.equal(await run("new URL(document.querySelector('.workspace-ledger-actions a:last-child').href).searchParams.get('store')"),'甲店');
 await run("document.querySelector('.workspace-ledger-actions a:last-child').click()");
 await wait("location.pathname==='/profit' && new URLSearchParams(location.search).get('view')==='detail' && document.querySelector('.workspace-profit-content')");
 await run("document.querySelector('.side-navigation a[href^=\"/workspace\"]').click()");
 await wait("location.pathname==='/workspace' && document.querySelector('[aria-label=首页店铺]')");
 await run("document.querySelector('.workspace-ledger-actions a:nth-child(2)').click()");
 await wait("location.pathname==='/profit' && new URLSearchParams(location.search).get('view')==='cost'");
 await wait("Boolean(document.querySelector('.cost-matching-content')) || document.body.innerText.includes('ERP 成本')");
 assert.equal(await run('document.querySelectorAll(".app-shell").length'),1);
 await window.loadURL(origin+'/cost-matching?ledger='+encodeURIComponent(ids[0])+'&store=甲店&q=SKU&supplier=A&missing=1');
 await wait("location.pathname==='/profit' && new URLSearchParams(location.search).get('view')==='cost'");
 assert.equal(await run("new URLSearchParams(location.search).get('q')"),'SKU');
 await window.loadURL(origin+'/workspace?ledger='+encodeURIComponent(ids[0])+'&store=甲店');
 await wait("Boolean(document.querySelector('[aria-label=首页核算月份]'))");
 await run(`{const s=document.querySelector('[aria-label=首页核算月份]');for(const id of ${JSON.stringify([ids[1],ids[2],ids[5]])}){s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}));}const store=document.querySelector('[aria-label=首页店铺]');store.value='乙店';store.dispatchEvent(new Event('change',{bubbles:true}));}`);
 await wait(`document.querySelector('[aria-label=首页核算月份]')?.value===${JSON.stringify(ids[5])}`);
 await run("{const s=document.querySelector('[aria-label=首页店铺]');s.value='乙店';s.dispatchEvent(new Event('change',{bubbles:true}));}");
 await wait("document.querySelector('.sales-analytics')?.innerText.includes('2026-04 · 乙店')");
 assert.ok(await run("[...document.querySelectorAll('.sales-daily-bar')].some(e=>e.title.includes('2026-04-01：0'))"));
 await run("document.querySelector('.workspace-daily-trend').scrollIntoView({block:'start'})");await capture('confirmed-zero');
 await window.reload();await wait("document.querySelector('[aria-label=首页店铺]')?.value==='乙店'");
 await run("document.querySelector('.workspace-ledger-heading a').click()");await wait("location.pathname==='/ledger'");
 await wait("document.body.innerText.includes('2026')");assert.equal(await run("document.body.innerText.includes('2099')"),false);
 await window.loadURL(origin+'/workspace?ledger='+encodeURIComponent(ids[4]));
 await wait("document.querySelector('.sales-analytics')?.innerText.includes('尚未取得销售数据')");
 assert.equal(await run("document.querySelectorAll('.sales-daily-bar').length"),0);
 await run("document.querySelector('.workspace-daily-trend').scrollIntoView({block:'start'})");await capture('unknown-dates');
 await window.loadURL(origin+'/workspace?ledger=FOREIGN&store=secret&q=secret');
 await wait("document.querySelector('[aria-label=首页核算月份]')?.options.length===6 && !location.search.includes('secret')");
 assert.equal(await run("[...document.querySelectorAll('.side-navigation a')].some(a=>a.href.includes('secret')||a.href.includes('FOREIGN'))"),false);
 await window.loadURL(origin+'/cost-matching?ledger=FOREIGN&store=secret');
 await wait("location.pathname==='/profit' && !location.search.includes('secret') && !location.search.includes('FOREIGN')");
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks:['empty does not seed ledger','six months and two stores','shared date diagnostics','light dark three sizes','four nav items','old cost compatibility','scope retained across refresh and routes','rapid month latest wins','foreign scope and management filtered']},null,2));console.log(output);app.exit(0);
}).catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);console.error(error);app.exit(1);});
