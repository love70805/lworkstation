import { REPORT_FORMULA_VERSION, REPORT_TEMPLATE_VERSION, canonicalJson } from './profitReports';
import { canonicalJsonChunks, hashJsonChunks, quotedJsonChunks } from './canonicalHash';
import { REPORT_SOURCE_DIGEST_VERSION, reportSourceDigests } from './reportSourceDigests';

// Keep the Beta3 byte representation: old saved fingerprints remain comparable.
// This pure step runs in a worker for the live status check, outside the DB read.
export function canonicalReportSourceState({ ledger, salesRows, erpCosts, approvals, dispatch, deduction, supplementRows, formula = REPORT_FORMULA_VERSION, template = REPORT_TEMPLATE_VERSION }) {
  const ordered = values => values.map(value => canonicalJson(value)).sort();
  return canonicalJson({ version: 1, formula, template,
    workspaceId: ledger.workspaceId, ledgerId: ledger.id, period: ledger.period,
    accountingMode: ledger.accountingMode, warehouseRate: String(ledger.warehouseRate ?? '0.7'),
    salesRows: ordered(salesRows), erpCosts: ordered(erpCosts), approvals: ordered(approvals),
    dispatch: dispatch ?? null, deduction: deduction ?? null, supplementRows: ordered(supplementRows) });
}

function* sourceStateChunks(input, digests) {
  const { ledger, dispatch, deduction, formula = REPORT_FORMULA_VERSION, template = REPORT_TEMPLATE_VERSION } = input;
  const lists = new Set(digests ? ['approvals', 'supplementRows'] : ['salesRows', 'erpCosts', 'approvals', 'supplementRows']);
  const header = { version: digests ? REPORT_SOURCE_DIGEST_VERSION : 1, formula, template,
    ...(digests ? { salesRows: digests.salesRows.unordered, erpCosts: digests.erpCosts.unordered } : {}),
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

export async function reportSourceFingerprint(input, digests) {
  if ((input.fingerprintVersion ?? 1) === 1) return hashJsonChunks(sourceStateChunks(input));
  if (input.fingerprintVersion !== REPORT_SOURCE_DIGEST_VERSION) throw new Error('无法识别报告来源校验版本。');
  return hashJsonChunks(sourceStateChunks(input, digests ?? await reportSourceDigests(input, true)));
}
