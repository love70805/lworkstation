import { db } from '../db/clientDatabase';
import { cachedDerived, sourceRevision, observeSourceRevision } from '../db/derivedCache';

// Every consumer establishes its own live-query dependency even on a shared hit.
export async function readLedgerSalesRows(workspaceId, ledgerId, { strict = false } = {}) {
  const observable = await observeSourceRevision();
  const read = () => db.salesRows.where('ledgerId').equals(ledgerId).toArray();
  const rows = !observable ? await read() : await cachedDerived({ scope: [workspaceId, ledgerId], formula: 'raw-ledger-rows@1', revision: sourceRevision(), persist: false,
    compute: read,
  });
  if (rows.some(row => row.workspaceId !== workspaceId)) {
    if (strict) throw new Error('台账存在跨工作区来源记录，请恢复完整备份后再核算。');
    return rows.filter(row => row.workspaceId === workspaceId);
  }
  return rows;
}
