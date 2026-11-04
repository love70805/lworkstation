import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readErpTaskState, subscribeErpTaskState, refreshErpTaskState } from '../lib/erpCollectionTaskStore';
import { requestErpInboxRefresh } from '../lib/erpInboxEvents';

export function useErpCollectionTasks(workspaceId, ledgerId) {
  const state = useSyncExternalStore(subscribeErpTaskState, () => readErpTaskState(workspaceId), () => readErpTaskState(workspaceId));
  const refresh = useCallback(() => {
    requestErpInboxRefresh();
    void refreshErpTaskState({ workspaceId }).catch(() => {});
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    void refreshErpTaskState({ workspaceId }).catch(() => {});
  }, [workspaceId, ledgerId]);
  return { tasks: state.tasks.filter(task => !ledgerId || task.ledgerId === ledgerId), loading: Boolean(workspaceId && !state.ready), error: state.error, refresh };
}
