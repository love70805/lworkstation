import { db } from '../db/clientDatabase';

const keyFor = (workspaceId, taskId) => `erp-catalog:publication:${workspaceId}:${taskId}`;

// Persist only the small barrier, not another copy of the cost evidence. An
// absent record stays closed across restarts and connection failures.
export async function syncErpCatalogPublications({ workspaceId, tasks }) {
  const scoped = tasks.filter(task => task.workspaceId === workspaceId && ['after_costs', 'on_demand'].includes(task.catalogMode));
  if (!scoped.length) return;
  await db.transaction('rw', db.settings, async () => {
    for (const task of scoped) {
      const batches = task.batches ?? [];
      const allowed = task.catalogMode === 'after_costs' && !task.recoveryRequired && !['paused', 'stopped', 'invalidated'].includes(task.status)
        && batches.length > 0 && batches.every(batch => batch.status === 'delivered' && batch.deliveryId && batch.adoptionReportedAt);
      const record = { key: keyFor(workspaceId, task.taskId), kind: 'erp_catalog_publication', workspaceId,
        taskId: task.taskId, requestId: task.requestId, ledgerId: task.ledgerId, catalogMode: task.catalogMode, allowed,
        createdAt: task.createdAt ?? '',
        attempts: allowed ? batches.map(batch => [batch.batchId, batch.attemptId]) : [] };
      const previous = await db.settings.get(record.key);
      if (JSON.stringify(previous) !== JSON.stringify(record)) await db.settings.put(record);
    }
  });
}

export async function readErpCatalogPublicationGate(workspaceId) {
  const records = await db.settings.where('key').startsWith(`erp-catalog:publication:${workspaceId}:`).toArray();
  const byTask = new Map(records.map(record => [record.taskId, record]));
  const byRequest = new Map();
  for (const record of records) {
    const key = JSON.stringify([record.requestId, record.ledgerId]);
    const previous = byRequest.get(key);
    if (!previous || record.createdAt > previous.createdAt) byRequest.set(key, record);
  }
  return source => {
    const binding = source?.sourceMeta?.catalogPublication;
    // Cost-only receipts retain identity and purchase evidence, but never
    // supply product metadata. Explicit catalog receipts use a separate source.
    if (binding?.mode === 'on_demand') return false;
    if (binding?.mode !== 'after_costs') {
      const record = byRequest.get(JSON.stringify([source?.requestId, source?.ledgerId]));
      return record?.catalogMode === 'on_demand' ? true : record?.allowed ?? true;
    }
    const record = byTask.get(binding.taskId);
    return Boolean(record?.allowed && record.workspaceId === workspaceId && record.requestId === source.requestId
      && record.ledgerId === source.ledgerId && record.attempts.some(([batchId, attemptId]) => batchId === binding.batchId && attemptId === binding.attemptId));
  };
}
