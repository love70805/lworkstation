import Dexie from 'dexie';
import { db } from '../db/clientDatabase';
import { cachedDerived, sourceRevision, tableRevisionReader, observeTableRevision } from '../db/derivedCache';

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
export async function readLedgerSalesRows(workspaceId, ledgerId, { strict = false } = {}) {
  const writing = Dexie.currentTransaction?.mode === 'readwrite';
  const observable = !writing;
  if (observable) await Promise.all([db.salesRows.count(), observeTableRevision('salesRows')]);
  const read = () => db.salesRows.where('ledgerId').equals(ledgerId).toArray();
  const revision = salesRevision();
  // Never publish uncommitted transaction rows into a shared cache. Cost and
  // receipt edits do not change the immutable sales source for other readers.
  const revisionReader = revision ? salesRevision : sourceRevision;
  let rows = !observable ? await read() : await cachedDerived({ scope: [ledgerId], formula: 'raw-ledger-rows@3-source', revision: revision ?? sourceRevision(),
    revisionReader, persist: false, boundedMemory: true, compute: read,
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
