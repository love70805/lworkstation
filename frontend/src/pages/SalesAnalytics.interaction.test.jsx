// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SalesAnalytics from './SalesAnalytics';
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../data/repositories/salesAnalyticsRepository', () => ({ readLedgerSalesAnalytics: mock.read, readLedgerDailySalesDetails: vi.fn() }));
vi.mock('../data/repositories/profitRepository', () => ({ listLedgerSummaries: async () => [{ id: 'L', workspaceId: 'W', period: '2026-08' }, { id: 'P', workspaceId: 'W', period: '2026-07' }] }));
vi.mock('dexie-react-hooks', async () => {
  const { useState, useEffect } = await import('react');
  return { useLiveQuery: (callback, deps) => {
    const [value, setValue] = useState();
    useEffect(() => { let active = true; Promise.resolve().then(callback).then(result => { if (active) setValue(result); }); return () => { active = false; }; }, deps);
    return value;
  } };
});
let container, root;
const find = text => [...container.querySelectorAll('button')].find(button => button.textContent === text);
const choose = async (element, value) => act(async () => Simulate.change(element, { target: { value } }));
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mock.read.mockImplementation(async ({ ledgerId }) => {
    const period = ledgerId === 'L' ? '2026-08' : '2026-07';
    return { period, sourceRows: Array.from({ length: 25 }, (_, index) => ({ store: index % 2 ? '甲' : '乙', platformSku: `SKU${index}`, platformSkc: `SKC${index}`, sourceAddedDate: `${period}-01`, amountExact: '10', quantityExact: '1' })) };
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SalesAnalytics workspaceId="W" ledgerId="L" />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('replaces the month with grouped store bars, retains SKC details and resets only list scroll on paging', async () => {
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
  await act(async () => container.querySelector('.sales-daily-bar').click());
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(1);
  expect(container.querySelectorAll('.sales-stack-segment')).toHaveLength(2);
  expect(container.querySelectorAll('.sales-store-legend button')).toHaveLength(2);
  expect(container.querySelector('.sales-day-tooltip')).toBeNull();
  expect(container.textContent).toContain('SKC1');
  const table = container.querySelector('.sales-day-table'); table.scrollTop = 200; document.documentElement.scrollTop = 400;
  await act(async () => find('下一页').click());
  expect(table.scrollTop).toBe(0); expect(document.documentElement.scrollTop).toBe(400);
  await act(async () => find('返回全月').click());
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
});
it('opens the clicked comparison month and aligns keyboard tooltip days', async () => {
  await choose(container.querySelector('select'), 'P');
  const charts = container.querySelectorAll('.sales-stack-chart'); expect(charts).toHaveLength(2);
  await act(async () => Simulate.focus(charts[1].querySelector('button')));
  expect(container.textContent).toContain('主月 − 对比月：0 元');
  await act(async () => charts[1].querySelector('button').click());
  expect(container.querySelector('.sales-details-heading').textContent).toContain('2026-07-01');
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(1);
});
it('search changes reset pagination without destroying the input element', async () => {
  await act(async () => container.querySelector('.sales-daily-bar').click());
  await act(async () => find('下一页').click());
  const input = container.querySelector('input'); input.focus();
  await choose(input, 'SKC24');
  expect(container.querySelector('input')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(container.textContent).toContain('第 1/1 页');
});


it('compares monthly store totals and legend toggles only chart visibility', async () => {
  await choose(container.querySelector('select'), 'P');
  await act(async () => find('每月').click());
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(2);
  expect(container.querySelectorAll('.sales-grouped-segment')).toHaveLength(4);
  expect(container.querySelector('.sales-month-totals').textContent).toContain('250');
  const legend = container.querySelector('.sales-store-legend button');
  await act(async () => legend.click());
  expect(legend.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelectorAll('.sales-grouped-segment')).toHaveLength(2);
  expect(container.querySelector('.sales-month-totals').textContent).toContain('250');
  await act(async () => find('每日').click());
  await act(async () => container.querySelector('.sales-daily-bar').click());
  expect(container.querySelector('.sales-list-scope').textContent).toContain('25/25');
});

it('monthly focus identifies one month and exposes each store value', async () => {
  await choose(container.querySelector('select'), 'P');
  await act(async () => find('每月').click());
  const bars = container.querySelectorAll('.sales-daily-bar');
  await act(async () => Simulate.focus(bars[0]));
  expect(container.querySelectorAll('.sales-daily-bar.is-selected')).toHaveLength(1);
  expect(container.querySelector('.sales-hover-summary').textContent).toContain('2026-07');
  expect(container.querySelector('.sales-hover-summary').textContent).toContain('甲');
  expect(bars[0].getAttribute('aria-label')).toContain('销售原额');
  await act(async () => Simulate.focus(bars[1]));
  expect(container.querySelectorAll('.sales-daily-bar.is-selected')).toHaveLength(1);
  expect(container.querySelector('.sales-hover-summary').textContent).toContain('2026-08');
});
