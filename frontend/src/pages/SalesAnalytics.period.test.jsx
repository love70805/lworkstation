// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SalesAnalytics from './SalesAnalytics';
import { buildSalesMonth } from '../domain/salesChartModel';
import { aggregatePeriodSalesDetails } from '../domain/salesPeriodDetails';

const mocks = vi.hoisted(() => ({ month: vi.fn(), months: vi.fn(), detail: vi.fn() }));
vi.mock('../data/repositories/salesAnalyticsRepository', () => ({
  readLedgerSalesAnalytics: mocks.month, readWorkspaceSalesMonths: mocks.months, readLedgerPeriodSalesDetails: mocks.detail,
}));
vi.mock('dexie-react-hooks', async () => {
  const { useState, useEffect } = await import('react');
  return { useLiveQuery: (callback, deps) => {
    const [value, setValue] = useState();
    useEffect(() => { let active = true; Promise.resolve().then(callback).then(result => { if (active) setValue(result); }); return () => { active = false; }; }, deps);
    return value;
  } };
});
const source = (period, store = '甲') => [
  ...Array.from({ length: 14 }, (_, index) => ({ store, platformSkc: `SKC-${String(index).padStart(2, '0')}`, platformSku: `SKU-${index}`, quantityExact: String(index < 3 ? 20 : index), amountExact: String(100 - index), sourceAddedDate: `${period}-01` })),
  { store, platformSkc: '', platformSku: 'MISSING-A', quantityExact: '999', amountExact: '1', sourceAddedDate: `${period}-01` },
  { store, platformSkc: '', platformSku: 'MISSING-B', quantityExact: '998', amountExact: '1', sourceAddedDate: `${period}-01` },
  { store: '乙', platformSkc: 'OTHER', platformSku: 'OTHER', quantityExact: '4', amountExact: '20', sourceAddedDate: `${period}-02` },
];
let container, root;
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async node => act(async () => node.click());
const change = async (node, value) => act(async () => Simulate.change(node, { target: { value } }));
const props = { workspaceId: 'W', ledgerId: 'L' };
const byLabel = label => container.querySelector(`[aria-label="${label}"]`);
const openDay = async (index = 0) => click(container.querySelectorAll('.sales-daily-bar')[index]);
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.month.mockImplementation(async () => ({ period: '2026-08', sourceRows: source('2026-08') }));
  mocks.months.mockImplementation(async () => ['2026-07', '2026-08'].map((period, index) => ({
    ...buildSalesMonth({ period, sourceRows: source(period, index ? '甲' : '乙') }, { today: '2026-09-18' }), ledgerId: index ? 'L' : 'P',
  })));
  mocks.detail.mockImplementation(async scope => {
    const period = scope.ledgerId === 'P' ? '2026-07' : '2026-08';
    return aggregatePeriodSalesDetails(source(period, scope.ledgerId === 'L' ? '甲' : '乙'), { period, date: scope.date ?? null });
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SalesAnalytics {...props} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('switches from daily stacks to grouped months and opens whole-month details without a date', async () => {
  expect(mocks.months).not.toHaveBeenCalled();
  await click(button('月度'));
  expect(mocks.months).toHaveBeenCalledWith({ workspaceId: 'W', store: 'all' });
  expect(container.querySelectorAll('.sales-month-group')).toHaveLength(2);
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(0);
  const bars = [...container.querySelectorAll('.sales-month-group:last-child .sales-grouped-segment')];
  expect(bars).toHaveLength(2);
  for (const bar of bars) expect(parseFloat(bar.style.top) + parseFloat(bar.style.height)).toBeCloseTo(100);
  await click(container.querySelectorAll('.sales-month-group')[1]);
  expect(mocks.detail).toHaveBeenLastCalledWith({ workspaceId: 'W', ledgerId: 'L', store: 'all' });
  expect(container.querySelector('.sales-details-heading h3').textContent).toBe('2026-08 商品明细');
  expect(container.querySelector('.sales-store-pie')).not.toBeNull();
  expect(byLabel('下一月').disabled).toBe(true);
});

it('ranks five nonempty SKCs by exact quantity with stable key ties and clears back to all rows', async () => {
  await openDay();
  const total = container.querySelector('.sales-details-heading p').textContent;
  const pie = container.querySelector('.sales-store-pie [role="button"]');
  await act(async () => Simulate.keyDown(pie, { key: 'Enter' }));
  expect([...container.querySelectorAll('tbody strong')].map(node => node.textContent)).toEqual(['SKC-00', 'SKC-01', 'SKC-02', 'SKC-13', 'SKC-12']);
  expect(container.querySelector('.sales-details-heading p').textContent).toBe(total);
  expect(container.textContent).toContain('SKC 待补充记录不参与排名');
  expect(mocks.detail).toHaveBeenCalledTimes(1);
  expect(container.querySelector('.sales-selected-store-totals').textContent).toContain('销量 2145 件');
  expect(container.querySelector('.sales-selected-store-totals').textContent).toContain('4%');
  expect(container.querySelector('tbody tr td:nth-child(3)').textContent).toBe('0.9%');
  expect(container.querySelector('.sales-store-pie title').textContent).toContain('销售原额');
  await click(container.querySelector('.sales-pie-legend button'));
  expect(container.querySelector('.sales-list-scope').textContent).toContain('16/16');
  await change(container.querySelector('input'), 'MISSING');
  expect([...container.querySelectorAll('tbody strong')].map(node => node.textContent)).toEqual(['SKC 待补充', 'SKC 待补充']);
});

it('keeps the selected store across adjacent days and reports an empty store without selecting another', async () => {
  await openDay();
  await click(container.querySelector('.sales-pie-legend button'));
  await click(byLabel('下一日'));
  expect(container.textContent).toContain('甲 · 销量 Top 5 SKC');
  expect(container.textContent).toContain('该店在此期间无商品记录');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  expect(container.querySelector('.sales-details-heading p').textContent).toContain('¥20');
  await click(byLabel('上一日'));
  expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  expect(byLabel('上一日').disabled).toBe(true);
});

it('keeps store selection when moving to the previous month and clear reveals its entire detail', async () => {
  await click(button('月度')); await click(container.querySelectorAll('.sales-month-group')[1]);
  await click([...container.querySelectorAll('.sales-pie-legend button')].find(node => node.textContent.startsWith('甲')));
  await click(byLabel('上一月'));
  expect(container.textContent).toContain('甲 · 销量 Top 5 SKC');
  expect(container.textContent).toContain('该店在此期间无商品记录');
  await click(button('全部店铺'));
  expect(container.querySelector('.sales-list-scope').textContent).toContain('17/17');
  expect(byLabel('上一月').disabled).toBe(true);
});

it('restores query, sort, page and table scroll after return and reopening', async () => {
  await openDay();
  await change(container.querySelector('input'), 'SKC-');
  await change(container.querySelector('.sales-details-controls select'), 'quantityExact');
  await click(button('下一页'));
  const before = container.querySelector('tbody').textContent;
  const table = container.querySelector('.sales-day-table'); table.scrollTop = 42;
  await act(async () => Simulate.scroll(table));
  await click(button('返回总览')); await openDay();
  expect(container.querySelector('input').value).toBe('SKC-');
  expect(container.querySelector('.sales-details-controls select').value).toBe('quantityExact');
  expect(container.querySelector('.sales-pagination').textContent).toContain('第 2/3 页');
  expect(container.querySelector('tbody').textContent).toBe(before);
  expect(container.querySelector('.sales-day-table').scrollTop).toBe(42);
});

it.each(['unknown', 'future', 'unobserved'])('honors daily %s availability even when the detail API returns records', async status => {
  const chartMonth = buildSalesMonth({ period: '2026-08', sourceRows: source('2026-08') }, { today: '2026-09-18' });
  chartMonth.daily[0] = { ...chartMonth.daily[0], status, revenueExact: null, quantityExact: null };
  mocks.month.mockResolvedValue({ period: '2026-08', chartMonth });
  await act(async () => root.render(<SalesAnalytics {...props} ledgerId="RELOAD" />));
  await openDay();
  expect(container.querySelector('.sales-store-pie')).toBeNull();
  expect(container.querySelector('tbody')).toBeNull();
  expect(container.querySelector('.sales-details-heading p').textContent).toBe('销售原额 待查 · 销量 待查');
  expect(container.textContent).toContain(status === 'future' ? '尚未发生' : status === 'unobserved' ? '尚未统计' : '期间数据待查');
});

it.each([['10', '-2'], ['0', '0'], ['-1', '-2']])('does not plot signed/nonpositive values %s/%s as a pie', async (a, b) => {
  mocks.detail.mockResolvedValue({
    period: '2026-08', date: '2026-08-01', status: 'data', unlocatedCount: 0,
    totalsExact: { revenueExact: String(Number(a) + Number(b)), quantityExact: '2' },
    stores: [{ key: 'a', store: '甲', revenueExact: a, quantityExact: '1' }, { key: 'b', store: '乙', revenueExact: b, quantityExact: '1' }], rows: [],
  });
  await openDay();
  expect(container.querySelector('.sales-store-pie')).toBeNull();
  expect(container.textContent).toContain('不绘制扇形占比');
  expect(container.querySelector('.sales-period-composition').textContent).not.toContain('%');
  await click(button('销量'));
  expect(container.querySelectorAll('.sales-store-pie [role="button"]')).toHaveLength(2);
});

it('shows monthly missing-store values as unknown and prevents stale monthly results leaking after scope changes', async () => {
  mocks.months.mockResolvedValue([{ ...buildSalesMonth({ period: '2026-07', sourceRows: [] }, { store: '甲' }), ledgerId: 'P' }]);
  await click(button('月度'));
  const bar = container.querySelector('.sales-month-group');
  expect(bar.getAttribute('aria-label')).toContain('数据待查');
  expect(bar.querySelector('.sales-grouped-segment')).toBeNull();
  let finish;
  mocks.months.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<SalesAnalytics {...props} store="甲" />));
  expect(container.querySelector('.sales-month-group')).toBeNull();
  await act(async () => finish([]));
  expect(container.textContent).toContain('暂无可用账本月份');
});

it('shows read errors and can return to overview', async () => {
  mocks.detail.mockRejectedValueOnce(new Error('明细读取失败'));
  await openDay();
  expect(container.querySelector('[role="alert"]').textContent).toBe('明细读取失败');
  await click(button('返回总览'));
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
});

it.each(['0', '-1'])('does not invent a Top 5 share for a %s store denominator', async quantity => {
  mocks.detail.mockResolvedValue({
    period: '2026-08', date: '2026-08-01', status: 'data', unlocatedCount: 0,
    totalsExact: { revenueExact: '10', quantityExact: quantity },
    stores: [{ key: 'a', store: '甲', revenueExact: '10', quantityExact: quantity }],
    rows: [{ key: 'a', store: '甲', platformSkc: 'A', platformSkus: ['SKU'], revenueExact: '10', quantityExact: quantity, averagePriceExact: null }],
  });
  await openDay();
  await click(container.querySelector('.sales-pie-legend button'));
  expect(container.querySelector('.sales-selected-store-totals').textContent).toContain('Top 5 销量占店铺全部销量：待查');
  expect(container.querySelector('tbody tr td:nth-child(3)').textContent).toBe('待查');
});
