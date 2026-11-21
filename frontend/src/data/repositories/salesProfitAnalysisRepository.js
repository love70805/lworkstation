import { assertSourceRevision, cachedDerived, retrySourceRead, observeSourceRevision } from '../db/derivedCache';
import { inventoryCalculationRevision, inventoryLowestRevision } from '../db/inventoryRevisions';
import { db } from '../db/clientDatabase';
import { readAccountingSupplement } from './inventoryAccountingRepository';
import { buildSalesDispatch } from '../../domain/salesDispatchContribution';
import { getLedgerSnapshot } from './profitRepository';
import { readPageSaleChunks } from './ledgerPageSalesRepository';
import { runDerivedComputation } from './derivedComputationService';

export function readSalesProfitAnalysis({ workspaceId, ledgerId, store = 'all', daily = true, includeDispatch = true, requestedMode }) {
  return retrySourceRead(async () => {
    const snapshot = await getLedgerSnapshot(ledgerId, { summaryOnly: true, profitPage: true, requestedMode });
    if (!snapshot || snapshot.ledger.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    const { ledger, pageSales, costs, approvals, rows, dataVersion } = snapshot;
    if (pageSales.reportError) throw new Error(pageSales.reportError);
    const revisionReader = ledger.accountingMode === 'historical_lowest' ? inventoryLowestRevision : inventoryCalculationRevision;
    const result = await cachedDerived({
      scope: [workspaceId, ledgerId, store, daily, ledger.accountingMode, ledger.warehouseRate],
      formula: 'sales-product-profit@3-cost-source', revision: dataVersion, revisionReader, boundedMemory: true,
      compute: async () => {
        const pageChunks = daily ? await readPageSaleChunks(workspaceId, ledgerId, { parent: ledger }) : undefined;
        return runDerivedComputation('sales-profit', { ledger, identities: rows, approvals, costs, groups: pageSales.groups, store, workspaceId, pageChunks });
      },
    });
    let dispatch = null;
    if (includeDispatch) {
      const batch = await readAccountingSupplement(ledger, 'dispatch');
      if (batch) {
        const rows = db.monthlySupplementRows.where('batchId').equals(batch.id);
        if (!await observeSourceRevision()) await rows.count();
        dispatch = await cachedDerived({
          scope:[workspaceId, ledgerId, batch.id, store, ledger.warehouseRate], formula:'dispatch-contribution@1', boundedMemory:true,
          compute:async () => buildSalesDispatch(batch, await rows.toArray(), ledger, store),
        });
      }
    }
    assertSourceRevision(dataVersion, revisionReader);
    return { ...result, period:ledger.period, dispatch };
  });
}
