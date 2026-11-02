import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'frontend/package.json'));
const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
const src=process.env.ERP_RESET_TEST_SRC || path.join(root,'integrations/erp-assistant-extension/src');
const manifest=await fs.readFile(path.join(src,'../manifest.json'),'utf8');
const backgroundSource=await fs.readFile(path.join(src,'background.js'),'utf8');
const checkpointKey='shopeersErpCollectionCheckpointsV1', pendingKey='shopeersErpPendingCostResultsV2';
const resultKey='erpAssistantV8_latest_cost_result_v7';
const resetKey='erpAssistantV8_workspaceResetV1';
const sender={url:'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html',frameId:0};
sender.tab={url:sender.url};
const oldDate=new Date(Date.now()-60000).toISOString();
const marker={resetId:'SYN-RESET-ONE',clearedAt:new Date().toISOString()};
const checkpoint={schemaVersion:1,extensionVersion:'8.0.50',workspaceId:'W',requestId:'OLD-REQUEST',updatedAt:Date.now()-60000,state:'pending',platformSkcs:['SKC-OLD'],completedTargets:[],filters:{sku:'SKC-OLD'}};

async function backgroundChecks() {
  let reset=null,failClear=false,offline=false;
  const storage={shopeersErpInboxBaseUrl:'http://127.0.0.1:5397',shopeersErpInboxCapability:'SYN-CAPABILITY-AT-LEAST-32-CHARACTERS',shopeersErpWorkspaceId:'W',
    [checkpointKey]:[checkpoint],[pendingKey]:[{resultDeliveryId:'OLD-RESULT',createdAt:oldDate}],unrelatedPreference:'keep'};
  const configuration=JSON.stringify([storage.shopeersErpInboxBaseUrl,storage.shopeersErpInboxCapability,storage.shopeersErpWorkspaceId]);
  function start() {
    const chrome={storage:{local:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>Object.hasOwn(storage,key)).map(key=>[key,structuredClone(storage[key])]));},
      async set(values){if(failClear && values[checkpointKey]?.length===0){failClear=false;throw Error('synthetic storage failure');}Object.assign(storage,structuredClone(values));}}},
      runtime:{getManifest:()=>({version:JSON.parse(manifest).version}),onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{create(){},onAlarm:{addListener(){}}}};
    const context=vm.createContext({__SHOPEERS_ERP_BACKGROUND_TEST__:true,chrome,URL,AbortController,setTimeout,clearTimeout,console,fetch:async raw=>{
      if(offline)throw Error('synthetic offline');
      const route=new URL(raw).pathname;
      assert.ok(['/erp/v1/extension-status','/erp/v1/collection-tasks'].includes(route),route);
      return {ok:true,status:route.endsWith('extension-status')?202:200,json:async()=>({accepted:true,workspaceReset:reset,tasks:[]})};
    }});
    vm.runInContext(backgroundSource,context);return context.__SHOPEERS_ERP_BACKGROUND_TEST_API__;
  }
  let api=start();
  assert.equal((await api.collectionCheckpoint({action:'list'},sender)).records.length,1,'8.0.50 checkpoint remains compatible');
  await api.reportInstalled({sender});
  assert.equal(storage[checkpointKey].length,1,'normal heartbeat keeps valid progress');
  offline=true;await assert.rejects(api.reportInstalled({sender}));offline=false;
  assert.equal(storage[pendingKey].length,1,'offline does not imply clear');
  reset=marker;failClear=true;
  await assert.rejects(api.reportInstalled({sender}),/storage failure/);
  assert.equal((await api.reportInstalled({sender})).workspaceReset.resetId,marker.resetId);
  assert.equal(storage[checkpointKey].length,0,'retry clears checkpoints after storage failure');
  assert.equal(storage[pendingKey].length,0,'pending costs are removed');
  assert.equal(storage.unrelatedPreference,'keep');
  assert.equal(JSON.stringify([storage.shopeersErpInboxBaseUrl,storage.shopeersErpInboxCapability,storage.shopeersErpWorkspaceId]),configuration);
  storage[checkpointKey]=[{...checkpoint,requestId:'NEW-REQUEST',updatedAt:Date.now()}];
  storage[pendingKey]=[{resultDeliveryId:'NEW-RESULT',createdAt:new Date(Date.now()+1000).toISOString()}];
  api=start();await api.reportInstalled({sender});
  assert.equal(storage[checkpointKey][0].requestId,'NEW-REQUEST','background restart and repeated marker keep new task');
  assert.equal(storage[pendingKey][0].resultDeliveryId,'NEW-RESULT');
  reset={resetId:'SYN-RESET-TWO',clearedAt:new Date(Date.now()+2000).toISOString()};
  await api.collectionTask({action:'list'},sender);
  assert.equal(storage[checkpointKey].length,0,'task response also propagates a subsequent clear');
  assert.equal(storage[pendingKey].length,0);
  storage[checkpointKey]=[{...checkpoint,requestId:'AFTER-SECOND-CLEAR',updatedAt:Date.now()}];
  reset=marker;
  assert.equal((await api.reportInstalled({sender})).workspaceReset.resetId,'SYN-RESET-TWO','out-of-order heartbeat returns latest clear');
  assert.equal(storage[checkpointKey][0].requestId,'AFTER-SECOND-CLEAR','old clear notice cannot erase newer work');
}

const oldTask={taskId:'TASK-OLD',requestId:'OLD-REQUEST',status:'paused',ledgerPeriod:'2026-09',createdAt:oldDate,summary:{adopted:0},batches:[{platformSkcs:['SKC-OLD'],status:'pending'}]};
const cache=()=>({timestamp:Date.now(),createdAt:oldDate,queryCapturedAt:oldDate,capturedUrl:'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-OLD',resultDeliveryId:'OLD-RESULT',
  results:[{warehouseSku:'WH-OLD',name:'合成商品',mappings:[{platformSku:'SKU-OLD',platformSkc:'SKC-OLD'}],details:[]}],meta:{querySkcs:['SKC-OLD'],filters:{sku:'SKC-OLD'}}});
async function contentChecks() {
  const window=new Window({url:sender.url});
  const intervals=new Map(), errors=[];
  let reset=null,tasks=[oldTask],holdNext=false,releasePoll;
  const delay=()=>new Promise(resolve=>setTimeout(resolve,10));
  window.setInterval=fn=>{intervals.set(fn.name,fn);return intervals.size;};
  window.clearInterval=()=>{};
  window.addEventListener('error',event=>errors.push(event.message));
  window.addEventListener('unhandledrejection',event=>errors.push(event.reason?.message||String(event.reason)));
  window.fetch=async()=>{throw Error('unexpected ERP business request');};
  window.localStorage.setItem(resultKey,JSON.stringify(cache()));
  window.localStorage.setItem('erp-preference','keep');
  window.chrome={runtime:{sendMessage(message,done){void (async()=>{
    if(message.type==='shopeers.erp.reportStatus')return {ok:true,workspaceReset:reset};
    if(message.type==='shopeers.erp.catalogContext')return {ok:false};
    if(message.type==='shopeers.erp.previewContext')return {ok:true,ledgerPeriod:'2026-09'};
    if(message.type==='shopeers.erp.collectionCheckpoint')return {ok:true,records:reset?[]:[checkpoint]};
    if(message.type==='shopeers.erp.collectionTask'){
      if(holdNext){holdNext=false;return new Promise(resolve=>{releasePoll=()=>resolve({ok:true,tasks:[oldTask]});});}
      return {ok:true,tasks,workspaceReset:reset};
    }
    throw Error(message.type);
  })().then(done).catch(error=>done({ok:false,message:error.message}));}}};
  async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await delay();}throw Error('Timeout: '+window.document.body.textContent);}
  try {
    for(const file of ['result-policy.js','catalog-collector.js','request-context.js','shopeers-bridge.js','content.js'])window.eval(await fs.readFile(path.join(src,file),'utf8'));
    await until(()=>window.document.querySelector('#erpa-task-status')?.textContent.includes('SKC'));
    assert.match(window.document.querySelector('#erpa-table-body').textContent,/SKC-OLD/,'reproduce prior preview');
    const report=intervals.get('reportExtensionStatus'),poll=intervals.get('pollCollectionTask');
    assert.ok(report&&poll);
    tasks=[];await poll();
    assert.doesNotMatch(window.document.querySelector('#erpa-task-status').textContent,/TASK-OLD|原范围/,'authoritative empty list clears stale task display');
    tasks=[oldTask];holdNext=true;const late=poll();await until(()=>releasePoll);
    reset=marker;await report();
    assert.equal(window.localStorage.getItem(resultKey),null,'heartbeat removes persisted preview/query');
    assert.equal(window.document.querySelector('#erpa-table-body').textContent,'');
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled,true,'cleared query cannot trigger old SKC again');
    assert.equal(window.document.querySelector('#erpa-export').disabled,true);
    assert.equal(window.document.querySelector('#erpa-resume').hidden,true);
    releasePoll();await late;
    assert.doesNotMatch(window.document.body.textContent,/SKC-OLD|SKU-OLD|WH-OLD|TASK-OLD/,'late task reply cannot restore old scope');
    assert.equal(window.localStorage.getItem('erp-preference'),'keep');
    assert.equal(JSON.parse(window.localStorage.getItem(resetKey)).resetId,marker.resetId);
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured',{detail:{url:'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-NEW'}}));
    await report();
    assert.equal(window.document.querySelector('#erpa-recalculate').disabled,false,'fresh query survives repeated marker');
    assert.deepEqual(errors,[]);
    const saved=JSON.parse(window.localStorage.getItem(resetKey));
    const reopened=new Window({url:sender.url});
    try {
      reopened.localStorage.setItem(resetKey,JSON.stringify(saved));
      reopened.localStorage.setItem(resultKey,JSON.stringify(cache()));
      reopened.setInterval=()=>0;reopened.chrome=window.chrome;reopened.fetch=window.fetch;
      for(const file of ['result-policy.js','catalog-collector.js','request-context.js','shopeers-bridge.js','content.js'])reopened.eval(await fs.readFile(path.join(src,file),'utf8'));
      await delay();
      assert.equal(reopened.localStorage.getItem(resultKey),null,'reopened page rejects old cache even before heartbeat');
      assert.equal(reopened.document.querySelector('#erpa-table-body').textContent,'');
    } finally {await reopened.happyDOM.close();}
  } finally {await window.happyDOM.close();}
}
if (!process.env.ERP_RESET_CONTENT_ONLY) await backgroundChecks();
await contentChecks();
console.log('ERP workspace reset: prior SKC preview, background cache/config isolation, offline/restart preservation, repeated clear, storage retry, empty task list, late reply and reopened page passed.');
