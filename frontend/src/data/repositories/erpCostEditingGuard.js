import Dexie from 'dexie';
import { db } from '../db/clientDatabase';
import { inboxRowVersion, transactionChangedTable } from '../db/derivedCache';
import { erpCostEditingGuard } from '../../domain/erpCostEditingGuard';
import { listErpCollectionTasks } from '../../lib/erpInboxTransport';
import { publishErpTaskState, readErpTaskState } from '../../lib/erpCollectionTaskStore';

export const hasCostTaskTransport = () => typeof globalThis.window?.shopeersDesktopRuntime?.requestInbox === 'function';
const fail = guard => { if (guard.blocked) throw Object.assign(new Error(`${guard.title}。${guard.message}`), { code: 'ERP_COST_REVIEW_NOT_READY' }); };
const committedStates = new Map();
export async function readReceiptStates(field, value) {
  return db.transaction('r', db.erpCostInbox, async () => {
    const tx = Dexie.currentTransaction;
    const ids = await db.erpCostInbox.where(field).equals(value).primaryKeys();
    const canRemember = !transactionChangedTable(tx, ['erpCostInbox']);
    const result = [], updates = [];
    for (let offset = 0; offset < ids.length; offset += 4) {
      const group = ids.slice(offset,offset + 4).map(id => {
        const version = canRemember && inboxRowVersion(id), saved = committedStates.get(id);
        return { id, version, state: version && saved?.version === version ? saved.state : null };
      });
      const missing = group.filter(entry => !entry.state);
      const rows = missing.length ? await db.erpCostInbox.bulkGet(missing.map(entry => entry.id)) : [];
      rows.forEach((inbox,i) => {
        if (!inbox) return;
        const state = { id:inbox.id, deliveryId:inbox.deliveryId, workspaceId:inbox.workspaceId, ledgerId:inbox.ledgerId, requestId:inbox.requestId, status:inbox.status,
          adoptionPending:inbox.adoptionPending, adoptionFailure:inbox.adoptionFailure, adoption:inbox.adoption ? {state:inbox.adoption.state,processedAt:inbox.adoption.processedAt,summary:inbox.adoption.summary} : null };
        missing[i].state = state;
        if (missing[i].version) updates.push(missing[i]);
      });
      for (const entry of group) if (entry.state) result.push(entry.state);
    }
    if (updates.length) tx.idbtrans.addEventListener('complete', () => {
      for (const entry of updates) if (entry.version === inboxRowVersion(entry.id)) committedStates.set(entry.id, entry);
      while (committedStates.size > 512) committedStates.delete(committedStates.keys().next().value);
    }, {once:true});
    return result;
  });
}

// The save path re-reads durable task metadata; a stale/open dialog is insufficient.
// Network I/O is deliberately outside IndexedDB transactions.
export async function assertLedgerCostEditingReady(ledgerId) {
  if (!hasCostTaskTransport()) return;
  const ledger = await db.ledgers.get(ledgerId);
  if (!ledger) return;
  if (Dexie.currentTransaction) return assertCachedLedgerCostEditingReady(ledger);
  try {
    const result = await listErpCollectionTasks({ workspaceId: ledger.workspaceId, signal: AbortSignal.timeout(5000) });
    if (!Array.isArray(result.tasks)) throw new Error('采集状态响应不完整');
    publishErpTaskState({ workspaceId: ledger.workspaceId, tasks: result.tasks });
  } catch (error) {
    publishErpTaskState({ workspaceId: ledger.workspaceId, error: error.message });
    fail(erpCostEditingGuard({ error: error.message }));
  }
  await assertCachedLedgerCostEditingReady(ledger);
}

// Recheck local adoption and any newer task notification inside the write transaction.
export async function assertCachedLedgerCostEditingReady(ledger) {
  if (!hasCostTaskTransport()) return;
  const inboxes = await readReceiptStates('ledgerId', ledger.id);
  const state = readErpTaskState(ledger.workspaceId);
  fail(erpCostEditingGuard({ workspaceId: ledger.workspaceId, ledgerId: ledger.id,
    tasks: state.tasks, loading: !state.ready, error: state.error, inboxes }));
}
