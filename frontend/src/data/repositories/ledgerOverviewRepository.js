import { readAccountingSupplement } from './inventoryAccountingRepository';
import { getLedgerSnapshot } from './profitRepository';
import { readCachedReportProducts } from './derivedComputationService';
import { Exact } from '../../domain/profitReports';
import { db } from '../db/clientDatabase';
import { cachedDerived, sourceRevision, assertSourceRevision, retrySourceRead, observeSourceRevision } from '../db/derivedCache';

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
    const results=[];
    for(const original of new Map(ledgers.filter(Boolean).map(ledger => [ledger.id, ledger])).values()){
      const snapshot=await getLedgerSnapshot(original.id, { summaryOnly: true });
      if(!snapshot)continue;
      const ledger=snapshot.ledger;
      const lines=await readCachedReportProducts({snapshot});
      const missing=lines.some(line=>line.unitCostExact==null);
      const [dispatch,deduction]=await Promise.all([readAccountingSupplement(ledger.id,'dispatch',ledger.accountingMode),readAccountingSupplement(ledger.id,'deduction',ledger.accountingMode)]);
      const stores=[...new Set(lines.map(line=>line.store))];
      const complete=deduction&&stores.every(store=>deduction.coveredStores.includes(store));
      const productProfit=lines.reduce((sum,line)=>sum.plus(line.profitExact??0),new Exact(0));
      const profit=missing?null:productProfit.plus(new Exact(dispatch?.adoptedQuantityExact??0).times(ledger.warehouseRate??'0.7')).minus(deduction?.signedAmountExact??0).toDecimalPlaces(2,Exact.ROUND_DOWN).toNumber();
      const currentResult={state:missing?'pending':'current',label:missing?'待补成本':complete?'本月利润':deduction?'暂计利润':'未扣款利润',profit,report:null,
        deductionStatus: complete ? 'complete' : deduction ? 'partial' : 'missing', needsAttention: missing || !complete};
      results.push({...ledger,liveResult:currentResult,currentResult});
    }
    assertSourceRevision(revision);
    return results;
  });
}

// This is the same product calculation used by the profit page. Monthly
// supplements are deliberately not allocated to a filtered store.
export async function readWorkspaceScopeSummary(workspaceId, ledgerId, store = 'all') {
  return retrySourceRead(async () => {
    await observeSourceRevision(); const revision = sourceRevision();
    const snapshot = await getLedgerSnapshot(ledgerId, { summaryOnly: true });
    if (snapshot.ledger?.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    const lines = await readCachedReportProducts({ snapshot });
    const selected = lines.filter(line => store === 'all' || line.store === store);
    const sum = key => selected.reduce((total, line) => total.plus(line[key] ?? 0), new Exact(0));
    const missing = new Set(selected.filter(line => line.unitCostExact == null).map(line => JSON.stringify([line.store,line.platformSku]))).size;
    assertSourceRevision(revision);
    return { revenue: sum('revenueExact').toDecimalPlaces(2, Exact.ROUND_DOWN).toNumber(), quantity: sum('quantityExact').toNumber(), profit: missing ? null : sum('profitExact').toDecimalPlaces(2, Exact.ROUND_DOWN).toNumber(), missing };
  });
}
