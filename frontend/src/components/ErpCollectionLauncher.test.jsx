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
it('offers the existing ERP login entry and tells the user that this scope will resume', async () => {
  runtime.getErpCollection.mockResolvedValue({ ok: true, requestId: 'R', status: 'waiting_login' }); await render();
  expect(host.textContent).toContain('登录后自动继续本次采集');
  await act(async () => button('登录 ERP').click()); expect(runtime.openErpLogin).toHaveBeenCalledOnce();
});
it('keeps a failed registration actionable with its actual reason', async () => {
  runtime.startErpCollection.mockResolvedValue({ ok: false, error: '采集请求已失效' }); await render();
  await act(async () => button('开始成本核算').click());
  expect(host.querySelector('[role="alert"]').textContent).toBe('采集请求已失效');
  expect(props.onRegistrationRetry).toHaveBeenCalledOnce(); expect(button('开始成本核算').disabled).toBe(false);
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

it('shows a failed renewal and leaves the action retryable without a start loop', async () => {
  runtime.startErpCollection.mockResolvedValue({ok:false,code:'ERP_REQUEST_INVALID',error:'请求已失效'});
  props.onRegistrationRetry.mockRejectedValue(new Error('登记失败：本机服务不可用'));
  await render();await act(async()=>button('开始成本核算').click());
  expect(host.querySelector('[role="alert"]').textContent).toContain('本机服务不可用');
  expect(runtime.startErpCollection).toHaveBeenCalledOnce();expect(button('开始成本核算').disabled).toBe(false);
});
