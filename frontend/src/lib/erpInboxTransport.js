import { requestInbox } from "./inboxTransport";

const deliveryWorkspaces = new Map();

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
