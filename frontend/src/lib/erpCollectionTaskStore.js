import { listErpCollectionTasks } from './erpInboxTransport';

const empty = Object.freeze({ tasks: [], error: '', ready: false });
const states = new Map(), listeners = new Set(), pending = new Map();
export const readErpTaskState = workspaceId => states.get(workspaceId) ?? empty;
export function subscribeErpTaskState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function publishErpTaskState({ workspaceId, tasks, error = '' }) {
  if (!workspaceId) return;
  const previous = readErpTaskState(workspaceId);
  states.set(workspaceId, { tasks: tasks == null ? previous.tasks : tasks.filter(task => task.workspaceId === workspaceId),
    error, ready: true });
  // Only task metadata is retained; keep inactive workspace history bounded.
  if (states.size > 8) states.delete(states.keys().next().value);
  for (const listener of listeners) listener();
}
export function refreshErpTaskState({ workspaceId } = {}) {
  if (!workspaceId) return Promise.resolve({ tasks: [] });
  if (pending.has(workspaceId)) return pending.get(workspaceId);
  const work = listErpCollectionTasks({ workspaceId }).then(payload => {
    const tasks = payload.tasks ?? payload.records ?? [];
    publishErpTaskState({ workspaceId, tasks });
    return { ...payload, tasks };
  }).catch(error => {
    publishErpTaskState({ workspaceId, error: error.message });
    throw error;
  }).finally(() => pending.delete(workspaceId));
  pending.set(workspaceId, work);
  return work;
}
