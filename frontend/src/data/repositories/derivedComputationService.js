import { computeDerived } from '../../workers/derivedComputations';
import { REPORT_FORMULA_VERSION } from '../../domain/profitReports';
import { cachedDerived, assertSourceRevision } from '../db/derivedCache';
import { ledgerSnapshotRevision } from './ledgerReadCache';
import { inventoryCalculationRevision, inventoryLowestRevision } from '../db/inventoryRevisions';

const idleWorkers = [];
let nextJobId = 0;
export function disposeIdleDerivedWorkers() {
  for (const entry of idleWorkers.splice(0)) { clearTimeout(entry.timer); entry.worker.terminate(); }
}
function retainWorker(worker) {
  if (idleWorkers.length >= 2) { worker.terminate(); return; }
  const entry = { worker, constructor: Worker, timer: null };
  entry.timer = setTimeout(() => { const index = idleWorkers.indexOf(entry); if (index >= 0) idleWorkers.splice(index, 1); worker.terminate(); }, 15000);
  entry.timer?.unref?.();
  idleWorkers.push(entry);
}
export function runDerivedComputation(kind, input, { signal, onProgress } = {}) {
  const cancelled = () => Object.assign(new Error('后台计算已取消。'), { name: 'AbortError' });
  if (signal?.aborted) return Promise.reject(cancelled());
  // Tests and unsupported browsers retain precisely the same domain functions.
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => computeDerived(kind, input));
  return new Promise((resolve, reject) => {
    const idle = idleWorkers.find(entry => entry.constructor === Worker);
    if (idle) { idleWorkers.splice(idleWorkers.indexOf(idle), 1); clearTimeout(idle.timer); }
    const worker = idle?.worker ?? new Worker(new URL('../../workers/derived.worker.js', import.meta.url), { type: 'module' });
    const jobId = ++nextJobId;
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null; worker.onerror = null;
      if (error) worker.terminate(); else retainWorker(worker);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(cancelled());
    worker.onmessage = ({ data }) => {
      if (finished || data.jobId != null && data.jobId !== jobId) return;
      if (data.type === 'progress') { onProgress?.(data.progress); return; }
      finish(data.error ? new Error(data.error) : null, data.value);
    };
    worker.onerror = () => finish(new Error('后台计算失败，请重新读取。'));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    const send = async () => {
      const chunks = kind === 'report-source-fingerprint' ? Object.entries(input).filter(([, value]) => Array.isArray(value) && value.length > 1000) : [];
      if (!chunks.length) { worker.postMessage({ kind, input, jobId }); return; }
      const header = { ...input };
      for (const [field] of chunks) header[field] = [];
      worker.postMessage({ type: 'initialize', kind, input: header, jobId });
      for (const [field, rows] of chunks) for (let offset = 0; offset < rows.length; offset += 500) {
        if (finished) return;
        worker.postMessage({ type: 'append', field, rows: rows.slice(offset, offset + 500), jobId });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!finished) worker.postMessage({ type: 'compute', jobId });
    };
    void send().catch(error => finish(error));
  });
}

export async function readCachedReportProducts({ snapshot, warehouseRate = snapshot?.ledger?.warehouseRate, onStatus }) {
  if (!snapshot?.ledger) return [];
  const compute = () => runDerivedComputation('profit', { ledger: { ...snapshot.ledger, warehouseRate }, salesRows: snapshot.rows, erpCosts: snapshot.costs ?? [], approvals: snapshot.approvals ?? [], allowMissing: true }, { onProgress: progress => onStatus?.(progress.label) });
  // Supplied/testing snapshots without a verified source revision cannot be persisted.
  if (!snapshot.dataVersion) return compute();
  const revisionOptions = snapshot.revisionKind === 'ledger' ? { revisionReader: ledgerSnapshotRevision } : snapshot.revisionKind === 'inventory' ? { revisionReader: inventoryCalculationRevision } : snapshot.revisionKind === 'inventory-lowest' ? { revisionReader: inventoryLowestRevision } : {};
  assertSourceRevision(snapshot.dataVersion, revisionOptions.revisionReader);
  return cachedDerived({ scope: [snapshot.ledger.workspaceId, snapshot.ledger.id, snapshot.ledger.period, snapshot.ledger.accountingMode ?? 'weighted', 'all', String(warehouseRate)], formula: `${REPORT_FORMULA_VERSION}:products@9-anomaly-ignore`, revision: snapshot.dataVersion, ...revisionOptions, compute, onStatus });
}
