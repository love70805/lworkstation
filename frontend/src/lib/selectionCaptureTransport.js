import { requestInbox } from "./inboxTransport";

const deliveryWorkspaces = new Map();

export async function pollSelectionCaptureInbox({ workspaceId = null, memberId = null, includeAll = false, limit = 50, signal } = {}) {
  const payload = await requestInbox({
    route: "/selection/v1/captures",
    query: { workspaceId, memberId, includeAll: includeAll ? true : null, limit },
  }, { signal });
  const records = Array.isArray(payload?.records) ? payload.records : [];
  for (const record of records) {
    if (record?.deliveryId && record?.workspaceId) deliveryWorkspaces.set(record.deliveryId, record.workspaceId);
  }
  return records;
}

export async function acknowledgeSelectionCapture(deliveryId, { workspaceId = null } = {}) {
  if (!deliveryId) return;
  const resolvedWorkspaceId = workspaceId || deliveryWorkspaces.get(deliveryId) || "";
  await requestInbox({
    route: "/selection/v1/captures/ack",
    method: "POST",
    body: { deliveryId, workspaceId: resolvedWorkspaceId },
  });
  deliveryWorkspaces.delete(deliveryId);
}

export async function publishSelectionCaptureContext({ workspaceId, memberId, visibility = "workspace" } = {}) {
  if (!workspaceId || !memberId) return;
  await requestInbox({
    route: "/selection/v1/context",
    method: "POST",
    body: { workspaceId, memberId, visibility },
  });
}

export async function checkSelectionCaptureInbox() {
  return requestInbox({ route: "/selection/v1/status" });
}

export function getSelectionExtensionStatus() {
  return requestInbox({ route: "/selection/v1/extension-status" });
}
