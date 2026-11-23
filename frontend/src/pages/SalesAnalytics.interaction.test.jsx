// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SalesAnalytics from './SalesAnalytics';
import { SalesMonthChart } from './SalesMonthChart';
import { aggregatePeriodSalesDetails } from '../domain/salesPeriodDetails';
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../data/repositories/salesProfitAnalysisRepository', () => ({ readSalesProfitAnalysis: async () => null }));
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
it('replaces daily stacks with a store pie, retains SKC details and preserves horizontal position while paging the page list', async () => {
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
  await act(async () => container.querySelector('.sales-daily-bar').click());
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(0);
  expect(container.querySelectorAll('.sales-store-pie [role="button"]')).toHaveLength(2);
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(container.querySelector('.sales-pie-legend')).toBeNull();
  expect(container.querySelector('.sales-day-tooltip')).toBeNull();
  await act(async () => container.querySelector('.sales-store-entry').click());
  expect(container.querySelector('.sales-store-pie [aria-pressed="true"]')).not.toBeNull();
  await act(async () => container.querySelector('tr[data-highlighted] td:last-child').click());
  expect(container.textContent).toContain('SKC');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  expect(container.querySelectorAll('.sales-store-pie [role="button"]').length).toBeGreaterThan(5);
  const firstProduct = container.querySelector('tbody strong').textContent;
  const table = container.querySelector('.sales-day-table'); table.scrollLeft = 200; document.documentElement.scrollTop = 400;
  await act(async () => Simulate.scroll(table));
  await act(async () => find('下一页').click());
  expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  expect(container.querySelector('tbody strong').textContent).not.toBe(firstProduct);
  expect(table.scrollLeft).toBe(200); expect(document.documentElement.scrollTop).toBe(400);
  await act(async () => find('趋势').click());
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
});
it('search changes reset pagination without destroying the input element', async () => {
  await act(async () => container.querySelector('.sales-daily-bar').click());
  await act(async () => container.querySelector('.sales-store-entry').click());
  await act(async () => find('查看商品明细').click());
  await act(async () => find('下一页').click());
  const input = container.querySelector('input'); input.focus();
  await choose(input, 'SKC24');
  expect(container.querySelector('input')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(container.querySelector('.sales-pagination')).toBeNull();
});


it('opens the only visible store from the daily chart and restores the legend on return', async () => {
  expect(container.textContent).not.toContain('对比月份');
  expect(container.querySelector('[aria-label="趋势周期"] [aria-pressed="true"]').textContent).toBe('按日');
  expect(mock.read).toHaveBeenCalledTimes(1);
  expect(mock.read.mock.calls[0][0].ledgerId).toBe('L');
  const segments = [...container.querySelector('.sales-daily-bar').querySelectorAll('.sales-stack-segment')];
  expect(segments).toHaveLength(2);
  expect(parseFloat(segments[0].style.top) + parseFloat(segments[0].style.height)).toBeCloseTo(100);
  expect(parseFloat(segments[1].style.top) + parseFloat(segments[1].style.height)).toBeCloseTo(parseFloat(segments[0].style.top));
  const legend = find('甲');
  await act(async () => legend.click());
  expect(legend.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelectorAll('.sales-stack-segment')).toHaveLength(1);
  expect(container.querySelector('.sales-month-totals').textContent).toContain('所选店铺合计 · 销售原额 ¥130 · 销量 13 件');
  const visibleStore = container.querySelector('.sales-store-legend [aria-pressed="true"]').textContent;
  expect(visibleStore).toBe('乙');
  await act(async () => container.querySelector('.sales-daily-bar').click());
  expect(container.querySelector('.sales-details-heading h3').textContent).toContain(visibleStore + ' 商品明细');
  expect(container.querySelectorAll('tbody .sales-product-entry')).toHaveLength(5);
  expect(container.querySelectorAll('.sales-detail-path button')).toHaveLength(1);
  await act(async () => find('返回趋势').click());
  expect(container.querySelector('.sales-store-legend [aria-pressed="true"]').textContent).toBe(visibleStore);
});
it('hover and keyboard focus keep chart and details DOM stable without extra data reads', async () => {
  const bar = container.querySelector('.sales-daily-bar');
  await act(async () => Simulate.mouseEnter(bar));
  expect(container.querySelector('.sales-daily-bar')).toBe(bar);
  expect(container.querySelector('.sales-day-tooltip .sales-hover-summary').textContent).toContain('2026-08-01');
  await act(async () => Simulate.mouseLeave(bar));
  expect(container.querySelector('.sales-day-tooltip')).toBeNull();
  await act(async () => bar.focus());
  expect(container.querySelector('.sales-day-tooltip').textContent).toContain('甲');
  expect(bar.getAttribute('aria-label')).toContain('占比');
  const next = container.querySelectorAll('.sales-daily-bar')[1];
  await act(async () => Simulate.mouseEnter(next));
  expect(container.querySelector('.sales-hover-summary strong').textContent).toBe(bar.dataset.date);
  await act(async () => Simulate.mouseMove(next, { movementX: 15 }));
  expect(container.querySelector('.sales-hover-summary strong').textContent).toBe(next.dataset.date);
  await act(async () => Simulate.mouseLeave(next));
  expect(container.querySelector('.sales-day-tooltip')).toBeNull();
  await act(async () => next.focus());
  expect(container.querySelector('.sales-day-tooltip')).not.toBeNull();
  await act(async () => next.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('.sales-day-tooltip')).toBeNull();
  await act(async () => bar.click());
  const table = container.querySelector('.sales-day-table'), input = container.querySelector('input');
  table.scrollLeft = 50;
  await act(async () => Simulate.scroll(table));
  await act(async () => find('销量').click());
  expect(container.querySelector('.sales-day-table')).toBe(table);
  expect(container.querySelector('input')).toBe(input);
  expect(table.scrollLeft).toBe(50);
  expect(mock.read).toHaveBeenCalledTimes(1);
});

it('leaves space above and beside the pointer, stays steady within a bar and mirrors near the edge', async () => {
  const bar = container.querySelector('.sales-daily-bar'), plot = bar.closest('.sales-chart-plot');
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 880);
  let plotRect = new DOMRect(300, 470, 680, 210), barRect = new DOMRect(900, 470, 18, 210);
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this === bar) return barRect;
    if (this === plot) return plotRect;
    return this.classList.contains('sales-day-tooltip') ? new DOMRect(0, 0, 350, 225) : new DOMRect();
  });
  try {
    await act(async () => Simulate.mouseEnter(bar, { clientY: 610 }));
    const tooltip = () => container.querySelector('.sales-day-tooltip');
    expect(tooltip().style.visibility).toBe('visible');
    expect(parseFloat(tooltip().style.left)).toBe(barRect.right + 36);
    expect(parseFloat(tooltip().style.left)).toBeLessThan(plotRect.right);
    const top = parseFloat(tooltip().style.top);
    expect(top + 225 / 2).toBe(610 - 48);
    await act(async () => Simulate.mouseMove(bar, { clientY: 630, movementY: 20 }));
    expect(parseFloat(tooltip().style.top)).toBe(top);
    await act(async () => Simulate.mouseLeave(bar));
    vi.stubGlobal('innerWidth', 600);
    vi.stubGlobal('innerHeight', 320);
    plotRect = new DOMRect(40, 40, 540, 210);
    barRect = new DOMRect(530, 40, 18, 210);
    await act(async () => Simulate.mouseEnter(bar, { clientY: 45 }));
    expect(tooltip().style.visibility).toBe('visible');
    expect(parseFloat(tooltip().style.left) + 350).toBe(barRect.left - 20);
    expect(parseFloat(tooltip().style.top)).toBe(12);
  } finally {
    measure.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('keeps pending profit and unknown dates distinct from recorded dispatch savings in a tooltip', async () => {
  const pending = { key: '27', store: '27', revenueExact: '10', quantityExact: '1', profitExact: null, salesProfitExact: null, dispatchAmountExact: '2.8' };
  const month = { period: '2026-08', hasDispatch: true, daily: [
    { ...pending, date: '2026-08-01', status: 'data', segments: [pending] },
    { ...pending, date: '2026-08-02', status: 'unknown', revenueExact: null, quantityExact: null, segments: [] },
  ] };
  await act(async () => root.render(<SalesMonthChart month={month} metric="profitExact" scale={{min:0, max:1, range:1, zero:100}} />));
  const bars = container.querySelectorAll('.sales-daily-bar');
  await act(async () => bars[0].focus());
  expect([...container.querySelector('.sales-tooltip-stores tr').cells].map(cell => cell.textContent)).toEqual(['27', '待核', '待核', '¥2.8']);
  await act(async () => bars[1].focus());
  expect(container.querySelector('.sales-tooltip-breakdown')).toBeNull();
  expect(container.querySelector('.sales-hover-summary').textContent).toContain('数据待查 · 已知代发节省 ¥2.8');
});

it('resets hidden stores when the outer store scope changes', async () => {
  await act(async () => container.querySelector('.sales-store-legend button').click());
  expect(container.querySelector('.sales-store-legend button').getAttribute('aria-pressed')).toBe('false');
  await act(async () => root.render(<SalesAnalytics workspaceId="W" ledgerId="L" store="甲" />));
  expect([...container.querySelectorAll('.sales-store-legend button')].every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  expect(container.querySelector('.sales-day-details')).toBeNull();
});
