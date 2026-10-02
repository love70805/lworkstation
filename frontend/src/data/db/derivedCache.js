import Dexie from 'dexie';

// Disposable sidecar only: the business database schema and backups stay intact.
export const derivedCacheDb = new Dexie('shopeers-derived-cache-v1');
derivedCacheDb.version(1).stores({ entries: 'key,createdAt', revisions: 'key' });
// Eviction reads only tiny metadata; scanning stored fact values after every
// product save would otherwise reintroduce a large structured-clone pause.
derivedCacheDb.version(2).stores({ metadata: 'key,createdAt' }).upgrade(tx => tx.table('entries').clear());
const REVISION_KEY = 'shopeers-derived-source-revision-v1';
const SELECTION_FACTS_REVISION_KEY = 'shopeers-selection-facts-revision-v1';
let volatileRevision = crypto.randomUUID();
let volatileFactsRevision = crypto.randomUUID();
let durable = true;
const memory = new Map();
const pending = new Map();
const memoryReaders = new Map();
const memoryBytes = new Map();
const MAX_MEMORY = 8;
const MAX_MEMORY_ROWS = 600000;
const MAX_DISK = 24;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_DISK_BYTES = 64 * 1024 * 1024;

export function sourceRevision() {
  try {
    let revision = localStorage.getItem(REVISION_KEY);
    if (!revision) { revision = crypto.randomUUID(); localStorage.setItem(REVISION_KEY, revision); }
    return revision;
  } catch { durable = false; return volatileRevision; }
}
// Only these catalog-only tables are independent of immutable ledger facts.
// Everything else (including settings/context, all finance and future tables)
// conservatively changes the facts version. Counts/timestamps are never keys.
const CATALOG_ONLY_TABLES = new Set(['products', 'platformSkus', 'supplierOffers', 'captures', 'auditEvents']);
export function selectionFactsRevision() {
  try {
    let revision = localStorage.getItem(SELECTION_FACTS_REVISION_KEY);
    if (!revision) { revision = crypto.randomUUID(); localStorage.setItem(SELECTION_FACTS_REVISION_KEY, revision); }
    return revision;
  } catch { durable = false; return volatileFactsRevision; }
}
function removeMemory(key) { memory.delete(key); memoryReaders.delete(key); memoryBytes.delete(key); }
function clearMemoryFor(reader) {
  for (const [key, entryReader] of memoryReaders) if (entryReader === reader) removeMemory(key);
}
function invalidateSelectionFacts() {
  volatileFactsRevision = crypto.randomUUID();
  try { localStorage.setItem(SELECTION_FACTS_REVISION_KEY, volatileFactsRevision); } catch { durable = false; }
  clearMemoryFor(selectionFactsRevision);
}
export function invalidateDerivedCache(notify = true) {
  volatileRevision = crypto.randomUUID();
  try { localStorage.setItem(REVISION_KEY, volatileRevision); } catch { durable = false; }
  clearMemoryFor(sourceRevision);
  // A cheap observable value makes every live-query consumer rerun for value
  // edits, which an IndexedDB count() dependency alone does not observe.
  if (notify) Dexie.ignoreTransaction(() => derivedCacheDb.revisions.put({ key: 'source', revision: volatileRevision })).catch(async () => {
    // Recover quota pressure by sacrificing only disposable results.
    try { await derivedCacheDb.entries.clear(); await derivedCacheDb.revisions.put({ key: 'source', revision: sourceRevision() }); } catch { /* unavailable cache */ }
  });
  return volatileRevision;
}
export async function observeSourceRevision() {
  try { await Dexie.ignoreTransaction(() => derivedCacheDb.revisions.get('source')); return true; }
  catch { return false; }
}
export class StaleDerivedResultError extends Error {
  constructor() { super('来源数据已变化，正在重新读取。'); this.name = 'StaleDerivedResultError'; }
}
export function assertSourceRevision(revision, revisionReader = sourceRevision) {
  if (revision !== revisionReader()) throw new StaleDerivedResultError();
}

// A write promise can settle just before the native transaction's complete
// event rotates the revision. Retry a coherent read after that event, while
// retaining a hard bound if another writer keeps changing the source.
export async function retrySourceRead(read) {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (!(error instanceof StaleDerivedResultError) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

export function installDerivedInvalidation(database) {
  const observed = new WeakSet();
  const factsObserved = new WeakSet();
  database.use({ stack: 'dbcore', name: 'derived-cache-revision', create(down) {
    return { ...down, table(name) {
      const table = down.table(name);
      return { ...table, mutate(request) {
        // Separate transaction tracking matters when a transaction writes a
        // catalog row first and a financial/context table later.
        if (!CATALOG_ONLY_TABLES.has(name) && !factsObserved.has(request.trans)) {
          factsObserved.add(request.trans);
          invalidateSelectionFacts();
          request.trans.addEventListener('complete', invalidateSelectionFacts);
          request.trans.addEventListener('abort', invalidateSelectionFacts);
        }
        if (!observed.has(request.trans)) {
          observed.add(request.trans);
          // Before writing prevents crash reuse; after commit prevents a reader
          // during the transaction from publishing pre-commit rows as current.
          invalidateDerivedCache(false);
          request.trans.addEventListener('complete', invalidateDerivedCache);
          request.trans.addEventListener('abort', invalidateDerivedCache);
        }
        return table.mutate(request);
      } };
    } };
  } });
}

export function clearDerivedMemory() { memory.clear(); memoryReaders.clear(); memoryBytes.clear(); pending.clear(); }

function persistEntry(entry, revision, revisionReader) {
  // A native timer starts a separate task outside Dexie's liveQuery scope.
  // ignoreTransaction only detaches transactions, not the read-only querier.
  // Keep this boundary specific to the disposable sidecar; source reads and
  // computation remain in the original observable, read-only context.
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        await derivedCacheDb.transaction('rw', derivedCacheDb.entries, derivedCacheDb.metadata, async () => {
          assertSourceRevision(revision, revisionReader);
          await derivedCacheDb.entries.put(entry);
          await derivedCacheDb.metadata.put({ key: entry.key, bytes: entry.bytes, createdAt: entry.createdAt, namespace: entry.namespace });
          const entries = await derivedCacheDb.metadata.orderBy('createdAt').reverse().toArray();
          let size = 0, count = 0;
          const expired = entries.filter(item => {
            // Superseded final projections must not crowd out unchanged ledger
            // facts after several catalog saves. Metadata is at most 24 rows.
            const namespace = item.namespace ?? JSON.stringify(JSON.parse(item.key).slice(0, 2));
            if (namespace === entry.namespace && item.key !== entry.key) return true;
            size += item.bytes;
            return count++ >= MAX_DISK || size > MAX_DISK_BYTES;
          });
          await derivedCacheDb.entries.bulkDelete(expired.map(item => item.key));
          await derivedCacheDb.metadata.bulkDelete(expired.map(item => item.key));
          assertSourceRevision(revision, revisionReader);
        });
        resolve();
      } catch (error) { reject(error); }
    }, 0);
  });
}

export async function cachedDerived({ scope, formula, revisionReader = sourceRevision, revision = revisionReader(), compute, persist = true, onStatus = () => {} }) {
  assertSourceRevision(revision, revisionReader);
  const key = JSON.stringify([formula, scope, revision]);
  if (memory.has(key)) { onStatus('ready'); return memory.get(key); }
  onStatus('reading');
  if (pending.has(key)) { const value = await pending.get(key); assertSourceRevision(revision, revisionReader); onStatus('ready'); return value; }
  const task = (async () => {
    let value;
    if (persist && durable) {
      try { value = (await Dexie.ignoreTransaction(() => derivedCacheDb.entries.get(key)))?.value; } catch { /* cache is optional */ }
    }
    assertSourceRevision(revision, revisionReader);
    if (value === undefined) {
      onStatus('recalculating');
      value = await compute();
      assertSourceRevision(revision, revisionReader);
      if (persist && durable) {
        try {
          const bytes = derivedValueBytes(value);
          if (bytes <= MAX_ENTRY_BYTES) await persistEntry({ key, namespace: JSON.stringify([formula, scope]), value, bytes, createdAt: Date.now() }, revision, revisionReader);
        } catch { /* quota/private mode must not block a correct calculation */ }
      }
    }
    assertSourceRevision(revision, revisionReader);
    // Facts are bounded on both disk and heap. Structured-clone Maps must not
    // appear as empty objects in the size estimate.
    if (revisionReader !== selectionFactsRevision || derivedValueBytes(value) <= MAX_ENTRY_BYTES) {
      memory.set(key, value);
      memoryReaders.set(key, revisionReader);
      if (revisionReader === selectionFactsRevision) memoryBytes.set(key, derivedValueBytes(value));
    }
    const rowCount = () => [...memory.values()].reduce((count, item) => count + (Array.isArray(item) ? item.length : item?.rows?.length ?? item?.computedReferenceRows?.length ?? 0), 0);
    const normalKeys = () => [...memory.keys()].filter(item => memoryReaders.get(item) !== selectionFactsRevision);
    while (normalKeys().length > MAX_MEMORY || rowCount() > MAX_MEMORY_ROWS) removeMemory(normalKeys()[0] ?? memory.keys().next().value);
    while (memoryBytes.size > MAX_DISK || [...memoryBytes.values()].reduce((sum, bytes) => sum + bytes, 0) > MAX_DISK_BYTES) removeMemory(memoryBytes.keys().next().value);
    return value;
  })();
  pending.set(key, task);
  try { const value = await task; onStatus('ready'); return value; }
  catch (error) { onStatus('failed'); throw error; }
  finally { pending.delete(key); }
}

export function derivedValueBytes(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : item).length * 2;
}
