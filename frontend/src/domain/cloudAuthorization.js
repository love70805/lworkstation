import { canCloudRole, isCloudRole } from "./cloudPermissions.js";
import { syncActionRule } from "./syncActionRegistry.js";

export function auditActionPermission(event = {}) {
  return auditActionPermissions(event)?.[0] ?? null;
}

export function auditActionPermissions(event = {}) {
  const rule = syncActionRule(event.action);
  return rule?.permissions.map(([table, operation]) => ({ table, operation })) ?? null;
}

export function createCloudAuthorizer({ expectedToken = "", role = "admin", allowedWorkspaces = [] } = {}) {
  const normalizedToken = String(expectedToken ?? "").trim();
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const workspaceSet = new Set(allowedWorkspaces.map((value) => String(value).trim()).filter(Boolean));
  return ({ workspaceId, token, operation = "audit_events", events = [] } = {}) => {
    if (!isCloudRole(normalizedRole)) return false;
    if (normalizedToken && String(token ?? "") !== normalizedToken) return false;
    if (workspaceSet.size > 0 && !workspaceSet.has(String(workspaceId ?? ""))) return false;
    if (["preflight", "import"].includes(operation)) return canCloudRole(normalizedRole, "workspaces", "update");
    if (operation === "recovery") return canCloudRole(normalizedRole, "workspaces", "read");
    if (operation === "audit_events") return events.every((event) => {
      const permissions = auditActionPermissions(event);
      return Boolean(permissions?.length) && permissions.every((permission) => canCloudRole(normalizedRole, permission.table, permission.operation));
    });
    return false;
  };
}
