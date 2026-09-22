import { describe, expect, it } from 'vitest';
import { currentLedgerResult, ledgerNextStep, reportReadiness } from './ledgerWorkflow';

const ledger = { id: 'june', workspaceId: 'w', period: '2026-06', status: 'finalized', currentBaseReportId: 'base', reportWorkflowVersion: 1, profitSummary: { profit: 100 } };
const base = { id: 'base', ledgerId: 'june', workspaceId: 'w', period: '2026-06', kind: 'pre_deduction', displayTotals: { profit: '100.00' }, revision: 1 };
const deduction = { id: 'deduction20', ledgerId: 'june', workspaceId: 'w', status: 'adopted', coveredStores: ['A'] };
const financial = { ...base, id: 'financial', kind: 'financial', baseReportId: 'base', adoptedBatchIds: ['dispatch', 'deduction20'], displayTotals: { profit: '80.00' } };
describe('current report projection', () => {
  it('uses the matching current financial report without mutating the base', () => {
    expect(currentLedgerResult(ledger, [base, financial], deduction)).toMatchObject({ profit: 80, state: 'financial' });
    expect(ledger.profitSummary.profit).toBe(100);
  });
  it('a replacement deduction does not keep the old financial result current', () => {
    expect(currentLedgerResult(ledger, [base, financial], { ...deduction, id: 'deduction30' })).toMatchObject({ profit: 100, state: 'deduction_pending' });
    expect(currentLedgerResult(ledger, [base, financial, { ...financial, id: 'new', revision: 2, adoptedBatchIds: ['deduction30'], displayTotals: { profit: '70.00' } }], { ...deduction, id: 'deduction30' }).profit).toBe(70);
  });
  it('ignores another workspace, month or base and hides old results after reopening', () => {
    for (const mismatch of [{ workspaceId: 'other' }, { period: '2026-09' }, { baseReportId: 'old' }]) {
      expect(currentLedgerResult(ledger, [base, { ...financial, ...mismatch }], deduction).state).toBe('deduction_pending');
    }
    expect(currentLedgerResult({ ...ledger, status: 'cost_pending', currentBaseReportId: null }, [base, financial], deduction)).toMatchObject({ profit: null, state: 'reopened' });
  });
  it('preserves legacy frozen results and does not treat missing report as zero', () => {
    expect(currentLedgerResult({ ...ledger, currentBaseReportId: null }).profit).toBe(100);
    expect(currentLedgerResult(ledger).profit).toBeNull();
  });
});
it('finalized and filtered views use whole-ledger readiness', () => {
  expect(ledgerNextStep(ledger, { missingCount: 99 }).key).toBe('report');
  expect(ledgerNextStep({ ...ledger, status: 'cost_pending', costSummary: { missingCount: 2 } }).text).toContain('2');
  expect(reportReadiness({ ledger, stores: ['A', 'B'], deduction }).financialReady).toBe(false);
  expect(reportReadiness({ ledger, stores: ['A'], deduction }).financialReady).toBe(true);
});
