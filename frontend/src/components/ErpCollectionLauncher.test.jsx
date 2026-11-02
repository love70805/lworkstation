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
