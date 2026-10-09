// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import ErpBackgroundNotice, { ErpBackgroundNoticeContent } from './ErpBackgroundNotice';
import { publishErpCollectionActivity, readErpCollectionActivity } from '../lib/erpCollectionActivity';

const task = { taskId: 'T', workspaceId: 'NOTICE-W', ledgerId: 'LEDGER-A', ledgerPeriod: '2026-09', status: 'cost_complete', phase: 'catalog', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'running' }] };

it('shows the actual background stage and links to that task instead of the current page month', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ErpBackgroundNoticeContent tasks={[task]} /></MemoryRouter>);
  expect(html).toContain('正在后台补充商品资料');
  expect(html).toContain('2026-09 · 成本已送达 1 / 1 个 SKC');
  expect(html).toContain('/profit?ledger=LEDGER-A&amp;view=cost');
  expect(html).not.toContain('继续补充资料');
});

it('retains task context but stops claiming it is running when the status source is offline', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ErpBackgroundNoticeContent tasks={[task]} error="本机服务连接失败" /></MemoryRouter>);
  expect(html).toContain('后台采集状态暂无法确认');
  expect(html).toContain('本机服务连接失败');
  expect(html).not.toContain('正在后台补充商品资料');
  expect(html).not.toContain('class="spin"');
});

it('shares updates across page mounts, isolates workspaces and removes completed tasks', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const render = workspaceId => act(() => root.render(<MemoryRouter><ErpBackgroundNotice workspaceId={workspaceId} /></MemoryRouter>));
  try {
    publishErpCollectionActivity({ workspaceId: 'NOTICE-W', tasks: [task, { ...task, workspaceId: 'OTHER-W' }] });
    expect(readErpCollectionActivity('NOTICE-W').tasks).toHaveLength(1);
    await render('NOTICE-W'); expect(container.textContent).toContain('正在后台补充商品资料');
    await render('OTHER-W'); expect(container.textContent).toBe('');
    await render('NOTICE-W'); expect(container.textContent).toContain('正在后台补充商品资料');
    await act(() => publishErpCollectionActivity({ workspaceId: 'NOTICE-W', tasks: [{ ...task, batches: task.batches.map(batch => ({ ...batch, catalogStatus: 'completed' })) }] }));
    expect(container.textContent).toBe('');
  } finally { await act(() => root.unmount()); container.remove(); }
});
