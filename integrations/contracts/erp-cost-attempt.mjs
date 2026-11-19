// A failed lookup never gets a receipt. An unsent staged result and a queued
// retry can still change costs, even if an earlier attempt already finished.
export function hasFinishedCostAttemptWithIssues(task) {
  if (task?.runMode === 'catalog' || !['partial', 'failed', 'cost_complete'].includes(task?.status)) return false;
  const batches = task.batches ?? [];
  return batches.some(batch => ['failed', 'incomplete'].includes(batch.status))
    && batches.every(batch => batch.deliveryId || batch.status === 'failed' || batch.status === 'incomplete' && !batch.resultDeliveryId);
}
