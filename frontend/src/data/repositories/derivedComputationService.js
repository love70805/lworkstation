import { computeDerived } from '../../workers/derivedComputations';
import { REPORT_FORMULA_VERSION } from '../../domain/profitReports';
import { cachedDerived, assertSourceRevision } from '../db/derivedCache';

export function runDerivedComputation(kind, input) {
  // Tests and unsupported browsers retain precisely the same domain functions.
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => computeDerived(kind, input));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/derived.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.value); };
    worker.onerror = () => { worker.terminate(); reject(new Error('后台计算失败，请重新读取。')); };
    worker.postMessage({ kind, input });
  });
}

export async function readCachedReportProducts({ snapshot, warehouseRate = snapshot?.ledger?.warehouseRate, onStatus }) {
  if (!snapshot?.ledger) return [];
  const compute = () => runDerivedComputation('profit', { ledger: { ...snapshot.ledger, warehouseRate }, salesRows: snapshot.rows, erpCosts: snapshot.costs ?? [], approvals: snapshot.approvals ?? [], allowMissing: true });
  // Supplied/testing snapshots without a verified source revision cannot be persisted.
  if (!snapshot.dataVersion) return compute();
  assertSourceRevision(snapshot.dataVersion);
  return cachedDerived({ scope: [snapshot.ledger.workspaceId, snapshot.ledger.id, snapshot.ledger.period, 'all', String(warehouseRate)], formula: `${REPORT_FORMULA_VERSION}:products@4-beta-prior-month-latest-three`, revision: snapshot.dataVersion, compute, onStatus });
}
