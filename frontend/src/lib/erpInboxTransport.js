import { requestInbox } from "./inboxTransport";

const deliveryWorkspaces = new Map();
const catalogDeliveryWorkspaces = new Map();

export async function pollErpCatalogInbox({ workspaceId = null, limit = 20, signal } = {}) {
  const payload = await requestInbox({ route: "/erp/v1/catalog-batches", query: { workspaceId, limit } }, { signal });
  const records = Array.isArray(payload?.records) ? payload.records : [];
  records.forEach(record => { if (record.deliveryId && record.workspaceId) catalogDeliveryWorkspaces.set(record.deliveryId, record.workspaceId); });
  return records;
}

export async function acknowledgeErpCatalogInbox(deliveryId, { workspaceId = null } = {}) {
  await requestInbox({ route: "/erp/v1/catalog-batches", method: "POST", body: { deliveryId, workspaceId: workspaceId || catalogDeliveryWorkspaces.get(deliveryId) || "", status: "acknowledged" } });
  catalogDeliveryWorkspaces.delete(deliveryId);
}

export async function pollErpInbox({ workspaceId = null, ledgerId = null, limit = 20, signal } = {}) {
  const payload = await requestInbox({
    route: "/erp/v1/cost-batches",
    query: { workspaceId, ledgerId, limit },
  }, { signal });
  const records = Array.isArray(payload?.records) ? payload.records : [];
  for (const record of records) {
    if (record?.deliveryId && record?.workspaceId) deliveryWorkspaces.set(record.deliveryId, record.workspaceId);
  }
  return records;
}

export async function acknowledgeErpInbox(deliveryId, { workspaceId = null } = {}) {
  if (!deliveryId) return;
  const resolvedWorkspaceId = workspaceId || deliveryWorkspaces.get(deliveryId) || "";
  await requestInbox({
    route: "/erp/v1/cost-batches",
    method: "POST",
    body: { deliveryId, workspaceId: resolvedWorkspaceId, status: "acknowledged" },
  });
  deliveryWorkspaces.delete(deliveryId);
}

export async function registerErpBridgeRequest({ request, expectedSkus = [] } = {}) {
  if (!request) return { accepted: false, unavailable: true };
  return requestInbox({
    route: "/erp/v1/requests",
    method: "POST",
    body: { request, expectedSkus },
  });
}

export function getErpRequestHistory({ workspaceId } = {}) {
  return requestInbox({ route: "/erp/v1/requests", query: { workspaceId, includeHistory: true } });
}

export function getErpExtensionStatus() {
  return requestInbox({ route: "/erp/v1/extension-status" });
}

export function listErpCollectionTasks({ workspaceId, ledgerId, requestId, signal } = {}) {
  return requestInbox({ route: '/erp/v1/collection-tasks', query: { workspaceId, ledgerId, requestId } }, { signal });
}

export function controlErpCollectionTask(taskId, { workspaceId, action, requestId, filters, scopeHash } = {}) {
  return requestInbox({ route: `/erp/v1/collection-tasks/${encodeURIComponent(taskId)}/control`, method: 'POST', body: { workspaceId, action, requestId, filters, scopeHash } });
}

export function reportErpCollectionAdoption(taskId, { workspaceId, deliveryId, adoption } = {}) {
  if (!taskId || !deliveryId || !adoption) return Promise.resolve(null);
  return requestInbox({ route: `/erp/v1/collection-tasks/${encodeURIComponent(taskId)}/adoption`, method: 'POST', body: {
    workspaceId, deliveryId, ...adoption.summary, state: adoption.state, processedAt: adoption.processedAt,
  } });
}
