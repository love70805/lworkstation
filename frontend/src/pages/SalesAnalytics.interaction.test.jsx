// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SalesAnalytics from './SalesAnalytics';
import { aggregatePeriodSalesDetails } from '../domain/salesPeriodDetails';
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../data/repositories/salesAnalyticsRepository', () => ({
  readLedgerSalesAnalytics: mock.read,
  readWorkspaceSalesMonths: vi.fn(async () => []),
  readLedgerPeriodSalesDetails: async scope => {
    const period = scope.ledgerId === 'L' ? '2026-08' : '2026-07';
    const rows = Array.from({ length: 25 }, (_, index) => ({ store: index % 2 ? '甲' : '乙', platformSku: `SKU${index}`, platformSkc: `SKC${index}`, sourceAddedDate: `${period}-01`, amountExact: '10', quantityExact: '1' }));
    return aggregatePeriodSalesDetails(rows, { period, date: scope.date });
  },
}));
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
  mock.read.mockClear();
  mock.read.mockImplementation(async ({ ledgerId }) => {
    const period = ledgerId === 'L' ? '2026-08' : '2026-07';
    return { period, sourceRows: Array.from({ length: 25 }, (_, index) => ({ store: index % 2 ? '甲' : '乙', platformSku: `SKU${index}`, platformSkc: `SKC${index}`, sourceAddedDate: `${period}-01`, amountExact: '10', quantityExact: '1' })) };
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SalesAnalytics workspaceId="W" ledgerId="L" />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('replaces daily stacks with a store pie, retains SKC details and resets only list scroll on paging', async () => {
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
  await act(async () => container.querySelector('.sales-daily-bar').click());
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(0);
  expect(container.querySelectorAll('.sales-store-pie [role="button"]')).toHaveLength(2);
  expect(container.querySelectorAll('.sales-pie-legend button')).toHaveLength(2);
  expect(container.querySelector('.sales-day-tooltip')).toBeNull();
  expect(container.textContent).toContain('SKC1');
  const table = container.querySelector('.sales-day-table'); table.scrollTop = 200; document.documentElement.scrollTop = 400;
  await act(async () => Simulate.scroll(table));
  await act(async () => find('下一页').click());
  expect(table.scrollTop).toBe(0); expect(document.documentElement.scrollTop).toBe(400);
  await act(async () => find('返回总览').click());
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
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


it('keeps monthly data lazy, stacks daily stores on a shared column, and keeps hidden filters visual', async () => {
  expect(container.textContent).not.toContain('对比月份');
  expect(find('月度')).toBeDefined();
  expect(mock.read).toHaveBeenCalledTimes(1);
  expect(mock.read.mock.calls[0][0].ledgerId).toBe('L');
  const segments = [...container.querySelector('.sales-daily-bar').querySelectorAll('.sales-stack-segment')];
  expect(segments).toHaveLength(2);
  expect(parseFloat(segments[0].style.top) + parseFloat(segments[0].style.height)).toBeCloseTo(100);
  expect(parseFloat(segments[1].style.top) + parseFloat(segments[1].style.height)).toBeCloseTo(parseFloat(segments[0].style.top));
  const legend = container.querySelector('.sales-store-legend button');
  await act(async () => legend.click());
  expect(legend.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelectorAll('.sales-stack-segment')).toHaveLength(1);
  expect(container.querySelector('.sales-month-totals').textContent).toContain('250');
  await act(async () => container.querySelector('.sales-daily-bar').click());
  expect(container.querySelector('.sales-list-scope').textContent).toContain('25/25');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(6);
});
it('hover and keyboard focus keep chart and details DOM stable without extra data reads', async () => {
  const bar = container.querySelector('.sales-daily-bar');
  await act(async () => Simulate.mouseEnter(bar));
  expect(container.querySelector('.sales-daily-bar')).toBe(bar);
  expect(container.querySelector('.sales-day-tooltip .sales-hover-summary').textContent).toContain('2026-08-01');
  await act(async () => Simulate.mouseLeave(bar));
  expect(container.querySelector('.sales-day-tooltip')).toBeNull();
  await act(async () => Simulate.focus(bar));
  expect(container.querySelector('.sales-day-tooltip').textContent).toContain('甲');
  expect(bar.getAttribute('aria-label')).toContain('占比');
  await act(async () => bar.click());
  const table = container.querySelector('.sales-day-table'), input = container.querySelector('input');
  table.scrollTop = 50;
  await act(async () => Simulate.scroll(table));
  await act(async () => find('销量').click());
  expect(container.querySelector('.sales-day-table')).toBe(table);
  expect(container.querySelector('input')).toBe(input);
  expect(table.scrollTop).toBe(50);
  expect(mock.read).toHaveBeenCalledTimes(1);
});

it('resets hidden stores when the outer store scope changes', async () => {
  await act(async () => container.querySelector('.sales-store-legend button').click());
  expect(container.querySelector('.sales-store-legend button').getAttribute('aria-pressed')).toBe('false');
  await act(async () => root.render(<SalesAnalytics workspaceId="W" ledgerId="L" store="甲" />));
  expect([...container.querySelectorAll('.sales-store-legend button')].every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  expect(container.querySelector('.sales-day-details')).toBeNull();
});
