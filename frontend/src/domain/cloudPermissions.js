export const CLOUD_ROLES = Object.freeze(["admin", "selection", "operations", "finance", "viewer"]);
export const CLOUD_OPERATIONS = Object.freeze(["read", "insert", "update", "delete"]);

const READ_ALL = ["admin", "selection", "operations", "finance", "viewer"];
const ADMIN = ["admin"];
const SELECTION = ["admin", "selection"];
const OPERATIONS = ["admin", "operations"];
const FINANCE = ["admin", "finance"];
const OPERATIONS_FINANCE = ["admin", "operations", "finance"];

export const CLOUD_PERMISSION_MATRIX = Object.freeze({
  workspaces: { read: READ_ALL, update: ADMIN },
  workspace_members: { read: READ_ALL, insert: ADMIN, update: ADMIN, delete: ADMIN },
  products: { read: READ_ALL, insert: SELECTION, update: SELECTION },
  platform_skus: { read: READ_ALL, insert: SELECTION, update: SELECTION },
  supplier_offers: { read: READ_ALL, insert: SELECTION, update: SELECTION, delete: SELECTION },
  captures: { read: READ_ALL, insert: ["admin", "selection", "operations"], update: ["admin", "selection", "operations"], delete: ["admin", "selection", "operations"] },
  ledgers: { read: READ_ALL, insert: ["admin", "operations", "finance"], update: ["admin", "operations", "finance"], delete: ["admin", "operations", "finance"] },
  import_batches: { read: READ_ALL, insert: OPERATIONS, update: OPERATIONS, delete: OPERATIONS },
  sales_rows: { read: READ_ALL, insert: OPERATIONS, update: OPERATIONS, delete: OPERATIONS },
  erp_cost_requests: { read: READ_ALL, insert: OPERATIONS, update: OPERATIONS, delete: OPERATIONS },
  erp_cost_batches: { read: READ_ALL, insert: OPERATIONS_FINANCE, update: FINANCE },
  erp_cost_rows: { read: READ_ALL, insert: OPERATIONS_FINANCE },
  erp_cost_inbox: { read: READ_ALL, insert: OPERATIONS_FINANCE, update: FINANCE },
  cost_approvals: { read: READ_ALL, insert: FINANCE, update: FINANCE },
  profit_lines: { read: READ_ALL, insert: FINANCE, delete: FINANCE },
  audit_events: { read: READ_ALL, insert: READ_ALL },
});

export function isCloudRole(role) {
  return CLOUD_ROLES.includes(String(role ?? "").trim().toLowerCase());
}

export function canCloudRole(role, table, operation) {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const normalizedOperation = String(operation ?? "").trim().toLowerCase();
  return Boolean(
    isCloudRole(normalizedRole)
      && CLOUD_PERMISSION_MATRIX[table]
      && CLOUD_PERMISSION_MATRIX[table][normalizedOperation]?.includes(normalizedRole),
  );
}

export function assertCloudRoleCan(role, table, operation) {
  if (!canCloudRole(role, table, operation)) {
    throw new Error(`角色 ${role || "unknown"} 无权对 ${table} 执行 ${operation}。`);
  }
  return true;
}

export function cloudRoleMatrixSnapshot() {
  return Object.fromEntries(Object.entries(CLOUD_PERMISSION_MATRIX).map(([table, permissions]) => [
    table,
    Object.fromEntries(CLOUD_OPERATIONS.map((operation) => [operation, [...(permissions[operation] ?? [])]])),
  ]));
}

