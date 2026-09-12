// Isolated Chromium window, synthetic database only; run with the existing Electron runtime.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const origin = process.env.PROFIT_SMOKE_ORIGIN || 'http://127.0.0.1:5193';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('loopback only');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'profit-analytics-ui-'));
app.setPath('userData', path.join(output, 'profile'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: ['http:', 'https:'].includes(url.protocol) && url.origin !== origin });
  });
  const window = new BrowserWindow({ width:1280, height:800, useContentSize:true, show:false, frame:false, webPreferences:{backgroundThrottling:false} });
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function until(code) {
    const end = Date.now() + 15000;
    while (Date.now() < end) { if (await evaluate(`Boolean(${code})`)) return; await delay(100); }
    throw new Error(`Timeout: ${code}\n${await evaluate('document.body.innerText.slice(-3000)')}`);
  }
  async function click(text) { await evaluate(`{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!button)throw new Error('button missing');button.click();}`); }
  async function capture(name) { await delay(200); fs.writeFileSync(path.join(output, name+'.png'), (await window.webContents.capturePage()).toPNG()); }
  await window.loadURL(origin+'/profit');
  await until("document.body.innerText.includes('还没有月度账本')");
  const ids = await evaluate(`(async()=>{
    const {db,createOrGetMonthlyLedger,getActiveMemberContext}=await import('/src/data/database.js');
    const member=await getActiveMemberContext(); const ids=[];
    for(const period of ['2026-08','2026-07']){
      const ledger=await createOrGetMonthlyLedger({workspaceId:member.workspaceId,period});ids.push(ledger.id);
      await db.salesRows.bulkPut(Array.from({length:24},(_,i)=>({id:period+'-'+i,ledgerId:ledger.id,workspaceId:member.workspaceId,store:i%2?'乙店':'甲店',platformSku:'SKU-'+i,platformSkc:'SKC-'+Math.floor(i/2),supplierNumber:'合成供应商',attribute:'合成属性',quantity:2,quantityExact:'2',amount:20+i,amountExact:String(20+i),unitPriceRaw:String((20+i)/2),sourceAddedDate:i===23?null:period+'-'+String(i%20+1).padStart(2,'0'),activityRaw:i%3?'':'合成活动',activityStatus:i%3?'missing':'known',penalty:0})));
    }
    await db.ledgers.put({id:'FOREIGN',workspaceId:'foreign',period:'2099-12'});
    return ids;
  })()`);
  const url = (id, store='all', view='detail') => `${origin}/profit?ledger=${encodeURIComponent(id)}&store=${encodeURIComponent(store)}&view=${view}&missing=0`;
  await window.loadURL(url(ids[0]));
  await until("document.querySelector('.sales-daily-chart') && document.querySelectorAll('.profit-skc-group').length===24");
  const checks = [];
  for (const [width,height] of [[1024,768],[1280,800],[390,780]]) {
    window.setContentSize(width,height); await delay(200);
    assert.equal(await evaluate("document.querySelectorAll('.app-shell').length"),1);
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false);
    await capture(`detail-${width}`);
    await evaluate("document.querySelector('.sales-analytics').scrollIntoView({block:'start'})");
    await capture(`analytics-${width}`);
    await click('销量');
    assert.equal(await evaluate("document.querySelector('[aria-label=每日销量]')!==null"),true);
    await click('成本核对');
    await until("document.querySelector('.cost-page .cost-primary-actions') || document.body.innerText.includes('ERP 成本核对')");
    await delay(300);
    assert.equal(await evaluate("document.querySelectorAll('.app-shell').length"),1);
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false);
    await evaluate('scrollTo(0,0)'); await capture(`cost-${width}`);
    await click('利润明细');
    await until("document.querySelector('.sales-daily-chart')");
    checks.push({width,height,singleShell:true,noOverflow:true});
  }
  window.setContentSize(1280,800);
  await evaluate("document.querySelector('.profit-table-panel').parentElement.open=true;document.querySelector('.profit-skc-group').open=true");
  await click('人工更正');
  await until("document.querySelector('#manual-cost-value')");
  await capture('manual-cost');
  await evaluate(`{const set=(selector,value)=>{const e=document.querySelector(selector);Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));};set('#manual-cost-value','0');set('#manual-cost-reason','合成零值验收');}`);
  await click('保存更正');
  await until("!document.querySelector('#manual-cost-value')");
  assert.equal(await evaluate("(async()=>{const {db}=await import('/src/data/database.js');return (await db.costApprovals.toArray()).some(a=>a.status==='approved'&&a.referenceCost?.unitCost===0)})()"),true);
  await click('更正 / 撤销'); await click('撤销当前更正');
  await until("!document.querySelector('#manual-cost-value')");
  await click('成本核对');
  await until("new URLSearchParams(location.search).get('view')==='cost'");
  await evaluate(`{const e=document.querySelector('[aria-label=核算月份]');e.value=${JSON.stringify(ids[1])};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(`new URLSearchParams(location.search).get('ledger')===${JSON.stringify(ids[1])}`);
  assert.equal(await evaluate("new URLSearchParams(location.search).get('view')"),'cost');
  await window.loadURL(url(ids[0],'甲店','cost'));
  await until("document.querySelector('.profit-view-tabs select')");
  await evaluate("{const e=document.querySelector('.profit-view-tabs select');e.value='乙店';e.dispatchEvent(new Event('change',{bubbles:true}));e.value='甲店';e.dispatchEvent(new Event('change',{bubbles:true}));}");
  await until("new URLSearchParams(location.search).get('store')==='甲店'");
  await window.reload(); await delay(500);
  assert.equal(await evaluate("new URLSearchParams(location.search).get('view')"),'cost');
  await window.loadURL(`${origin}/cost-matching?ledger=${encodeURIComponent(ids[0])}&store=甲店`);
  await until("document.body.innerText.includes('ERP 成本核对')");
  assert.equal(await evaluate("document.querySelectorAll('.app-shell').length"),1);
  await window.loadURL(url('FOREIGN'));
  await until("document.body.innerText.includes('账本不属于当前工作区')");
  await window.loadURL(url(ids[0],'不存在'));
  await until("document.body.innerText.includes('没有可用的账本或店铺')");
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,scenarios:['daily metric','all SKC expand','manual zero/revoke','embedded and legacy cost','month view preserved','rapid store/reload','foreign scope rejected'],origin},null,2));
  console.log(`Profit analytics smoke passed: ${output}`); app.exit(0);
}).catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);console.error(output,error);app.exit(1);});
