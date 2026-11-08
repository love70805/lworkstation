import { REPORT_FORMULA_VERSION, REPORT_TEMPLATE_VERSION, canonicalJson, sha256 } from './profitReports';

// Keep the Beta3 byte representation: old saved fingerprints remain comparable.
// This pure step runs in a worker for the live status check, outside the DB read.
export function canonicalReportSourceState({ ledger, salesRows, erpCosts, approvals, dispatch, deduction, supplementRows }) {
  const ordered = values => values.map(value => canonicalJson(value)).sort();
  return canonicalJson({ version: 1, formula: REPORT_FORMULA_VERSION, template: REPORT_TEMPLATE_VERSION,
    workspaceId: ledger.workspaceId, ledgerId: ledger.id, period: ledger.period,
    accountingMode: ledger.accountingMode, warehouseRate: String(ledger.warehouseRate ?? '0.7'),
    salesRows: ordered(salesRows), erpCosts: ordered(erpCosts), approvals: ordered(approvals),
    dispatch: dispatch ?? null, deduction: deduction ?? null, supplementRows: ordered(supplementRows) });
}

export function reportSourceFingerprint(input) {
  return sha256(canonicalReportSourceState(input));
}
