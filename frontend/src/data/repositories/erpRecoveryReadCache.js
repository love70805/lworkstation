import { db } from '../db/clientDatabase';
import { cachedDerived, derivedCacheDb, sourceRevision, tableRevisionReader } from '../db/derivedCache';
import { canonicalPlatformSku, canonicalPlatformSkc } from '../../domain/identifiers';
import { version as appVersion } from '../../../package.json';

const salesRevision = tableRevisionReader('salesRows');
const inputTables = ['costApprovals', 'erpCostRows', 'erpCostBatches', 'importBatches'];
const inputReaders = inputTables.map(tableRevisionReader);
const inputRevision = () => {
  const revisions = inputReaders.map(read => read());
  return revisions.every(Boolean) ? JSON.stringify(revisions) : null;
};
const results = new Map();
const loadedScopes = new Set(), dirtyScopes = new Set();
const memoKey = member => `erp-recovery:${JSON.stringify([appVersion, member.workspaceId, member.memberId, member.role])}`;

export async function loadErpRecoveryMemo(member) {
  const key = memoKey(member);
  if (loadedScopes.has(key)) return;
  try {
    const memo = await derivedCacheDb.revisions.get(key);
    if (memo?.format === 1 && Array.isArray(memo.entries) && memo.entries.length <= 256) {
      for (const [id, signature] of memo.entries) if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(signature)) {
        if (!results.has(id)) results.set(id, { signature, memoKey: key });
      }
      while (results.size > 256) results.delete(results.keys().next().value);
    }
    loadedScopes.add(key);
    while (loadedScopes.size > 8) loadedScopes.delete(loadedScopes.values().next().value);
  } catch { /* Disposable cache unavailable: run the normal recovery path. */ }
}

export async function persistErpRecoveryMemo(member) {
  const key = memoKey(member);
  if (!dirtyScopes.has(key)) return;
  const entries = [...results].filter(([, value]) => value.memoKey === key).map(([id, value]) => [id, value.signature]);
  try {
    await derivedCacheDb.transaction('rw', derivedCacheDb.revisions, async () => {
      await derivedCacheDb.revisions.put({ key, format: 1, entries, updatedAt: Date.now() });
      const memos = await derivedCacheDb.revisions.where('key').startsWith('erp-recovery:').sortBy('updatedAt');
      if (memos.length > 8) await derivedCacheDb.revisions.bulkDelete(memos.slice(0, -8).map(row => row.key));
    });
    dirtyScopes.delete(key);
  } catch { /* No business write depends on persisting this memo. */ }
}
const skuOf = row => {
  const raw = row?.platformSku ?? row?.sku;
  return String(raw ?? '').normalize('NFKC').trim() ? canonicalPlatformSku(raw) : null;
};
const skcOf = row => String(row?.platformSkc ?? '').normalize('NFKC').trim() ? canonicalPlatformSkc(row.platformSkc) : null;

// These projections only decide whether a background no-op can be skipped.
// They are never inputs to a financial write or a replacement for validation.
async function readSalesIdentities(ledgerId) {
  const compute = async () => {
    const identities = new Map();
    for (const row of await db.salesRows.where('ledgerId').equals(ledgerId).toArray()) {
      const identity = { workspaceId: row.workspaceId, ledgerId: row.ledgerId,
        store: row.store, platformSku: row.platformSku, sku: row.sku, platformSkc: row.platformSkc };
      identities.set(JSON.stringify(identity), identity);
    }
    return [...identities.values()];
  };
  const revision = salesRevision();
  return revision ? cachedDerived({ scope: [ledgerId], formula: 'erp-recovery-sales-identities@1',
    revision, revisionReader: salesRevision, persist: false, boundedMemory: true, compute }) : compute();
}

async function readLedgerInputs(ledgerId) {
  const compute = async () => {
    const rows = await Promise.all(inputTables.map(table => db.table(table).where('ledgerId').equals(ledgerId).toArray()));
    return Object.fromEntries(inputTables.map((table, index) => [table, rows[index]]));
  };
  const revision = inputRevision();
  return revision ? cachedDerived({ scope: [ledgerId], formula: 'erp-recovery-ledger-inputs@1',
    revision, revisionReader: inputRevision, persist: false, boundedMemory: true, compute }) : compute();
}

export async function readErpRecoveryProbe({ inboxId, workspaceId, ledgerId, getContext }) {
  const snapshot = await db.transaction('r', db.settings, db.ledgers, db.erpCostInbox, db.erpCostRequests,
    db.salesRows, db.costApprovals, db.erpCostRows, db.erpCostBatches, db.importBatches, async () => {
      const inbox = await db.erpCostInbox.get(inboxId), member = await getContext();
      if (!inbox || inbox.workspaceId !== workspaceId || ledgerId && inbox.ledgerId !== ledgerId
        || !['pending', 'loaded'].includes(inbox.status)) return { ignored: true };
      const metadata = { id: inbox.id, status: inbox.status };
      if (member.workspaceId !== workspaceId || !['admin', 'finance'].includes(member.role)) return { metadata };
      const [ledger, request] = await Promise.all([db.ledgers.get(inbox.ledgerId), db.erpCostRequests.get(inbox.requestId)]);
      // Legacy request inference has broader dependencies; keep its full path.
      if (!ledger || !request?.expectedSkus?.length) return { metadata };
      const [sales, inputs] = await Promise.all([readSalesIdentities(inbox.ledgerId), readLedgerInputs(inbox.ledgerId)]);
      const queried = new Set((inbox.envelope?.batch?.query?.platformSkcs ?? []).map(row => skcOf(typeof row === 'string' ? { platformSkc: row } : row)).filter(Boolean));
      const wanted = new Set(request.expectedSkus.filter(row => queried.has(skcOf(row))).map(skuOf).filter(Boolean));
      const costs = inputs.erpCostRows.filter(row => !skuOf(row) || wanted.has(skuOf(row)) || row.sourceEnvelopeBatchId === inbox.batchId);
      const batchIds = new Set([inbox.appliedBatchId, ...costs.map(row => row.batchId)].filter(Boolean));
      const serialized = JSON.stringify({ appVersion, member, inbox, request,
        ledger: { id: ledger.id, workspaceId: ledger.workspaceId, period: ledger.period, status: ledger.status },
        imports: inputs.importBatches,
        sales,
        approvals: inputs.costApprovals.filter(row => wanted.has(skuOf(row))),
        costs, batches: inputs.erpCostBatches.filter(row => batchIds.has(row.id)) });
      const result = inbox.adoption ? { id: inbox.id, inboxId: inbox.id, batchId: inbox.appliedBatchId, status: inbox.status,
        adoption: inbox.adoption, ...inbox.adoption.summary, matchedCount: inbox.adoption.summary?.adoptedCount, idempotent: true } : null;
      return { metadata, serialized, result, memoKey: memoKey(member), revision: sourceRevision(), key: JSON.stringify([appVersion, workspaceId, inbox.ledgerId, member.memberId, member.role, inbox.id]) };
    });
  if (!snapshot.serialized || !globalThis.crypto?.subtle) return snapshot;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot.serialized));
  const { serialized: _serialized, ...probe } = snapshot;
  return { ...probe, signature: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
}

export function cachedErpRecoveryResult(probe) {
  if (!probe.signature || probe.revision !== sourceRevision()) return null;
  const saved = results.get(probe.key);
  return saved?.signature === probe.signature && probe.result ? structuredClone(probe.result) : null;
}

export function rememberErpRecoveryResult(probe, result) {
  if (!probe.key) return;
  results.delete(probe.key);
  // A write changed the dependency snapshot. The next sweep verifies that new
  // state once; errors and mutations never establish a reusable no-op.
  if (!probe.signature || result?.idempotent !== true || probe.revision !== sourceRevision()) return;
  results.set(probe.key, { signature: probe.signature, memoKey: probe.memoKey });
  dirtyScopes.add(probe.memoKey);
  while (results.size > 256) results.delete(results.keys().next().value);
}

// Test/reset hook for process restarts. Durable signatures remain disposable;
// returned adoption states always come from the freshly read business receipt.
export function clearErpRecoveryMemory() { results.clear(); loadedScopes.clear(); dirtyScopes.clear(); }
