// Authorization and business projection must never disagree about an action.
const business = (entityType, permissions, operation = "upsert") => Object.freeze({ entityType, operation, permissions });
const audit = (permissions = [["audit_events", "insert"]]) => Object.freeze({ permissions });
const productWrite = [["products", "update"], ["platform_skus", "update"], ["supplier_offers", "update"]];

export const SYNC_ACTION_RULES = Object.freeze({
  capture_created: business("capture", [["captures", "insert"]]),
  capture_draft_saved: business("capture", [["captures", "update"]]),
  capture_confirmed: business("capture", [["captures", "update"]]),
  capture_ignored: business("capture", [["captures", "update"]]),
  capture_product_relinked: business("capture", [["captures", "update"], ["products", "update"]]),
  product_created: business("product", [["products", "insert"], ["platform_skus", "insert"], ["supplier_offers", "insert"]]),
  product_updated: business("product", productWrite),
  product_merged: business("product", productWrite),
  product_deleted: business("product", [["products", "delete"]], "delete"),
  selection_status_definitions_updated: business("workspace", [["workspaces", "update"]]),
  catalog_manual_cost_confirmed: business("catalog_manual_cost", [["catalog_manual_costs", "insert"], ["catalog_manual_costs", "update"]]),
  catalog_manual_cost_relinked: business("catalog_manual_cost", [["catalog_manual_costs", "update"], ["products", "update"]]),
  created: business("monthly_ledger", [["ledgers", "insert"]]),
  imported: business("sales_import_batch", [["import_batches", "insert"]]),
  warehouse_rate_updated: business("monthly_ledger", [["ledgers", "update"]]),
  deleted: business("monthly_ledger", [["ledgers", "delete"]], "delete"),
  published: business("erp_cost_batch", [["erp_cost_batches", "insert"], ["erp_cost_rows", "insert"], ["erp_cost_inbox", "insert"], ["ledgers", "update"]]),
  voided: business("erp_cost_batch", [["erp_cost_batches", "update"], ["erp_cost_inbox", "update"], ["ledgers", "update"]]),
  skcs_copied: business("erp_cost_request", [["erp_cost_requests", "update"]]),
  request_prepared: business("erp_cost_request", [["erp_cost_requests", "update"]]),
  approved_1688_fallback: business("cost_approval", [["cost_approvals", "insert"]]),
  manual_override_saved: business("cost_approval", [["cost_approvals", "insert"]]),
  manual_override_revoked: business("cost_approval", [["cost_approvals", "update"]]),
  revoked: business("cost_approval", [["cost_approvals", "update"]]),
  finalized: business("monthly_ledger", [["profit_lines", "insert"]]),
  reopened_for_cost_recalculation: business("monthly_ledger", [["ledgers", "update"], ["profit_lines", "delete"]]),
  // Explicitly supported metadata events never project into business tables.
  backup_exported: audit(),
  cloud_seed_exported: audit(),
  cloud_seed_imported: audit([["workspaces", "update"]]),
  backup_restored: audit([["workspaces", "update"]]),
  sync_recovery_restored: audit(),
  workspace_reset: audit([["workspaces", "update"]]),
  product_sales_status_bulk_updated: audit([["products", "update"]]),
  received: audit([["erp_cost_inbox", "insert"]]),
  rejected: audit([["erp_cost_inbox", "update"]]),
  manual_v2_import_applied: audit([["erp_cost_inbox", "insert"]]),
});

export function syncActionRule(action) {
  return Object.hasOwn(SYNC_ACTION_RULES, action) ? SYNC_ACTION_RULES[action] : null;
}
