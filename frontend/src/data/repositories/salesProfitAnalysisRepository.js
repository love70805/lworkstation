import Dexie from 'dexie';
import { assertSourceRevision, cachedDerived, retrySourceRead, observeSourceRevision, sourceRevision, ledgerTableRevision, tableRevisionReader } from '../db/derivedCache';
import { inventoryCalculationRevision, inventoryLowestRevision } from '../db/inventoryRevisions';
import { db } from '../db/clientDatabase';
import { readAccountingSupplement, readAccountingMode, projectAccountingLedger } from './inventoryAccountingRepository';
import { LOWEST_ACCOUNTING } from '../../domain/inventoryAccounting';
import { getActiveMemberContext } from './selectionRepository';
import { buildSalesDispatch } from '../../domain/salesDispatchContribution';
import { getLedgerSnapshot } from './profitRepository';
import { readPageSaleChunks } from './ledgerPageSalesRepository';
import { runDerivedComputation } from './derivedComputationService';

const localCostTables = ['erpCostRows', 'erpCostBatches'];
const sharedEvidence = [...localCostTables, 'erpCostInbox', 'erpCostRequests'].map(tableRevisionReader);
const visibleMonthVersions = new WeakMap();

export function readSalesProfitAnalysis(options, previousMonth) {
  if (options.daily !== false || Dexie.currentTransaction) return calculateSalesProfit(options);
  return retrySourceRead(async () => {
    const { workspaceId, ledgerId, store = 'all', includeDispatch = true } = options;
    const opening = sourceRevision();
    if (!await observeSourceRevision()) return calculateSalesProfit(options);
    const [member, original] = await Promise.all([getActiveMemberContext(), db.ledgers.get(ledgerId)]);
    if (!original || original.workspaceId !== workspaceId || member.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    const mode = ['weighted', LOWEST_ACCOUNTING].includes(options.requestedMode) ? options.requestedMode : await readAccountingMode(workspaceId);
    const ledger = await projectAccountingLedger(original, mode);
    const tables = ['salesRows', 'ledgers', 'costApprovals'];
    let historyLedgers = null;
    if (mode === LOWEST_ACCOUNTING) {
      // Shared purchase history can change the result in more than one month.
      historyLedgers = await db.ledgers.where('workspaceId').equals(workspaceId).primaryKeys();
    } else tables.push(...localCostTables);
    if (includeDispatch) tables.push('monthlySupplementBatches', 'monthlySupplementRows');
    const revisionReader = () => JSON.stringify([
      ...tables.map(name => ledgerTableRevision(name, ledgerId)),
      ...(historyLedgers ? sharedEvidence.map(read => read() ?? sourceRevision()) : []),
    ]);
    const scope = [workspaceId, ledgerId, ledger.period, store, mode, ledger.warehouseRate, includeDispatch, historyLedgers];
    const revision = revisionReader();
    const visibleVersion = JSON.stringify([scope, revision]);
    // The chart already holds the visible months, even when the general cache
    // has evicted some of their large product breakdowns.
    const result = previousMonth && visibleMonthVersions.get(previousMonth) === visibleVersion ? previousMonth : await cachedDerived({
      scope, formula: 'monthly-trend-profit@1', revision, revisionReader,
      compute: () => calculateSalesProfit(options),
    });
    assertSourceRevision(opening);
    visibleMonthVersions.set(result, visibleVersion);
    return result;
  });
}

function calculateSalesProfit({ workspaceId, ledgerId, store = 'all', daily = true, includeDispatch = true, requestedMode }) {
  return retrySourceRead(async () => {
    const snapshot = await getLedgerSnapshot(ledgerId, { summaryOnly: true, profitPage: true, requestedMode });
    if (!snapshot || snapshot.ledger.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    const { ledger, pageSales, costs, approvals, rows, dataVersion } = snapshot;
    if (pageSales.reportError) throw new Error(pageSales.reportError);
    const revisionReader = ledger.accountingMode === 'historical_lowest' ? inventoryLowestRevision : inventoryCalculationRevision;
    const result = await cachedDerived({
      scope: [workspaceId, ledgerId, store, daily, ledger.accountingMode, ledger.warehouseRate],
      formula: 'sales-product-profit@4-owned-ledgers', revision: dataVersion, revisionReader, boundedMemory: true,
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
