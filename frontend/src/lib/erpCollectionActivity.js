const empty = Object.freeze({ tasks: [], error: '' });
const snapshots = new Map();
const listeners = new Set();

export function readErpCollectionActivity(workspaceId) {
  return snapshots.get(workspaceId) ?? empty;
}

export function subscribeErpCollectionActivity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Publish metadata already read by the existing adoption poller. No extra poll,
// purchase request, financial evidence or business write is introduced here.
export function publishErpCollectionActivity({ workspaceId, tasks, error = '' }) {
  if (!workspaceId) return;
  const previous = readErpCollectionActivity(workspaceId);
  const projected = tasks == null ? previous.tasks : tasks.filter(task => task.workspaceId === workspaceId).map(task => ({
    taskId: task.taskId, workspaceId, ledgerId: task.ledgerId, ledgerPeriod: task.ledgerPeriod,
    status: task.status, phase: task.phase, recoveryRequired: task.recoveryRequired,
    batches: (task.batches ?? []).map(batch => ({
      status: batch.status, catalogStatus: batch.catalogStatus, deliveryId: batch.deliveryId,
      platformSkcs: batch.platformSkcs ?? [],
    })),
  }));
  const next = { tasks: projected, error };
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  snapshots.set(workspaceId, next);
  for (const listener of listeners) listener();
}
