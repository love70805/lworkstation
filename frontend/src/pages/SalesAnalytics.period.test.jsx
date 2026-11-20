// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SalesAnalytics from './SalesAnalytics';
import { buildSalesMonth } from '../domain/salesChartModel';
import { aggregatePeriodSalesDetails } from '../domain/salesPeriodDetails';
import { buildSalesProfitAnalysis } from '../domain/salesProfitAnalysis';
import { groupReportSales } from '../domain/profitReports';

const mocks = vi.hoisted(() => ({ month: vi.fn(), months: vi.fn(), detail: vi.fn(), profit: vi.fn() }));
vi.mock('../data/repositories/salesProfitAnalysisRepository', () => ({ readSalesProfitAnalysis: mocks.profit }));
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

const openStore = async (name = '甲') => click([...container.querySelectorAll('.sales-store-entry')].find(node => node.textContent.includes(name)));
const monthBar = period => [...container.querySelectorAll('.sales-month-group')].find(node => node.getAttribute('aria-label').startsWith(period));

it('defaults to reconciled profit, locates a losing product beyond page one and keeps the chosen metric', async () => {
  const period = '2026-08';
  const rows = source(period).map(row => ({ ...row, supplierNumber: 'SUP' }));
  const costs = rows.map(row => ({
    platformSku: row.platformSku, platformSkc: row.platformSkc, unitCost: row.platformSku === 'SKU-13' ? 40 : 0.1,
    checkedPeriod: period, withinPeriod: true, resolutionStatus: 'resolved', currency: 'CNY',
  }));
  mocks.profit.mockResolvedValue(buildSalesProfitAnalysis({ ledger: { id: 'L', workspaceId: 'W2', period, accountingMode: 'weighted', warehouseRate: 0 },
    rows, identities: rows, groups: groupReportSales(rows), costs, approvals: [] }));
  await act(async () => root.render(<SalesAnalytics {...props} workspaceId="W2" />));
  expect(button('商品利润').getAttribute('aria-pressed')).toBe('true');
  await openDay(); await openStore();
  expect(container.querySelector('.sales-store-pie')).not.toBeNull();
  expect(container.querySelector('.sales-period-composition').textContent).toContain('亏损合计');
  await click(container.querySelector('[aria-label^="亏损最多，"]'));
  expect(container.querySelector('tr[data-highlighted] strong').textContent).toBe('SKC-13');
  expect(container.querySelector('.sales-pagination').textContent).toContain('第 4/4 页');
  const total = container.querySelector('.sales-selected-store-totals').textContent;
  await change(container.querySelector('.sales-product-view select'), 'loss');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(container.querySelector('.sales-selected-store-totals').textContent).toBe(total);
  await click(button('销量'));
  expect(container.querySelector('.sales-store-pie')).not.toBeNull();
  await click(button('趋势'));
  await openDay();
  expect(button('销量').getAttribute('aria-pressed')).toBe('true');
});

async function showStoreProfits(profits) {
  const period = '2026-08', date = period + '-01';
  const rows = ['27', '20'].map(store => ({ store, platformSku: 'SKU' + store, platformSkc: 'SKC' + store,
    supplierNumber: 'SUP', sourceAddedDate: date, quantityExact: '1', amountExact: '100' }));
  const costs = rows.flatMap((row, i) => profits[i] == null ? [] : [{ ...row, unitCost: 100 - profits[i],
    checkedPeriod: period, withinPeriod: true, resolutionStatus: 'resolved', currency: 'CNY' }]);
  mocks.month.mockResolvedValue({ period, sourceRows: rows });
  mocks.detail.mockResolvedValue(aggregatePeriodSalesDetails(rows, { period, date }));
  mocks.profit.mockResolvedValue(buildSalesProfitAnalysis({ ledger: { id: 'L', workspaceId: 'W2', period, accountingMode: 'weighted', warehouseRate: 0 },
    rows, identities: rows, groups: groupReportSales(rows), costs, approvals: [] }));
  await act(async () => root.render(<SalesAnalytics {...props} workspaceId="W2" />));
}

it.each([
  [[20, 60], '利润构成', ['25%', '75%']],
  [[20, -60], '盈利构成', ['100%']],
  [[-20, -60], '亏损构成', ['25%', '75%']],
  [[0, 0], '利润构成', []],
])('uses signed amounts for profit pies at %j', async (profits, heading, shares) => {
  await showStoreProfits(profits);
  expect([...byLabel('趋势指标').querySelectorAll('button')].map(node => node.textContent)).toEqual(['商品利润', '销量']);
  await openDay();
  expect(container.querySelector('.sales-period-composition h3').textContent).toBe(heading);
  const slices = [...container.querySelectorAll('.sales-store-pie [role="button"]')];
  expect(slices.map(item => item.getAttribute('aria-label').split(' ').at(-1)).sort()).toEqual(shares);
  if (profits[1] < 0) expect(container.querySelector('.sales-composition-notes').textContent).toContain('亏损店铺合计');
  if (!shares.length) expect(container.textContent).toContain('商品利润为 0');
  if (slices.length) {
    await act(async () => Simulate.keyDown(slices[0], { key: 'Enter' }));
    await click(container.querySelector('tbody td:last-child'));
    expect(container.querySelector('.sales-store-pie [aria-pressed="true"]')).not.toBeNull();
  }
});

it('replaces sales with profit in the same slot for a fully costed store and keeps the quantity preference', async () => {
  await showStoreProfits([20, null]);
  const labels = () => [...byLabel('趋势指标').querySelectorAll('button')].map(node => node.textContent);
  expect(labels()).toEqual(['销售额', '销量']);
  await openDay();
  expect(labels()).toEqual(['销售额', '销量']);
  await openStore('27');
  expect(labels()).toEqual(['商品利润', '销量']);
  await click(button('销量'));
  await click(button('返回店铺')); await openStore('20');
  expect(labels()).toEqual(['销售额', '销量']);
  expect(button('销量').getAttribute('aria-pressed')).toBe('true');
  await click(button('趋势')); await click(button('20'));
  expect(labels()).toEqual(['商品利润', '销量']);
  await click(button('商品利润'));
  expect(container.querySelector('.sales-month-totals').textContent).toContain('所选店铺合计 · 商品利润 ¥20');
  expect(container.querySelector('.sales-daily-bar').getAttribute('aria-label')).toContain('商品利润 ¥20');
});

it('defaults to twelve calendar slots and one total column, preserving missing months', async () => {
  expect(mocks.months).not.toHaveBeenCalled();
  await click(button('按月'));
  expect(mocks.months).toHaveBeenCalledWith({ workspaceId: 'W', store: 'all' });
  expect(container.querySelectorAll('.sales-month-group')).toHaveLength(12);
  expect(monthBar('2026-08').querySelectorAll('.sales-grouped-segment')).toHaveLength(1);
  expect(monthBar('2026-06').getAttribute('aria-label')).toContain('数据待查');
  await click(monthBar('2026-08'));
  expect(mocks.detail).toHaveBeenLastCalledWith({ workspaceId: 'W', ledgerId: 'L', store: 'all' });
  expect(container.querySelector('.sales-details-heading h3').textContent).toBe('2026-08 店铺明细');
  expect(container.querySelector('.sales-store-pie')).not.toBeNull();
  expect(container.querySelectorAll('.sales-store-entry')).toHaveLength(2);
  expect(container.querySelectorAll('tbody strong')).toHaveLength(0);
  expect(byLabel('下一月').disabled).toBe(true);
});

it('shows all products in five-row pages and searches beyond the old top five including missing SKCs', async () => {
  await openDay();
  const total = container.querySelector('.sales-details-heading p').textContent;
  await act(async () => Simulate.keyDown(container.querySelector('.sales-store-pie [role="button"]'), { key: 'Enter' }));
  expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  expect(container.querySelector('[aria-label="SKC 构成"] .sales-store-pie')).not.toBeNull();
  expect(container.querySelector('.sales-selected-store-totals').textContent).toContain('销量 2145 件');
  expect(container.querySelector('.sales-details-heading p').textContent).toBe(total.replace('当日全部店铺合计', '店铺合计'));
  expect(container.textContent).not.toContain('Top 5');
  await change(container.querySelector('input'), 'SKC-03');
  expect(container.querySelector('tbody strong').textContent).toBe('SKC-03');
  await change(container.querySelector('input'), 'MISSING');
  expect([...container.querySelectorAll('tbody strong')].map(node => node.textContent)).toEqual(['SKC 待补充', 'SKC 待补充']);
  await click(button('清空搜索'));
  expect(container.querySelector('.sales-list-scope').textContent).toContain('16/16');
  await change(container.querySelector('.sales-details-controls select'), 'quantityExact');
  expect(container.querySelector('tbody strong').textContent).toBe('SKC 待补充');
  expect(mocks.detail).toHaveBeenCalledTimes(1);
});

it('keeps the store across adjacent days and does not invent a zero for an absent store', async () => {
  await openDay(); await openStore();
  await click(byLabel('下一日'));
  expect(container.textContent).toContain('甲 · 该店商品明细');
  expect(container.textContent).toContain('该店在此期间无商品记录');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  expect(container.querySelector('.sales-selected-store-totals').textContent).toContain('待查');
  await click(byLabel('上一日'));
  expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
});

it('returns directly to the filtered chart after changing dates, including while details are loading', async () => {
  await click(button('乙'));
  await openDay();
  expect(container.querySelector('.sales-details-heading h3').textContent).toBe('2026-08-01 甲 商品明细');
  let finish;
  mocks.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click(byLabel('下一日'));
  expect(container.querySelector('.sales-details-heading h3').textContent).toBe('2026-08-02 甲 商品明细');
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => Simulate.keyDown(container.querySelector('.sales-day-details'), { key: 'Escape' }));
  await act(async () => finish(aggregatePeriodSalesDetails(source('2026-08'), { period: '2026-08', date: '2026-08-02' })));
  expect(container.querySelector('.sales-day-details')).toBeNull();
  expect(button('甲').getAttribute('aria-pressed')).toBe('true');
  expect(button('乙').getAttribute('aria-pressed')).toBe('false');
  await openDay(1);
  expect(container.textContent).toContain('该店在此期间无商品记录');
  expect(container.querySelector('.sales-selected-store-totals').textContent).toContain('待查');
  await click(button('返回趋势'));
  await click(button('清空店铺'));
  expect(container.querySelector('.sales-daily-bar')).toBeNull();
  expect(container.textContent).toContain('请选择至少一家店铺');
  await click(button('全选店铺')); await openDay();
  expect(container.querySelector('.sales-store-entry').textContent).toContain('甲');
});

it('selects a product from any table cell or slice and keeps its search, page and share', async () => {
  await openDay();
  await click(container.querySelector('tbody tr td:last-child'));
  await change(container.querySelector('.sales-details-controls input'), 'SKC-');
  await click(button('下一页'));
  const row = container.querySelectorAll('tbody tr')[2];
  const skc = row.querySelector('strong').textContent;
  await click(row.querySelector('td:last-child'));
  expect(row.getAttribute('data-highlighted')).toBe('true');
  expect(row.querySelector('button').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.sales-period-composition .sales-chart-note').textContent).toContain('选中商品占销售额');
  expect(container.querySelector('.sales-store-pie [aria-pressed="true"]').getAttribute('aria-label')).toMatch(skc);
  expect(container.querySelector('.sales-details-controls input').value).toBe('SKC-');
  expect(container.querySelector('.sales-pagination').textContent).toContain('第 2/3 页');
  const first = container.querySelector('tbody strong').textContent;
  const slice = [...container.querySelectorAll('.sales-store-pie [role="button"]')].find(item => item.getAttribute('aria-label').startsWith(first + ' '));
  await act(async () => Simulate.click(slice));
  expect(container.querySelector('tbody tr:first-child button').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.sales-details-controls input').value).toBe('SKC-');
  expect(mocks.detail).toHaveBeenCalledTimes(1);
});

it('direct month selection keeps the store and has independent list context for each month', async () => {
  await click(button('按月')); await click(monthBar('2026-08')); await openStore();
  await change(container.querySelector('input'), 'SKC-');
  await click(button('下一页'));
  const before = container.querySelector('tbody').textContent;
  await change(byLabel('选择月份'), '2026-07');
  expect(container.textContent).toContain('甲 · 该店商品明细');
  expect(container.querySelector('input').value).toBe('');
  await change(byLabel('选择月份'), '2026-08');
  expect(container.querySelector('input').value).toBe('SKC-');
  expect(container.querySelector('.sales-pagination').textContent).toContain('第 2/3 页');
  expect(container.querySelector('tbody').textContent).toBe(before);
  await click(button('销量'));
  expect(container.querySelector('tbody').textContent).toBe(before);
  expect(container.querySelector('input').value).toBe('SKC-');
});

it('restores store and product queries separately and table scroll on reopening', async () => {
  await openDay();
  await change(container.querySelector('input'), '甲');
  await openStore();
  await change(container.querySelector('input'), 'SKC-');
  await change(container.querySelector('.sales-details-controls select'), 'quantityExact');
  await click(button('下一页'));
  const before = container.querySelector('tbody').textContent;
  const table = container.querySelector('.sales-day-table'); table.scrollLeft = 42;
  await act(async () => Simulate.scroll(table));
  await click(button('返回店铺'));
  expect(container.querySelector('input').value).toBe('甲');
  await openStore();
  expect(container.querySelector('input').value).toBe('SKC-');
  expect(container.querySelector('.sales-details-controls select').value).toBe('quantityExact');
  expect(container.querySelector('tbody').textContent).toBe(before);
  expect(container.querySelector('.sales-day-table').scrollLeft).toBe(42);
  await click(button('趋势')); await openDay();
  expect(container.querySelector('input').value).toBe('甲');
});

it.each(['unknown', 'future', 'unobserved'])('honors %s availability even when detail returns records', async status => {
  const chartMonth = buildSalesMonth({ period: '2026-08', sourceRows: source('2026-08') }, { today: '2026-09-18' });
  chartMonth.daily[0] = { ...chartMonth.daily[0], status, revenueExact: null, quantityExact: null };
  mocks.month.mockResolvedValue({ period: '2026-08', chartMonth });
  await act(async () => root.render(<SalesAnalytics {...props} ledgerId="RELOAD" />));
  await openDay();
  expect(container.querySelector('.sales-store-pie')).toBeNull();
  expect(container.querySelector('tbody')).toBeNull();
  expect(container.querySelector('.sales-details-heading p').textContent).toContain('销售原额 待查 · 销量 待查');
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
  await click(button('销量'));
  expect(container.querySelectorAll('.sales-store-pie [role="button"]')).toHaveLength(2);
});

it('opens absent months as unknown without sending synthetic ledger IDs to the repository', async () => {
  await click(button('按月')); await click(monthBar('2026-06'));
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(container.textContent).toContain('期间数据待查');
  expect(container.querySelector('.sales-details-heading p').textContent).toContain('待查');
});

it('preserves all comparison store selections across modes and range changes', async () => {
  await click(button('按月')); await click(button('店铺对比'));
  expect(container.querySelectorAll('.sales-store-legend input:checked')).toHaveLength(2);
  await click(button('清空店铺'));
  expect(container.querySelectorAll('.sales-store-legend input:checked')).toHaveLength(0);
  expect(container.querySelectorAll('.sales-grouped-segment')).toHaveLength(0);
  await click(button('月度总览'));
  expect(container.querySelectorAll('.sales-grouped-segment').length).toBeGreaterThan(0);
  await click(button('店铺对比'));
  expect(container.querySelectorAll('.sales-store-legend input:checked')).toHaveLength(0);
  await click(button('全选店铺'));
  await change(byLabel('月份范围'), '3');
  expect(container.querySelectorAll('.sales-month-group')).toHaveLength(3);
  expect(container.querySelectorAll('.sales-store-legend input:checked')).toHaveLength(2);
});

it('shows read errors and returns to the trend', async () => {
  mocks.detail.mockRejectedValueOnce(new Error('明细读取失败'));
  await openDay();
  expect(container.querySelector('[role="alert"]').textContent).toBe('明细读取失败');
  await click(button('返回趋势'));
  expect(container.querySelectorAll('.sales-daily-bar')).toHaveLength(31);
});

it('keeps an explicitly selected range end when a newer month arrives', async () => {
  await click(button('按月'));
  await change(byLabel('月份范围'), '6');
  await click(button('按日'));
  mocks.months.mockResolvedValue(['2026-08', '2026-09'].map(period => ({
    ...buildSalesMonth({ period, sourceRows: source(period) }, { today: '2026-10-18' }), ledgerId: period,
  })));
  await click(button('按月'));
  expect(container.querySelectorAll('.sales-month-group')).toHaveLength(6);
  expect(monthBar('2026-08')).toBeTruthy();
  expect(monthBar('2026-09')).toBeUndefined();
});

it('ignores late period results after rapid month changes', async () => {
  await click(button('按月')); await click(monthBar('2026-08'));
  let finish;
  mocks.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click(byLabel('上一月'));
  expect(container.textContent).toContain('正在读取 2026-07');
  await change(byLabel('选择月份'), '2026-08');
  await act(async () => finish(aggregatePeriodSalesDetails(source('2026-07'), { period: '2026-07' })));
  expect(container.querySelector('.sales-details-heading h3').textContent).toContain('2026-08');
});

it('applies the selected comparison stores to month details and never treats empty selection as all stores', async () => {
  await click(button('按月')); await click(button('店铺对比'));
  await click(button('清空店铺'));
  expect(monthBar('2026-08')).toBeUndefined();
  expect(container.querySelectorAll('.sales-store-entry')).toHaveLength(0);
  expect(container.textContent).toContain('请选择至少一家店铺');
  await click(container.querySelector('.sales-store-legend input'));
  await click(monthBar('2026-08'));
  expect(container.querySelectorAll('.sales-store-entry')).toHaveLength(1);
  expect(container.querySelector('.sales-store-entry').textContent).toContain('乙');
  await click(byLabel('上一月'));
  expect(container.querySelectorAll('.sales-store-entry')).toHaveLength(1);
});

it('keeps full SKC composition while searching and jumps to the chosen product page', async () => {
  await openDay(); await openStore();
  const before = container.querySelector('[aria-label="销售额SKC构成"]').innerHTML;
  await change(container.querySelector('.sales-details-controls input'), 'SKC-00');
  expect(container.querySelector('[aria-label="销售额SKC构成"]').innerHTML).toBe(before);
  const slice = [...container.querySelectorAll('.sales-store-pie [role="button"]')].find(node => node.getAttribute('aria-label').startsWith('SKC-12 '));
  await act(async()=>Simulate.click(slice));
  expect(container.querySelector('.sales-details-controls input').value).toBe('');
  expect(container.querySelector('[data-highlighted="true"]').textContent).toContain('SKC-12');
  expect(container.querySelector('.sales-pagination').textContent).toContain('第 3/4 页');
});

it('follows two selected stores from a date to a losing SKU inside a profitable SKC and back', async () => {
  const period = '2026-08';
  const rows = [
    ['27','S','GREEN',70,1], ['27','S','RED',5,1], ['27','S','RED',15,2],
    ['680','B','OTHER',50,1], ['20','EXCLUDE','HIDDEN',900,1],
  ].map(([store, platformSkc, platformSku, amount, quantity]) => ({
    store, platformSkc, platformSku, sourceAddedDate: period + '-01', supplierNumber: 'SUP',
    amountExact: String(amount), quantityExact: String(quantity),
  }));
  rows.push({ ...rows[0], sourceAddedDate: period + '-02' });
  const costs = ['GREEN','RED','OTHER','HIDDEN'].map(platformSku => ({
    platformSku, unitCost: 10, checkedPeriod: period, withinPeriod: true, resolutionStatus: 'resolved', currency: 'CNY',
  }));
  mocks.month.mockResolvedValue({ period, sourceRows: rows });
  mocks.detail.mockImplementation(async ({date}) => aggregatePeriodSalesDetails(rows,{period,date}));
  mocks.profit.mockResolvedValue(buildSalesProfitAnalysis({ ledger: { period, warehouseRate: 0, accountingMode: 'weighted' },
    rows, identities: rows, groups: groupReportSales(rows), costs, approvals: [] }));
  await act(async () => root.render(<SalesAnalytics {...props} workspaceId="comparison" />));
  await click(button('20'));
  expect(container.querySelector('.sales-daily-bar').getAttribute('aria-label')).toContain('商品利润 ¥90');
  await openDay();
  expect([...container.querySelectorAll('.sales-store-entry')].map(node => node.dataset.storeKey).sort()).toEqual(['27','680']);
  expect(container.querySelector('.sales-details-heading p').textContent).toContain('当日所选店铺合计 · 商品利润 ¥90');
  await click(byLabel('27 店，查看亏损 SKU，1 个'));
  expect(container.querySelector('.sales-product-view select').value).toBe('loss');
  expect(container.querySelector('tbody strong').textContent).toBe('RED');
  expect(container.querySelector('tbody tr').lastElementChild.textContent).toContain('¥-10');
  expect(container.querySelector('.sales-period-products > .sales-list-scope').textContent).toBe('亏损 SKU 合计 · 销售原额 ¥20 · 采购成本 ¥30 · 仓储费 ¥0 · 商品利润 ¥-10');
  await click(byLabel('下一日'));
  expect(container.textContent).toContain('该店本期没有亏损 SKU');
  await click(byLabel('上一日')); await click(button('返回店铺'));
  expect(container.querySelectorAll('.sales-store-entry')).toHaveLength(2);
  await openStore('27');
  expect(container.querySelector('.sales-product-view select').value).toBe('skc');
  expect(container.querySelector('tbody strong').textContent).toBe('S');
  await click(button('趋势'));
  expect(button('20').getAttribute('aria-pressed')).toBe('false');
});
