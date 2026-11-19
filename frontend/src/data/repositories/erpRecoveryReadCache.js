import { db } from '../db/clientDatabase';
import { cachedDerived, derivedCacheDb, sourceRevision, tableRevisionReader } from '../db/derivedCache';
import { canonicalPlatformSku, canonicalPlatformSkc } from '../../domain/identifiers';
import { version as appVersion } from '../../../package.json';
import Dexie from 'dexie';
import { forEachLedgerChunk } from './ledgerReadCache';
import { readPageSaleChunks } from './ledgerPageSalesRepository';
import { pageRecoveryIdentities } from '../../domain/ledgerPageSales';

const salesRevision = tableRevisionReader('salesRows');
const inputTables = ['costApprovals', 'erpCostRows', 'erpCostBatches', 'importBatches', 'erpCostInbox', 'erpCostRequests'];
const inputReaders = inputTables.map(tableRevisionReader);
const inputRevision = () => {
  const revisions = inputReaders.map(read => read());
  return revisions.every(Boolean) ? JSON.stringify(revisions) : null;
};
const results = new Map();
class DeferredReceiptReview extends Error {}
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
async function digestValue(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fingerprintRow(table, row) {
  if (table !== 'erpCostRows' || !row.evidence || Array.isArray(row.evidence) || typeof row.evidence !== 'object') return digestValue(row);
  // IndexedDB preserves these shared references. Encode an explicit reference
  // only for an identical object; independently edited evidence retains its full content.
  const evidence = { ...row.evidence }, shared = [];
  for (const key of ['purchaseRecords', 'excludedRecords', 'sourceWarnings', 'costDecision']) {
    if (row[key] && row[key] === evidence[key]) { shared.push(key); delete evidence[key]; }
  }
  return digestValue([shared, { ...row, evidence }]);
}

export function adoptionCostHeader(row) {
  const { id, workspaceId, batchId, platformSku, warehouseSku, sourceWarehouseSku, sourceEnvelopeBatchId, sourceOrder, resolutions } = row;
  return { id, workspaceId, batchId, platformSku, warehouseSku, sourceWarehouseSku, sourceEnvelopeBatchId, sourceOrder, resolutions };
}

export function adoptionBatchHeader(row) {
  const { workspaceId, status, sourceOrder, publishedAt, adoption } = row;
  return { workspaceId, status, sourceOrder, publishedAt, adoption };
}

// These projections only decide whether a background no-op can be skipped.
// They are never inputs to a financial write or a replacement for validation.
async function readSalesIdentities(ledgerId, parent) {
  const compute = async () => {
    if (parent && !Dexie.currentTransaction) {
      const chunks = await readPageSaleChunks(parent.workspaceId, ledgerId, { parent });
      if (!chunks.some(chunk => chunk.foreign)) return pageRecoveryIdentities(chunks, ledgerId);
    }
    const identities = new Map();
    await forEachLedgerChunk(db.salesRows, ledgerId, 1000, row => {
      const identity = { workspaceId: row.workspaceId, ledgerId: row.ledgerId,
        store: row.store, platformSku: row.platformSku, sku: row.sku, platformSkc: row.platformSkc };
      identities.set(JSON.stringify(identity), identity);
    });
    return [...identities.values()];
  };
  const revision = salesRevision();
  return revision ? cachedDerived({ scope: [ledgerId], formula: 'erp-recovery-sales-identities@1',
    revision, revisionReader: salesRevision, persist: false, boundedMemory: true, compute }) : compute();
}

async function readRecoveryTable(ledgerId, table, reader, defer) {
  const compute = async () => {
    const rows = [], keys = await db.table(table).where('ledgerId').equals(ledgerId).primaryKeys();
    const chunkSize = ['erpCostBatches','erpCostInbox'].includes(table) ? 1 : 8;
    for (let offset = 0; offset < keys.length; offset += chunkSize) {
      if (defer?.()) throw new DeferredReceiptReview();
      const chunk = await db.table(table).bulkGet(keys.slice(offset, offset + chunkSize));
      const relevant = chunk.filter(row => row && (table !== 'erpCostInbox' || row.costResolutions?.some(item => item.action === 'ignore_anomaly')));
      const entries = await Promise.all(relevant.map(async row => {
        const { id, platformSku, sku, batchId, sourceEnvelopeBatchId } = row;
        const entry = { id, platformSku, sku, batchId, sourceEnvelopeBatchId, fingerprint: await fingerprintRow(table, row) };
        if (table === 'erpCostRows') entry.header = adoptionCostHeader(row);
        if (table === 'erpCostBatches') entry.header = adoptionBatchHeader(row);
        return entry;
      }));
      rows.push(...entries);
    }
    return rows;
  };
  const version = reader();
  return version ? cachedDerived({ scope: [ledgerId, table], formula: 'erp-recovery-table-fingerprints@2', revision: version,
    revisionReader: reader, boundedMemory: true, compute }) : compute();
}

async function readLedgerInputs(ledgerId, readScope, defer) {
  const revision = inputRevision();
  if (revision && readScope?.inputs?.ledgerId === ledgerId && readScope.inputs.revision === revision) return readScope.inputs.value;
  const value = {};
  // Changing an approval or receiving another envelope does not invalidate
  // complete fingerprints of untouched purchase tables. Keep large reads serial.
  for (const [i, table] of inputTables.entries()) value[table] = await readRecoveryTable(ledgerId, table, inputReaders[i], defer);
  // Only tiny, content-complete fingerprints remain in this optional cache.
  // The raw evidence is released after each chunk. Financial/context changes
  // still force revalidation; unrelated notifications reuse unchanged inputs.
  if (revision && revision === inputRevision() && readScope) readScope.inputs = { ledgerId, revision, value };
  return value;
}

// Only a read-only probe can use this hint. An actual adoption independently
// rechecks reusable decisions in its business write transaction.
export function recoveryIgnoreIds(readScope, ledgerId) {
  const inputs = readScope?.inputs;
  if (!inputs || inputs.ledgerId !== ledgerId || inputs.revision !== inputRevision()) return null;
  return inputs.value.erpCostInbox.map(row => row.id);
}

// Reuse only the headers just read while hashing the same source version.
// A later write always obtains independent authoritative inputs inside its transaction.
export async function readRecoveryAdoptionInputs(readScope, ledgerId) {
  const inputs = readScope?.inputs;
  if (!inputs || inputs.ledgerId !== ledgerId || inputs.revision !== inputRevision()) return null;
  const [approvals, salesRows] = await Promise.all([db.costApprovals.where('ledgerId').equals(ledgerId).toArray(), readSalesIdentities(ledgerId)]);
  if (inputs.revision !== inputRevision()) return null;
  return { approvals, salesRows, batchById: new Map(inputs.value.erpCostBatches.map(row => [row.id, row.header])),
    costHeaders: inputs.value.erpCostRows.map(row => row.header), coverageHeads: null };
}

export async function readErpRecoveryProbe({ inboxId, workspaceId, ledgerId, getContext, readScope }) {
  // WebCrypto is prepared outside the IndexedDB transaction so it cannot
  // auto-commit a transaction or require a busy keep-alive loop. Verify the
  // finance revision again inside the coherent receipt snapshot below.
  let prepared;
  if (globalThis.crypto?.subtle && !Dexie.currentTransaction) {
    const candidate = await db.erpCostInbox.get(inboxId), member = await getContext(), revision = inputRevision();
    if (revision && candidate?.workspaceId === workspaceId && member.workspaceId === workspaceId
      && ['admin', 'finance'].includes(member.role) && ['pending', 'loaded'].includes(candidate.status)
      && (!ledgerId || candidate.ledgerId === ledgerId)) {
      const reviewed = candidate.adoption?.version && !candidate.adoptionPending && !candidate.adoptionFailure;
      const defer = () => readScope?.shouldStop?.() || (reviewed && readScope?.deferReviewed?.());
      if (defer()) return { deferred: true };
      try {
        const value = await readLedgerInputs(candidate.ledgerId, readScope, defer);
        if (defer()) return { deferred: true };
        const parent = await db.ledgers.get(candidate.ledgerId), saleVersion = salesRevision();
        const sales = saleVersion && parent?.workspaceId === workspaceId ? await readSalesIdentities(candidate.ledgerId, parent) : null;
        prepared = { ledgerId: candidate.ledgerId, revision, value, sales, saleVersion };
      }
      catch (error) { if (error instanceof DeferredReceiptReview) return { deferred: true }; throw error; }
    }
  }
  if (readScope?.shouldStop?.()) return { deferred: true };
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
      if (!prepared || prepared.ledgerId !== inbox.ledgerId || prepared.revision !== inputRevision()) return { metadata };
      const sales = prepared.sales && prepared.saleVersion === salesRevision() ? prepared.sales : await readSalesIdentities(inbox.ledgerId), inputs = prepared.value;
      const queried = new Set((inbox.envelope?.batch?.query?.platformSkcs ?? []).map(row => skcOf(typeof row === 'string' ? { platformSkc: row } : row)).filter(Boolean));
      const wanted = new Set(request.expectedSkus.filter(row => queried.has(skcOf(row))).map(skuOf).filter(Boolean));
      const costs = inputs.erpCostRows.filter(row => !skuOf(row) || wanted.has(skuOf(row)) || row.sourceEnvelopeBatchId === inbox.batchId);
      const batchIds = new Set([inbox.appliedBatchId, ...costs.map(row => row.batchId)].filter(Boolean));
      const signatureInput = { appVersion, member, inbox, request,
        ledger: { id: ledger.id, workspaceId: ledger.workspaceId, period: ledger.period, status: ledger.status },
        imports: inputs.importBatches,
        ignoredEvidence: inputs.erpCostInbox, requests: inputs.erpCostRequests,
        sales,
        approvals: inputs.costApprovals.filter(row => wanted.has(skuOf(row))),
        costs: costs.map(row => row.fingerprint), batches: inputs.erpCostBatches.filter(row => batchIds.has(row.id)).map(row => row.fingerprint) };
      const result = inbox.adoption ? { id: inbox.id, inboxId: inbox.id, batchId: inbox.appliedBatchId, status: inbox.status,
        adoption: inbox.adoption, ...inbox.adoption.summary, matchedCount: inbox.adoption.summary?.adoptedCount, idempotent: true } : null;
      return { metadata, signatureInput, result, memoKey: memoKey(member), revision: sourceRevision(), key: JSON.stringify([appVersion, workspaceId, inbox.ledgerId, member.memberId, member.role, inbox.id]) };
    });
  const { signatureInput, ...probe } = snapshot;
  if (!signatureInput || !globalThis.crypto?.subtle) return probe;
  // Arrays here contain identity fields or complete content hashes, never
  // purchase bodies. Sign them in bounded blocks to avoid a WebCrypto job per SKU.
  const fingerprints = readScope ? (readScope.fingerprints ??= new WeakMap()) : new WeakMap();
  const fingerprint = async value => {
    if (Array.isArray(value) && value.length > 512) {
      const chunks = [];
      for (let i = 0; i < value.length; i += 512) chunks.push(await digestValue(value.slice(i, i + 512)));
      return digestValue(['blocks', value.length, chunks]);
    }
    return digestValue(value);
  };
  const cachedFingerprint = async value => {
    if (value == null || typeof value !== 'object') return digestValue(value);
    if (!fingerprints.has(value)) fingerprints.set(value, fingerprint(value));
    return fingerprints.get(value);
  };
  const manifest = {};
  for (const [key, value] of Object.entries(signatureInput)) manifest[key] = await cachedFingerprint(value);
  return { ...probe, signature: await digestValue(manifest), hasPreviousCheck: results.has(probe.key) };
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
