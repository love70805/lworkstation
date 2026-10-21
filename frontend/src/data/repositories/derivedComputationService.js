import { computeDerived } from '../../workers/derivedComputations';
import { REPORT_FORMULA_VERSION } from '../../domain/profitReports';
import { cachedDerived, assertSourceRevision } from '../db/derivedCache';

export function runDerivedComputation(kind, input, { signal } = {}) {
  const cancelled = () => Object.assign(new Error('后台计算已取消。'), { name: 'AbortError' });
  if (signal?.aborted) return Promise.reject(cancelled());
  // Tests and unsupported browsers retain precisely the same domain functions.
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => computeDerived(kind, input));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/derived.worker.js', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(cancelled());
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.value);
    worker.onerror = () => finish(new Error('后台计算失败，请重新读取。'));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    try { worker.postMessage({ kind, input }); } catch (error) { finish(error); }
  });
}

export async function readCachedReportProducts({ snapshot, warehouseRate = snapshot?.ledger?.warehouseRate, onStatus }) {
  if (!snapshot?.ledger) return [];
  const compute = () => runDerivedComputation('profit', { ledger: { ...snapshot.ledger, warehouseRate }, salesRows: snapshot.rows, erpCosts: snapshot.costs ?? [], approvals: snapshot.approvals ?? [], allowMissing: true });
  // Supplied/testing snapshots without a verified source revision cannot be persisted.
  if (!snapshot.dataVersion) return compute();
  assertSourceRevision(snapshot.dataVersion);
  return cachedDerived({ scope: [snapshot.ledger.workspaceId, snapshot.ledger.id, snapshot.ledger.period, 'all', String(warehouseRate)], formula: `${REPORT_FORMULA_VERSION}:products@6-ledger-cost-identity`, revision: snapshot.dataVersion, compute, onStatus });
}
