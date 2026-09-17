import { aggregateDailySales, aggregateDailySalesDetails } from '../domain/salesAnalytics';
import { buildReportProducts } from '../domain/profitReports';
import { buildSalesMonth } from '../domain/salesChartModel';
import { aggregatePeriodSalesDetails } from '../domain/salesPeriodDetails';

export function computeDerived(kind, input) {
  if (kind === 'period-detail') return aggregatePeriodSalesDetails(input.rows, input);
  if (kind === 'sales') {
    const result = aggregateDailySales(input.rows, { period: input.period, includeSkuStats: false });
    return { ...result, chartMonth: buildSalesMonth({ ...result, sourceRows: input.rows }, { store: input.store, today: input.today }) };
  }
  if (kind === 'day') return aggregateDailySalesDetails(input.rows, { period: input.period, date: input.date });
  // UI needs only the first source reference. Immutable report generation calls
  // the domain directly and retains every evidence row.
  if (kind === 'profit') return buildReportProducts(input).map(row => ({ ...row, sourceRowCount: row.sourceRows.length, sourceRows: row.sourceRows.slice(0, 1) }));
  throw new Error('未知计算类型。');
}
