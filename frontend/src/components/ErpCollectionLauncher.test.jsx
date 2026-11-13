// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ErpCollectionLauncher from './ErpCollectionLauncher';

let host, root, runtime, props;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  runtime = { getErpCollection: vi.fn().mockResolvedValue({ status: 'idle' }), startErpCollection: vi.fn().mockResolvedValue({ ok: true, requestId: 'R', status: 'running' }), openErpLogin: vi.fn().mockResolvedValue({ ok: true }) };
  window.shopeersDesktopRuntime = runtime;
  props = { workspaceId: 'W', ledgerId: 'L', requestId: 'R', ready: true, onStarted: vi.fn(), onRegistrationRetry: vi.fn() };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.shopeersDesktopRuntime; });
const render = async () => act(async () => root.render(<ErpCollectionLauncher {...props} />));
const button = label => [...host.querySelectorAll('button')].find(button => button.textContent === label);

it('starts the registered scope from one workstation action without any copy or ERP form input', async () => {
  props.ready = false; await render(); expect(button('开始成本核算').disabled).toBe(true);
  props.ready = true; await render(); await act(async () => button('开始成本核算').click());
  expect(runtime.startErpCollection).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'W', ledgerId: 'L', requestId: 'R', retryFailed: true });
  expect(props.onStarted).toHaveBeenCalledOnce(); expect(button('正在采集成本').disabled).toBe(true);
});
it.each(['completed','paused','partial'])('offers explicit recollection alongside the existing %s action', async status => {
  props.task={requestId:'R',taskId:'T',status,batches:[status==='completed'?{deliveryId:'D'}:{status:'pending'}]};
  props.onRecollect=vi.fn();props.recollectReady=true;await render();
  expect(button('重新获取 ERP 成本').disabled).toBe(false);
  if(status==='completed')expect(button('成本已采集').disabled).toBe(true);
  if(status==='paused')expect(button('继续成本核算').disabled).toBe(false);
  await act(async()=>button('重新获取 ERP 成本').click());
  expect(props.onRecollect).toHaveBeenCalledOnce();expect(runtime.startErpCollection).not.toHaveBeenCalled();
});
it('offers the existing ERP login entry and tells the user that this scope will resume', async () => {
  runtime.getErpCollection.mockResolvedValue({ ok: true, requestId: 'R', status: 'waiting_login' }); await render();
  expect(host.textContent).toContain('登录后自动继续本次采集');
  await act(async () => button('登录 ERP').click()); expect(runtime.openErpLogin).toHaveBeenCalledOnce();
});
it.each(['cost','catalog'])('lets a queued %s task recheck the same login without retrying a batch', async mode => {
  props.mode=mode;props.task={requestId:'R',taskId:'T',executionProtocol:2,executionTarget:'desktop',status:'ready',batches:[mode==='catalog'?{deliveryId:'D'}:{status:'pending'}]};
  runtime.getErpCollection.mockResolvedValue({ok:true,requestId:'R',taskId:'T',status:'waiting_login'});
  await render();
  expect(button('核验登录并继续').disabled).toBe(false);expect(host.textContent).not.toContain('正在采集成本');
  await act(async()=>button('核验登录并继续').click());
  expect(runtime.startErpCollection).toHaveBeenCalledExactlyOnceWith({workspaceId:'W',ledgerId:'L',requestId:'R',mode,checkLogin:true});
});
it('keeps a failed registration actionable with its actual reason', async () => {
  runtime.startErpCollection.mockResolvedValue({ ok: false, error: '采集请求已失效' }); await render();
  await act(async () => button('开始成本核算').click());
  expect(host.querySelector('[role="alert"]').textContent).toBe('采集请求已失效');
  expect(props.onRegistrationRetry).toHaveBeenCalledOnce(); expect(button('开始成本核算').disabled).toBe(false);
});
it('distinguishes a sent intent from ERP acknowledgement and exposes bounded reconnect failure', async () => {
  runtime.getErpCollection.mockResolvedValue({ requestId: 'R', status: 'waiting_ack' });
  await render();
  expect(button('正在连接 ERP').disabled).toBe(true);
  expect(host.textContent).toContain('等待 ERP 确认接收');
  runtime.getErpCollection.mockResolvedValue({ requestId: 'R', status: 'sync_error', error: 'ERP 尚未确认接收任务' });
  props.requestId = 'TEMP'; await render(); props.requestId = 'R'; await render();
  expect(button('重新连接 ERP').disabled).toBe(false);
  expect(host.querySelector('[role="alert"]').textContent).toContain('尚未确认接收');
  runtime.startErpCollection.mockResolvedValue({ ok: true, requestId: 'R', status: 'waiting_ack' });
  await act(async () => button('重新连接 ERP').click());
  expect(runtime.startErpCollection).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'W', ledgerId: 'L', requestId: 'R', retryFailed: true });
  expect(button('正在连接 ERP').disabled).toBe(true);
});
it('does not restart an acknowledged executor when its page probe reports an error', async () => {
  runtime.getErpCollection.mockResolvedValue({ requestId: 'R', status: 'running', error: 'ERP 页面响应超时' });
  await render();
  expect(button('正在采集成本').disabled).toBe(true);
  expect(runtime.startErpCollection).not.toHaveBeenCalled();
});
it('preserves browser-only behavior when no desktop runtime exists', async () => {
  delete window.shopeersDesktopRuntime; await render(); expect(host.children).toHaveLength(0);
});

it('re-registers a cancelled session and starts the new request in the same click', async () => {
  props.task={requestId:'R',status:'stopped',batches:[{status:'failed'}]};
  runtime.getErpCollection.mockResolvedValue({requestId:'R',status:'waiting_login'});
  runtime.startErpCollection.mockResolvedValueOnce({ok:false,code:'ERP_SESSION_CHANGED',error:'登录已变化'})
    .mockResolvedValueOnce({ok:true,requestId:'R-NEW',status:'running'});
  props.onRegistrationRetry.mockResolvedValue({id:'R-NEW'});
  await render();
  expect(host.textContent).not.toContain('登录后自动继续');
  await act(async()=>button('继续成本核算').click());
  expect(runtime.startErpCollection.mock.calls.map(([call])=>call.requestId)).toEqual(['R','R-NEW']);
  expect(props.onStarted).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('does not let an old completed task disable a newly registered scope', async () => {
  props.task={requestId:'OLD',status:'completed',batches:[{deliveryId:'D'}]};
  await render();expect(button('继续成本核算').disabled).toBe(false);
});

it.each(['waiting_ack', 'ready', 'waiting_login', 'sync_error', 'running'])('prefers durable cost completion to stale desktop %s', async status => {
  props.task = { requestId: 'R', executionProtocol: 2, catalogMode: 'on_demand', runMode: 'cost',
    status: 'cost_complete', runnerId: 'RETAINED', batches: [{ status: 'delivered', deliveryId: 'D' }] };
  runtime.getErpCollection.mockResolvedValue({ requestId: 'R', status });
  await render();
  expect(button('成本已采集').disabled).toBe(true);
  expect(host.textContent).not.toMatch(/正在连接|等待 ERP|核验登录|重新连接/);
  expect(runtime.startErpCollection).not.toHaveBeenCalled();
});

it('shows a failed renewal and leaves the action retryable without a start loop', async () => {
  runtime.startErpCollection.mockResolvedValue({ok:false,code:'ERP_REQUEST_INVALID',error:'请求已失效'});
  props.onRegistrationRetry.mockRejectedValue(new Error('登记失败：本机服务不可用'));
  await render();await act(async()=>button('开始成本核算').click());
  expect(host.querySelector('[role="alert"]').textContent).toContain('本机服务不可用');
  expect(runtime.startErpCollection).toHaveBeenCalledOnce();expect(button('开始成本核算').disabled).toBe(false);
});

it('uses the registered archive task activity when the runtime snapshot has not caught up', async () => {
  props.mode='catalog'; props.task={requestId:'R',runMode:'catalog',catalogMode:'on_demand',status:'cost_complete',runnerId:'RUNNER',batches:[{status:'delivered',deliveryId:'D',catalogStatus:'running'}]};
  await render(); expect(button('正在获取商品档案').disabled).toBe(true);
  props.task.requestId='OLD'; await render(); expect(button('继续获取商品档案').disabled).toBe(false);
});
it('never starts an empty visible scope even when an old registered request is ready', async () => {
  props.scopeEmpty=true;props.task={requestId:'R',status:'partial',batches:[{status:'incomplete'}]};
  runtime.getErpCollection.mockResolvedValue({requestId:'R',status:'waiting_ack'});
  await render();const start=button('当前范围无需采集');expect(start.disabled).toBe(true);
  await act(async()=>start.click());expect(runtime.startErpCollection).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('正在等待 ERP 确认接收');
});
