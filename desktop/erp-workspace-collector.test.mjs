import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createWorkspaceErpCollector,PURCHASE_FILTERS}=require('./erp-workspace-collector.cjs');
function harness(){
  const input={workspaceId:'W',ledgerId:'L',requestId:'REQ'};
  let context={workspaceId:'W'},task=null,login=false,created=0,closed=0,reloads=0,requestStatus='registered';
  const calls=[];
  const collector=createWorkspaceErpCollector({getContext:()=>context,interval:()=>1,clear:()=>{},createView:async url=>{
    created++;assert.match(url,/lworkstationRequest=REQ/);
    return {webContents:{isDestroyed:()=>false,close:()=>{closed++;},executeJavaScript:async()=>login,loadURL:async()=>{reloads++;}}};
  },requestInbox:async call=>{
    calls.push(structuredClone(call));
    if(call.route==='/erp/v1/requests'){
      if(call.body?.request?.cancel)requestStatus='cancelled';
      return {records:[{...input,status:requestStatus,platformSkcs:[{platformSkc:'SKC-A'}],expectedSkus:[{platformSku:'SKU-A',platformSkc:'SKC-A'}]}]};
    }
    if(call.route==='/erp/v1/collection-tasks'){
      if(call.method==='POST')task={...input,taskId:'TASK',scopeHash:'SCOPE',status:'paused',filters:call.body.filters,batches:[{batchId:'B',status:'pending'}]};
      return call.method==='POST'?{task}:{tasks:task?[task]:[]};
    }
    if(call.route.endsWith('/control')){
      if(call.body.action==='request_resume')assert.ok(!['stopped','invalidated','completed'].includes(task.status),'terminal tasks must not be resumed');
      task={...task,status:call.body.action==='pause'?'paused':call.body.action==='stop'?'stopped':'ready',pauseReason:undefined};return {task};
    }
    return {task};
  }});
  return {collector,input,calls,login(value){login=value;},context(value){context=value;},running(){task.status='running';},update(value){Object.assign(task,value);},register(id){input.requestId=id;requestStatus='registered';task=null;},get created(){return created;},get closed(){return closed;},get reloads(){return reloads;}};
}
test('starts one immutable desktop task with no foreground form or clipboard operation',async()=>{
  const h=harness();await Promise.all([h.collector.start(h.input),h.collector.start(h.input)]);
  assert.equal(h.created,1);
  const create=h.calls.find(call=>call.route==='/erp/v1/collection-tasks'&&call.method==='POST');
  assert.equal(create.body.executionTarget,'desktop');assert.deepEqual(create.body.filters,{...PURCHASE_FILTERS,sku:'SKC-A'});
  assert.equal(h.collector.snapshot().status,'ready');h.collector.dispose();
});
test('waits for first login and resumes only that fixed task after login',async()=>{
  const h=harness();h.login(true);await h.collector.start(h.input);assert.equal(h.collector.snapshot().status,'waiting_login');
  h.login(false);await h.collector.sessionChanged();await h.collector.poll();assert.equal(h.reloads,1);assert.equal(h.collector.snapshot().requestId,'REQ');h.collector.dispose();
});
test('stops and cancels old-session work instead of combining accounts',async()=>{
  const h=harness();await h.collector.start(h.input);h.running();await h.collector.poll();await h.collector.sessionChanged();
  assert.equal(h.closed,1);assert.equal(h.collector.snapshot().status,'session_changed');
  assert.ok(h.calls.some(call=>call.route==='/erp/v1/requests'&&call.body?.request?.cancel));
  await assert.rejects(h.collector.start(h.input),/登录已变化/);h.collector.dispose();
});
test('rejects foreign workspaces before transport and stops a running view when the workspace changes',async()=>{
  const h=harness();await assert.rejects(h.collector.start({...h.input,workspaceId:'OTHER'}),/工作区/);assert.equal(h.calls.length,0);
  await h.collector.start(h.input);h.context({workspaceId:'OTHER'});await h.collector.poll();assert.equal(h.closed,1);assert.equal(h.collector.snapshot().status,'workspace_changed');h.collector.dispose();
});

test('stopped work wins over login pages and old batch errors, then one click creates new work',async()=>{
  const h=harness();h.login(true);await h.collector.start(h.input);
  h.update({status:'stopped',batches:[{status:'failed',error:{message:'请先登录 ERP'}}]});
  await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'stopped');assert.equal(h.closed,1);
  h.login(false);
  const result=await h.collector.start(h.input);
  assert.equal(result.status,'ready');assert.equal(h.created,2);h.collector.dispose();
});

test('login callback never tries to resume a task stopped before the next poll',async()=>{
  const h=harness();h.login(true);await h.collector.start(h.input);
  h.update({status:'stopped'});h.login(false);await h.collector.sessionChanged();
  assert.equal(h.collector.snapshot().status,'session_changed');assert.equal(h.reloads,0);
  await assert.rejects(h.collector.start(h.input),{code:'ERP_SESSION_CHANGED'});h.collector.dispose();
});

test('a fresh registration restarts after logout while the old session stays cancelled',async()=>{
  const h=harness();await h.collector.start(h.input);h.running();await h.collector.poll();
  h.login(true);await h.collector.sessionChanged();h.login(false);
  await assert.rejects(h.collector.start(h.input),{code:'ERP_SESSION_CHANGED'});
  h.register('REQ-NEW');const result=await h.collector.start(h.input);
  assert.equal(result.requestId,'REQ-NEW');assert.equal(result.status,'ready');assert.equal(h.created,2);h.collector.dispose();
});

test('historical login errors do not override a running task or prevent retry of a pause',async()=>{
  const h=harness();await h.collector.start(h.input);
  h.update({status:'running',batches:[{status:'delivered',deliveryId:'RECEIPT',error:{message:'请先登录'}}]});
  await h.collector.poll();assert.equal(h.collector.snapshot().status,'running');
  h.update({status:'paused'});await h.collector.start(h.input);
  assert.equal(h.collector.snapshot().status,'ready');
  assert.equal(h.created,2);h.collector.dispose();
});

test('a permission pause closes the hidden view and continues the same task without requiring another login',async()=>{
  const h=harness();await h.collector.start(h.input);
  h.update({status:'paused',pauseReason:{code:'ERP_PERMISSION_REQUIRED'},batches:[{status:'delivered',deliveryId:'RECEIPT'},{status:'pending'}]});
  await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'paused');assert.equal(h.closed,1);
  const result=await h.collector.start(h.input);
  assert.equal(result.status,'ready');assert.equal(result.taskId,'TASK');assert.equal(h.created,2);
  assert.equal(h.calls.filter(call=>call.route==='/erp/v1/collection-tasks'&&call.method==='POST').length,1);
  h.collector.dispose();
});
