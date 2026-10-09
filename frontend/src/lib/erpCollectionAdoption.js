import { listErpCollectionTasks, reportErpCollectionAdoption } from './erpInboxTransport';
import { listErpCostAdoptionStates } from '../data/database';
import { publishErpCollectionActivity } from './erpCollectionActivity';

const reported = new Map();
// Receipt acknowledgement and adopted cost are independent facts. Retry failed
// reports from durable local inboxes, including after app/service restart.
export async function syncErpCollectionAdoptions({ workspaceId, listTasks = listErpCollectionTasks, listInboxes = listErpCostAdoptionStates, report = reportErpCollectionAdoption } = {}) {
  let tasks;
  try {
    ({ tasks = [] } = await listTasks({ workspaceId }));
    publishErpCollectionActivity({ workspaceId, tasks });
  } catch (error) {
    publishErpCollectionActivity({ workspaceId, error: error.message });
    throw error;
  }
  if (!tasks.length) return;
  const inboxes = await listInboxes({ workspaceId });
  const byDelivery = new Map(inboxes.filter(inbox => inbox.workspaceId === workspaceId).map(inbox => [inbox.deliveryId, inbox]));
  for (const task of tasks) for (const batch of task.batches ?? []) {
    const inbox = byDelivery.get(batch.deliveryId);
    if (!inbox?.adoption || inbox.adoptionPending || inbox.adoptionFailure) continue;
    const adoption = { ...inbox.adoption, summary: { ...inbox.adoption.summary } };
    adoption.summary.adoptedCount = ['voided', 'rejected'].includes(inbox.status) ? 0 : Math.max(0, (adoption.summary.adoptedCount ?? 0) - (adoption.summary.manualEffectiveCount ?? 0));
    const key = `${workspaceId}/${task.taskId}/${batch.deliveryId}`;
    const signature = JSON.stringify([inbox.status, adoption]);
    if (batch.adoption && reported.get(key) === signature) continue;
    await report(task.taskId, { workspaceId, deliveryId: batch.deliveryId, adoption });
    reported.set(key, signature);
  }
  if (reported.size > 5000) reported.clear();
}
