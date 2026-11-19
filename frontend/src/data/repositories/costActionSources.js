import Dexie from 'dexie';
import { db } from '../db/clientDatabase';
import { tableRevisionReader, transactionChangedTable } from '../db/derivedCache';
import { forEachLedgerChunk } from './ledgerReadCache';
import { collectSaleIdentities, capturedSaleIdentities } from './saleIdentityProjection';

// Reuse only projections read from the business database under its native lock.
// Never publish an uncommitted snapshot, or reuse one after a same-count edit.
export function committedCostSource(tables, read) {
  const readers = tables.map(tableRevisionReader);
  const stamp = () => {
    const values = readers.map(reader => reader());
    return values.every(Boolean) ? JSON.stringify(values) : null;
  };
  let last;
  const scopeOf = (ledger,option) => JSON.stringify([ledger.workspaceId, ledger.id, ledger.period, option]);
  async function get(ledger, option) {
    const scope = scopeOf(ledger, option);
    const tx = Dexie.currentTransaction;
    if (!tx) return db.transaction('r', tables.map(name => db.table(name)), () => get(ledger, option));
    // Starting a Dexie transaction alone doesn't acquire the native store lock.
    await db.table(tables[0]).where('ledgerId').equals(ledger.id).count();
    const revision = stamp();
    if (revision && !transactionChangedTable(tx, tables) && last?.scope === scope && last.revision === revision) return last.value;
    const value = await read(ledger, option);
    if (revision && stamp() === revision && !transactionChangedTable(tx, tables)) {
      tx.idbtrans.addEventListener('complete', () => {
        if (stamp() === revision && !transactionChangedTable(tx, tables)) last = { scope, revision, value };
      }, { once: true });
    }
    return value;
  }
  // A fresh page calculation can offer its verified source read before any
  // packing or display-cache access. A racing edit invalidates the offer.
  get.capture = (ledger,option) => {
    const revision = stamp();
    if (!revision || Dexie.currentTransaction) return null;
    const scope = scopeOf(ledger,option);
    return value => { if (stamp() === revision) last = {scope,revision,value}; };
  };
  return get;
}

export const readCostSaleIdentities = committedCostSource(['salesRows'], async (ledger, includeDates) => {
  const captured = !includeDates && capturedSaleIdentities(ledger);
  if (captured) return captured;
  const collector = collectSaleIdentities(includeDates);
  await forEachLedgerChunk(db.salesRows, ledger.id, 1000, collector.add);
  return collector.result();
});
