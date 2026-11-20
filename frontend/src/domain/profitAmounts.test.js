import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildReportProducts, legacyReportLine, reportTotals } from './profitReports';
import { buildProfitReportWorkbook } from '../lib/profitReportWorkbook';
import { summarizeProfitRows } from '../lib/profitPrecision';
import { profitCostFields } from './profitPageProjection';

it('reconciles thirds to the cent across SKUs, page projections and the Excel file in either mode', () => {
  const salesRows = [1, 2].map((_, i) => ({ store:'甲', platformSku:'SKU'+i, platformSkc:'SKC', quantity:1, amount:2 }));
  const erpCosts = [1, 2].map((amount, i) => {
    const purchase = { recordId:'P', quantity:3, unitPrice:amount/3, totalPrice:amount, amountBasis:'purchase_total' };
    return {id:'C'+i, ...salesRows[i], unitCost:amount/3, resolutionStatus:'resolved', selectedRecordIds:['P'], purchaseRecords:[purchase]};
  });
  for (const [accountingMode, cost, profit] of [['weighted','1','3'],['historical_lowest','0.99','3.01']]) {
    const input = {ledger:{accountingMode,warehouseRate:0}, salesRows, erpCosts, approvals:[]};
    const products = buildReportProducts(input);
    const preview = buildReportProducts({...input, erpCosts:erpCosts.map(row => profitCostFields(row, null))});
    const totals = reportTotals(products, null, '0');
    expect(totals).toMatchObject({purchaseCostExact:cost,profitExact:profit});
    expect(summarizeProfitRows(preview.map(legacyReportLine)).exactTotals).toMatchObject({purchaseCost:cost,profit});
    const result = buildProfitReportWorkbook({report:{accountingMode, ledgerPeriod:'2026-10',kind:'pre_deduction',totalsExact:totals},products});
    const sheet = XLSX.read(result.bytes,{type:'array'}).Sheets['甲'];
    expect(sheet.G2.w).toBe(accountingMode === 'weighted' ? '0.33333333' : '0.33');
    expect(sheet.H4.v).toBe(Number(cost));
    expect(sheet.J4.v).toBe(Number(profit));
    if (accountingMode === 'weighted') expect(sheet.G2.f).toBe('1/3');
  }
});
