const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-erp-ui-'));
const origin = process.env.WORKSPACE_SMOKE_ORIGIN || 'http://127.0.0.1:5188';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('loopback preview required');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let application, run;
const checks = [];
async function wait(code) {
  const end = Date.now() + 35000;
  while (Date.now() < end) { if (await run(code)) return; await delay(120); }
  throw new Error('Timeout: ' + code + '\n' + await run('document.body.innerText'));
}
async function click(text) {
  await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&b.getClientRects().length)`);
  await run(`{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&b.getClientRects().length);b.scrollIntoView({block:'center'});b.click();}`);
}
async function fill(value) {
  await run(`{const e=document.querySelector('.cost-manual-textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await delay(150);
}
async function capture(name) {
  await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const png = await application.evaluate(async () => (await globalThis.__erpUi.workspace().capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(png, 'base64'));
}
async function navigate(url) {
  await application.evaluate((_, url) => globalThis.__erpUi.workspace().loadURL(url), origin + url);
}
function copiedExtensionText(results, envelope) {
  // Execute the extension's real export and copy functions with an in-memory clipboard.
  const source = fs.readFileSync(path.join(__dirname, '../integrations/erp-assistant-extension/src/content.js'), 'utf8');
  const start = source.indexOf('    function buildExportRows('), end = source.indexOf('    function exportCsv()', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({lastResults: results, lastImportEnvelope: envelope,
    resultCostWarnings: () => ({count:0,reasons:[],records:[]}), resultPolicy: {},
    navigator: {clipboard: {writeText: async text => { context.copied = text; }}},
    showToast() {}, showError(error) { throw error; }, CostError: Error});
  vm.runInContext(source.slice(start, end) + '\nglobalThis.copyCosts = copyCosts;', context);
  return context.copyCosts().then(() => context.copied);
}
(async () => {
  const profile = path.join(output, 'profile');
  const env = {...process.env, DESKTOP_ERP_UI_SMOKE:'1', SHOPEERS_DESKTOP_DEV_URL:origin,
    SHOPEERS_DESKTOP_SMOKE_USER_DATA:profile, SHOPEERS_DESKTOP_SMOKE_CACHE:path.join(profile,'cache'),
    SHOPEERS_ERP_INBOX_FILE:path.join(profile,'inbox.json'), SHOPEERS_ERP_INBOX_PORT:String(25000 + Math.floor(Math.random()*1000))};
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = {executablePath:process.env.DESKTOP_EXPERIENCE_ELECTRON || 'C:/Users/Administrator/Desktop/Lworkstation/desktop/node_modules/electron/dist/electron.exe', args:[path.join(__dirname,'erp-ui-smoke-app.cjs')], env};
  application = await _electron.launch(launchOptions);
  run = code => application.evaluate((_, code) => globalThis.__erpUi.workspace().executeJavaScript(code), code);
  const end = Date.now()+30000;
  while (!(await application.evaluate(() => globalThis.__erpUi?.state().startup.status === 'ready'))) { if(Date.now()>end)throw new Error('startup timeout');await delay(100); }
  await application.evaluate(() => globalThis.__erpUi.window().setContentSize(1280,880));
  // Only initial sales/ledger fixtures are seeded. No request, inbox, cost or publication writes.
  const scope = await run(`(async()=>{const {db,createOrGetMonthlyLedger,getActiveMemberContext}=await import('/src/data/database.js');const m=await getActiveMemberContext();const l=await createOrGetMonthlyLedger({workspaceId:m.workspaceId,period:'2026-08'});await db.salesRows.bulkPut(['甲店','乙店'].map((store,i)=>({id:'UI-SALE-'+i,ledgerId:l.id,workspaceId:m.workspaceId,store,platformSku:'UI-SKU',platformSkc:'UI-SKC',quantity:1000,quantityExact:'1000',amount:100,amountExact:'100',penalty:0,sourceAddedDate:'2026-08-01',dateStatus:'valid'})));return {workspaceId:m.workspaceId,ledgerId:l.id};})()`);
  await navigate('/profit?view=cost&ledger='+scope.ledgerId+'&store='+encodeURIComponent('甲店'));
  await wait("document.body.innerText.includes('回传关联已登记')");
  const request = await run(`(async()=>{const {getLatestErpCostRequest}=await import('/src/data/database.js');return getLatestErpCostRequest(${JSON.stringify(scope.ledgerId)});})()`);
  assert.equal(request.workspaceId,scope.workspaceId); assert.equal(request.ledgerId,scope.ledgerId);
  assert.ok(JSON.stringify(request).includes('UI-SKC'));
  checks.push('React cost scope automatically registers without copy click');
  await click('手动导入'); await fill('SYNTHETIC UNSAVED MANUAL DRAFT'); await click('取消');
  const capturedAt = new Date(Date.now()+100).toISOString();
  const payload = {...scope, requestId:request.id,expectedSkus:[{platformSku:'UI-SKU',platformSkc:'UI-SKC',warehouseSku:'UI-WH'}],querySkcs:['UI-SKC'],queryCapturedAt:capturedAt,registeredBefore:capturedAt,
    results:[{platformSkc:'UI-SKC',warehouseSku:'UI-WH',mappings:[{platformSku:'UI-SKU',platformSkc:'UI-SKC'}],name:'合成微小成本商品',unitCost:0.009,totalQty:1000,totalPrice:9,selectedRecordIds:['UI-RECORD']}],
    meta:{...scope,requestId:request.id,querySkcs:['UI-SKC'],queryCapturedAt:capturedAt,registeredBefore:capturedAt,sourceFormat:'desktop-ui-smoke',evidenceComplete:true},
    warehouseEvidence:{formatVersion:2,warehouses:[{warehouseSku:'UI-WH',evidenceComplete:true,purchaseRecords:[{recordId:'UI-RECORD',warehouseSku:'UI-WH',productName:'合成微小成本商品',quantity:1000,unitPrice:0.009,totalPrice:9,purchaseDate:'2026-07-15',eligible:true,selectedForPreview:true}],excludedRecords:[],sourceWarnings:[]}],excludedOrders:[],excludedDetails:[],detailFailures:[],mappingFailures:[]}};
  const delivery = await application.evaluate((_, payload) => globalThis.__erpUi.submit(payload), payload);
  fs.writeFileSync(path.join(output,'delivery.json'),JSON.stringify(delivery,null,2));
  assert.equal(delivery.ok,true); assert.ok(delivery.envelope);
  await wait("document.body.innerText.includes('当前手动草稿仍保留')");
  await click('手动导入');assert.equal(await run("document.querySelector('.cost-manual-textarea').value"),'SYNTHETIC UNSAVED MANUAL DRAFT');await click('取消');
  await capture('draft-preserved'); checks.push('real bridge/background HTTP delivery and IPC polling persist while manual draft remains');
  await click('保留草稿，查看返回批次'); await click('载入核对'); await click('保留草稿');await click('关闭');
  await click('手动导入');assert.equal(await run("document.querySelector('.cost-manual-textarea').value"),'SYNTHETIC UNSAVED MANUAL DRAFT');
  // Clear through the real textarea; background evidence remains available and auto-loads.
  await fill('');await click('取消');await wait("document.body.innerText.includes('可发布 1 项')");
  await capture('loaded-evidence');checks.push('preserve draft and clear draft leave received batch intact; empty draft loads evidence');
  const copied = await copiedExtensionText(payload.results,delivery.envelope);
  assert.deepEqual(JSON.parse(copied),delivery.envelope);
  await click('查看当前成本');await fill(copied);await click('解析并核对');
  await wait("document.body.innerText.includes('可发布 1 项')");
  checks.push('real extension copy function output is parsed by React manual import');
  // Pasting a known received batch intentionally releases its inbox identity.
  // Publication must use the received queue item, not bypass its status guard.
  await click('保留草稿，查看返回批次');await click('载入核对');await click('丢弃草稿并载入结果');
  await wait("!document.querySelector('.cost-inbox-queue-modal')");
  // Destroy the entire source main process, including its actual bridge VM, and renderer.
  // Recovery below uses only persistent inbox/profile data: no payload/envelope injection.
  const closed = application.waitForEvent('close');
  await application.evaluate(({app})=>app.quit());await closed;application=null;
  application = await _electron.launch(launchOptions);
  const restartEnd=Date.now()+30000;
  while (!(await application.evaluate(() => globalThis.__erpUi?.state().startup.status==='ready'))) {if(Date.now()>restartEnd)throw new Error('restart timeout');await delay(100);}
  await application.evaluate(()=>globalThis.__erpUi.window().setContentSize(1280,880));
  await navigate('/profit?view=cost&ledger='+scope.ledgerId+'&store='+encodeURIComponent('甲店'));
  await wait("document.body.innerText.includes('可发布 1 项')");
  await capture('restored-after-process-restart');
  await click('发布已匹配 ERP 成本');
  await wait("document.body.innerText.includes('已发布，匹配') || document.body.innerText.includes('成本批次发布失败')");
  assert.equal(await run("document.body.innerText.includes('成本批次发布失败')"),false,await run("document.querySelector('.toast-stack').innerText"));
  await wait("!document.querySelector('.cost-publish-bar') && document.body.innerText.includes('月度利润核算')");
  const snapshot = await run(`(async()=>{const {getLedgerSnapshot}=await import('/src/data/database.js');const {calculateFormalLedgerRows}=await import('/src/domain/ledgerProfit.js');const s=await getLedgerSnapshot(${JSON.stringify(scope.ledgerId)});return {costs:s.costs,lines:calculateFormalLedgerRows({ledger:s.ledger,salesRows:s.rows,erpCosts:s.costs,approvals:s.approvals})};})()`);
  fs.writeFileSync(path.join(output,'publication.json'),JSON.stringify(snapshot,null,2));
  assert.ok(snapshot.costs.some(row=>row.unitCost===0.009));
  assert.equal(snapshot.lines.find(row=>row.store==='甲店').purchaseCost,9);
  assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
  await capture('published-profit');checks.push('entire source process/VM exits; same isolated profile restores evidence and UI publishes; 0.009 × 1000 equals 9');
  // Change the member context, then visit the stale URL: it must not expose/apply the old workspace batch.
  const otherLedger = await run("(async()=>{const {setActiveMemberContext,createOrGetMonthlyLedger}=await import('/src/data/database.js');await setActiveMemberContext({workspaceId:'UI-OTHER',memberId:'UI-MEMBER',role:'admin'});return createOrGetMonthlyLedger({workspaceId:'UI-OTHER',period:'2026-08'});})()");
  // SPA scope simulation: a full local-mode reload intentionally restores the default member.
  await run(`history.pushState({},'',${JSON.stringify('/profit?view=cost&ledger='+scope.ledgerId+'&store='+encodeURIComponent('甲店'))});dispatchEvent(new PopStateEvent('popstate'));`);
  await wait("document.body.innerText.includes('账本不属于当前工作区')");
  await capture('stale-workspace-link');
  await run(`history.pushState({},'',${JSON.stringify('/profit?view=cost&ledger='+otherLedger.id+'&store=all')});dispatchEvent(new PopStateEvent('popstate'));`);
  await wait("document.querySelector('.cost-page') && document.body.innerText.includes('没有可核对的月度销售明细')");
  const late = await application.evaluate((_,payload)=>globalThis.__erpUi.submit(payload),payload);
  // A late/retried extension result keeps its original workspace, even if rejected/replayed.
  assert.notEqual(late.workspaceId,'UI-OTHER');
  await delay(1800);
  assert.equal(await run("document.body.innerText.includes('UI-SKU') || document.body.innerText.includes('可发布 1 项')"),false);
  const foreign = await run("(async()=>{const {db}=await import('/src/data/database.js');return db.erpCostRows.filter(row=>row.workspaceId==='UI-OTHER').count();})()");assert.equal(foreign,0);
  await capture('workspace-isolation');checks.push('workspace switch does not display or apply previous workspace results');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,scope,lateDelivery:{ok:late.ok,status:late.status,workspaceId:late.workspaceId},viewport:await run('({width:innerWidth,height:innerHeight})'),publication:snapshot,boundaries:['synthetic initial ledger only','real React registration/publication and controlled IPC/inbox','real extension bridge/background in VM; no ERP login or scraping','source process/VM and workspace fully closed and restarted; no evidence reinjected for recovery/publication','member switch uses public context API in SPA; local full reload resets default member','manual priority/revocation covered by existing targeted tests']},null,2));
  console.log(output);
})().catch(async error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);if(application)await capture('failure').catch(()=>{});console.error(output,error);process.exitCode=1;}).finally(async()=>{
  if(application)await application.evaluate(({app})=>app.quit()).catch(()=>{});
  const files=fs.readdirSync(output).filter(name=>/\.(png|json|txt)$/.test(name)&&name!=='sha256.json');
  fs.writeFileSync(path.join(output,'sha256.json'),JSON.stringify(files.map(file=>({file,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(output,file))).digest('hex')})),null,2));
});
