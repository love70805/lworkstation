import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createWorkspaceErpCollector,PURCHASE_FILTERS}=require('./erp-workspace-collector.cjs');
function deferred(){
  let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};
}
function harness(options={}){
  const input={workspaceId:'W',ledgerId:'L',requestId:'REQ'};
  let context={workspaceId:'W'},task=null,login=false,created=0,closed=0,reloads=0,requestStatus='registered',clock=0;
  let nextRead=null,nextCreation=null,nextProbe=null,nextReconnectError=null,claimOnReconnect=false;
  const calls=[],views=[],retainedTasks=new Map();
  const collector=createWorkspaceErpCollector({getContext:()=>context,now:()=>clock,ackTimeoutMs:100,checkSession:async()=>!login,...options,interval:()=>1,clear:()=>{},createView:async url=>{
    created++;assert.equal(new URL(url).searchParams.get('lworkstationRequest'),input.requestId);
    assert.equal(new URL(url).searchParams.get('lworkstationResume'),task.resumeRequestId,'the page is bound to the exact execution intent');
    const view={url,destroyed:false,webContents:{isDestroyed:()=>view.destroyed,close:()=>{view.destroyed=true;closed++;},
      executeJavaScript:async()=>{if(nextProbe){const gate=nextProbe;nextProbe=null;gate.entered.resolve();await gate.release.promise;}return login;},
      getURL:()=>view.url,loadURL:async next=>{reloads++;assert.equal(new URL(next).searchParams.get('lworkstationResume'),task.resumeRequestId);view.url=next;}}};
    views.push(view);
    if(nextCreation){const gate=nextCreation;nextCreation=null;gate.entered.resolve();await gate.release.promise;}
    return view;
  },requestInbox:async call=>{
    calls.push(structuredClone(call));
    if(call.route==='/erp/v1/requests'){
      if(call.body?.request?.cancel)requestStatus='cancelled';
      return {records:[{...input,status:requestStatus,platformSkcs:[{platformSkc:'SKC-A'}],expectedSkus:[{platformSku:'SKU-A',platformSkc:'SKC-A'}]}]};
    }
    if(call.route==='/erp/v1/collection-tasks'){
      if(call.method==='POST')task={...input,taskId:'TASK',scopeHash:'SCOPE',status:'paused',executionTarget:call.body.executionTarget,catalogMode:call.body.catalogMode,runMode:'cost',filters:call.body.filters,batches:[{batchId:'B',status:'pending'}]};
      return call.method==='POST'?{task}:{tasks:task?[task]:[]};
    }
    if(call.route.endsWith('/control')){
      if(call.body.action==='reconnect'){
        if(nextReconnectError){const error=nextReconnectError;nextReconnectError=null;throw error;}
        if(claimOnReconnect){claimOnReconnect=false;task={...task,status:'running',runnerId:'RACE-RUNNER'};}
        if(task.status!=='ready'||task.runnerId||call.body.resumeRequestId!==task.resumeRequestId)throw Object.assign(new Error('handoff changed'),{code:'ERP_TASK_HANDOFF_CHANGED',status:409});
        task={...task,resumeRequestId:'RECONNECT-'+calls.filter(item=>item.body?.action==='reconnect').length};return {task};
      }
      if(call.body.action==='request_resume')assert.ok(!['stopped','invalidated','completed'].includes(task.status),'terminal tasks must not be resumed');
      if(call.body.action==='request_resume'&&task.runnerId&&task.status!=='paused')return {task};
      task={...task,status:call.body.action==='pause'?'paused':call.body.action==='stop'?'stopped':'ready',pauseReason:undefined,
        resumeRequestId:call.body.action==='request_resume'?'RESUME-'+calls.filter(item=>item.body?.action==='request_resume').length:task.resumeRequestId,
        ...(call.body.action==='request_resume'?{runnerId:undefined,runnerLeaseExpiresAt:undefined,executionTarget:call.body.executionTarget??task.executionTarget}:{})};return {task};
    }
    const observed=task??retainedTasks.get(call.route.split('/').at(-1));
    if(nextRead){const gate=nextRead;nextRead=null;const snapshot=structuredClone(observed);gate.entered.resolve();await gate.release.promise;return {task:snapshot};}
    return {task:observed};
  }});
  const gate=()=>({entered:deferred(),release:deferred()});
  return {collector,input,calls,views,login(value){login=value;},context(value){context=value;},running(){task={...task,status:'running',runnerId:'RUNNER'};},
    update(value){task={...task,...value};},register(id,{retainPreviousTask=false}={}){if(retainPreviousTask&&task)retainedTasks.set(task.taskId,structuredClone(task));input.requestId=id;requestStatus='registered';task=null;},advance(ms){clock+=ms;},
    holdRead(){return nextRead=gate();},holdCreation(){return nextCreation=gate();},holdProbe(){return nextProbe=gate();},
    claimBeforeReconnect(){claimOnReconnect=true;},failReconnect(error){nextReconnectError=error;},get task(){return task;},
    get created(){return created;},get closed(){return closed;},get reloads(){return reloads;}};
}
test('starts one immutable desktop task with no foreground form or clipboard operation',async()=>{
  const h=harness();await Promise.all([h.collector.start(h.input),h.collector.start(h.input)]);
  assert.equal(h.created,1);
  const create=h.calls.find(call=>call.route==='/erp/v1/collection-tasks'&&call.method==='POST');
  assert.equal(create.body.executionTarget,'desktop');assert.deepEqual(create.body.filters,{...PURCHASE_FILTERS,sku:'SKC-A'});
  assert.equal(create.body.catalogMode,'on_demand');
  assert.equal(create.body.costFlow,'task');
  assert.equal(h.collector.snapshot().status,'waiting_ack');h.collector.dispose();
});

test('recollection releases a confirmed stopped old view without waiting for the next poll',async()=>{
  const h=harness();await h.collector.start(h.input);h.running();await h.collector.poll();
  h.update({status:'stopped'});h.register('REQ-NEW',{retainPreviousTask:true});
  const [a,b]=await Promise.all([h.collector.start(h.input),h.collector.start(h.input)]);
  assert.equal(a.requestId,'REQ-NEW');assert.equal(b.requestId,'REQ-NEW');
  assert.equal(h.closed,1);assert.equal(h.created,2);assert.equal(h.views[0].destroyed,true);h.collector.dispose();
});
test('a different request never closes a genuinely running task or accepts foreign task metadata',async()=>{
  for(const patch of [{status:'running',runnerId:'ACTIVE'},{status:'stopped',workspaceId:'OTHER'}]){
    const h=harness();await h.collector.start(h.input);h.update(patch);h.register('REQ-NEW',{retainPreviousTask:true});
    await assert.rejects(h.collector.start(h.input),/采集正在执行/);
    assert.equal(h.closed,0);assert.equal(h.created,1);h.collector.dispose();
  }
});
test('a workspace change during the old-view read cannot launch or release another workspace view',async()=>{
  const h=harness();await h.collector.start(h.input);h.update({status:'stopped'});h.register('REQ-NEW',{retainPreviousTask:true});
  const gate=h.holdRead(),pending=h.collector.start(h.input);await gate.entered.promise;
  h.context({workspaceId:'OTHER'});gate.release.resolve();
  await assert.rejects(pending,/工作区或采集状态已改变/);assert.equal(h.closed,0);assert.equal(h.created,1);h.collector.dispose();
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
  assert.equal(result.status,'waiting_ack');assert.equal(h.created,2);h.collector.dispose();
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
  assert.equal(result.requestId,'REQ-NEW');assert.equal(result.status,'waiting_ack');assert.equal(h.created,2);h.collector.dispose();
});

test('historical login errors do not override a running task or prevent retry of a pause',async()=>{
  const h=harness();await h.collector.start(h.input);
  h.update({status:'running',batches:[{status:'delivered',deliveryId:'RECEIPT',error:{message:'请先登录'}}]});
  await h.collector.poll();assert.equal(h.collector.snapshot().status,'running');
  h.update({status:'paused'});await h.collector.start(h.input);
  assert.equal(h.collector.snapshot().status,'waiting_ack');
  assert.equal(h.created,2);h.collector.dispose();
});

test('a permission pause closes the hidden view and continues the same task without requiring another login',async()=>{
  const h=harness();await h.collector.start(h.input);
  h.update({status:'paused',pauseReason:{code:'ERP_PERMISSION_REQUIRED'},batches:[{status:'delivered',deliveryId:'RECEIPT'},{status:'pending'}]});
  await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'paused');assert.equal(h.closed,1);
  const result=await h.collector.start(h.input);
  assert.equal(result.status,'waiting_ack');assert.equal(result.taskId,'TASK');assert.equal(h.created,2);
  assert.equal(h.calls.filter(call=>call.route==='/erp/v1/collection-tasks'&&call.method==='POST').length,1);
  h.collector.dispose();
});

test('an unclaimed task rebuilds once, fencing old intents while preserving the task, batches and receipts',async()=>{
  const h=harness();await h.collector.start(h.input);
  h.update({batches:[{batchId:'DONE',status:'delivered',deliveryId:'RECEIPT'},{batchId:'TODO',status:'pending'}]});
  const batches=structuredClone(h.task.batches);
  const intent=h.task.resumeRequestId;
  assert.equal(new URL(h.views[0].url).searchParams.get('lworkstationResume'),intent);
  h.views[0].url='https://www.zhuolinkeji.cn/unexpected-error.html';
  h.advance(101);await h.collector.poll();
  assert.equal(h.created,2);assert.equal(h.closed,1);
  assert.equal(h.collector.snapshot().status,'waiting_ack');
  assert.notEqual(h.task.resumeRequestId,intent);assert.equal(h.task.status,'ready');assert.deepEqual(h.task.batches,batches);
  assert.equal(new URL(h.views[1].url).searchParams.get('lworkstationResume'),h.task.resumeRequestId);
  assert.equal(h.calls.filter(call=>call.body?.action==='request_resume').length,1,'automatic recovery does not issue a new resume request');
  const replacementIntent=h.task.resumeRequestId;
  h.advance(101);await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'sync_error');
  assert.equal(h.created,2);assert.equal(h.closed,2);
  assert.equal(h.task.status,'ready');assert.notEqual(h.task.resumeRequestId,replacementIntent);assert.deepEqual(h.task.batches,batches);
  const result=await h.collector.start(h.input);
  assert.equal(result.status,'waiting_ack');assert.equal(result.requestId,'REQ');assert.equal(result.taskId,'TASK');
  assert.equal(h.created,3);assert.equal(h.calls.filter(call=>call.route==='/erp/v1/collection-tasks'&&call.method==='POST').length,1);
  assert.deepEqual(h.task.batches,batches);assert.equal(h.task.requestId,'REQ');
  h.collector.dispose();
});

test('a runner claiming between the status read and reconnect fence keeps its live view',async()=>{
  const h=harness();await h.collector.start(h.input);h.advance(101);h.claimBeforeReconnect();
  await h.collector.poll();
  assert.equal(h.task.runnerId,'RACE-RUNNER');assert.equal(h.collector.snapshot().status,'running');
  assert.equal(h.created,1);assert.equal(h.closed,0);h.collector.dispose();
});

test('a claim acknowledges the existing executor and never triggers automatic page recreation',async()=>{
  const h=harness();await h.collector.start(h.input);h.running();
  h.advance(1000);await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'running');assert.equal(h.created,1);assert.equal(h.closed,0);
  h.advance(1000);await h.collector.poll();await h.collector.start(h.input);
  assert.equal(h.created,1);assert.equal(h.closed,0);h.collector.dispose();
});

test('a claimed on-demand catalog executor stays open until its material checks finish',async()=>{
  const h=harness();await h.collector.start(h.input);
  h.update({status:'cost_complete',catalogMode:'on_demand',runMode:'catalog',runnerId:'CATALOG-RUNNER',
    batches:[{status:'delivered',deliveryId:'RECEIPT',catalogStatus:'running'}]});
  await h.collector.poll();assert.equal(h.closed,0);assert.equal(h.collector.snapshot().status,'cost_complete');
  h.update({batches:[{status:'delivered',deliveryId:'RECEIPT',catalogStatus:'completed'}]});
  await h.collector.poll();assert.equal(h.closed,1);h.collector.dispose();
});

test('the acknowledgement deadline does not count login waiting or bypass a later pause or stop',async()=>{
  const h=harness();h.login(true);await h.collector.start(h.input);
  h.advance(1000);await h.collector.poll();assert.equal(h.collector.snapshot().status,'waiting_login');assert.equal(h.created,1);
  h.login(false);await h.collector.sessionChanged();
  assert.equal(h.collector.snapshot().status,'waiting_ack');assert.equal(h.created,1);assert.equal(h.reloads,1);
  h.update({status:'paused'});h.advance(1000);await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'paused');assert.equal(h.created,1);assert.equal(h.closed,1);
  h.collector.dispose();
  const stopped=harness();await stopped.collector.start(stopped.input);stopped.update({status:'stopped'});stopped.advance(1000);
  await stopped.collector.poll();assert.equal(stopped.collector.snapshot().status,'stopped');assert.equal(stopped.created,1);stopped.collector.dispose();
});

test('concurrent polls at the acknowledgement deadline create only one replacement view',{timeout:1000},async()=>{
  const h=harness();await h.collector.start(h.input);h.advance(101);
  const gate=h.holdCreation();const rebuilding=h.collector.poll();await gate.entered.promise;
  await Promise.all([h.collector.poll(),h.collector.poll()]);
  assert.equal(h.created,2);gate.release.resolve();await rebuilding;
  assert.equal(h.created,2);assert.equal(h.collector.snapshot().status,'waiting_ack');h.collector.dispose();
});

test('a replacement view finishing after a workspace change is discarded instead of reviving the old task',{timeout:1000},async()=>{
  const h=harness();await h.collector.start(h.input);h.advance(101);
  const gate=h.holdCreation();const rebuilding=h.collector.poll();await gate.entered.promise;
  h.context({workspaceId:'OTHER'});await h.collector.stop('workspace_changed');
  gate.release.resolve();await rebuilding;
  assert.equal(h.collector.snapshot().status,'workspace_changed');
  assert.equal(h.created,2);assert.ok(h.views.every(view=>view.destroyed),'old and late replacement views are both closed');
  h.collector.dispose();
});

test('an old status read cannot overwrite a newly started workspace owner',{timeout:1000},async()=>{
  const h=harness();await h.collector.start(h.input);
  const gate=h.holdRead();const stale=h.collector.poll();await gate.entered.promise;
  h.context({workspaceId:'OTHER'});await h.collector.stop('workspace_changed');
  h.register('REQ-NEW');h.input.workspaceId='OTHER';
  await h.collector.start(h.input);const expected=h.collector.snapshot();
  gate.release.resolve();await stale;
  assert.deepEqual(h.collector.snapshot(),expected);assert.equal(expected.requestId,'REQ-NEW');
  assert.equal(h.views.at(-1).destroyed,false);h.collector.dispose();
});

test('a hung renderer probe has a bounded failure and does not hold the polling lock forever',{timeout:1000},async()=>{
  const h=harness({probeTimeoutMs:5});await h.collector.start(h.input);
  const gate=h.holdProbe();h.advance(101);const probing=h.collector.poll();await gate.entered.promise;
  await probing;
  assert.ok(['waiting_ack','sync_error'].includes(h.collector.snapshot().status));
  gate.release.resolve();h.advance(101);await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'sync_error');h.collector.dispose();
});

test('a hidden view that finishes after its load deadline is discarded and the same task can reconnect',{timeout:1000},async()=>{
  const h=harness({viewTimeoutMs:5});const gate=h.holdCreation();
  const pending=h.collector.start(h.input);const rejected=assert.rejects(pending,/超时|timeout/i);
  await gate.entered.promise;await rejected;
  gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.views[0].destroyed,true,'a late view cannot become an orphan executor');
  const result=await h.collector.start(h.input);
  assert.equal(result.taskId,'TASK');assert.equal(result.requestId,'REQ');assert.equal(result.status,'waiting_ack');
  assert.equal(h.created,2);assert.equal(h.calls.filter(call=>call.route==='/erp/v1/collection-tasks'&&call.method==='POST').length,1);
  h.collector.dispose();
});

test('a page that claims before its load deadline is preserved when loadURL finishes late',{timeout:1000},async()=>{
  const h=harness({viewTimeoutMs:5});const gate=h.holdCreation();
  const pending=h.collector.start(h.input).catch(error=>error);
  await gate.entered.promise;h.running();const result=await pending;
  gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.task.runnerId,'RUNNER');assert.equal(result.status,'running');
  assert.equal(h.views[0].destroyed,false,'a late load completion must not kill an acknowledged executor');
  assert.equal(h.created,1);h.collector.dispose();
});

test('an uncertain fence retains a late executor and a manual retry transfers it without a duplicate page',{timeout:1000},async()=>{
  const h=harness({viewTimeoutMs:5});const gate=h.holdCreation();
  const pending=h.collector.start(h.input).catch(error=>error);
  await gate.entered.promise;h.failReconnect(Object.assign(new Error('isolated fence unavailable'),{status:503}));
  const failed=await pending;assert.ok(failed instanceof Error);
  h.running();const resumed=await h.collector.start(h.input);
  assert.equal(resumed.status,'running');assert.equal(h.created,1);
  gate.release.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.views[0].destroyed,false);assert.equal(h.collector.snapshot().status,'running');
  assert.equal(h.created,1);assert.equal(h.closed,0);h.collector.dispose();
});

test('an explicit pause with an old runner still permits continuation with a fresh page',async()=>{
  const h=harness();await h.collector.start(h.input);h.running();await h.collector.poll();
  h.update({status:'paused'});await h.collector.poll();assert.equal(h.closed,1);
  const result=await h.collector.start(h.input);
  assert.equal(result.status,'waiting_ack');assert.equal(h.created,2);assert.equal(h.task.runnerId,undefined);
  h.collector.dispose();
});

test('a ready task from an older external helper can be taken over by desktop in one start',async()=>{
  const h=harness();h.update({...h.input,taskId:'LEGACY-TASK',scopeHash:'SCOPE',status:'ready',resumeRequestId:'EXTERNAL-INTENT',
    executionProtocol:2,catalogMode:'on_demand',runMode:'cost',filters:{...PURCHASE_FILTERS,sku:'SKC-A'},batches:[{batchId:'OLD-B',status:'pending'}]});
  const result=await h.collector.start(h.input);
  assert.equal(result.status,'waiting_ack');assert.equal(result.taskId,'LEGACY-TASK');assert.equal(h.created,1);
  assert.equal(h.task.executionTarget,'desktop');
  assert.equal(h.calls.filter(call=>call.body?.action==='request_resume').length,1);
  assert.equal(h.calls.filter(call=>call.body?.action==='reconnect').length,0);
  assert.equal(h.calls.filter(call=>call.route==='/erp/v1/collection-tasks'&&call.method==='POST').length,0);
  h.collector.dispose();
});

test('keeps archive mode after first login instead of restarting cost collection', async()=>{
  const h=harness(); h.login(true); await h.collector.start({...h.input,mode:'catalog'});
  h.login(false); await h.collector.sessionChanged();
  const resume=h.calls.filter(call=>call.body?.action==='request_resume').at(-1);
  assert.equal(resume.body.mode,'catalog'); assert.equal(resume.body.retryFailed,false);
  assert.equal(h.calls.filter(call=>call.body?.action==='request_resume').length,1);
  assert.equal(h.calls.filter(call=>call.body?.action==='reconnect').length,1);
  h.collector.dispose();
});

test('a successful shared ERP session wakes a stale hidden login document without a cookie event', async()=>{
  let authenticated=false, probes=0;
  const h=harness({loginProbeIntervalMs:50,checkSession:async()=>{probes++;return authenticated;}});
  h.login(true);await h.collector.start(h.input);
  await h.collector.poll();assert.equal(probes,1);assert.equal(h.reloads,0);
  authenticated=true;h.advance(51);await h.collector.poll();
  assert.equal(h.reloads,1);assert.equal(h.collector.snapshot().status,'waiting_ack');
  h.running();h.login(false);await h.collector.poll();assert.equal(h.collector.snapshot().status,'running');
  assert.equal(h.created,1);assert.equal(h.calls.filter(c=>c.body?.action==='request_resume').length,1);h.collector.dispose();
});
test('manual login recheck is bounded to the same waiting task', async()=>{
  const h=harness({checkSession:async()=>false});
  h.login(true);await h.collector.start(h.input);
  await h.collector.start({...h.input,checkLogin:true});assert.equal(h.reloads,1);assert.equal(h.created,1);
  h.update({status:'paused'});await h.collector.poll();
  assert.equal(h.collector.snapshot().status,'paused');assert.equal(h.reloads,1);h.collector.dispose();
});
test('a pause racing a verified login wins, and a late first-login notification cannot cancel its new runner', async()=>{
  const hold=deferred(),entered=deferred();let probing=false;
  const h=harness({loginProbeIntervalMs:1,checkSession:async()=>{if(!probing)return false;entered.resolve();return hold.promise;}});
  h.login(true);await h.collector.start(h.input);probing=true;h.advance(2);
  const poll=h.collector.poll();await entered.promise;h.update({status:'paused'});hold.resolve(true);await poll;
  assert.equal(h.reloads,0);assert.equal(h.collector.snapshot().status,'paused');h.collector.dispose();
  const r=harness({loginProbeIntervalMs:1});r.login(true);await r.collector.start(r.input);
  const read=r.holdRead(),notification=r.collector.sessionChanged();await read.entered.promise;
  r.login(false);r.advance(2);await r.collector.poll();r.running();await r.collector.poll();
  read.release.resolve();await notification;
  assert.equal(r.collector.snapshot().status,'running');assert.equal(r.closed,0);
  assert.equal(r.calls.some(call=>call.body?.request?.cancel),false);r.collector.dispose();
});
