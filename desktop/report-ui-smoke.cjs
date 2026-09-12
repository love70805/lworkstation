// Actual React report operations. Only initial ledger/sales/effective costs are seeded.
const {_electron}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'lworkstation-report-ui-'));
const origin=process.env.WORKSPACE_SMOKE_ORIGIN||'http://127.0.0.1:5188';
if(new URL(origin).hostname!=='127.0.0.1')throw new Error('loopback preview required');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let application,run;
const evidence=[];
async function wait(code){const end=Date.now()+30000;while(Date.now()<end){if(await run(code))return;await delay(100);}throw new Error('Timeout '+code+'\n'+await run('document.body.innerText'));}
async function click(text){const query=`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled&&e.getClientRects().length)`;await wait(`Boolean(${query})`);await wait(`(()=>{const e=${query};if(!e)return false;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit);})()`);await run(`(${query}).click()`);await delay(100);}
async function fill(selector,value,index=0){await run(`{const e=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!e)throw Error('missing input');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}`);await delay(100);}
async function capture(name){await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const bytes=await application.evaluate(async()=>(await globalThis.__erpUi.workspace().capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(bytes,'base64'));}
async function reportState(ledgerId){return run(`(async()=>{const {readMonthlyReportState}=await import('/src/data/repositories/profitReportRepository.js');return readMonthlyReportState(${JSON.stringify(ledgerId)});})()`);}
async function downloads(){return application.evaluate(()=>globalThis.__reportDownloads);}
async function saveDownload(){const count=(await downloads()).length;await click('保存并下载');const end=Date.now()+30000;while((await downloads()).length===count){if(Date.now()>end)throw new Error('download timeout '+await run('document.body.innerText'));await delay(100);}const file=(await downloads()).at(-1);assert.equal(file.state,'completed');return file;}
async function layoutMatrix(){
 for(const theme of ['light','dark']){
  await run(`(async()=>{const {applyAppearance}=await import('/src/lib/appearance.js');applyAppearance('${theme}',{animate:false});})()`);
  for(const [width,height] of [[1024,768],[1280,800],[390,780]]){
   await application.evaluate((_,s)=>{const w=globalThis.__erpUi.window();w.setMinimumSize(300,500);w.setContentSize(s[0],s[1]+80);},[width,height]);await delay(150);
   await run("document.querySelector('.monthly-report-manager').scrollIntoView({block:'start'})");
   assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false,`body overflow ${theme} ${width}`);await capture(`manager-${theme}-${width}`);
   await click('登记代发');
   assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false,`modal overflow ${theme} ${width}`);
   for(const text of ['取消','预览采用'])assert.ok(await run(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getClientRects().length)`));
   await click('预览采用');await wait("Boolean(document.querySelector('[role=dialog] [role=alert]'))");
   await capture(`editor-${theme}-${width}`);await click('取消');
   evidence.push({theme,width,height,bodyOverflow:false,sourceEditorOpened:true});
  }
 }
 await application.evaluate(()=>globalThis.__erpUi.window().setContentSize(1280,880));
}
(async()=>{
 const profile=path.join(output,'profile'),env={...process.env,DESKTOP_ERP_UI_SMOKE:'report',SHOPEERS_DESKTOP_DEV_URL:origin,SHOPEERS_DESKTOP_SMOKE_USER_DATA:profile,SHOPEERS_DESKTOP_SMOKE_CACHE:path.join(profile,'cache'),SHOPEERS_ERP_INBOX_FILE:path.join(profile,'inbox.json'),SHOPEERS_ERP_INBOX_PORT:String(26500+Math.floor(Math.random()*500))};delete env.ELECTRON_RUN_AS_NODE;
 application=await _electron.launch({executablePath:process.env.DESKTOP_EXPERIENCE_ELECTRON||'C:/Users/Administrator/Desktop/Lworkstation/desktop/node_modules/electron/dist/electron.exe',args:[path.join(__dirname,'erp-ui-smoke-app.cjs')],env});
 const end=Date.now()+30000;while(!(await application.evaluate(()=>globalThis.__erpUi?.state().startup.status==='ready'))){if(Date.now()>end)throw new Error('startup timeout');await delay(100);}
 run=code=>application.evaluate((_,code)=>globalThis.__erpUi.workspace().executeJavaScript(code),code);
 await application.evaluate((_,directory)=>{globalThis.__reportDownloads=[];let ordinal=0;globalThis.__erpUi.workspace().session.on('will-download',(_event,item)=>{const fileName=item.getFilename(),target=directory+'/'+`${++ordinal}-${fileName}`;item.setSavePath(target);item.once('done',(_e,state)=>globalThis.__reportDownloads.push({fileName,path:target,state}));});},output);
 const ledgerId=await run(`(async()=>{const {db,createOrGetMonthlyLedger,getActiveMemberContext,saveManualCostOverride}=await import('/src/data/database.js');const m=await getActiveMemberContext();const l=await createOrGetMonthlyLedger({workspaceId:m.workspaceId,period:'2026-08'});await db.salesRows.bulkPut([{id:'REPORT-A',store:'甲店',platformSku:'REPORT-A',quantity:1000,quantityExact:'1000',amount:100,amountExact:'100'},{id:'REPORT-B',store:'乙店',platformSku:'REPORT-B',quantity:1.5,quantityExact:'1.5',amount:30.015,amountExact:'30.015'}].map(r=>({...r,ledgerId:l.id,workspaceId:m.workspaceId,platformSkc:'REPORT-SKC',attribute:'合成属性',penalty:0,sourceAddedDate:'2026-08-01',dateStatus:'valid'})));for(const [store,platformSku,unitCost] of [['甲店','REPORT-A',0.009],['乙店','REPORT-B',0]])await saveManualCostOverride({ledgerId:l.id,store,platformSku,unitCost,reason:'合成验收初始有效成本'});return l.id;})()`);
 await application.evaluate((_,url)=>globalThis.__erpUi.workspace().loadURL(url),origin+'/profit?view=detail&ledger='+ledgerId+'&store=all');
 await wait("Boolean(document.querySelector('.monthly-report-manager'))");
 assert.equal((await reportState(ledgerId)).dispatch,null);
 await layoutMatrix();
 await click('登记代发');await fill('[role="dialog"] select','manual');await click('预览采用');
 await wait("Boolean(document.querySelector('[role=dialog] [role=alert]'))");assert.equal((await reportState(ledgerId)).dispatch,null);
 await fill('[role="dialog"] input[type="number"]','0');await click('预览采用');await click('确认采用本月来源');
 await wait("document.querySelector('.monthly-report-manager').innerText.includes('已采用 0 件')");
 const zero=await reportState(ledgerId);assert.equal(zero.dispatch.adoptedQuantityExact,'0');assert.equal(zero.dispatch.rowCount,0);
 await click('登记代发');
 const csv='姓名,店铺,SKC,供方货号,订单号,1688订单号,件数\n本人甲,甲店,REPORT-SKC,MY-A,ORDER-A,12345678901234567890,1200\n本人乙,乙店,REPORT-SKC,MY-B,ORDER-B,12345678901234567891,800\n他人,乙店,OTHER,OTHER,ORDER-X,12345678901234567892,9000\n合计,,,,,,11000';
 await run(`{const file=new File([${JSON.stringify(csv)}],'合成代发.csv',{type:'text/csv'});const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('[role="dialog"] input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
 await wait("Boolean(document.querySelector('.report-source'))");
 await run("{const d=document.querySelector('.report-source');d.open=true;d.querySelector('summary input').click();}");
 await fill('input[placeholder="本人姓名或货号标记（包含匹配）"]','本人');
 await fill('[role="dialog"] .form-field input[type="number"]','2000');await click('预览采用');
 await wait("document.querySelector('.report-adoption-preview')?.innerText.includes('采用 2000 件')");
 assert.equal(await run("document.querySelectorAll('.report-preview-rows tbody tr').length"),2);await capture('csv-owner-preview');
 await click('确认采用本月来源');await wait("document.querySelector('.monthly-report-manager').innerText.includes('已采用 2000 件')");
 await click('预览未扣款报告并定稿');await wait("document.querySelector('[role=dialog]')?.innerText.includes('819.96')");await capture('pre-deduction-preview');const firstDownload=await saveDownload();
 await wait("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='登记代发')?.disabled");
 assert.equal(await run("document.querySelector('.profit-summary-action').disabled"),true);
 const frozen=await reportState(ledgerId),base=frozen.reports.find(r=>r.kind==='pre_deduction');assert.equal(frozen.ledger.status,'finalized');assert.equal(base.totalsExact.preDeductionExact,'819.965');assert.equal(base.totalsExact.dispatchQuantityExact,'2000');assert.equal(frozen.deduction,null);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(firstDownload.path)).digest('hex'),base.fileSha256);
 await click('登记扣款');await fill('[role="dialog"] select','manual');
 const stores=await run("[...document.querySelectorAll('[role=dialog] .form-field')].map(e=>e.textContent)");
 for(let i=0;i<stores.length;i++)await fill('[role="dialog"] .form-field input',stores[i].startsWith('甲店')?'1.009':'-0.004',i);
 await click('预览采用');await wait("document.querySelector('.report-adoption-preview')?.innerText.includes('1.005')");await capture('signed-deductions-preview');await click('确认采用本月来源');
 await click('预览财务对账报告');await wait("document.querySelector('[role=dialog]')?.innerText.includes('818.96')");const financialDownload=await saveDownload();
 const financial=(await reportState(ledgerId)).reports.find(r=>r.kind==='financial');assert.equal(financial.baseReportId,base.id);assert.equal(financial.totalsExact.profitExact,'818.96');
 await run("{const s=[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('查看利润明细与成本更正'));if(!s.parentElement.open)s.click();}");
 await click('重开本月全部店铺核算');await fill('#profit-reopen-reason','合成验收修订代发总数');await click('确认重开');
 await wait("![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='登记代发')?.disabled");
 await click('登记代发');await fill('[role="dialog"] select','manual');await fill('[role="dialog"] input[type="number"]','2001');await click('预览采用');await click('确认采用本月来源');
 await click('预览未扣款报告并定稿');const revisedDownload=await saveDownload();const revised=(await reportState(ledgerId)).reports.find(r=>r.kind==='pre_deduction'&&r.revision===2);assert.equal(revised.supersedesReportId,base.id);
 for(const theme of ['light','dark'])for(const [width,height] of [[1024,768],[1280,800],[390,780]]){
  await run(`(async()=>{const {applyAppearance}=await import('/src/lib/appearance.js');applyAppearance('${theme}',{animate:false});})()`);
  await application.evaluate((_,s)=>globalThis.__erpUi.window().setContentSize(s[0],s[1]+80),[width,height]);await delay(100);
  await click('预览财务对账报告');await wait("document.querySelector('[role=dialog]')?.innerText.includes('保存财务对账报告')");
  assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
  await capture(`report-preview-${theme}-${width}`);await click('取消');
 }
 await run("{const row=[...document.querySelectorAll('.report-history-row')].find(e=>e.textContent.includes('未扣款 · r1'));if(!row.closest('details').open)row.closest('details').querySelector('summary').click();}");
 await wait("(()=>{const e=[...document.querySelectorAll('.report-history-row')].find(e=>e.textContent.includes('未扣款 · r1')).querySelector('button');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit);})()");
 await run("[...document.querySelectorAll('.report-history-row')].find(e=>e.textContent.includes('未扣款 · r1')).querySelector('button').click()");
 const downloadEnd=Date.now()+15000;while((await downloads()).length<4){if(Date.now()>downloadEnd)throw new Error('history download timeout');await delay(100);}
 const oldDownload=(await downloads()).at(-1);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(oldDownload.path)).digest('hex'),base.fileSha256);assert.equal(Buffer.compare(fs.readFileSync(firstDownload.path),fs.readFileSync(oldDownload.path)),0);
 await capture('immutable-report-history');
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,ledgerId,evidence,base,financial,revised,downloads:await downloads(),checks:['manual blank rejected and explicit zero adopted','CSV input change event and owner preview','2000 dispatch exceeds 1001.5 sales','UI saves and downloads frozen pre-deduction report','signed two-store late deductions produce financial against same base','frozen dispatch disabled; explicit reason reopens revision','old report UI redownload byte-identical']},null,2));console.log(output);
})().catch(async error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);if(application&&run)await capture('failure').catch(()=>{});console.error(output,error);process.exitCode=1;}).finally(async()=>{if(application)await application.evaluate(({app})=>app.quit()).catch(()=>{});const names=fs.readdirSync(output).filter(name=>/\.(png|json|xlsx|txt)$/.test(name)&&name!=='sha256.json');fs.writeFileSync(path.join(output,'sha256.json'),JSON.stringify(names.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(output,file))).digest('hex')})),null,2));});

