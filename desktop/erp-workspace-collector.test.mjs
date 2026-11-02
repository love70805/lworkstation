import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createWorkspaceErpCollector,PURCHASE_FILTERS}=require('./erp-workspace-collector.cjs');
function harness(){
  const input={workspaceId:'W',ledgerId:'L',requestId:'REQ'};
  let context={workspaceId:'W'},task=null,login=false,created=0,closed=0,reloads=0;
  const calls=[];
  const collector=createWorkspaceErpCollector({getContext:()=>context,interval:()=>1,clear:()=>{},createView:async url=>{
    created++;assert.match(url,/lworkstationRequest=REQ/);
    return {webContents:{isDestroyed:()=>false,close:()=>{closed++;},executeJavaScript:async()=>login,loadURL:async()=>{reloads++;}}};
  },requestInbox:async call=>{
    calls.push(structuredClone(call));
    if(call.route==='/erp/v1/requests')return {records:[{...input,status:'registered',platformSkcs:[{platformSkc:'SKC-A'}],expectedSkus:[{platformSku:'SKU-A',platformSkc:'SKC-A'}]}]};
    if(call.route==='/erp/v1/collection-tasks'){
      if(call.method==='POST')task={...input,taskId:'TASK',scopeHash:'SCOPE',status:'paused',filters:call.body.filters,batches:[{batchId:'B',status:'pending'}]};
      return call.method==='POST'?{task}:{tasks:task?[task]:[]};
    }
    if(call.route.endsWith('/control')){task={...task,status:call.body.action==='pause'?'paused':'ready'};return {task};}
    return {task};
  }});
  return {collector,input,calls,login(value){login=value;},context(value){context=value;},running(){task.status='running';},get created(){return created;},get closed(){return closed;},get reloads(){return reloads;}};
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
