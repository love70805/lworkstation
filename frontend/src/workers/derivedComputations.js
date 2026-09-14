import { aggregateDailySales, aggregateDailySalesDetails } from '../domain/salesAnalytics';
import { buildReportProducts } from '../domain/profitReports';

export function computeDerived(kind, input) {
  if (kind === 'sales') return aggregateDailySales(input.rows, { period: input.period, includeSkuStats: false });
  if (kind === 'day') return aggregateDailySalesDetails(input.rows, { period: input.period, date: input.date });
  // UI needs only the first source reference. Immutable report generation calls
  // the domain directly and retains every evidence row.
  if (kind === 'profit') return buildReportProducts(input).map(row => ({ ...row, sourceRowCount: row.sourceRows.length, sourceRows: row.sourceRows.slice(0, 1) }));
  throw new Error('未知计算类型。');
}
