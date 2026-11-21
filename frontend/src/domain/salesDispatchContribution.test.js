import { expect, it } from 'vitest';
import { buildSalesDispatch, chartWithDispatch, detailWithDispatch } from './salesDispatchContribution';
import { profitableSkcs } from './salesProfitAnalysis';
import { dispatchSourcePeriods } from './dispatchPeriods';
import { inspectSupplementSource, suggestSupplementMapping } from './monthlySupplements';

const ledger = {workspaceId:'W',id:'L',period:'2026-09',warehouseRate:'0.65'};
const batch = {id:'B',adoptedQuantityExact:'13'};
const line = (store, platformSkc, quantityExact, dispatchDate) => ({kind:'dispatch',workspaceId:'W',ledgerId:'L',batchId:'B',store,platformSkc,quantityExact,dispatchDate});
const rows = [line('A','Parent','5','2026-09-02'),line('B','PARENT','2'),line('B','Only','3','2026-09-03')];
const sales = (store, skc) => ({ key:store,store,platformSkc:skc,platformSkus:['S'],quantityExact:'2',revenueExact:'5',warehouseCostExact:'1.3',purchaseCostExact:'4',profitExact:'-0.3' });

it('retains month-only savings and never counts a dispatch as a sale or a second purchase adjustment', () => {
  const data = buildSalesDispatch(batch,rows,ledger);
  expect(data.month.total).toEqual({dispatchAmountExact:'8.45',dispatchQuantityExact:'13'});
  expect(data.undatedQuantityExact).toBe('5');
  const visible = buildSalesDispatch(batch,rows,ledger,'B');
  expect(visible.month.total.dispatchAmountExact).toBe('3.25');
  expect(visible.days['2026-09-02']).toBeUndefined();
  const sale = sales('A','PARENT');
  const monthly = detailWithDispatch({status:'data',totalsExact:sale,stores:[sale],rows:[sale]},data);
  expect(monthly.totalsExact).toMatchObject({revenueExact:'5',quantityExact:'2',salesProfitExact:'-0.3',profitExact:'8.15',purchaseCostExact:'4'});
  expect(profitableSkcs(monthly.rows)).toMatchObject([
    {skc:'PARENT',stores:['A','B'],profit:'4.25',salesProfit:'-0.3',purchase:'4',dispatchQuantity:'7'},
    {skc:'Only',profit:'1.95',salesProfit:'0',purchase:'0'}
  ]);
  const day = detailWithDispatch({status:'data',totalsExact:sale,stores:[sale],rows:[sale]},data,'2026-09-02');
  expect(day.totalsExact).toMatchObject({profitExact:'2.95',dispatchQuantityExact:'5'});
  expect(day.rows).toHaveLength(1);
  const pending = {...sale,profitExact:null,purchaseCostExact:null};
  const unpriced = detailWithDispatch({status:'data',totalsExact:pending,stores:[pending],rows:[pending]},data,'2026-09-02');
  expect(unpriced.totalsExact).toMatchObject({profitExact:null,dispatchAmountExact:'3.25'});
  expect(profitableSkcs(unpriced.rows)).toEqual([]);
});
it('keeps unknown sales unknown and creates a daily bar only on a covered date', () => {
  const data = buildSalesDispatch(batch,rows,ledger);
  const month = {daily:[{date:'2026-09-02',status:'unknown',segments:[],profitExact:null},{date:'2026-09-03',status:'known_zero',profitExact:'0',revenueExact:'0',quantityExact:'0',segments:[]}]};
  const actual = chartWithDispatch(month,data);
  expect(actual.daily[0]).toMatchObject({status:'unknown',profitExact:null,dispatchAmountExact:'3.25',segments:[]});
  expect(actual.daily[1]).toMatchObject({status:'data',quantityExact:'0',profitExact:'1.95',segments:[{store:'B',quantityExact:'0',profitExact:'1.95'}]});
  expect(() => buildSalesDispatch(batch,[{...rows[0],workspaceId:'other'}],ledger)).toThrow();
});
it('preserves the original date row for merged and continuous blocks, stopping at separators and invalid dates', () => {
  const headers=['日期','登记人','店铺','SKC','数量','订单号'];
  const record=(day,id)=>[day,'登记人甲','A','Parent',1,id];
  const cells=[headers,record('9月2日','a'),record('','b'),record('','c'),[],record('','d'),record('9月31日','e'),record('','f')];
  const mapping=suggestSupplementMapping(headers);
  const source={fileHash:'H',fileName:'9月代发.xlsx',sheetName:'9月',sourceFormat:'xlsx',headerRow:1,cells,merges:[{s:{r:1,c:0},e:{r:2,c:0}}],mapping};
  const scope=dispatchSourcePeriods(source,ledger.period);
  const parsed=inspectSupplementSource(source,{kind:'dispatch',mapping,ownerMarker:'登记人甲',stores:['A'],periodScope:{...scope,selected:new Set([ledger.period])}});
  expect(scope.dates[2]).toEqual({date:'2026-09-02',sourceRow:2});
  expect(scope.dates[3]).toEqual(scope.dates[2]);
  expect(scope.dates[5]).toBeUndefined();
  expect(scope.dates[6]).toBeUndefined();
  expect(parsed.rows.filter(row => row.dispatchDate).map(row => row.dispatchDateSourceRow)).toEqual([2,2,2]);
});
