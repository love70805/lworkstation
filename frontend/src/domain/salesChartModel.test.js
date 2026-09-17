import { describe, expect, it } from 'vitest';
import { buildSalesMonth, salesScale, salesSegments, salesStoreColor, salesDayDifference, salesGroupedScale, salesGroupedSegments } from './salesChartModel';
const row = (store, date, amount, quantity = '1') => ({ store, sourceAddedDate: date, amountExact: amount, quantityExact: quantity });
const model = (rows, period = '2026-08', store = 'all') => buildSalesMonth({ period, sourceRows: rows }, { store, today: '2026-09-14' });
describe('sales chart semantic model', () => {
  it('keeps stable store colors independent of row ordering and store filters', () => {
    expect(salesStoreColor(' 甲 ')).toBe(salesStoreColor('甲'));
    const rows = [row('甲', '2026-08-01', '10'), row('乙', '2026-08-01', '20')];
    expect(model(rows).daily[0].segments).toEqual(model([...rows].reverse()).daily[0].segments);
    expect(model(rows, '2026-08', '甲').daily[0].revenueExact).toBe('10');
  });
  it('preserves exact negatives and uses signed stack extents with zero baseline', () => {
    const month = model([row('甲', '2026-08-01', '10.009'), row('乙', '2026-08-01', '-10.009')]);
    expect(month.daily[0].revenueExact).toBe('0');
    const scale = salesScale([month], 'revenueExact');
    expect(scale).toMatchObject({ max: 10.9, min: -10.9, zero: 50 });
    expect(salesSegments(month.daily[0], 'revenueExact', scale).every(item => item.percent === null)).toBe(true);
    expect(salesSegments(month.daily[0], 'quantityExact', salesScale([month], 'quantityExact')).map(item => item.percent)).toEqual(['50', '50']);
  });
  it('distinguishes missing stores, absent sources, known zeros and undated gaps', () => {
    const rows = [row('甲', '2026-08-01', '0')];
    expect(model(rows, '2026-08', '乙').missingStore).toBe(true);
    expect(model(rows, '2026-08', '乙').daily[1].revenueExact).toBeNull();
    expect(model(rows).daily[1]).toMatchObject({ status: 'known_zero', revenueExact: '0' });
    expect(model([...rows, row('甲', null, '1')]).daily[1].status).toBe('unknown');
    expect(model([]).daily[0].status).toBe('unknown');
    expect(model([{ ...rows[0], isDeduction: true }], '2026-08', '甲')).toMatchObject({ missingStore: false, coverage: 'unknown' });
  });
  it('does not claim future/unobserved days are zero in an unfinished month', () => {
    const month = model([row('甲', '2026-09-01', '5')], '2026-09');
    expect(month.cutoff).toBe('2026-09-01');
    expect(month.daily[13]).toMatchObject({ status: 'unobserved', revenueExact: null });
    expect(month.daily[14]).toMatchObject({ status: 'future', revenueExact: null });
  });
  it('aligns leap/month lengths and compares only known exact values on a shared daily scale', () => {
    const a = model([row('甲', '2024-02-01', '0.009')], '2024-02');
    const b = model([row('甲', '2026-08-01', '10')]);
    expect(a.daily).toHaveLength(29); expect(b.daily).toHaveLength(31);
    expect(salesDayDifference(a.daily[0], b.daily[0], 'revenueExact')).toBe('-9.991');
    expect(salesDayDifference(a.daily[30], b.daily[30], 'revenueExact')).toBeNull();
    expect(salesScale([a,b], 'revenueExact').max).toBe(10.8);
  });
  it('includes undated and out-of-period rows in exact per-store monthly totals', () => {
    const month = model([row('甲', '2026-08-01', '0.009', '0.1'), row('甲', null, '0.001', '0.2'), row('乙', '2026-07-31', '5'), { ...row('乙', null, '100'), isDeduction: true }]);
    expect(month.monthlySegments.find(item => item.store === '甲')).toMatchObject({ revenueExact: '0.01', quantityExact: '0.3' });
    expect(month.monthlySegments.find(item => item.store === '乙')).toMatchObject({ revenueExact: '5', quantityExact: '1' });
    expect(month.monthTotalsExact).toEqual({ revenueExact: '5.01', quantityExact: '1.3' });
    expect(month.unlocated).toBe(2);
    expect(month.daily[0].revenueExact).toBe('0.009');
  });
  it('keeps missing and sales-unknown stores absent from monthly bars while retaining real zero', () => {
    const rows = [row('甲', '2026-08-01', '0'), { ...row('乙', null, '1'), isDeduction: true }];
    expect(model(rows, '2026-08', '丙').monthlySegments).toEqual([]);
    expect(model(rows, '2026-08', '乙').monthlySegments).toEqual([]);
    expect(model([]).monthlySegments).toEqual([]);
    expect(model(rows).monthlySegments).toHaveLength(1);
    expect(model(rows).monthlySegments[0].revenueExact).toBe('0');
  });
  it('scales grouped columns independently and starts each signed bar at zero', () => {
    const month = model([row('甲', '2026-08-01', '6'), row('乙', '2026-08-01', '7'), row('丙', '2026-08-01', '-3')]);
    const scale = salesGroupedScale([month], 'revenueExact');
    expect(scale).toMatchObject({ max: 7.56, min: -3.24 });
    const bars = salesGroupedSegments(month.daily[0], 'revenueExact', scale);
    for (const bar of bars) {
      if (Number(bar.revenueExact) >= 0) expect(bar.top + bar.height).toBeCloseTo(scale.zero);
      else expect(bar.top).toBe(scale.zero);
      expect(bar.percent).toBeNull();
    }
    expect(salesGroupedSegments(month.daily[1], 'revenueExact', scale)).toEqual([]);
    expect(salesGroupedSegments({ revenueExact: null, segments: month.daily[0].segments }, 'revenueExact', scale)).toEqual([]);
  });
  it('uses monthly extrema and hidden store filters without changing source totals', () => {
    const month = model([row('甲', '2026-08-01', '4'), row('甲', null, '7'), row('乙', '2026-08-01', '2')]);
    expect(salesGroupedScale([month], 'revenueExact').max).toBe(4.32);
    expect(salesGroupedScale([month], 'revenueExact', { monthly: true }).max).toBe(11.9);
    expect(salesGroupedScale([month], 'revenueExact', { monthly: true, hiddenStores: [' 甲 '] }).max).toBe(2.16);
    expect(salesGroupedScale([month], 'revenueExact', { monthly: true, hiddenStores: ['甲', '乙'] })).toMatchObject({ max: 1, min: -0, zero: 100 });
    expect(month.monthTotalsExact.revenueExact).toBe('13');
  });
  it('preserves tiny values and a usable scale for negative-only grouped data', () => {
    const positive = model([row('甲', '2026-08-01', '0.009')]);
    const scale = salesGroupedScale([positive], 'revenueExact');
    expect(scale.max).toBe(0.00972);
    expect(salesGroupedSegments(positive.daily[0], 'revenueExact', scale)[0]).toMatchObject({ revenueExact: '0.009', percent: '100' });
    expect(salesGroupedScale([model([row('甲', '2026-08-01', '-2')])], 'revenueExact')).toMatchObject({ max: 0, min: -2.16, zero: 0 });
  });
  it('keeps matching headroom across differently sized revenue and quantity metrics', () => {
    const month = model([row('甲', '2026-08-01', '500027', '100002')]);
    for (const metric of ['revenueExact', 'quantityExact']) {
      for (const scale of [salesScale([month], metric), salesGroupedScale([month], metric, { monthly: true })]) {
        const ratio = scale.max / Number(month.monthTotalsExact[metric]);
        expect(ratio).toBeGreaterThanOrEqual(1.08);
        expect(ratio).toBeLessThan(1.09);
        expect(scale.min).toBe(-0);
        expect(scale.zero).toBe(100);
      }
    }
  });
});
