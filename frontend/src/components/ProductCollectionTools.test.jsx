// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductCollectionTools from './ProductCollectionTools';
import { ToastProvider } from './UI';
const mocks = vi.hoisted(() => ({ tasks: [], control: vi.fn(), prepare: vi.fn() }));
vi.mock('../hooks/useErpCollectionTasks', () => ({ useErpCollectionTasks: () => ({ tasks: mocks.tasks, refresh: vi.fn() }) }));
vi.mock('../lib/erpInboxTransport', () => ({ controlErpCollectionTask: mocks.control }));
vi.mock('../data/repositories/erpCatalogRepository', () => ({ prepareProductArchiveCollection: mocks.prepare }));
let root, host, runtime;
const button = name => [...host.querySelectorAll('button')].find(node => node.textContent === name);
const render = () => act(async () => root.render(<ToastProvider><ProductCollectionTools workspaceId="W" /></ToastProvider>));
const task = () => ({ taskId:'T', requestId:'R', ledgerId:'L', workspaceId:'W', status:'cost_complete', ledgerPeriod:'2026-10', catalogMode:'on_demand', batches:[{platformSkcs:['A'], status:'delivered', deliveryId:'D'}] });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; mocks.tasks=[]; mocks.control.mockReset(); mocks.prepare.mockReset();
  runtime = {startErpCollection:vi.fn().mockResolvedValue({ok:true,status:'running',requestId:'R'}),getErpCollection:vi.fn().mockResolvedValue({status:'idle'}),openErpLogin:vi.fn()};
  window.shopeersDesktopRuntime=runtime;
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.shopeersDesktopRuntime; });
it('offers automatic acquisition when mappings become available', async () => {
  await render();
  expect(button('一键获取商品档案').disabled).toBe(true);
  expect(button('导入 ERP 商品档案')).toBeUndefined();
  expect(host.textContent).not.toContain('手动导入档案');
  expect(mocks.control).not.toHaveBeenCalled();
  mocks.tasks=[task()]; await render();
  expect(button('一键获取商品档案').disabled).toBe(false);
  expect(host.textContent).not.toContain('已采用');
  await act(async()=>button('一键获取商品档案').click());
  expect(mocks.prepare).toHaveBeenCalledWith(mocks.tasks[0]);
  expect(mocks.control).toHaveBeenCalledWith('T',expect.objectContaining({workspaceId:'W',action:'request_resume',mode:'catalog',catalogMode:'on_demand',refreshCatalog:false}));
  expect(runtime.startErpCollection).toHaveBeenCalledWith({workspaceId:'W',ledgerId:'L',requestId:'R',mode:'catalog'});
});
it('refreshes completed metadata explicitly without resetting delivered costs', async () => {
  mocks.tasks=[{...task(),status:'completed',runMode:'catalog',batches:[{...task().batches[0],catalogStatus:'completed'}]}]; await render();
  await act(async()=>button('重新获取商品档案').click());
  expect(mocks.control.mock.calls[0][1]).toMatchObject({mode:'catalog',refreshCatalog:true});
  expect(mocks.control.mock.calls[0][1]).not.toHaveProperty('retryFailed');
});
it('does not launch an unregistered scope and shows a retryable error', async () => {
  mocks.tasks=[task()]; mocks.prepare.mockRejectedValue(new Error('范围已变化')); await render();
  await act(async()=>button('一键获取商品档案').click());
  expect(mocks.control).not.toHaveBeenCalled(); expect(runtime.startErpCollection).not.toHaveBeenCalled();
  expect(host.textContent).toContain('范围已变化'); expect(button('一键获取商品档案').disabled).toBe(false);
});
