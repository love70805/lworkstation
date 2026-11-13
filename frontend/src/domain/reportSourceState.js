import { REPORT_FORMULA_VERSION, REPORT_TEMPLATE_VERSION, canonicalJson } from './profitReports';
import { canonicalJsonChunks, hashJsonChunks, quotedJsonChunks } from './canonicalHash';

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

function* sourceStateChunks(input) {
  const { ledger, dispatch, deduction } = input;
  const lists = new Set(['salesRows', 'erpCosts', 'approvals', 'supplementRows']);
  const header = { version: 1, formula: REPORT_FORMULA_VERSION, template: REPORT_TEMPLATE_VERSION,
    workspaceId: ledger.workspaceId, ledgerId: ledger.id, period: ledger.period,
    accountingMode: ledger.accountingMode, warehouseRate: String(ledger.warehouseRate ?? '0.7'),
    dispatch: dispatch ?? null, deduction: deduction ?? null };
  const keys = [...Object.keys(header).filter(key => header[key] !== undefined), ...lists].sort();
  yield '{';
  for (let index = 0; index < keys.length; index++) {
    if (index) yield ',';
    const key = keys[index]; yield* quotedJsonChunks(key); yield ':';
    if (!lists.has(key)) { yield* canonicalJsonChunks(header[key]); continue; }
    // Preserve the existing sort order and quoted row representation. Release
    // each table's sort strings before preparing the next; never join the
    // complete source state or UTF-8-encode that entire state at once.
    const ordered = input[key].map(canonicalJson).sort();
    yield '[';
    for (let row = 0; row < ordered.length; row++) {
      if (row) yield ',';
      if (ordered[row] !== undefined) yield* quotedJsonChunks(ordered[row]);
    }
    yield ']';
  }
  yield '}';
}

export const reportSourceFingerprint = input => hashJsonChunks(sourceStateChunks(input));
