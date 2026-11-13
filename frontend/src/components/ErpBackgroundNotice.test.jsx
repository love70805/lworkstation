// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import ErpBackgroundNotice, { ErpBackgroundNoticeContent } from './ErpBackgroundNotice';
import { publishErpCollectionActivity, publishErpCollectionReceiptError, readErpCollectionActivity } from '../lib/erpCollectionActivity';

const task = { taskId: 'T', workspaceId: 'NOTICE-W', ledgerId: 'LEDGER-A', ledgerPeriod: '2026-09', status: 'cost_complete', phase: 'catalog', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'running' }] };

it('reveals and focuses the progress panel even when the user is already on the cost page', async () => {
  const container=document.createElement('div'),panel=document.createElement('section');
  panel.id='erp-collection-progress';panel.tabIndex=-1;panel.scrollIntoView=vi.fn();document.body.append(container,panel);
  const root=createRoot(container);
  try {
    await act(async()=>root.render(<MemoryRouter initialEntries={['/profit?ledger=LEDGER-A&view=cost']}><ErpBackgroundNoticeContent tasks={[{...task, status:'running', phase:'cost', batches:[{platformSkcs:['A'],status:'running'}]}]}/></MemoryRouter>));
    expect(container.querySelector('a').getAttribute('href')).toContain('#erp-collection-progress');
    await act(async()=>{container.querySelector('a').click();await new Promise(resolve=>setTimeout(resolve,10));});
    expect(panel.scrollIntoView).toHaveBeenCalledOnce();expect(document.activeElement).toBe(panel);
  } finally {await act(async()=>root.unmount());container.remove();panel.remove();}
});

it('shows the actual background stage and links to that task instead of the current page month', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ErpBackgroundNoticeContent tasks={[task]} /></MemoryRouter>);
  expect(html).toContain('正在后台获取商品档案');
  expect(html).toContain('2026-09 · 商品资料已检查 0 / 1 个 SKC');
  expect(html).toContain('/products?collection=1');
  expect(html).not.toContain('继续补充资料');
});

it('retains the adoption acknowledgement in shared metadata and removes a finished cost runner', () => {
  const workspaceId = 'FINISHED-COST-W';
  publishErpCollectionActivity({ workspaceId, tasks: [{ ...task, workspaceId, executionProtocol: 2,
    runMode: 'cost', catalogMode: 'on_demand', runnerId: 'RETAINED',
    batches: [{ ...task.batches[0], adoptionReportedAt: '2026-11-09T00:00:00Z' }] }] });
  const activity = readErpCollectionActivity(workspaceId);
  expect(activity.tasks[0].batches[0].adoptionReportedAt).toBe('2026-11-09T00:00:00Z');
  expect(renderToStaticMarkup(<MemoryRouter><ErpBackgroundNoticeContent {...activity} /></MemoryRouter>)).toBe('');
});

it('retains task context but stops claiming it is running when the status source is offline', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ErpBackgroundNoticeContent tasks={[task]} error="本机服务连接失败" /></MemoryRouter>);
  expect(html).toContain('后台采集状态暂无法确认');
  expect(html).toContain('本机服务连接失败');
  expect(html).not.toContain('正在后台获取商品档案');
  expect(html).not.toContain('class="spin"');
});

it('shares updates across page mounts, isolates workspaces and removes completed tasks', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const render = workspaceId => act(() => root.render(<MemoryRouter><ErpBackgroundNotice workspaceId={workspaceId} /></MemoryRouter>));
  try {
    publishErpCollectionActivity({ workspaceId: 'NOTICE-W', tasks: [task, { ...task, workspaceId: 'OTHER-W' }] });
    expect(readErpCollectionActivity('NOTICE-W').tasks).toHaveLength(1);
    await render('NOTICE-W'); expect(container.textContent).toContain('正在后台获取商品档案');
    await render('OTHER-W'); expect(container.textContent).toBe('');
    await render('NOTICE-W'); expect(container.textContent).toContain('正在后台获取商品档案');
    await act(() => publishErpCollectionActivity({ workspaceId: 'NOTICE-W', tasks: [{ ...task, batches: task.batches.map(batch => ({ ...batch, catalogStatus: 'completed' })) }] }));
    expect(container.textContent).toBe('');
  } finally { await act(() => root.unmount()); container.remove(); }
});

it('keeps a receipt failure visible after collection completes, through task refresh and workspace switches, until a healthy receipt cycle', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const workspaceId = 'RECEIPT-W';
  const render = id => act(() => root.render(<MemoryRouter><ErpBackgroundNotice workspaceId={id} /></MemoryRouter>));
  try {
    publishErpCollectionReceiptError({ workspaceId, error: '已登记请求不一致' });
    await render(workspaceId);
    expect(container.textContent).toContain('成本回传处理遇到问题');
    expect(container.textContent).toContain('已登记请求不一致');
    expect(container.querySelector('a').getAttribute('href')).toBe('/profit?view=detail');
    await act(() => publishErpCollectionActivity({ workspaceId, tasks: [{ ...task, workspaceId, batches: task.batches.map(batch => ({ ...batch, catalogStatus: 'completed' })) }] }));
    expect(container.textContent).toContain('成本回传处理遇到问题');
    expect(container.querySelector('a').getAttribute('href')).toBe('/profit?ledger=LEDGER-A&view=detail');
    expect(container.querySelector('.spin')).toBeNull();
    await render('RECEIPT-OTHER'); expect(container.textContent).toBe('');
    await render(workspaceId); expect(container.textContent).toContain('成本回传处理遇到问题');
    await act(() => publishErpCollectionReceiptError({ workspaceId }));
    expect(container.textContent).toBe('');
    expect(readErpCollectionActivity(workspaceId).receiptError).toBeUndefined();
  } finally { await act(() => root.unmount()); container.remove(); }
});
