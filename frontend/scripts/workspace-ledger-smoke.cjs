const { app, BrowserWindow, session } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const origin=process.env.WORKSPACE_SMOKE_ORIGIN||'http://127.0.0.1:5188';
if(new URL(origin).hostname!=='127.0.0.1') throw new Error('loopback only');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'lworkstation-workspace-ledger-'));
const profile=path.join(output,'profile');fs.mkdirSync(profile);
app.setPath('userData',profile);app.setPath('sessionData',profile);
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
    for(const title of ['经营概览','当前核算范围','管理账本','最近活动','当前待办','商品成本观察']) assert.ok(await run(`document.body.innerText.includes(${JSON.stringify(title)})`),title);
    assert.equal(await run("document.querySelectorAll('.dashboard-metric-card').length"),4);
    assert.equal(await run("document.body.textContent.includes('FOREIGN-SECRET') || document.body.textContent.includes('2099-12')"),false);
    assert.deepEqual(await run("[...document.querySelectorAll('.side-navigation a,.sidebar-bottom a')].map(a=>a.title)"),['工作区首页','月度账本','商品资料','利润核算','系统与备份']);
    await capture(`${state}-${theme}-${width}`);
    await run("document.querySelector('.workspace-daily-trend').scrollIntoView({block:'start'})");await capture(`${state}-${theme}-${width}-trend`);await run('scrollTo(0,0)');
   }
  }
 }
 await window.loadURL(origin+'/workspace');await wait("document.body.innerText.includes('还没有月度账本')");await overview('empty');
 assert.equal(await run("(async()=>{const {db}=await import('/src/data/database.js');return db.ledgers.count()})()"),0);
 const ids=await run(`(async()=>{
 const {db,createOrGetMonthlyLedger,getActiveMemberContext,previewSalesImports,saveSalesImports}=await import('/src/data/database.js');
 const {validateSalesRows}=await import('/src/lib/salesImport.js');
 const {workspaceId}=await getActiveMemberContext();const ids=[];
 const mapping={platformSku:'SKU',platformSkc:'SKC',supplierNumber:'货号',quantity:'数量',amount:'金额',sourceAddedAt:'添加时间',attribute:'属性'};
 for(const period of ['2026-09','2026-08','2026-07','2026-06','2026-05','2026-04']) {
  const ledger=await createOrGetMonthlyLedger({workspaceId,period});ids.push(ledger.id);
  if(period==='2026-05')continue;
  const items=['甲店','乙店'].map((storeName,index)=>{
   const raw=[index,index+2].map(i=>({SKU:'SKU-'+i,SKC:'SKC-1',货号:'A',数量:2,金额:i===1?0:5,属性:'合成属性',
    添加时间:i===2?'':i===3?(period==='2026-04'?period+'-02':''):period+'-01'}));
   const checked=validateSalesRows(raw,mapping,{defaultStore:storeName,period});
   if(checked.errors.length||checked.rows.length!==raw.length)throw Error('Fixture validation failed: '+JSON.stringify(checked.errors));
   return {itemId:storeName,fileName:storeName+'-合成台账.csv',fileHash:period+'/'+storeName,storeName,mapping,rows:checked.rows,
    summary:{sourceRowCount:raw.length,errorCount:0,ignoredCount:0}};
  });
  const preview=await previewSalesImports({workspaceId,period,items});
  await saveSalesImports({workspaceId,period,items,preview,overwriteSignature:preview.targetSignature});
 }
 await db.ledgers.put({id:'FOREIGN',workspaceId:'foreign',period:'2099-12',status:'draft'});
 await db.auditEvents.put({id:'FOREIGN-AUDIT',workspaceId:'foreign',action:'created',after:{period:'FOREIGN-SECRET'},createdAt:'2099-12-01'});
 return ids;
 })()`);
 await window.loadURL(origin+'/workspace?ledger='+encodeURIComponent(ids[0]));
 await wait("document.querySelector('.sales-analytics')?.innerText.includes('2026-09 · 全部店铺')");
 await wait("document.querySelector('select[name=首页核算月份]')?.options.length>=6 && document.querySelector('select[name=首页店铺]')?.value==='all'");
 assert.deepEqual(await run("[...document.querySelector('select[name=首页核算月份]').options].map(option=>option.value).filter(Boolean)"),ids);
 // A hidden Electron window needs emulated foreground focus for trusted keyboard input.
 const keyboard = window.webContents.debugger;
 keyboard.attach();
 try {
   await keyboard.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
   async function press(key, keyCode) {
     const event = { key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
     await keyboard.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
     await keyboard.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
   }
   await wait(`(() => {
     const trigger = document.querySelector('select[name=首页店铺]')?.closest('.board-select')?.querySelector('.board-select-trigger');
     trigger?.focus();
     return trigger && document.activeElement === trigger;
   })()`);
   await press('ArrowDown', 40);
   await wait("document.querySelector('[role=listbox] [role=option]')");
   const stores = await run("[...document.querySelectorAll('[role=listbox] [role=option]')].map(option => option.textContent)");
   const storeIndex = stores.indexOf('甲店');
   assert.ok(storeIndex >= 0, '甲店应出现在店铺列表中');
   await press('Home', 36);
   for (let i = 0; i < storeIndex; i++) await press('ArrowDown', 40);
   await press('Enter', 13);
 } finally {
   keyboard.detach();
 }
 await wait("document.querySelector('select[name=首页店铺]')?.value==='甲店' && document.querySelector('.sales-analytics')?.innerText.includes('甲店')");
 await wait("document.querySelector('.sales-analytics')?.innerText.includes('缺少有效月内添加日期')");
 await overview('partial');
 await wait("document.querySelector('.workspace-pending-link')?.getAttribute('aria-label')==='查看当前范围待核对的 2 条店铺 SKU'");
 assert.ok(await run("document.querySelector('.workspace-ledger-status').innerText.includes('整月账本状态')"));
 await run("document.querySelector('.workspace-pending-link').click()");
 await wait("location.pathname==='/profit' && location.hash==='#profit-detail-area' && document.querySelector('[aria-label=月度利润明细]')");
 assert.deepEqual(await run("['ledger','store','missing','view'].map(key=>new URLSearchParams(location.search).get(key))"),[ids[0],'甲店','1','detail']);
 assert.ok(await run("document.querySelector('#profit-detail-area').innerText.includes('SKU-0') && document.querySelector('#profit-detail-area').innerText.includes('SKU-2')"));
 await run("document.querySelector('.side-navigation a[href^=\"/workspace\"]').click()");
 await wait("location.pathname==='/workspace' && document.querySelector('select[name=首页店铺]')");
 await run("[...document.querySelectorAll('.workspace-flow-step')].find(button=>button.textContent.includes('核对成本')).click()");
 await wait("location.pathname==='/profit' && document.querySelector('.profit-erp-pending')?.textContent==='2 条待补'");
 assert.equal(await run("document.querySelector('select[name=查看店铺]').value"),'甲店');
 assert.equal(await run('document.querySelectorAll(".app-shell").length'),1);
 await window.loadURL(origin+'/cost-matching?ledger='+encodeURIComponent(ids[0])+'&store=甲店&q=SKU&supplier=A&missing=1');
 await wait("location.pathname==='/profit' && document.querySelector('.profit-erp-pending')?.textContent==='2 条待补'");
 assert.deepEqual(await run("['ledger','store','q','supplier','missing'].map(key=>new URLSearchParams(location.search).get(key))"),[ids[0],'甲店','SKU','A','1']);
 await window.loadURL(origin+'/workspace?ledger='+encodeURIComponent(ids[0])+'&store=甲店');
 await wait("Boolean(document.querySelector('select[name=首页核算月份]'))");
 await run(`{const s=document.querySelector('select[name=首页核算月份]');for(const id of ${JSON.stringify([ids[1],ids[2],ids[5]])}){s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}));}const store=document.querySelector('select[name=首页店铺]');store.value='乙店';store.dispatchEvent(new Event('change',{bubbles:true}));}`);
 await wait(`document.querySelector('select[name=首页核算月份]')?.value===${JSON.stringify(ids[5])}`);
 assert.equal(await run("new URLSearchParams(location.search).get('ledger')"),ids[5]);
 assert.equal(await run("new URLSearchParams(location.search).get('store')"),'乙店');
 assert.equal(await run("document.querySelector('select[name=首页店铺]').value"),'乙店');
 await wait("document.querySelector('.sales-analytics')?.innerText.includes('2026-04 · 乙店')");
 assert.ok(await run("[...document.querySelectorAll('.sales-daily-bar')].some(e=>e.getAttribute('aria-label').includes('2026-04-01：销售原额 ¥0 · 销量 2 件'))"));
 await run("document.querySelector('.workspace-daily-trend').scrollIntoView({block:'start'})");await capture('confirmed-zero');
 await window.reload();await wait("document.querySelector('select[name=首页店铺]')?.value==='乙店'");
 await run("document.querySelector('.workspace-ledger-heading a').click()");await wait("location.pathname==='/ledger'");
 await wait("document.body.innerText.includes('2026')");assert.equal(await run("document.body.innerText.includes('2099')"),false);
 await window.loadURL(origin+'/workspace?ledger='+encodeURIComponent(ids[4]));
 await wait("document.querySelector('.sales-analytics')?.innerText.includes('尚未取得销售数据')");
 assert.ok(await run("[...document.querySelectorAll('.sales-daily-bar')].every(bar=>bar.getAttribute('aria-label').includes('数据待查'))"));
 await run("document.querySelector('.workspace-daily-trend').scrollIntoView({block:'start'})");await capture('unknown-dates');
 await window.loadURL(origin+'/workspace?ledger=FOREIGN&store=secret&q=secret');
 await wait("document.querySelector('.workspace-scope [role=alert]')?.innerText.includes('不属于当前工作区')");
 assert.equal(await run("Boolean(document.querySelector('.workspace-pending-link,.workspace-scope select'))"),false);
 assert.equal(await run("[...document.querySelectorAll('.side-navigation a')].some(a=>a.href.includes('secret')||a.href.includes('FOREIGN'))"),false);
 await window.loadURL(origin+'/cost-matching?ledger=FOREIGN&store=secret');
 await wait("location.pathname==='/profit' && !location.search.includes('secret') && !location.search.includes('FOREIGN')");
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks:['empty does not seed ledger','six months and two stores','shared date diagnostics','light dark three sizes','four primary links and system navigation','count links to scoped missing SKUs','old cost compatibility','scope retained across refresh and routes','rapid month latest wins','foreign scope and management filtered']},null,2));console.log(output);app.exit(0);
}).catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);console.error(output,error);app.exit(1);});
