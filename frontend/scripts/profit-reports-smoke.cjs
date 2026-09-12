// Synthetic data, isolated browser profile, loopback-only network.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const origin=process.env.PROFIT_SMOKE_ORIGIN||'http://127.0.0.1:5193';
if(new URL(origin).hostname!=='127.0.0.1')throw new Error('loopback only');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'profit-reports-ui-'));
app.setPath('userData',path.join(output,'profile'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url);callback({cancel:['http:','https:'].includes(url.protocol)&&url.origin!==origin});});
 const downloads=[];
 session.defaultSession.on('will-download',(_event,item)=>{const target=path.join(output,`${downloads.length}-${item.getFilename()}`);downloads.push(target);item.setSavePath(target);});
 const window=new BrowserWindow({width:1280,height:800,useContentSize:true,show:false,frame:false,webPreferences:{backgroundThrottling:false}});
 const evaluate=code=>window.webContents.executeJavaScript(code);
 async function until(code){const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(`Boolean(${code})`))return;await delay(100);}throw new Error(`Timeout ${code}\n${await evaluate('document.body.innerText.slice(-3000)')}`);}
 async function click(label){await evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw new Error('Unavailable button ${label}');b.click();}`);}
 async function set(selector,value){await evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}`);}
 async function capture(name){await delay(200);fs.writeFileSync(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());}
 await window.loadURL(origin+'/profit');await until("document.body.innerText.includes('还没有月度账本')");
 const id=await evaluate(`(async()=>{
 const {db,createOrGetMonthlyLedger,getActiveMemberContext,saveManualCostOverride}=await import('/src/data/database.js');
 const m=await getActiveMemberContext(),ledger=await createOrGetMonthlyLedger({workspaceId:m.workspaceId,period:'2026-08'});
 await db.salesRows.bulkAdd(['甲店','乙店'].map((store,i)=>({workspaceId:m.workspaceId,ledgerId:ledger.id,store,platformSku:'SKU'+i,platformSkc:'SKC'+i,supplierNumber:'合成',attribute:'红',quantity:2,quantityExact:'2',amount:20.009,amountExact:'20.009',penalty:0})));
 for(const [i,store] of ['甲店','乙店'].entries())await saveManualCostOverride({ledgerId:ledger.id,store,platformSku:'SKU'+i,unitCost:0,reason:'合成验收'});
 return ledger.id;})()`);
 await window.loadURL(origin+'/profit?ledger='+id+'&view=detail');await until("document.querySelector('#monthly-reports')");
 const checks=[];
 for(const [w,h] of [[1024,768],[1280,800],[390,780]]){
  window.setContentSize(w,h);await evaluate("document.querySelector('#monthly-reports').scrollIntoView({block:'start'})");
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture('reports-'+w);
  await click('登记代发');await set('[role=dialog] select','manual');await set('[role=dialog] input[type=number]','100');await click('预览采用');
  await until("document.querySelector('.report-adoption-preview')");assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture('dispatch-'+w);await click('取消');checks.push({w,h,noOverflow:true});
 }
 window.setContentSize(1280,800);await click('登记代发');await set('[role=dialog] select','manual');await set('[role=dialog] input[type=number]','100');await click('预览采用');await until("document.querySelector('.report-adoption-preview')");await click('确认采用本月来源');await until("!document.querySelector('[role=dialog]')&&document.body.innerText.includes('已采用 100 件')");
 await click('预览未扣款报告并定稿');await until("document.querySelector('[role=dialog] strong')");await capture('pre-preview');await click('保存并下载');await until("document.body.innerText.includes('历史报告（1）')");
 await click('登记扣款');await set('[role=dialog] select','manual');await set('[role=dialog] input[type=number]','0');await set('[role=dialog] label.form-field:last-of-type input','-0.009');await click('预览采用');await until("document.querySelector('.report-adoption-preview')");await capture('deductions');await click('确认采用本月来源');await until("!document.querySelector('[role=dialog]')");
 await click('预览财务对账报告');await until("document.querySelector('[role=dialog] strong')");await capture('financial-preview');await click('保存并下载');await until("document.body.innerText.includes('历史报告（2）')");
 await evaluate("document.querySelector('#monthly-reports details').open=true");await click('重下载原文件');await until("document.querySelectorAll('.report-history-row').length===2");await capture('history');
 const reports=await evaluate("(async()=>{const {db}=await import('/src/data/database.js');return db.profitReports.toArray();})()");
 assert.equal(reports.find(r=>r.kind==='financial').baseReportId,reports.find(r=>r.kind==='pre_deduction').id);
 assert.equal(reports.find(r=>r.kind==='financial').totalsExact.deductionExact,'-0.009');
 await window.loadURL(origin+'/profit?ledger='+id+'&view=cost');await until("document.querySelector('.cost-page-toolbar')");
 // Reopen through the authorized repository so the registration status is visible again.
 await evaluate(`(async()=>{const {reopenLedgerForCostCorrection}=await import('/src/data/database.js');await reopenLedgerForCostCorrection({ledgerId:${JSON.stringify(id)},reason:'合成重开验收'});})()`);
 await until("document.querySelector('.cost-registration-status')");
 for(const [w,h] of [[1024,768],[1280,800],[390,780]]){window.setContentSize(w,h);await delay(100);await evaluate('scrollTo(0,0)');assert.equal(await evaluate("document.querySelector('.cost-registration-status').getBoundingClientRect().bottom<=document.querySelector('.cost-page-toolbar').getBoundingClientRect().top"),true);await capture('cost-status-'+w);}
 for(let i=0;i<50&&downloads.some(file=>!fs.existsSync(file));i++)await delay(100);
 assert.equal(downloads.length,3);assert.ok(downloads.every(file=>fs.readFileSync(file).subarray(0,2).toString()==='PK'));
 assert.equal(fs.readFileSync(downloads[2]).equals(fs.readFileSync(downloads[1]))||fs.readFileSync(downloads[2]).equals(fs.readFileSync(downloads[0])),true);
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,downloads:downloads.map(file=>path.basename(file)),scenarios:['manual dispatch 100','explicit zero and negative deduction','two-stage save/download','original file redownload','cost status spacing']},null,2));
 console.log(output);app.exit(0);
}).catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);console.error(output,error);app.exit(1);});
