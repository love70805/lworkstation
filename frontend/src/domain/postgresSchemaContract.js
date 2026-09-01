export const REQUIRED_CLOUD_TABLES = [
  "workspaces",
  "workspace_members",
  "products",
  "platform_skus",
  "supplier_offers",
  "catalog_manual_costs",
  "captures",
  "ledgers",
  "import_batches",
  "sales_rows",
  "erp_cost_requests",
  "erp_cost_batches",
  "erp_cost_rows",
  "erp_cost_inbox",
  "cost_approvals",
  "profit_lines",
  "audit_events",
  "cloud_seed_imports",
];

export const REQUIRED_CLOUD_FRAGMENTS = [
  "unique (workspace_id, canonical_platform_sku)",
  "unique (workspace_id, period, type)",
  "unique (workspace_id, event_id)",
  "cost_summary jsonb not null",
  "group_key text not null",
  "source_payload jsonb not null",
  "create index sales_rows_ledger_group",
  "create or replace function public.is_workspace_member",
  "create or replace function public.has_workspace_role",
  "create or replace function public.reject_fact_mutation_except_parent_cascade",
  "create trigger erp_cost_rows_immutable",
  "create trigger profit_lines_immutable",
  "create trigger audit_events_immutable",
  "create trigger ledgers_delete_guard",
  "status in ('completed', 'published', 'failed', 'voided')",
  "create or replace function public.reopen_ledger_for_cost_recalculation",
  "create or replace function public.void_erp_cost_batch",
  "create trigger erp_cost_batches_controlled_transition",
  "create trigger erp_cost_inbox_controlled_transition",
  "unique (workspace_id, applied_batch_id)",
  "存在已发布或已作废 ERP 正式成本的账本不能物理删除",
  "create policy erp_inbox_insert",
  "drop policy if exists erp_batches_update",
  "alter table public.audit_events force row level security",
  "sale_price numeric(18, 6)",
  "image_url text",
  "owner_id text",
  "visibility text not null default 'workspace'",
  "products_workspace_visibility_owner",
  "captures_workspace_visibility_owner",
  "catalog_manual_costs_one_active_per_sku",
  "selection_status_definitions jsonb not null",
  "supplier_offers_one_active_version",
  "sales_platform text not null default ''",
  "publication_status text not null default 'unpublished'",
  "products_workspace_publication_status",
  "canonical_warehouse_sku text",
  "platform_skus_workspace_canonical_warehouse_sku",
];

export const REQUIRED_ROLE_POLICY_FRAGMENTS = [
  "create policy products_write",
  "create policy skus_write",
  "create policy captures_write",
  "create policy imports_write",
  "create policy erp_requests_write",
  "create policy erp_inbox_insert",
  "drop policy if exists erp_inbox_update",
  "create policy approvals_write",
  "create policy profits_write",
  "create policy cloud_seed_imports_write",
  "array['admin','selection']",
  "array['admin','operations','finance']",
  "array['admin','finance']",
  "drop policy if exists products_read",
  "drop policy if exists captures_read",
  "drop policy if exists skus_read",
  "drop policy if exists skus_update",
  "drop policy if exists skus_delete",
  "drop policy if exists offers_read",
  "create policy catalog_manual_costs_read",
  "create policy catalog_manual_costs_write",
];

export function inspectPostgresMigration(sql = "") {
  const source = String(sql);
  const missingTables = REQUIRED_CLOUD_TABLES.filter((table) => !source.includes(`create table public.${table}`));
  const missingWorkspaceColumns = REQUIRED_CLOUD_TABLES.filter((table) => {
    if (table === "workspaces") return false;
    const start = source.indexOf(`create table public.${table}`);
    const end = source.indexOf(";", start);
    return start < 0 || !source.slice(start, end < 0 ? undefined : end).includes("workspace_id");
  });
  const missingRls = REQUIRED_CLOUD_TABLES.filter((table) => (
    !source.includes(`alter table public.${table} enable row level security`)
      || !source.includes(`alter table public.${table} force row level security`)
  ));
  const missingFragments = REQUIRED_CLOUD_FRAGMENTS.filter((fragment) => !source.toLowerCase().includes(fragment.toLowerCase()));
  const missingRolePolicies = REQUIRED_ROLE_POLICY_FRAGMENTS.filter((fragment) => !source.toLowerCase().includes(fragment.toLowerCase()));
  const forbiddenPatterns = ["add constraint if not exists"];
  const forbidden = forbiddenPatterns.filter((pattern) => source.toLowerCase().includes(pattern));
  return { valid: [missingTables, missingWorkspaceColumns, missingRls, missingFragments, missingRolePolicies, forbidden].every((items) => items.length === 0), missingTables, missingWorkspaceColumns, missingRls, missingFragments, missingRolePolicies, forbidden };
}
