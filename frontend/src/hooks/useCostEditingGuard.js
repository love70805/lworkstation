import { useLiveQuery } from 'dexie-react-hooks';
import { useErpCollectionTasks } from './useErpCollectionTasks';
import { erpCostEditingGuard } from '../domain/erpCostEditingGuard';
import { hasCostTaskTransport } from '../data/repositories/erpCostEditingGuard';
import { listErpCostAdoptionStates } from '../data/repositories/profitRepository';

export function useCostEditingGuard(workspaceId, ledgerId) {
  const enabled = hasCostTaskTransport() && Boolean(workspaceId && ledgerId);
  const collection = useErpCollectionTasks(enabled ? workspaceId : null, ledgerId);
  const receipts = useLiveQuery(async () => {
    if (!enabled) return { rows: [] };
    try { return { rows: await listErpCostAdoptionStates({ workspaceId }) }; }
    catch (error) { return { rows: [], error: error.message }; }
  }, [workspaceId, ledgerId, enabled]);
  return { ...erpCostEditingGuard({ workspaceId, ledgerId,
    tasks: enabled ? collection.tasks : [], inboxes: receipts?.rows ?? [],
    loading: enabled && (collection.loading || !receipts), error: enabled ? collection.error || receipts?.error : '' }),
    refresh: collection.refresh };
}
