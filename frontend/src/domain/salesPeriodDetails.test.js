import { expect, it } from 'vitest';
import { aggregatePeriodSalesDetails } from './salesPeriodDetails';

const row = (patch = {}) => ({ store: '甲', platformSkc: 'SKC1', platformSku: '001', sourceAddedDate: '2026-08-01', quantityExact: '2', amountExact: '0.009', ...patch });
it('aggregates SKU branches by store and SKC without truncating money', () => {
  const result = aggregatePeriodSalesDetails([row(), row({ platformSku: '002' }), row({ store: '乙' })], { period: '2026-08' });
  expect(result.totalsExact.revenueExact).toBe('0.027');
  expect(result.rows).toHaveLength(2);
  expect(result.rows.find(item => item.store === '甲').platformSkus).toEqual(['001', '002']);
  expect(result.stores.map(item => item.quantityExact).sort()).toEqual(['2', '4']);
});
it('keeps missing SKCs distinct by SKU and never substitutes SKU for SKC', () => {
  const result = aggregatePeriodSalesDetails([row({ platformSkc: '', platformSku: '001' }), row({ platformSkc: '', platformSku: '002' })], { period: '2026-08' });
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every(item => item.platformSkc === '')).toBe(true);
});
it('includes undated sales in monthly detail only and excludes deductions', () => {
  const rows = [row(), row({ sourceAddedDate: '' }), row({ isDeduction: true }), row({ movementType: '盘亏' })];
  const month = aggregatePeriodSalesDetails(rows, { period: '2026-08' });
  const day = aggregatePeriodSalesDetails(rows, { period: '2026-08', date: '2026-08-01' });
  expect(month.totalsExact.quantityExact).toBe('4');
  expect(day.totalsExact.quantityExact).toBe('2');
  expect(day.unlocatedCount).toBe(1);
  expect(aggregatePeriodSalesDetails(rows, { period: '2026-08', date: '2026-08-02' }).status).toBe('unknown');
});
it('preserves negative and real zero values, rejects invalid dates', () => {
  const result = aggregatePeriodSalesDetails([row(), row({ quantityExact: '-2', amountExact: '-0.009' })], { period: '2026-08' });
  expect(result.totalsExact.quantityExact).toBe('0');
  expect(result.rows[0].averagePriceExact).toBeNull();
  expect(aggregatePeriodSalesDetails([row()], { period: '2026-08', date: '2026-08-02' }).status).toBe('known_zero');
  for (const date of ['2026-08-32', '2026-09-01']) expect(() => aggregatePeriodSalesDetails([], { period: '2026-08', date })).toThrow();
});
