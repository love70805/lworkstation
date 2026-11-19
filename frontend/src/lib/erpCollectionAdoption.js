import { reportErpCollectionAdoption } from './erpInboxTransport';
import { listErpCostAdoptionStates } from '../data/database';
import { publishErpCollectionActivity } from './erpCollectionActivity';
import { syncErpCatalogPublications } from '../data/repositories/erpCatalogPublicationRepository';
import { refreshErpTaskState } from './erpCollectionTaskStore';
import { ERP_ADOPTION_COUNTS } from '../../../integrations/contracts/erp-adoption-counts.mjs';

// Receipt acknowledgement and adopted cost are independent facts. Retry failed
// reports from durable local inboxes, including after app/service restart.
export async function syncErpCollectionAdoptions({ workspaceId, listTasks = refreshErpTaskState, listInboxes = listErpCostAdoptionStates, report = reportErpCollectionAdoption, publishCatalog = syncErpCatalogPublications, shouldStop } = {}) {
  let tasks;
  try {
    ({ tasks = [] } = await listTasks({ workspaceId }));
    publishErpCollectionActivity({ workspaceId, tasks });
  } catch (error) {
    publishErpCollectionActivity({ workspaceId, error: error.message });
    throw error;
  }
  if (!tasks.length || shouldStop?.()) return;
  const inboxes = tasks.some(task => task.batches?.length) ? await listInboxes({ workspaceId }) : [];
  const byDelivery = new Map(inboxes.filter(inbox => inbox.workspaceId === workspaceId).map(inbox => [inbox.deliveryId, inbox]));
  // Withdraw stale outcomes before reporting newly settled batches. Otherwise
  // a previous adoption timestamp can open the last-batch barrier while an
  // earlier local calculation is pending or failed.
  for (const task of tasks) for (const batch of task.batches ?? []) {
    if (shouldStop?.()) return;
    const inbox = byDelivery.get(batch.deliveryId);
    if (task.catalogMode !== 'after_costs' || !batch.adoptionReportedAt
      || inbox?.adoption && !inbox.adoptionPending && !inbox.adoptionFailure) continue;
    const response = await report(task.taskId, { workspaceId, deliveryId: batch.deliveryId, adoption: { state: 'pending', summary: {} } });
    if (response?.task) Object.assign(task, response.task);
  }
  for (const task of tasks) for (const batch of task.batches ?? []) {
    if (shouldStop?.()) return;
    const inbox = byDelivery.get(batch.deliveryId);
    if (!inbox?.adoption || inbox.adoptionPending || inbox.adoptionFailure) continue;
    // A locally evaluated receipt can still need a price decision. The task
    // protocol reserves "pending" for withdrawing a previous evaluation.
    const adoption = { ...inbox.adoption, state: inbox.adoption.state === 'pending' ? 'review_required' : inbox.adoption.state,
      summary: { ...inbox.adoption.summary } };
    adoption.summary.adoptedCount = ['voided', 'rejected'].includes(inbox.status) ? 0 : Math.max(0, (adoption.summary.adoptedCount ?? 0) - (adoption.summary.manualEffectiveCount ?? 0));
    if (batch.adoptionReportedAt && batch.adoption
      && ERP_ADOPTION_COUNTS.every(key => batch.adoption[key] === Number(adoption.summary[key] ?? 0))) continue;
    const response = await report(task.taskId, { workspaceId, deliveryId: batch.deliveryId, adoption });
    if (response?.task) Object.assign(task, response.task);
  }
  if (shouldStop?.()) return;
  await publishCatalog({ workspaceId, tasks });
  publishErpCollectionActivity({ workspaceId, tasks });
}
