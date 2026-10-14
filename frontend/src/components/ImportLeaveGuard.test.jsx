// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import ImportLeaveGuard from './ImportLeaveGuard';
let host, root, router, updateProtection;
function Preparation({ initial }) { const [protection, update] = useState(initial); updateProtection = update; return <><ImportLeaveGuard {...protection} /><input defaultValue="保留的货号选择" /></>; }
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent === label);
async function render(props = { pending: true, committing: false }) {
  router = createMemoryRouter([
    { path: '/import-preview', element: <Preparation initial={props} /> },
    { path: '/workspace', element: <p>经营概览</p> },
  ], { initialEntries: ['/workspace', '/import-preview'] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); router?.dispose();host.remove();delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
it('protects Back, preserves preparation when staying, and leaves only after explicit discard', async () => {
  await render();
  const input=host.querySelector('input');input.value='手工调整后';
  await act(async () => router.navigate(-1));
  expect(router.state.location.pathname).toBe('/import-preview');
  expect(host.querySelector('[role=dialog]').textContent).toContain('尚未完成');
  await act(async () => button('继续准备').click());
  expect(host.querySelector('input')).toBe(input);
  expect(input.value).toBe('手工调整后');
  await act(async () => router.navigate('/workspace'));
  await act(async () => button('放弃准备并离开').click());
  expect(router.state.location.pathname).toBe('/workspace');
});
it('blocks refresh only while there is preparation or a pending commit and cleans up on unmount', async () => {
  await render();
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
  await act(async()=>root.render(<p>closed</p>));
  const next=new Event('beforeunload',{cancelable:true});window.dispatchEvent(next);expect(next.defaultPrevented).toBe(false);
});
it('requires the write to finish or be canceled through the import page before leaving', async () => {
  await render({pending:true,committing:true});
  await act(async()=>router.navigate('/workspace'));
  expect(host.querySelector('[role=dialog]').textContent).toContain('台账正在导入');
  expect(button('放弃准备并离开').disabled).toBe(true);
  await act(async()=>button('返回导入').click());
  expect(router.state.location.pathname).toBe('/import-preview');
});
it('does not block an empty or successfully completed import', async () => {
  await render({pending:false,committing:false});
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
  await act(async()=>router.navigate('/workspace'));expect(router.state.location.pathname).toBe('/workspace');
});

it('keeps a finished or canceled blocked import on its result page, with no lingering refresh protection', async () => {
 await render({pending:true,committing:true});await act(async()=>router.navigate('/workspace'));
 await act(async()=>updateProtection({pending:false,committing:false}));
 expect(host.querySelector('[role=dialog]')).toBeNull();expect(router.state.location.pathname).toBe('/import-preview');
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
 await act(async()=>router.navigate('/workspace'));expect(router.state.location.pathname).toBe('/workspace');
});
