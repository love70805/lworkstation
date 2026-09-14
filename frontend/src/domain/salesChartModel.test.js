import { describe, expect, it } from 'vitest';
import { buildSalesMonth, salesScale, salesSegments, salesStoreColor, salesDayDifference } from './salesChartModel';
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
    expect(scale).toMatchObject({ max: 20, min: -20, zero: 50 });
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
    expect(salesScale([a,b], 'revenueExact').max).toBe(10);
  });
});
