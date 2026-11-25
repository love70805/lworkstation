import Dexie from 'dexie';
import { profitSaleFields } from '../../domain/profitPageProjection';
import { db } from '../db/clientDatabase';
import { readPageSaleChunks } from './ledgerPageSalesRepository';
import { cachedDerived, cooperativeDerivedValueBytes, sourceRevision, tableRevisionReader, observeTableRevision } from '../db/derivedCache';

const salesRevision = tableRevisionReader('salesRows');
const ledgerSourceTables = ['settings', 'ledgers', 'salesRows', 'importBatches', 'erpCostRows', 'erpCostBatches', 'costApprovals', 'profitLines'];
const ledgerSources = ledgerSourceTables.map(tableRevisionReader);
export async function observeLedgerSnapshotRevision() {
  // Primary-key counts observe each table's value mutations in Dexie without
  // cloning evidence bodies. An indexed ledgerId count has narrower semantics.
  await Promise.all(ledgerSourceTables.flatMap(table => [db.table(table).count(), observeTableRevision(table)]));
}
export function ledgerSnapshotRevision() {
  const revisions = ledgerSources.map(read => read());
  return revisions.every(Boolean) ? JSON.stringify(revisions) : sourceRevision();
}

// Read exact ledger keys in bounded native getAll requests. A cursor event for
// every sale is especially expensive inside the receipt's write transaction.
export async function forEachLedgerChunk(table, ledgerId, size, consume, { newestFirst = false } = {}) {
  const query = table.where('ledgerId').equals(ledgerId);
  const keys = await query.primaryKeys();
  if (newestFirst) keys.reverse();
  for (let offset = 0; offset < keys.length; offset += size) {
    const ids = keys.slice(offset, offset + size);
    const first = ids[0], last = ids.at(-1);
    let rows;
    if (typeof first === 'number' && typeof last === 'number' && Math.abs(last - first) === ids.length - 1) {
      rows = await table.where(':id').between(Math.min(first,last), Math.max(first,last), true, true).toArray();
      if (newestFirst) rows.reverse();
    } else rows = await table.bulkGet(ids);
    for (const row of rows) if (row && row.ledgerId === ledgerId) consume(row);
  }
}

function storeNamesCache(workspaceId, ledgerId, revisionReader, revision, compute) {
  return cachedDerived({ scope: [workspaceId, ledgerId], formula: 'ledger-store-names@1', revisionReader, revision, compute });
}
function scopeCache(workspaceId, ledgerId, revisionReader, revision, compute) {
  return cachedDerived({ scope:[workspaceId, ledgerId], formula:'ledger-navigation-scope@1', revisionReader, revision, compute });
}

// Navigation needs the store/supplier pairs, including pairs repeated across
// different stores. It never needs quantities, order IDs or evidence bodies.
function collectScope(workspaceId) {
  const stores=new Map(); let foreign=false;
  return {
    add(row) {
      if (row.workspaceId && row.workspaceId !== workspaceId) {foreign=true; return;}
      if (!stores.has(row.store)) stores.set(row.store,new Set());
      stores.get(row.store).add(row.supplierNumber);
    },
    value() { return { foreign, rows:[...stores].flatMap(([store,suppliers])=>[...suppliers].map(supplierNumber=>({store,supplierNumber}))) }; },
  };
}

export async function readLedgerScopeRows(workspaceId, ledgerId, {strict=false}={}) {
  const ledger=await db.ledgers.get(ledgerId);
  if (!ledger || ledger.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
  const compute=async()=>{
    const scope=collectScope(workspaceId);
    const chunks = await readPageSaleChunks(workspaceId, ledgerId);
    for (const { stores } of chunks) for (const [store, suppliers] of stores) {
      for (const supplierNumber of suppliers) scope.add({store, supplierNumber});
    }
    return { ...scope.value(), foreign: chunks.some(chunk => chunk.foreign) };
  };
  await Promise.all([db.salesRows.count(),observeTableRevision('salesRows')]);
  const reader=salesRevision() ? salesRevision : sourceRevision;
  const scope=Dexie.currentTransaction ? await compute() : await scopeCache(workspaceId,ledgerId,reader,reader(),compute);
  if (strict && scope.foreign) throw new Error('台账存在跨工作区来源记录，请恢复完整备份后再核算。');
  return scope.rows;
}
export async function readLedgerStoreNames(workspaceId, ledgerId) {
  await Promise.all([db.salesRows.count(), observeTableRevision('salesRows')]);
  const reader = salesRevision() ? salesRevision : sourceRevision;
  return storeNamesCache(workspaceId, ledgerId, reader, reader(), async () => {
    return [...new Set((await readLedgerScopeRows(workspaceId, ledgerId, { strict: true })).map(row => row.store))];
  });
}

// Every consumer establishes its own live-query dependency even on a shared hit.
export async function readLedgerSalesRows(workspaceId, ledgerId, { strict = false, cooperative = false, observe = true, profitPage = false, fresh = false } = {}) {
  const writing = Dexie.currentTransaction?.mode === 'readwrite';
  const observable = !writing;
  if (observable && observe) await Promise.all([db.salesRows.count(), observeTableRevision('salesRows')]);
  const read = async () => {
    const query = db.salesRows.where('ledgerId').equals(ledgerId);
    const project = values => profitPage ? values.map(profitSaleFields) : values;
    if (profitPage && cooperative && !writing) {
      const rows = [];
      await forEachLedgerChunk(db.salesRows, ledgerId, 1200, row => rows.push(profitSaleFields(row)));
      return rows;
    }
    if (!cooperative || writing) return project(await query.toArray());
    const keys = await query.primaryKeys();
    if (keys.length <= 1000) return project(await query.toArray());
    const rows = [];
    for (let offset = 0; offset < keys.length; offset += 500) {
      const chunkKeys = keys.slice(offset, offset + 500), first = chunkKeys[0], last = chunkKeys.at(-1);
      // Imports normally have nearby numeric primary keys. A bounded getAll
      // avoids hundreds of individual IDB requests; interleaved ledgers are
      // excluded by the exact key set. Sparse/legacy keys retain bulkGet.
      if (typeof first === 'number' && typeof last === 'number' && last - first < 1000) {
        const allowed = new Set(chunkKeys);
        rows.push(...project((await db.salesRows.where('id').between(first, last, true, true).toArray()).filter(row => allowed.has(row.id))));
      } else rows.push(...project(await db.salesRows.bulkGet(chunkKeys)));
      const pause = new Promise(resolve => setTimeout(resolve, 0));
      await (Dexie.currentTransaction ? Dexie.waitFor(pause) : pause);
    }
    return rows;
  };
  const revision = salesRevision();
  // Never publish uncommitted transaction rows into a shared cache. Cost and
  // receipt edits do not change the immutable sales source for other readers.
  const revisionReader = revision ? salesRevision : sourceRevision;
  const sourceVersion = revision ?? sourceRevision();
  let rows = fresh || !observable ? await read() : await cachedDerived({ scope: [ledgerId], formula: profitPage ? 'profit-page-sales@1' : 'raw-ledger-rows@3-source', revision: sourceVersion,
    revisionReader, persist: false, boundedMemory: true, compute: read,
    ...(cooperative ? { measure: cooperativeDerivedValueBytes } : {}),
  });
  if (rows.some(row => !row.workspaceId)) {
    const ledger = await db.ledgers.get(ledgerId);
    // Old rows can predate workspaceId. A persisted, owned parent establishes
    // their read scope; leave explicit foreign rows untouched for the guard.
    rows = ledger?.workspaceId === workspaceId
      ? rows.map(row => row.workspaceId ? row : { ...row, workspaceId }) : rows;
  }
  if (rows.some(row => row.workspaceId !== workspaceId)) {
    if (strict) throw new Error('台账存在跨工作区来源记录，请恢复完整备份后再核算。');
    return rows.filter(row => row.workspaceId === workspaceId);
  }
  if (profitPage && observable) await Promise.all([
    storeNamesCache(workspaceId, ledgerId, revisionReader, sourceVersion, () => [...new Set(rows.map(row => row.store))]),
    scopeCache(workspaceId, ledgerId, revisionReader, sourceVersion, () => { const scope=collectScope(workspaceId); rows.forEach(row=>scope.add(row)); return scope.value(); }),
  ]);
  return rows;
}
