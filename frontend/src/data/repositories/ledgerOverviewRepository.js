import { db } from '../db/clientDatabase';
import { cachedDerived, sourceRevision, assertSourceRevision, retrySourceRead, observeSourceRevision } from '../db/derivedCache';
import { currentLedgerResult } from '../../domain/ledgerWorkflow';

export async function readLedgerReportHeaders(ledger, revision = sourceRevision()) {
  return cachedDerived({
    scope: [ledger.workspaceId, ledger.id], formula: 'report-headers@1', revision,
    compute: async () => (await db.profitReports.where('ledgerId').equals(ledger.id).toArray())
      .filter(report => report.workspaceId === ledger.workspaceId)
      .map(({ fileBase64, ...report }) => report),
  });
}

export async function withCurrentLedgerResults(ledgers) {
  return retrySourceRead(async () => {
    await observeSourceRevision();
    const revision = sourceRevision();
    const results = await Promise.all(ledgers.map(async ledger => {
      if (!ledger.currentBaseReportId) return { ...ledger, currentResult: currentLedgerResult(ledger) };
      const [reports, batches] = await Promise.all([
        readLedgerReportHeaders(ledger, revision),
        db.monthlySupplementBatches.where('[ledgerId+kind+status]').equals([ledger.id, 'deduction', 'adopted']).toArray(),
      ]);
      const deduction = batches.find(batch => batch.workspaceId === ledger.workspaceId);
      return { ...ledger, currentResult: currentLedgerResult(ledger, reports, deduction) };
    }));
    assertSourceRevision(revision);
    return results;
  });
}
