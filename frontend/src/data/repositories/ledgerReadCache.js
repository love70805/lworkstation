import Dexie from 'dexie';
import { db } from '../db/clientDatabase';
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

// Every consumer establishes its own live-query dependency even on a shared hit.
export async function readLedgerSalesRows(workspaceId, ledgerId, { strict = false, cooperative = false, observe = true } = {}) {
  const writing = Dexie.currentTransaction?.mode === 'readwrite';
  const observable = !writing;
  if (observable && observe) await Promise.all([db.salesRows.count(), observeTableRevision('salesRows')]);
  const read = async () => {
    const query = db.salesRows.where('ledgerId').equals(ledgerId);
    if (!cooperative || writing) return query.toArray();
    const keys = await query.primaryKeys();
    if (keys.length <= 1000) return query.toArray();
    const rows = [];
    for (let offset = 0; offset < keys.length; offset += 500) {
      const chunkKeys = keys.slice(offset, offset + 500), first = chunkKeys[0], last = chunkKeys.at(-1);
      // Imports normally have nearby numeric primary keys. A bounded getAll
      // avoids hundreds of individual IDB requests; interleaved ledgers are
      // excluded by the exact key set. Sparse/legacy keys retain bulkGet.
      if (typeof first === 'number' && typeof last === 'number' && last - first < 1000) {
        const allowed = new Set(chunkKeys);
        rows.push(...(await db.salesRows.where('id').between(first, last, true, true).toArray()).filter(row => allowed.has(row.id)));
      } else rows.push(...await db.salesRows.bulkGet(chunkKeys));
      const pause = new Promise(resolve => setTimeout(resolve, 0));
      await (Dexie.currentTransaction ? Dexie.waitFor(pause) : pause);
    }
    return rows;
  };
  const revision = salesRevision();
  // Never publish uncommitted transaction rows into a shared cache. Cost and
  // receipt edits do not change the immutable sales source for other readers.
  const revisionReader = revision ? salesRevision : sourceRevision;
  let rows = !observable ? await read() : await cachedDerived({ scope: [ledgerId], formula: 'raw-ledger-rows@3-source', revision: revision ?? sourceRevision(),
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
  return rows;
}
