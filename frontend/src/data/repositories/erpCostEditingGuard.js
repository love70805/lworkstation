import Dexie from 'dexie';
import { db } from '../db/clientDatabase';
import { erpCostEditingGuard } from '../../domain/erpCostEditingGuard';
import { listErpCollectionTasks } from '../../lib/erpInboxTransport';
import { publishErpTaskState, readErpTaskState } from '../../lib/erpCollectionTaskStore';

export const hasCostTaskTransport = () => typeof globalThis.window?.shopeersDesktopRuntime?.requestInbox === 'function';
const fail = guard => { if (guard.blocked) throw Object.assign(new Error(`${guard.title}。${guard.message}`), { code: 'ERP_COST_REVIEW_NOT_READY' }); };

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
  const state = readErpTaskState(ledger.workspaceId);
  const inboxes = [];
  // The guard needs receipt identity and adoption state, never its purchase
  // payload. Release each decoded envelope before retaining the next state.
  await db.erpCostInbox.where('ledgerId').equals(ledger.id).each(inbox => inboxes.push({
    workspaceId: inbox.workspaceId, ledgerId: inbox.ledgerId, requestId: inbox.requestId,
    deliveryId: inbox.deliveryId, status: inbox.status,
    adoptionPending: inbox.adoptionPending, adoptionFailure: inbox.adoptionFailure,
  }));
  fail(erpCostEditingGuard({ workspaceId: ledger.workspaceId, ledgerId: ledger.id,
    tasks: state.tasks, loading: !state.ready, error: state.error, inboxes }));
}
