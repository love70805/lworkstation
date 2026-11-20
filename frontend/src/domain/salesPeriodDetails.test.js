import { expect, it } from 'vitest';
import { aggregatePeriodSalesDetails } from './salesPeriodDetails';
import { buildSalesProfitAnalysis, withDetailProfit } from './salesProfitAnalysis';
import { groupReportSales } from './profitReports';

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

it('classifies each store SKU after returns, isolates unpriced SKUs and reconciles dated and monthly totals', () => {
  const period = '2026-08', day = period + '-01';
  const rows = [
    row({ platformSku:'one', amountExact:'5', quantityExact:'2' }),
    row({ platformSku:'one', amountExact:'-4', quantityExact:'-1' }),
    row({ platformSku:'one', amountExact:'10', quantityExact:'1', sourceAddedDate:'' }),
    row({ platformSku:'two', amountExact:'10', quantityExact:'1' }),
    row({ store:'乙', platformSku:'unpriced', amountExact:'3', quantityExact:'1' }),
  ];
  const costs = ['one','two'].map(platformSku => ({platformSku, unitCost:2, checkedPeriod:period,withinPeriod:true,resolutionStatus:'resolved',currency:'CNY'}));
  const analysis = buildSalesProfitAnalysis({ledger:{period,warehouseRate:'0.5',accountingMode:'weighted'},
    rows,identities:rows,groups:groupReportSales(rows),costs,approvals:[]});
  const detail = date => withDetailProfit(aggregatePeriodSalesDetails(rows,{period,date}),analysis,date);
  const daily=detail(day), monthly=detail(null);
  const shop = (data,store) => data.stores.find(item => item.store === store);
  expect(shop(daily,'甲').breakdown).toEqual({earningExact:'7.5',lossExact:'-1.5',earned:1,lost:1,pending:0});
  expect(shop(daily,'甲').profitExact).toBe('6');
  expect(shop(monthly,'甲').breakdown).toEqual({earningExact:'13.5',lossExact:'0',earned:2,lost:0,pending:0});
  expect(shop(daily,'乙').breakdown).toEqual({earningExact:null,lossExact:null,earned:0,lost:0,pending:1});
  expect(daily.totalsExact.profitExact).toBeNull();
  expect(daily.unlocatedByStore).toEqual({甲:1});
  const mismatch=aggregatePeriodSalesDetails(rows,{period,date:day});
  mismatch.stores.find(item=>item.store==='甲').quantityExact='99';
  expect(shop(withDetailProfit(mismatch,analysis,day),'甲').breakdown).toBeUndefined();
});
