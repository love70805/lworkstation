import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { handleCollectionTaskRequest, collectionScopeHash, recoverCollectionTasks, recordCollectionDelivery } from './erp-collection-tasks.mjs';

{
  const records = [{ kind: 'request', status: 'registered', requestId: 'R-reason', workspaceId: 'W', ledgerId: 'L', platformSkcs: ['A'], expectedSkus: [] }];
  const call = (suffix, payload) => handleCollectionTaskRequest(records, { method: 'POST', url: new URL(`http://localhost/erp/v1/collection-tasks${suffix}`), payload: { workspaceId: 'W', ...payload }, instanceId: 'I' }).body;
  const { task } = call('', { requestId: 'R-reason' });
  call(`/${task.taskId}/control`, { action: 'resume' });
  const { batch } = call(`/${task.taskId}/batches/${task.batches[0].batchId}`, { state: 'running' });
  const batchUrl = `/${task.taskId}/batches/${batch.batchId}`;
  call(batchUrl, { state: 'collected', attemptId: batch.attemptId, evidenceComplete: false, error: '平台 SKU 映射不完整 2 个仓库 SKU（ERP 返回空映射 2 个）' });
  recordCollectionDelivery({ task, batch }, { deliveryId: 'D', resultDeliveryId: 'RESULT', evidenceComplete: false });
  assert.equal(batch.status, 'incomplete'); assert.match(batch.error, /空映射 2 个/);
  assert.equal(task.summary.delivered, 1, 'incomplete evidence still has a durable receipt');
  call(`/${task.taskId}/control`, { action: 'retry_failed' });
  assert.equal(batch.deliveryId, undefined); assert.equal(batch.resultDeliveryId, undefined);
  assert.equal(batch.collectedAt, undefined); assert.equal(batch.catalogStatus, undefined);
  call(batchUrl, { state: 'running' });
  call(batchUrl, { state: 'collected', attemptId: batch.attemptId, evidenceComplete: true });
  recordCollectionDelivery({ task, batch }, { deliveryId: 'D2', resultDeliveryId: 'RESULT2', evidenceComplete: true });
  assert.equal(batch.error, null); assert.equal(batch.status, 'delivered');
}

// Scale and time are deterministic; no ERP account or real workspace is used.
for (const size of [100, 500, 2000]) {
  const records = [{ kind:'request', status:'registered', requestId:'R', workspaceId:'W', ledgerId:'L', ledgerVersion:'v1', ledgerPeriod:'2026-09',
    platformSkcs:Array.from({length:size},(_,i)=>({platformSkc:`skc-${i}`})), expectedSkus:[] }];
  const call = (suffix, payload, now=100000) => handleCollectionTaskRequest(records,{method:'POST',url:new URL(`http://localhost/erp/v1/collection-tasks${suffix}`),payload:{workspaceId:'W',...payload},instanceId:'I',now}).body;
  const {task} = call('',{requestId:'R',filters:{status:'all'}});
  assert.equal(task.batches.length,size/20); assert.equal(task.summary.total,size); assert.equal(task.status,'paused');
  call(`/${task.taskId}/control`,{action:'resume'});
  const first = call(`/${task.taskId}/batches/${task.batches[0].batchId}`,{state:'running'}).batch;
  const attempt = first.attemptId;
  call(`/${task.taskId}/control`,{action:'pause'});
  assert.throws(()=>call(`/${task.taskId}/batches/${task.batches[1].batchId}`,{state:'running'}),/等待/);
  call(`/${task.taskId}/batches/${first.batchId}`,{state:'collected',attemptId:attempt});
  call(`/${task.taskId}/control`,{action:'resume'});
  assert.equal(first.status,'collected');
  assert.equal(first.attemptId,attempt,'collected attempt retained for lost receipt recovery');
  call(`/${task.taskId}/batches/${first.batchId}`,{state:'pending',attemptId:attempt});
  assert.equal(first.status,'pending');
  call(`/${task.taskId}/batches/${first.batchId}`,{state:'running'});
  assert.notEqual(first.attemptId,attempt);
  assert.throws(()=>call(`/${task.taskId}/batches/${first.batchId}`,{state:'failed',attemptId:attempt}),/旧尝试/);
  assert.equal(recoverCollectionTasks(records,'after-restart',100001),true);
  assert.equal(task.status,'paused');
  assert.throws(()=>call(`/${task.taskId}/control`,{action:'heartbeat'}),/继续/);
  const scope = collectionScopeHash(records[0]);
  records[0].ledgerVersion='v2';
  assert.throws(()=>call(`/${task.taskId}/control`,{action:'resume'}),/已变化/);
  records[0].ledgerVersion='v1'; records[0].status='expired';
  assert.throws(()=>call(`/${task.taskId}/control`,{action:'resume'}),/核对/);
  call(`/${task.taskId}/control`,{action:'resume',scopeHash:scope});
  assert.equal(task.status,'running');
  assert.throws(()=>call(`/${task.taskId}/control`,{action:'resume',filters:{status:'changed'}}),/已变化/);
  const scopedStore={...records[0],expectedSkus:[{platformSku:'SKU',platformSkc:'skc-0',store:'680店'}]};
  assert.notEqual(collectionScopeHash(scopedStore),collectionScopeHash({...scopedStore,expectedSkus:[{platformSku:'SKU',platformSkc:'skc-0',store:'681店'}]}));
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(),'erp-task-contract-'));
const spool = path.join(dir,'spool.json');
const port = 26000 + Math.floor(Math.random()*5000);
const capability = 'test-collection-task-capability-0123456789abcdef';
let child;
async function start() {
  child=spawn(process.execPath,[new URL('./erp-inbox-server.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,SHOPEERS_ERP_INBOX_PORT:String(port),SHOPEERS_ERP_INBOX_FILE:spool,SHOPEERS_ERP_INBOX_CAPABILITY:capability},
  });
  await new Promise((resolve,reject)=>{ const timeout=setTimeout(()=>reject(Error('server startup timeout')),5000); child.stdout.on('data',data=>{if(String(data).includes('listening')){clearTimeout(timeout);resolve();}}); child.once('error',reject); });
}
async function stop() { const exited=once(child,'exit'); child.kill(); await exited; }
async function request(suffix,payload,expected=200) {
  if(suffix.startsWith('collection-tasks')) {
    if(payload!==undefined) payload={workspaceId:'W-http',...payload};
    else if(!suffix.includes('workspaceId=')) suffix+=`${suffix.includes('?')?'&':'?'}workspaceId=W-http`;
  }
  const response=await fetch(`http://127.0.0.1:${port}/erp/v1/${suffix}`,{method:payload===undefined?'GET':'POST',headers:{authorization:`Bearer ${capability}`,'content-type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  const body=await response.json(); assert.equal(response.status,expected,JSON.stringify(body)); return body;
}
const scope={id:'R-http',workspaceId:'W-http',ledgerId:'L-http',ledgerPeriod:'2026-09',ledgerVersion:'import-v1',platformSkcs:[{platformSkc:'SKC-A'}]};
try {
  await start();
  const missingWorkspace=await fetch(`http://127.0.0.1:${port}/erp/v1/collection-tasks`,{headers:{authorization:`Bearer ${capability}`}});
  assert.equal(missingWorkspace.status,400);
  await request('requests',{request:scope,expectedSkus:[{platformSku:'SKU-A',platformSkc:'SKC-A',store:'680店'}]},202);
  let {task}=await request('collection-tasks',{requestId:scope.id,filters:{createTimePeriod:[]}},201);
  const taskUrl=`collection-tasks/${task.taskId}`;
  const batchUrl=`${taskUrl}/batches/${encodeURIComponent(task.batches[0].batchId)}`;
  await request(`${taskUrl}?workspaceId=wrong`,undefined,403);
  await request(`${taskUrl}/control`,{workspaceId:'wrong',action:'stop'},403);
  await request('collection-tasks',{requestId:scope.id,workspaceId:'wrong'},403);
  const concurrent=await Promise.all(Array.from({length:5},()=>request('collection-tasks',{requestId:scope.id,filters:{createTimePeriod:[]}})));
  assert.equal(new Set(concurrent.map(item=>item.task.taskId)).size,1);
  ({task}=await request(`${taskUrl}/control`,{action:'resume'}));
  let {batch}=await request(batchUrl,{state:'running'});
  const originalAttempt=batch.attemptId;
  await request(batchUrl,{state:'collected',attemptId:batch.attemptId});
  const payload={requestId:scope.id,workspaceId:scope.workspaceId,ledgerId:scope.ledgerId,querySkcs:['SKC-A'],resultDeliveryId:'RESULT-TASK-A',
    collectionTask:{taskId:task.taskId,batchId:batch.batchId,attemptId:batch.attemptId},rows:[{platformSku:'SKU-A',platformSkc:'SKC-A',warehouseSku:'WH-A',unitCost:4,totalPrice:8,totalQuantity:2,calculationCount:1}],
    sourceMeta:{evidenceComplete:true},warehouseEvidence:{evidenceVersion:1,evidenceComplete:true,warehouses:[{warehouseSku:'WH-A',evidenceComplete:true,purchaseRecords:[{quantity:2,totalPrice:8,unitPrice:4,recordId:'P-1',warehouseSku:'WH-A'}]}]}};
  const receipt=await request('cost-results',payload,202);
  ({task}=await request(taskUrl));
  assert.equal(task.summary.delivered,1); assert.equal(task.summary.adopted,0); assert.equal(task.status,'cost_complete');
  assert.equal(task.batches[0].deliveryId,receipt.deliveryId);
  await request('requests',{request:{...scope,id:'R-must-wait-catalog',replaceLedgerScope:true},expectedSkus:[]},409);
  assert.equal((await request('cost-results',payload)).idempotent,true);
  await request('cost-batches',{status:'acknowledged',deliveryId:receipt.deliveryId,workspaceId:scope.workspaceId});
  assert.equal((await request(taskUrl)).task.summary.adopted,0,'receipt ACK cannot claim adopted');
  await request(`${taskUrl}/adoption`,{deliveryId:receipt.deliveryId,adoptedCount:0,manualEffectiveCount:1,expectedCount:1});
  assert.equal((await request(taskUrl)).task.summary.adopted,0,'manual effective is distinct from actual ERP adoption');
  assert.equal((await request(taskUrl)).task.summary.manualEffective,1);
  await request(`${taskUrl}/adoption`,{deliveryId:receipt.deliveryId,adoptedCount:1,manualEffectiveCount:1,expectedCount:1},400);
  await request(`${taskUrl}/adoption`,{deliveryId:receipt.deliveryId,adoptedCount:1,expectedCount:1});
  await request(batchUrl,{state:'catalog_running',attemptId:originalAttempt});
  await stop(); await start();
  const catalogRecovery=(await request(taskUrl)).task;
  assert.equal(catalogRecovery.status,'paused');
  assert.equal(catalogRecovery.recoveryRequired,true);
  assert.equal(catalogRecovery.batches[0].deliveryId,receipt.deliveryId);
  assert.equal(catalogRecovery.summary.adopted,1);
  await request(`${taskUrl}/control`,{action:'heartbeat'},409);
  await request(`${taskUrl}/control`,{action:'resume'});
  await request(batchUrl,{state:'catalog_completed',attemptId:originalAttempt});
  await stop(); await start();
  ({task}=await request(taskUrl)); assert.equal(task.summary.adopted,1); assert.equal(task.batches[0].attemptId,originalAttempt);
  assert.equal(task.status,'cost_complete','fully completed catalog does not need restart recovery');

  // A pending second task survives restart; old attempt cannot submit after explicit resume.
  await request('requests',{request:{...scope,id:'R-two',platformSkcs:['SKC-B']},expectedSkus:[{platformSku:'SKU-B',platformSkc:'SKC-B'}]},202);
  await request('requests',{request:{kind:'catalog',id:'R-two-CATALOG',workspaceId:scope.workspaceId,ledgerId:scope.ledgerId,ledgerPeriod:scope.ledgerPeriod,platformSkcs:['SKC-B'],confirmedSkus:[{platformSku:'SKU-B',platformSkc:'SKC-B'}],sourceRequestId:'R-two',idempotencyKey:'R-two-CATALOG',requestedAt:new Date().toISOString()}},202);
  const second=(await request('collection-tasks',{requestId:'R-two',filters:{}},201)).task;
  const secondUrl=`collection-tasks/${second.taskId}`;
  const secondBatchUrl=`${secondUrl}/batches/${encodeURIComponent(second.batches[0].batchId)}`;
  await request(`${secondUrl}/control`,{action:'resume'});
  const old=(await request(secondBatchUrl,{state:'running'})).batch;
  await request(`${secondUrl}/control`, { action: 'pause', reason: { code: 'ERP_SERVICE_UNAVAILABLE', message: '维护期间未取得响应', cookie: 'discard' } });
  await stop(); await start();
  assert.deepEqual(Object.keys((await request(secondUrl)).task.pauseReason).sort(), ['at', 'code', 'message']);
  assert.equal((await request(secondUrl)).task.pauseReason.code, 'ERP_SERVICE_UNAVAILABLE', 'service pause survives a real service restart');
  await request(`${secondUrl}/control`, { action: 'resume' });
  assert.equal((await request(secondUrl)).task.pauseReason, undefined);
  await request(secondBatchUrl, { state: 'running' });
  await request('requests',{request:{...scope,id:'R-three',replaceLedgerScope:true},expectedSkus:[]},409);
  await stop(); await start();
  assert.equal((await request(secondUrl)).task.recoveryRequired,true);
  await request(`${secondUrl}/control`,{action:'resume'});
  const fresh=(await request(secondBatchUrl,{state:'running'})).batch;
  assert.notEqual(fresh.attemptId,old.attemptId);
  await request(secondBatchUrl,{state:'collected',attemptId:old.attemptId},409);
  await request('cost-results',{...payload,requestId:'R-two',resultDeliveryId:'STALE',querySkcs:['SKC-B'],collectionTask:{taskId:second.taskId,batchId:old.batchId,attemptId:old.attemptId}},409);
  await request(secondBatchUrl,{state:'failed',attemptId:fresh.attemptId,error:'timeout'});
  await request(`${secondUrl}/control`,{action:'retry_failed'});
  assert.equal((await request(secondUrl)).task.batches[0].status,'pending');
  const before=(await request('requests?workspaceId=W-http&includeHistory=true')).records.find(item=>item.requestId==='R-two').registeredAt;
  const evidenceBeforeHeartbeat = await fs.readFile(spool, 'utf8');
  await request(`${secondUrl}/control`,{action:'heartbeat'});
  assert.equal(await fs.readFile(spool, 'utf8'), evidenceBeforeHeartbeat, 'heartbeat must not rewrite historical evidence');
  const leases = JSON.parse(await fs.readFile(`${spool}.leases.json`, 'utf8'));
  assert.equal(leases.find(item => item.taskId === second.taskId).scopeHash, second.scopeHash);
  assert.ok((await fs.stat(`${spool}.leases.json`)).size < 5000, 'lease durability uses bounded metadata');
  assert.equal((await request('requests?workspaceId=W-http&includeHistory=true')).records.find(item=>item.requestId==='R-two').registeredAt,before);
  await stop();
  const persisted=JSON.parse(await fs.readFile(spool,'utf8'));
  const longRequest=persisted.find(item=>item.kind==='request'&&item.requestId==='R-two');
  longRequest.registeredAt=new Date(Date.now()-3*60*60*1000).toISOString();
  const longCatalog=persisted.find(item=>item.kind==='request'&&item.requestId==='R-two-CATALOG');
  longCatalog.registeredAt=longRequest.registeredAt;
  await fs.writeFile(spool,JSON.stringify(persisted));
  await start();
  assert.equal((await request('requests?workspaceId=W-http')).records.find(item=>item.requestId==='R-two').status,'registered','independent lease survives original two hour deadline');
  assert.equal((await request('requests?workspaceId=W-http')).records.find(item=>item.requestId==='R-two-CATALOG').status,'registered','companion catalog lease survives long cost stage');
  await stop();
  const expiredRecords=JSON.parse(await fs.readFile(spool,'utf8'));
  const expired=expiredRecords.find(item=>item.kind==='request'&&item.requestId==='R-two');
  expired.leaseExpiresAt=new Date(Date.now()-1000).toISOString();
  await fs.writeFile(spool,JSON.stringify(expiredRecords));
  // Expiry includes the latest durable heartbeat, rather than the older lease
  // in the evidence snapshot. Restart still requires explicit task recovery.
  const expiredLeases = JSON.parse(await fs.readFile(`${spool}.leases.json`, 'utf8'));
  expiredLeases.find(item => item.taskId === second.taskId).leaseExpiresAt = expired.leaseExpiresAt;
  await fs.writeFile(`${spool}.leases.json`, JSON.stringify(expiredLeases));
  await start();
  assert.equal((await request('requests?workspaceId=W-http&includeHistory=true')).records.find(item=>item.requestId==='R-two').status,'expired');
  await request('requests',{request:{...scope,id:'R-cannot-bypass-expired-task',replaceLedgerScope:true},expectedSkus:[]},409);
  await request(`${secondUrl}/control`,{action:'resume'},409);
  const expiredTask=(await request(secondUrl)).task;
  await request(`${secondUrl}/control`,{action:'resume',scopeHash:expiredTask.scopeHash});
  await request(`${secondUrl}/control`,{action:'stop'});
  await request(secondBatchUrl,{state:'running'},409);
  await request('requests',{request:{...scope,id:'R-four',replaceLedgerScope:true},expectedSkus:[]},202);
  console.log('ERP task persistence, restart, batching scale, receipts, adoption, lease, scope, pause and attempt-fencing tests passed');
} finally {
  if(child?.exitCode===null) await stop();
  await fs.rm(dir,{recursive:true,force:true});
}
