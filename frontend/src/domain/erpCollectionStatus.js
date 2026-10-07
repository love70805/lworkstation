export function hasPendingErpCatalog(task) {
  return (task?.batches ?? []).some(batch => batch.deliveryId && batch.catalogStatus !== 'completed');
}

export function isActiveErpCollection(task) {
  if (!task || ['stopped', 'completed', 'invalidated'].includes(task.status)) return false;
  return task.status !== 'cost_complete' || hasPendingErpCatalog(task);
}
