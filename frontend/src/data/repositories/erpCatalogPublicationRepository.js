import { db } from '../db/clientDatabase';

const keyFor = (workspaceId, taskId) => `erp-catalog:publication:${workspaceId}:${taskId}`;

// Persist only the small barrier, not another copy of the cost evidence. An
// absent record stays closed across restarts and connection failures.
export async function syncErpCatalogPublications({ workspaceId, tasks }) {
  if (!tasks.some(task => task.workspaceId === workspaceId && task.catalogMode === 'after_costs')) return;
  await db.transaction('rw', db.settings, async () => {
    for (const task of tasks.filter(task => task.workspaceId === workspaceId && task.catalogMode === 'after_costs')) {
      const batches = task.batches ?? [];
      const allowed = !task.recoveryRequired && !['paused', 'stopped', 'invalidated'].includes(task.status)
        && batches.length > 0 && batches.every(batch => batch.status === 'delivered' && batch.deliveryId && batch.adoptionReportedAt);
      const record = { key: keyFor(workspaceId, task.taskId), kind: 'erp_catalog_publication', workspaceId,
        taskId: task.taskId, requestId: task.requestId, ledgerId: task.ledgerId, allowed,
        attempts: allowed ? batches.map(batch => [batch.batchId, batch.attemptId]) : [] };
      const previous = await db.settings.get(record.key);
      if (JSON.stringify(previous) !== JSON.stringify(record)) await db.settings.put(record);
    }
  });
}

export async function readErpCatalogPublicationGate(workspaceId) {
  const records = await db.settings.where('key').startsWith(`erp-catalog:publication:${workspaceId}:`).toArray();
  const byTask = new Map(records.map(record => [record.taskId, record]));
  return source => {
    const binding = source?.sourceMeta?.catalogPublication;
    if (binding?.mode !== 'after_costs') return true;
    const record = byTask.get(binding.taskId);
    return Boolean(record?.allowed && record.workspaceId === workspaceId && record.requestId === source.requestId
      && record.ledgerId === source.ledgerId && record.attempts.some(([batchId, attemptId]) => batchId === binding.batchId && attemptId === binding.attemptId));
  };
}
