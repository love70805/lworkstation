import { aggregateDailySales, aggregateDailySalesDetails } from '../domain/salesAnalytics';
import { buildReportProducts, priceReportGroups } from '../domain/profitReports';
import { buildSalesMonth } from '../domain/salesChartModel';
import { buildSalesProfitAnalysis } from '../domain/salesProfitAnalysis';
import { aggregatePeriodSalesDetails } from '../domain/salesPeriodDetails';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import { prepareSelectionSalesFacts } from '../domain/selectionSalesFacts';
import { packSelectionSalesFacts } from '../domain/selectionSalesFactsCodec';
import { calculateLedgerCostCoverage } from '../domain/costCoverage';
import { profitCostWithinPeriod } from '../domain/profitPageProjection';
import { packProfitSaleGroups, prepareProfitPageSales } from '../domain/profitPageSales';
import { reconcileErpCostRows } from '../domain/erpCosts';
import { previewPendingErpCostAnomalies, previewErpCostAnomalyReview, reviewErpAnomalyReceipt } from '../domain/erpAnomalyPreview';
import { reportSourceFingerprint } from '../domain/reportSourceState';
import { expandPageSales } from '../domain/ledgerPageSales';

export function computeDerived(kind, input) {
  if (input.pageChunks) {
    const { pageChunks, ...options } = input;
    input = { ...options, [kind === 'selection-facts' ? 'salesRows' : 'rows']: expandPageSales(pageChunks, kind, options) };
  }
  if (kind === 'report-source-fingerprint') return reportSourceFingerprint(input);
  if (kind === 'cost-coverage') return calculateLedgerCostCoverage(input);
  if (kind === 'profit-page-coverage') return calculateLedgerCostCoverage(input, profitCostWithinPeriod);
  if (kind === 'profit-page-sales') return packProfitSaleGroups(prepareProfitPageSales(input.rows));
  if (kind === 'cost-reconciliation') return reconcileErpCostRows(input);
  if (kind === 'pending-erp-anomalies') return previewPendingErpCostAnomalies(input);
  if (kind === 'erp-anomaly-review') return previewErpCostAnomalyReview(input);
  if (kind === 'erp-anomaly-receipt') return reviewErpAnomalyReceipt(input);
  if (kind === 'selection-facts') return packSelectionSalesFacts(prepareSelectionSalesFacts(input), input.ledgers[0]);
  if (kind === 'selection') return buildSelectionReferenceRows({ ...input, compactEvidence: true, includeStoreTags: true });
  if (kind === 'period-detail') return aggregatePeriodSalesDetails(input.rows, input);
  if (kind === 'sales-profit') return buildSalesProfitAnalysis(input);
  if (kind === 'sales') {
    const result = aggregateDailySales(input.rows, { period: input.period, includeSkuStats: false });
    return { ...result, chartMonth: buildSalesMonth({ ...result, sourceRows: input.rows }, { store: input.store, today: input.today }) };
  }
  if (kind === 'day') return aggregateDailySalesDetails(input.rows, { period: input.period, date: input.date });
  // UI needs only the first source reference. Immutable report generation calls
  // the domain directly and retains every evidence row.
  if (kind === 'profit' || kind === 'profit-page') {
    const lines = kind === 'profit-page' && input.pageGroups ? priceReportGroups(input, input.pageGroups, profitCostWithinPeriod)
      : buildReportProducts(input, kind === 'profit-page' ? profitCostWithinPeriod : undefined);
    return lines.map(row => ({ ...row, sourceRowCount: row.sourceRowCount ?? row.sourceRows.length, sourceRows: row.sourceRows.slice(0, 1) }));
  }
  throw new Error('未知计算类型。');
}
