import Dexie from 'dexie';

// Disposable sidecar only: the business database schema and backups stay intact.
export const derivedCacheDb = new Dexie('shopeers-derived-cache-v1');
derivedCacheDb.version(1).stores({ entries: 'key,createdAt', revisions: 'key' });
const REVISION_KEY = 'shopeers-derived-source-revision-v1';
let volatileRevision = crypto.randomUUID();
let durable = true;
const memory = new Map();
const pending = new Map();
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
export function invalidateDerivedCache(notify = true) {
  volatileRevision = crypto.randomUUID();
  try { localStorage.setItem(REVISION_KEY, volatileRevision); } catch { durable = false; }
  memory.clear();
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
export function assertSourceRevision(revision) {
  if (revision !== sourceRevision()) throw new StaleDerivedResultError();
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
  database.use({ stack: 'dbcore', name: 'derived-cache-revision', create(down) {
    return { ...down, table(name) {
      const table = down.table(name);
      return { ...table, mutate(request) {
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

export function clearDerivedMemory() { memory.clear(); pending.clear(); }

function persistEntry(entry, revision) {
  // A native timer starts a separate task outside Dexie's liveQuery scope.
  // ignoreTransaction only detaches transactions, not the read-only querier.
  // Keep this boundary specific to the disposable sidecar; source reads and
  // computation remain in the original observable, read-only context.
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        await derivedCacheDb.transaction('rw', derivedCacheDb.entries, async () => {
          assertSourceRevision(revision);
          await derivedCacheDb.entries.put(entry);
          const entries = await derivedCacheDb.entries.orderBy('createdAt').reverse().toArray();
          let size = 0;
          const expired = entries.filter((item, index) => { size += item.bytes; return index >= MAX_DISK || size > MAX_DISK_BYTES; });
          await derivedCacheDb.entries.bulkDelete(expired.map(item => item.key));
          assertSourceRevision(revision);
        });
        resolve();
      } catch (error) { reject(error); }
    }, 0);
  });
}

export async function cachedDerived({ scope, formula, revision = sourceRevision(), compute, persist = true, onStatus = () => {} }) {
  assertSourceRevision(revision);
  const key = JSON.stringify([formula, scope, revision]);
  if (memory.has(key)) { onStatus('ready'); return memory.get(key); }
  onStatus('reading');
  if (pending.has(key)) { const value = await pending.get(key); onStatus('ready'); return value; }
  const task = (async () => {
    let value;
    if (persist && durable) {
      try { value = (await Dexie.ignoreTransaction(() => derivedCacheDb.entries.get(key)))?.value; } catch { /* cache is optional */ }
    }
    assertSourceRevision(revision);
    if (value === undefined) {
      onStatus('recalculating');
      value = await compute();
      assertSourceRevision(revision);
      if (persist && durable) {
        try {
          const bytes = JSON.stringify(value).length * 2;
          if (bytes <= MAX_ENTRY_BYTES) await persistEntry({ key, value, bytes, createdAt: Date.now() }, revision);
        } catch { /* quota/private mode must not block a correct calculation */ }
      }
    }
    assertSourceRevision(revision);
    memory.set(key, value);
    const rowCount = () => [...memory.values()].reduce((count, item) => count + (Array.isArray(item) ? item.length : item?.rows?.length ?? 0), 0);
    while (memory.size > MAX_MEMORY || rowCount() > MAX_MEMORY_ROWS) memory.delete(memory.keys().next().value);
    return value;
  })();
  pending.set(key, task);
  try { const value = await task; onStatus('ready'); return value; }
  catch (error) { onStatus('failed'); throw error; }
  finally { pending.delete(key); }
}
