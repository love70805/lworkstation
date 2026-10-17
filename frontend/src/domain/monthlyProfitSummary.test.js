import { expect, it } from 'vitest';
import { monthlyProfitSummary } from './monthlyProfitSummary';

const ledger = { id: 'L', workspaceId: 'W', period: '2026-09', status: 'draft', warehouseRate: '0.7' };
const batch = values => ({ workspaceId: 'W', ledgerId: 'L', period: '2026-09', status: 'adopted', ...values });
function summary({ ledger: target = ledger, dispatch = batch({ adoptedQuantityExact: '100' }), deduction = null, reports = [], missingCostCount = 0, productProfitExact = '10.009' } = {}) {
  return monthlyProfitSummary({ ledger: target, productProfitExact, missingCostCount, reportState: { ledgerId: 'L', workspaceId: 'W', data: { ledger: target, stores: ['甲', '乙'], dispatch, deduction, reports } } });
}
it('adds adopted dispatch immediately using exact whole-ledger amounts without premature rounding', () => {
  expect(summary()).toMatchObject({ dispatchQuantityExact: '100', dispatchAmountExact: '70', profitExact: '80.009', deductionExact: null, label: '未扣款利润' });
  expect(summary({ ledger: { ...ledger, warehouseRate: '0.0009' } })).toMatchObject({ dispatchAmountExact: '0.09', profitExact: '10.099' });
});
it('distinguishes missing dispatch, explicit zero, missing costs and unreceived deductions', () => {
  expect(summary({ dispatch: null })).toMatchObject({ dispatchAmountExact: null, profitExact: null, costsPending: false });
  expect(summary({ dispatch: batch({ adoptedQuantityExact: '0' }) })).toMatchObject({ dispatchAmountExact: '0', profitExact: '10.009', label: '未扣款利润' });
  expect(summary({ missingCostCount: 1 })).toMatchObject({ dispatchAmountExact: '70', profitExact: null, costsPending: true });
  expect(summary({ missingCostCount: null })).toMatchObject({ profitExact: null, costsPending: true });
});
it('subtracts signed deductions and identifies incomplete coverage instead of presenting final profit', () => {
  expect(summary({ deduction: batch({ signedAmountExact: '-0.0009', coveredStores: ['甲', '乙'] }) })).toMatchObject({ deductionExact: '-0.0009', profitExact: '80.0099', label: '本月利润', missingStores: [] });
  expect(summary({ deduction: batch({ signedAmountExact: '5', coveredStores: ['甲'] }) })).toMatchObject({ profitExact: '75.009', label: '暂计利润', missingStores: ['乙'] });
  expect(summary({ deduction: batch({ signedAmountExact: '0', coveredStores: ['甲', '乙'] }) })).toMatchObject({ profitExact: '80.009', label: '本月利润' });
});
it('projects frozen product, dispatch and rate only from the current base while newly adopted deductions remain a projection', () => {
  const base = batch({ id: 'BASE', kind: 'pre_deduction', warehouseRateExact: '0.7', totalsExact: { productProfitExact: '20.0001', dispatchQuantityExact: '10', dispatchAmountExact: '7' } });
  const before = JSON.stringify(base);
  for (const status of ['finalized', 'locked']) {
    expect(summary({ ledger: { ...ledger, status, currentBaseReportId: 'BASE', warehouseRate: '9' }, productProfitExact: '999', missingCostCount: 3, dispatch: batch({ adoptedQuantityExact: '999' }), reports: [base], deduction: batch({ signedAmountExact: '0.0002', coveredStores: ['甲', '乙'] }) })).toMatchObject({ frozen: true, rateExact: '0.7', dispatchAmountExact: '7', dispatchQuantityExact: '10', profitExact: '26.9999', costsPending: false });
  }
  expect(JSON.stringify(base)).toBe(before);
  expect(summary({ ledger: { ...ledger, status: 'finalized', currentBaseReportId: 'MISSING' }, reports: [base] }).status).toBe('error');
});
it('rejects stale, foreign and failed source state without displaying a healthy zero', () => {
  const args = { ledger, productProfitExact: '10', missingCostCount: 0 };
  expect(monthlyProfitSummary(args).status).toBe('loading');
  expect(monthlyProfitSummary({ ...args, reportState: { ledgerId: 'OTHER', workspaceId: 'W' } }).status).toBe('loading');
  expect(monthlyProfitSummary({ ...args, reportState: { ledgerId: 'L', workspaceId: 'OTHER' } }).status).toBe('loading');
  expect(monthlyProfitSummary({ ...args, reportState: { ledgerId: 'L', workspaceId: 'W', error: '读取中断' } })).toEqual({ status: 'error', error: '读取中断' });
  expect(summary({ dispatch: batch({ workspaceId: 'OTHER', adoptedQuantityExact: '900' }), deduction: batch({ period: '2026-08', signedAmountExact: '99', coveredStores: ['甲', '乙'] }) })).toMatchObject({ dispatchAmountExact: null, deductionExact: null, profitExact: null });
});
it('marks the saved formal result current only while its adopted deduction still matches', () => {
  const base=batch({id:'BASE',kind:'pre_deduction',warehouseRateExact:'0.7',totalsExact:{productProfitExact:'20',dispatchQuantityExact:'10',dispatchAmountExact:'7'}});
  const deduction=batch({id:'K',signedAmountExact:'2',coveredStores:['甲','乙']});
  const formal=batch({id:'F',kind:'financial',baseReportId:'BASE',adoptedBatchIds:['K'],displayTotals:{profit:'25.00'}});
  const options={ledger:{...ledger,status:'finalized',currentBaseReportId:'BASE'},reports:[base,formal],deduction};
  expect(summary(options).formalSaved).toBe(true);
  expect(summary({...options,deduction:{...deduction,id:'REPLACEMENT'}}).formalSaved).toBe(false);
});
