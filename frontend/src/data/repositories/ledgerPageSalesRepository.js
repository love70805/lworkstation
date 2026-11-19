import Dexie from 'dexie';
import { db } from '../db/clientDatabase';
import { cachedDerived, observeTableRevision, tableRevisionReader, sourceRevision } from '../db/derivedCache';
import { packPageSales } from '../../domain/ledgerPageSales';
import { capturePageSaleIdentities } from './saleIdentityProjection';

const salesRevision = tableRevisionReader('salesRows');
export async function readPageSaleChunks(workspaceId, ledgerId, { parent, cache = true } = {}) {
  const ledger = parent ?? await db.ledgers.get(ledgerId);
  if (!ledger || ledger.id !== ledgerId || ledger.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
  await Promise.all([db.salesRows.count(), observeTableRevision('salesRows')]);
  const readRevision = salesRevision() ? salesRevision : sourceRevision;
  const revision = readRevision();
  const identities = capturePageSaleIdentities(ledger);
  const read = (formula, scope, compute, persist = false) => !cache || Dexie.currentTransaction ? compute() :
    cachedDerived({ formula, scope: [workspaceId, ledgerId, ...scope], revisionReader: readRevision, revision, compute, persist });
  const keys = await read('page-sales-keys@1', [], () => db.salesRows.where('ledgerId').equals(ledgerId).primaryKeys());
  const chunks = [];
  for (let offset = 0; offset < keys.length; offset += 12000) {
    const shard = await read('page-sales-columns@1', [offset], async () => {
      const parts = [];
      for (let i = offset; i < Math.min(offset + 12000, keys.length); i += 1000) {
        const ids = keys.slice(i, i + 1000), first = ids[0], last = ids.at(-1);
        const rows = ids.length >= 64 && typeof first === 'number' && typeof last === 'number' && last - first === ids.length - 1
          ? await db.salesRows.where(':id').between(first, last, true, true).toArray()
          : await db.salesRows.bulkGet(ids);
        const owned = rows.filter(row => row?.ledgerId === ledgerId);
        identities?.chunk(i, owned);
        parts.push(packPageSales(owned, workspaceId));
      }
      return parts;
    }, keys.length > 2048);
    chunks.push(...shard);
  }
  identities?.finish(keys.length);
  return chunks;
}
