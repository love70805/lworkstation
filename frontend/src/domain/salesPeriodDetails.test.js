import { expect, it } from 'vitest';
import { aggregatePeriodSalesDetails } from './salesPeriodDetails';
import { buildSalesProfitAnalysis, profitableSkcs, withDetailProfit } from './salesProfitAnalysis';
import { packPageSales, periodDetailColumns } from './ledgerPageSales';
import { storeSkuKey } from './manualCostOverride';
import { groupReportSales } from './profitReports';

const row = (patch = {}) => ({ store: '甲', platformSkc: 'SKC1', platformSku: '001', sourceAddedDate: '2026-08-01', quantityExact: '2', amountExact: '0.009', ...patch });
it('reads packed and raw dates, returns and legacy fields identically for each selected store', () => {
  const rows = [row(), row({store:'乙',sourceAddedDate:'2026-08-01T19:00:00Z'}), row({sourceAddedDate:46235}),
    row({ store:'乙', sourceAddedDate:'2026-09-03' }),row({sourceAddedDate:'bad'}),row({sourceAddedDate:null}),
    row({isDeduction:true}),row({movementType:'罚款'}),row({platformSku:undefined,sku:'OLD',quantityExact:undefined,quantity:-2,amountExact:undefined,amount:-5})];
  const detailChunks = [rows.slice(0,3),rows.slice(3)].map(part => periodDetailColumns(packPageSales(part, 'W')));
  for (const store of ['all','甲','乙','空']) for (const date of [null,'2026-08-01','2026-08-02','2026-08-20']) {
    const scope={period:'2026-08',date};
    expect(aggregatePeriodSalesDetails(null,{...scope,store,detailChunks})).toEqual(aggregatePeriodSalesDetails(rows.filter(r=>store==='all'||store===r.store),scope));
  }
});

it('ranks complete parents after offsetting stores, preserves exact costs and the full range of adopted prices', () => {
  const priced=(store,platformSkc,profitExact,purchaseCostExact,revenueExact,platformSkus=['001']) =>
    ({store,platformSkc,profitExact,purchaseCostExact,revenueExact,warehouseCostExact:'0',platformSkus});
  const rows=[priced('甲','ABC','9','1','10'),priced('乙','ａｂｃ','-2','2','0'),priced('甲','ZERO','0','0','0'),
    priced('甲','UNKNOWN','10','0','10'),priced('乙','UNKNOWN',null,null,'5'),priced('甲','','99','0','99'),
    {...priced('甲','SMALL','0.00005','0','0.00005'),platformSkus:['003']}];
  const costs={ [storeSkuKey('甲','001')]: '1', [storeSkuKey('乙','001')]: ['2','1'], [storeSkuKey('甲','003')]: '0' };
  expect(profitableSkcs(rows,costs)).toEqual([
    {key:'ABC',skc:'ABC',profit:'7',purchase:'3',minUnit:'1',maxUnit:'2'},
    {key:'SMALL',skc:'SMALL',profit:'0.00005',purchase:'0',minUnit:'0',maxUnit:'0'},
  ]);
});
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
