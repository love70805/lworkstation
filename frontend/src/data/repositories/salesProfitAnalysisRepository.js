import { assertSourceRevision, cachedDerived, retrySourceRead } from '../db/derivedCache';
import { inventoryCalculationRevision, inventoryLowestRevision } from '../db/inventoryRevisions';
import { getLedgerSnapshot } from './profitRepository';
import { readPageSaleChunks } from './ledgerPageSalesRepository';
import { runDerivedComputation } from './derivedComputationService';

export function readSalesProfitAnalysis({ workspaceId, ledgerId, store = 'all', daily = true }) {
  return retrySourceRead(async () => {
    const snapshot = await getLedgerSnapshot(ledgerId, { summaryOnly: true, profitPage: true });
    if (!snapshot || snapshot.ledger.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    const { ledger, pageSales, costs, approvals, rows, dataVersion } = snapshot;
    if (pageSales.reportError) throw new Error(pageSales.reportError);
    const revisionReader = ledger.accountingMode === 'historical_lowest' ? inventoryLowestRevision : inventoryCalculationRevision;
    const result = await cachedDerived({
      scope: [workspaceId, ledgerId, store, daily, ledger.accountingMode, ledger.warehouseRate],
      formula: 'sales-product-profit@2', revision: dataVersion, revisionReader, boundedMemory: true,
      compute: async () => {
        const pageChunks = daily ? await readPageSaleChunks(workspaceId, ledgerId, { parent: ledger }) : undefined;
        return runDerivedComputation('sales-profit', { ledger, identities: rows, approvals, costs, groups: pageSales.groups, store, workspaceId, pageChunks });
      },
    });
    assertSourceRevision(dataVersion, revisionReader);
    return result;
  });
}
