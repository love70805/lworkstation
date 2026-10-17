import { Exact } from './profitReports';

// A read-only, whole-ledger projection. Filtered product subtotals never enter it.
export function monthlyProfitSummary({ ledger, reportState, productProfitExact, missingCostCount }) {
  if (!reportState || reportState.ledgerId !== ledger.id || reportState.workspaceId !== ledger.workspaceId) return { status: 'loading' };
  if (reportState.error) return { status: 'error', error: reportState.error };
  const data = reportState.data;
  if (!data || data.ledger.id !== ledger.id || data.ledger.workspaceId !== ledger.workspaceId || data.ledger.period !== ledger.period) return { status: 'loading' };
  const frozen = ['finalized', 'locked'].includes(ledger.status);
  const belongs = row => row?.workspaceId === ledger.workspaceId && row.ledgerId === ledger.id && row.period === ledger.period;
  const base = frozen ? data.reports.find(report => belongs(report) && report.id === ledger.currentBaseReportId && report.kind === 'pre_deduction') : null;
  if (frozen && !base) return { status: 'error', error: '基础报告缺失，请检查备份。' };
  const dispatch = belongs(data.dispatch) && data.dispatch.status === 'adopted' ? data.dispatch : null;
  const deduction = belongs(data.deduction) && data.deduction.status === 'adopted' ? data.deduction : null;
  const dispatchQuantityExact = frozen ? base.totalsExact.dispatchQuantityExact : dispatch?.adoptedQuantityExact ?? null;
  const rateExact = frozen ? base.warehouseRateExact : String(ledger.warehouseRate ?? '0.7');
  const dispatchAmountExact = frozen ? base.totalsExact.dispatchAmountExact : dispatchQuantityExact === null ? null : new Exact(dispatchQuantityExact).times(rateExact).toFixed();
  const deductionExact = deduction?.signedAmountExact ?? null;
  const missingStores = deduction ? data.stores.filter(store => !deduction.coveredStores.includes(store)) : data.stores;
  const products = frozen ? base.totalsExact.productProfitExact : productProfitExact;
  const costsPending = !frozen && (missingCostCount !== 0 || products == null);
  const profitExact = costsPending || dispatchAmountExact === null ? null : new Exact(products).plus(dispatchAmountExact).minus(deductionExact ?? '0').toFixed();
  return {
    status: 'ready', dispatchQuantityExact, dispatchAmountExact, rateExact, deductionExact, missingStores, costsPending, profitExact,
    label: deductionExact === null ? '未扣款利润' : missingStores.length ? '暂计利润' : '本月利润',
    frozen,
  };
}
