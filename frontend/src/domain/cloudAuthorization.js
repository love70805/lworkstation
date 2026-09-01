import { canCloudRole, isCloudRole } from "./cloudPermissions.js";

const ACTION_RULES = Object.freeze({
  capture_created: [["captures", "insert"]],
  capture_draft_saved: [["captures", "update"]],
  capture_confirmed: [["captures", "update"]],
  capture_ignored: [["captures", "update"]],
  product_created: [["products", "insert"]],
  product_updated: [["products", "update"]],
  created: [["ledgers", "insert"]],
  imported: [["import_batches", "insert"]],
  warehouse_rate_updated: [["ledgers", "update"]],
  deleted: [["ledgers", "delete"]],
  published: [["erp_cost_batches", "insert"], ["erp_cost_rows", "insert"], ["erp_cost_inbox", "insert"], ["ledgers", "update"]],
  voided: [["erp_cost_batches", "update"], ["erp_cost_inbox", "update"], ["ledgers", "update"]],
  skcs_copied: [["erp_cost_requests", "update"]],
  approved_1688_fallback: [["cost_approvals", "insert"]],
  revoked: [["cost_approvals", "update"]],
  finalized: [["profit_lines", "insert"]],
  reopened_for_cost_recalculation: [["ledgers", "update"], ["profit_lines", "delete"]],
  backup_exported: [["audit_events", "insert"]],
  cloud_seed_exported: [["audit_events", "insert"]],
  cloud_seed_imported: [["audit_events", "insert"]],
});

export function auditActionPermission(event = {}) {
  return auditActionPermissions(event)[0];
}

export function auditActionPermissions(event = {}) {
  const rules = ACTION_RULES[event.action] ?? [["audit_events", "insert"]];
  return rules.map(([table, operation]) => ({ table, operation }));
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
      return permissions.every((permission) => canCloudRole(normalizedRole, permission.table, permission.operation));
    });
    return canCloudRole(normalizedRole, "audit_events", "insert");
  };
}
