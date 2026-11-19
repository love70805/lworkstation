import Dexie from 'dexie';
import { cachedDerived, observeTableRevision, tableRevisionReader } from '../db/derivedCache';
import { db } from '../db/clientDatabase';
import { readLedgerSalesRows } from './ledgerReadCache';
import { readPageSaleChunks } from './ledgerPageSalesRepository';
import { runDerivedComputation } from './derivedComputationService';
import { prepareProfitPageSales, unpackProfitSaleGroups } from '../../domain/profitPageSales';

const salesRevision = tableRevisionReader('salesRows');
const decoded = new WeakMap();
export function warmImportedProfitSales(ledgerId, workspaceId) {
  const warm = async () => {
    const ledger = await db.ledgers.get(ledgerId);
    if (ledger?.workspaceId === workspaceId) await readProfitPageSales(ledger);
  };
  const start = () => { void warm().catch(() => {}); };
  if (globalThis.requestIdleCallback) globalThis.requestIdleCallback(start, { timeout: 1200 });
  else setTimeout(start, 0);
}
export async function readProfitPageSales(ledger) {
  const compute = async () => runDerivedComputation('profit-page-sales', {
    pageChunks: await readPageSaleChunks(ledger.workspaceId, ledger.id), workspaceId: ledger.workspaceId,
  });
  if (Dexie.currentTransaction) return prepareProfitPageSales(await readLedgerSalesRows(ledger.workspaceId,ledger.id,{profitPage:true}));
  await Promise.all([db.salesRows.count(), observeTableRevision('salesRows')]);
  const revision = salesRevision();
  // Ownership for legacy rows is proved by the current parent on each snapshot.
  const packed = revision ? await cachedDerived({ scope:[ledger.workspaceId, ledger.id], formula:'profit-page-sale-groups@2', revisionReader:salesRevision, revision, compute }) : await compute();
  const existing = decoded.get(packed)?.deref();
  if (existing) return existing;
  const view = unpackProfitSaleGroups(packed);
  if (typeof WeakRef !== 'undefined') decoded.set(packed,new WeakRef(view));
  return view;
}
