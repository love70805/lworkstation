import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { handleCollectionTaskRequest, validateCollectionDelivery, recordCollectionDelivery } from './erp-collection-tasks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const sourceDir = path.join(root, 'integrations/erp-assistant-extension/src');
const source = Object.fromEntries(await Promise.all(['background.js','result-policy.js','catalog-collector.js','request-context.js','shopeers-bridge.js','content.js'].map(async name => [name, await readFile(path.join(sourceDir,name),'utf8')])));
const extensionVersion=JSON.parse(await readFile(path.join(root,'integrations/erp-assistant-extension/manifest.json'),'utf8')).version;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scenario(size, mode = '') {
  const skcs = Array.from({length:size},(_,i) => `SKC-${i}`);
  const request = { kind:'request', requestId:'REQ', workspaceId:'WS', ledgerId:'LEDGER', ledgerPeriod:'2026-08', ledgerVersion:'IMPORT-1', registeredAt:new Date(Date.now()-60000).toISOString(), status:'registered', platformSkcs:skcs.map(platformSkc => ({platformSkc,canonicalPlatformSkc:platformSkc})), expectedSkus:skcs.map((platformSkc,i)=>({platformSkc,platformSku:`SKU-${i}`,store:'店铺一'})) };
  const records = [request], deliveries = [], calls = [], listTimes = new Map();
  const storage = { shopeersErpInboxBaseUrl:'http://127.0.0.1:5397', shopeersErpInboxCapability:'SYNTHETIC-CAPABILITY-01234567890123456789', shopeersErpWorkspaceId:'WS' };
  let dispatch, window, inflight = 0, maxInflight = 0, maxInflightAfterLimit = 0, lists = 0, maxLists = 0, paused = false, lostAck = false, limited = false, remoteStopped = false;
  const sender = { url:'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html', frameId:0 };
  const chrome = { storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(storage[key])])),set:async values=>Object.assign(storage,structuredClone(values))}},runtime:{getManifest:()=>({version:extensionVersion}),onMessage:{addListener:fn=>{dispatch=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{create(){},onAlarm:{addListener(){}}} };
  const context = vm.createContext({ __SHOPEERS_ERP_BACKGROUND_TEST__:true,chrome,URL,AbortController,TextEncoder,crypto:webcrypto,setTimeout,clearTimeout,console,fetch:async(raw,init={})=>{
    const url = new URL(raw), payload = init.body ? JSON.parse(init.body) : {};
    let body;
    try {
      const result = handleCollectionTaskRequest(records,{method:init.method||'GET',url,payload,instanceId:'test'});
      if (result) body=result.body;
      else if(url.pathname==='/erp/v1/requests') body={records:[request]};
      else if(url.pathname==='/erp/v1/extension-status') body={ok:true};
      else if(url.pathname==='/erp/v1/cost-results') {
        const task = validateCollectionDelivery(records,payload);
        const existing = deliveries.find(item=>item.resultDeliveryId===payload.resultDeliveryId);
        if(existing) return {ok:true,status:200,json:async()=>({deliveryId:existing.deliveryId,batchId:existing.batchId,resultDeliveryId:payload.resultDeliveryId})};
        body={deliveryId:`DEL-${deliveries.length}`,batchId:`IMPORT-${deliveries.length}`,resultDeliveryId:payload.resultDeliveryId};
        recordCollectionDelivery(task,body); deliveries.push({...payload,...body,listCount:calls.filter(x=>x.endpoint==='purchase-order-page').length});
      } else throw Error(url.pathname);
      return {ok:true,status:200,json:async()=>structuredClone(body)};
    } catch(error) {return {ok:false,status:error.status||400,json:async()=>({code:error.code,message:error.message})};}
  }});
  vm.runInContext(source['background.js'],context);
  async function open() {
    window = new Window({url:sender.url});
    window.confirm=()=>true;
    const schedule=window.setTimeout.bind(window);
    if(mode==='lost-ack')window.setTimeout=(fn,ms,...args)=>schedule(fn,[15000,210000].includes(ms)?100:ms,...args);
    window.chrome={runtime:{sendMessage:(message,done)=>dispatch(message,sender,response=>{
      if(mode==='lost-ack'&&!lostAck&&message.type==='shopeers.erp.submitCostResult'){lostAck=true;return;}
      done(response);
    })}};
    window.fetch=async raw=>{
      const url=new URL(raw),endpoint=url.pathname.split('/').at(-1),target=url.searchParams.get('sku')||url.searchParams.get('purchaseOrderId')||url.searchParams.get('productId')||url.searchParams.get('skuGroup');
      assert.notEqual(target,'[object Object]'); calls.push({endpoint,target,at:Date.now()});
      const timeKey = Math.floor(Number(target.split('-').at(-1)) / 20);
      if(endpoint==='purchase-order-page'&&!listTimes.has(timeKey))listTimes.set(timeKey,{start:performance.now()});
      inflight++; maxInflight=Math.max(maxInflight,inflight);if(limited)maxInflightAfterLimit=Math.max(maxInflightAfterLimit,inflight);
      if(endpoint==='purchase-order-page'){lists++;maxLists=Math.max(maxLists,lists);}
      if(mode==='pause' && !paused && deliveries.length===1 && endpoint==='purchase-order-page'){paused=true;window.document.getElementById('erpa-pause').click();}
      if(mode==='remote-stop'&&!remoteStopped&&endpoint==='purchase-order-page'){
        remoteStopped=true;schedule(()=>{records[1].status='stopped';},10);
      }
      await delay(mode==='remote-stop'&&endpoint==='purchase-order-page'?4000:mode.startsWith('benchmark') ? 8 : 1);
      inflight--; if(endpoint==='purchase-order-page'){lists--;listTimes.get(timeKey).end=performance.now();}
      if(mode==='throttle'&&!limited&&endpoint==='purchase-order-page'){limited=true;return {ok:false,status:429,statusText:'Limited',headers:{get:()=> '1'}};}
      const id=target.split('-').at(-1);
      const data=endpoint==='product-page'?[{itemId:`WH-${mode==='shared-orders'?Number(id)%20:id}`}]:endpoint==='purchase-order-page'?[{purchaseOrderId:`PO-${mode==='shared-orders'?Number(id)%20:id}`}]:endpoint==='purchase-order-details'?[{purchaseOrderDetailId:`D-${id}`,itemId:`WH-${id}`,creationTime:'2026-08-20',purchaseQuantity:2,purchaseUnitPrice:4}]:Array.from({length:mode==='shared-orders'?size/20:1},(_,index)=>({associatedProductId:`WH-${id}`,barcodeSkuid:`SKU-${Number(id)+index*20}`,barcodeSkcid:`SKC-${Number(id)+index*20}`}));
      return {ok:true,status:200,json:async()=>({code:0,count:data.length,data})};
    };
    for(const name of ['result-policy.js','catalog-collector.js','request-context.js','shopeers-bridge.js','content.js'])window.eval(mode==='benchmark-serial'&&name==='content.js'?source[name].replace('mapConcurrent(querySkcs, 2,','mapConcurrent(querySkcs, 1,'):source[name]);
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured',{detail:{url:'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-0'}}));
  }
  const until=async predicate=>{const end=Date.now()+120000;while(!predicate()){if(Date.now()>end)throw Error(window.document.body.textContent.slice(0,2500));await delay(5);}};
  const began=Date.now();
  try {
    await open(); window.document.getElementById('erpa-cost-trigger').click();
    if(mode==='remote-stop'){
      await until(()=>remoteStopped&&!window.document.getElementById('erpa-recalculate').disabled);
      assert.equal(records[1].status,'stopped');assert.equal(deliveries.length,0);assert.equal(calls.filter(call=>call.endpoint==='purchase-order-page').length,2,'remote stop aborts active purchase requests and prevents new work');assert.equal(calls.filter(call=>call.endpoint==='purchase-order-details').length,0);
      console.log(JSON.stringify({mode,elapsedMs:Date.now()-began,requests:calls.length,delivered:0}));return;
    }
    if(mode==='lost-ack'){
      await until(()=>lostAck&&!window.document.getElementById('erpa-recalculate').disabled);
      assert.equal(deliveries.length,1);assert.equal(records[1].batches[0].status,'delivered','lost page ACK does not demote service receipt');
      window.document.getElementById('erpa-resume').click();
    }
    if(mode==='pause'){
      await until(()=>paused&&!window.document.getElementById('erpa-recalculate').disabled);
      assert.equal(deliveries.length,1);assert.equal(records[1].status,'paused');
      const before=calls.length;await window.happyDOM.close(); await open();
      window.document.getElementById('erpa-cost-trigger').click();await delay(40);
      assert.equal(calls.length,before,'restart never automatically resumes ERP reads');
      window.document.getElementById('erpa-resume').click();
    }
    await until(()=>deliveries.length===Math.ceil(size/20)&&!window.document.getElementById('erpa-recalculate').disabled);
    assert.equal(records[1].summary.delivered,size);
    assert.equal(new Set(deliveries.map(item=>item.resultDeliveryId)).size,deliveries.length);
    assert.ok(deliveries[0].listCount<=(mode==='throttle'?21:20),'first batch delivered before all targets');
    assert.equal(maxLists,mode==='benchmark-serial'?1:2);assert.ok(maxInflight<=8);
    assert.ok(deliveries.every(item=>item.querySkcs.length<=20&&item.warehouseEvidence.warehouses.every(row=>row.evidenceComplete)));
    if(mode==='throttle'){
      const target=calls.find(item=>item.endpoint==='purchase-order-page').target,attempts=calls.filter(item=>item.endpoint==='purchase-order-page'&&item.target===target);
      assert.equal(attempts.length,2);assert.ok(attempts[1].at-attempts[0].at>=1000,'Retry-After is honored');assert.ok(maxInflightAfterLimit<=2,'rate limiting reduces global concurrency after the 429 response');
    }
    if(mode==='lost-ack')assert.equal(calls.filter(item=>item.endpoint==='purchase-order-page'&&item.target==='SKC-0').length,1,'lost ACK recovery does not reread delivered first batch');
    if(mode==='pause')assert.equal(calls.filter(item=>item.endpoint==='purchase-order-page'&&item.target==='SKC-0').length,1,'delivered batch not reread after restart');
    if(mode==='shared-orders'){
      assert.equal(calls.filter(item=>item.endpoint==='purchase-order-details').length,20,'shared orders are read once across batches');
      assert.equal(calls.filter(item=>item.endpoint==='product-info-sku').length,20,'shared warehouse mappings are read once across batches');
      assert.equal(new Set(deliveries.flatMap(item=>item.rows.map(row=>row.platformSku))).size,size);
      const sharedTitle=window.document.querySelector('.erpa-cell-platform').getAttribute('title');
      assert.match(sharedTitle,/SKU-0 · SKC-0/);assert.match(sharedTitle,/SKU-80 · SKC-80/,'preview preserves mappings across all five batches');
    }
    if(mode==='recalculate'){
      listTimes.clear();const oldId=records[1].taskId;window.document.getElementById('erpa-recalculate').click();
      await until(()=>deliveries.length===Math.ceil(size/20)*2&&!window.document.getElementById('erpa-recalculate').disabled);
      assert.equal(records[1].status,'stopped');assert.notEqual(records[2].taskId,oldId);
      assert.equal(calls.filter(item=>item.endpoint==='purchase-order-details').length,size*2,'explicit new task rereads authoritative history');
    }
    const listMs=[...listTimes.values()].reduce((sum,time)=>sum+time.end-time.start,0);
    console.log(JSON.stringify({size,mode,listMs:Math.round(listMs),elapsedMs:Date.now()-began,requests:calls.length,maxInflight,maxLists,batches:deliveries.length,duplicateRequests:calls.length-(mode==='shared-orders'?size*2+40:mode==='recalculate'?size*8:size*4),heapMb:Math.round(process.memoryUsage().heapUsed/1048576)}));
    return listMs;
  } finally {await window.happyDOM.close();}
}
if(process.env.ERP_BATCH_SCENARIO){await scenario(100,process.env.ERP_BATCH_SCENARIO);} else {
for(const size of [100,500,2000])await scenario(size);
await scenario(40,'pause');
await scenario(40,'lost-ack');
await scenario(40,'remote-stop');
await scenario(40,'throttle');
await scenario(100,'shared-orders');
await scenario(40,'recalculate');

const serialMs=await scenario(100,'benchmark-serial');
const parallelMs=await scenario(100,'benchmark-parallel');
assert.ok(parallelMs/serialMs<=0.7,`two-worker list phase must improve >=30% (${serialMs}→${parallelMs} ms)`);
console.log(JSON.stringify({listImprovementPercent:Math.round((1-parallelMs/serialMs)*100)}));

// Use the real optional collector with enough valid warehouse mappings to cross
// the previous 500-request cap; retain bounded paging and evidence validation.
{
 const window=new Window(); let calls=0;
 try {
  window.eval(source['result-policy.js']);window.eval(source['catalog-collector.js']);
  const collector=window.ShopeersErpCatalogCollector.create({policy:window.ShopeersErpResultPolicy,apiGet:async(path,params)=>{
   calls++;
   const data=path.endsWith('product-page')?Array.from({length:Math.max(0,Math.min(100,601-(params.page-1)*100))},(_,i)=>({itemId:`WH-${(params.page-1)*100+i}`})):[{associatedProductId:params.productId,barcodeSkuid:`SKU-${params.productId}`,barcodeSkcid:'SKC-A'}];
   return {code:0,count:path.endsWith('product-page')?601:data.length,data};
  },readWarehouseEvidence:async warehouseSku=>({warehouseSku,evidenceComplete:true,purchaseRecords:[],excludedRecords:[]})});
  const result=await collector.collect(['SKC-A'],{controller:new AbortController(),expectedSkus:Array.from({length:601},(_,i)=>({platformSku:`SKU-WH-${i}`,platformSkc:'SKC-A'}))});
  assert.equal(result.results.length,601);assert.ok(calls>500);assert.equal(result.coverage.mappings.state,'complete');
  const pauseCollector=window.ShopeersErpCatalogCollector.create({policy:window.ShopeersErpResultPolicy,apiGet:async()=>{throw Object.assign(new Error('paused'),{code:'ERP_COLLECTION_PAUSED'});},readWarehouseEvidence:async()=>{}});
  await assert.rejects(()=>pauseCollector.collect(['SKC-A'],{controller:new AbortController(),expectedSkus:[{platformSku:'SKU-ONE',platformSkc:'SKC-A'}]}),error=>error.code==='ERP_COLLECTION_PAUSED');
  console.log(JSON.stringify({catalogRequests:calls,catalogWarehouses:result.results.length,pausePropagated:true}));
 } finally {await window.happyDOM.close();}
}

}
