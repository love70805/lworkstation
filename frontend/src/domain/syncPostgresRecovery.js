import { inspectCloudSeedRelations } from "./cloudSeedImportContract.js";
import { CLOUD_SEED_FORMAT, CLOUD_SEED_VERSION } from "./cloudSeed.js";
import { buildSyncRecoveryPayload } from "./syncRecovery.js";

const TABLE_QUERIES = Object.freeze([
  ["workspaces", "select id, name, default_currency, timezone, selection_status_definitions, created_at, updated_at from public.workspaces where id = $1"],
  ["products", "select id, workspace_id, name, english_title, sales_platform, publication_status, platform_skc, canonical_platform_skc, store, image_url, supplier_code, supplier_name, source_product_id, source_url, owner_id, visibility, status, currency, attributes, created_at, updated_at from public.products where workspace_id = $1 order by id"],
  ["platformSkus", "select id, workspace_id, product_id, platform_skc, canonical_platform_skc, platform_sku, canonical_platform_sku, warehouse_sku, canonical_warehouse_sku, source_sku, attribute, sale_price, image_url, status, created_at, updated_at from public.platform_skus where workspace_id = $1 order by id"],
  ["supplierOffers", "select id, workspace_id, product_id, platform_sku_id, platform_sku, canonical_platform_sku, source_sku, supplier_id, offer_key, source, source_product_id, source_url, supplier_code, supplier_name, purchase_unit_price, shipping_amount, handling_fee, purchase_pack_count, total_purchase_packs, units_per_pack, landed_unit_cost, reference_unit_cost, currency, input_snapshot, calculated_at, status, superseded_at, created_at, updated_at from public.supplier_offers where workspace_id = $1 order by created_at, id"],
  ["catalogManualCosts", "select id, workspace_id, product_id, platform_sku_id, platform_sku, canonical_platform_sku, amount, currency, kind, status, note, confirmed_by, confirmed_at, superseded_at, created_at, updated_at from public.catalog_manual_costs where workspace_id = $1 order by confirmed_at, id"],
  ["captures", "select id, workspace_id, request_id, batch_id, source, source_product_id, source_url, source_title, image_url, supplier_code, owner_id, visibility, status, draft, validation, captured_by, captured_at, updated_at from public.captures where workspace_id = $1 order by id"],
  ["ledgers", "select id, workspace_id, period, type, status, currency, warehouse_rate, summary, cost_summary, profit_summary, formula_version, finalized_at, finalized_by, created_by, created_at, updated_at from public.ledgers where workspace_id = $1 order by period, id"],
  ["importBatches", "select id, workspace_id, ledger_id, file_name, file_hash, mapping, status, store, period, source_row_count, valid_row_count, error_count, skipped_row_count, replaced_group_count, added_group_count, created_at from public.import_batches where workspace_id = $1 order by created_at, id"],
  ["salesRows", "select id, workspace_id, ledger_id, batch_id, group_key, sku_key, store, supplier_number, platform_skc, canonical_platform_skc, platform_sku, canonical_platform_sku, attribute, order_id, order_date, quantity, revenue, penalty, is_deduction, source_row, source_payload, created_at from public.sales_rows where workspace_id = $1 order by id"],
  ["erpCostRequests", "select id, workspace_id, ledger_id, platform_skcs, query_unit, status, requested_by, requested_at, created_at, updated_at from public.erp_cost_requests where workspace_id = $1 order by requested_at, id"],
  ["erpCostBatches", "select id, workspace_id, ledger_id, request_id, source_name, input_hash, status, currency, summary, source_contract, published_by, published_at, created_at, voided_at, voided_by, void_reason from public.erp_cost_batches where workspace_id = $1 order by created_at, id"],
  ["erpCostRows", "select id, workspace_id, batch_id, ledger_id, platform_sku, canonical_platform_sku, platform_skc, canonical_platform_skc, warehouse_sku, unit_cost, currency, order_number, order_type, total_quantity, total_price, selected_record_ids, evidence, published_at from public.erp_cost_rows where workspace_id = $1 order by id"],
  ["erpCostInbox", "select id, workspace_id, delivery_id, batch_id, ledger_id, request_id, status, received_via, sent_at, received_at, envelope, applied_batch_id, voided_batch_id, applied_at, rejected_at, rejected_by, voided_at, voided_by, void_reason, updated_at from public.erp_cost_inbox where workspace_id = $1 order by received_at, id"],
  ["costApprovals", "select id, workspace_id, ledger_id, platform_sku, canonical_platform_sku, reference_cost_id, approved_amount, currency, reason, approved_by, approved_at, status, reference_snapshot, revoked_at, revoked_by, revoke_reason from public.cost_approvals where workspace_id = $1 order by approved_at, id"],
  ["profitLines", "select id, workspace_id, ledger_id, platform_sku, canonical_platform_sku, platform_skc, store, attribute, quantity, revenue, penalty, formal_cost_source, formal_unit_cost, purchase_cost, warehouse_cost, profit, profit_rate, cost_batch_id, cost_approval_id, calculation_mode, formula_version, finalized_at, finalized_by from public.profit_lines where workspace_id = $1 order by id"],
  ["auditEvents", "select id, workspace_id, event_id, object_type, object_id, action, actor_id, before_snapshot, after_snapshot, content_hash, created_at, sync_version from public.audit_events where workspace_id = $1 order by created_at, id"],
]);

const SELECTION_VISIBILITY_QUERIES = Object.freeze({
  products: "select id, workspace_id, name, english_title, sales_platform, publication_status, platform_skc, canonical_platform_skc, store, image_url, supplier_code, supplier_name, source_product_id, source_url, owner_id, visibility, status, currency, attributes, created_at, updated_at from public.products where workspace_id = $1 and ($3::boolean or coalesce(visibility, 'workspace') = 'workspace' or owner_id = $2) order by id",
  platformSkus: "select s.id, s.workspace_id, s.product_id, s.platform_skc, s.canonical_platform_skc, s.platform_sku, s.canonical_platform_sku, s.warehouse_sku, s.canonical_warehouse_sku, s.source_sku, s.attribute, s.sale_price, s.image_url, s.status, s.created_at, s.updated_at from public.platform_skus s where s.workspace_id = $1 and ($3::boolean or exists (select 1 from public.products p where p.workspace_id = s.workspace_id and p.id = s.product_id and (coalesce(p.visibility, 'workspace') = 'workspace' or p.owner_id = $2))) order by s.id",
  supplierOffers: "select o.id, o.workspace_id, o.product_id, o.platform_sku_id, o.platform_sku, o.canonical_platform_sku, o.source_sku, o.supplier_id, o.offer_key, o.source, o.source_product_id, o.source_url, o.supplier_code, o.supplier_name, o.purchase_unit_price, o.shipping_amount, o.handling_fee, o.purchase_pack_count, o.total_purchase_packs, o.units_per_pack, o.landed_unit_cost, o.reference_unit_cost, o.currency, o.input_snapshot, o.calculated_at, o.status, o.superseded_at, o.created_at, o.updated_at from public.supplier_offers o where o.workspace_id = $1 and ($3::boolean or exists (select 1 from public.products p where p.workspace_id = o.workspace_id and p.id = o.product_id and (coalesce(p.visibility, 'workspace') = 'workspace' or p.owner_id = $2))) order by o.created_at, o.id",
  catalogManualCosts: "select c.id, c.workspace_id, c.product_id, c.platform_sku_id, c.platform_sku, c.canonical_platform_sku, c.amount, c.currency, c.kind, c.status, c.note, c.confirmed_by, c.confirmed_at, c.superseded_at, c.created_at, c.updated_at from public.catalog_manual_costs c where c.workspace_id = $1 and ($3::boolean or exists (select 1 from public.products p where p.workspace_id = c.workspace_id and p.id = c.product_id and (coalesce(p.visibility, 'workspace') = 'workspace' or p.owner_id = $2))) order by c.confirmed_at, c.id",
  captures: "select id, workspace_id, request_id, batch_id, source, source_product_id, source_url, source_title, image_url, supplier_code, owner_id, visibility, status, draft, validation, captured_by, captured_at, updated_at from public.captures where workspace_id = $1 and ($3::boolean or coalesce(visibility, 'workspace') = 'workspace' or owner_id = $2) order by id",
});

function recoverySelectionContext(context = {}) {
  const role = String(context.role ?? "").trim().toLowerCase();
  const actor = String(context.actor ?? "").trim();
  const canSeeAllSelection = context.canSeeAllSelection == null
    ? (!actor && !role) || ["admin", "operations", "finance"].includes(role)
    : Boolean(context.canSeeAllSelection);
  return {
    actor,
    canSeeAllSelection,
  };
}

function timestamp(value) {
  if (value == null) return value ?? null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(tableName, row) {
  const source = { ...row };
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    output[camel] = value instanceof Date ? value.toISOString() : value;
  }
  if (tableName === "workspaces") {
    output.defaultCurrency = output.defaultCurrency ?? "CNY";
    output.selectionStatusDefinitions = output.selectionStatusDefinitions ?? [];
  }
  if (tableName === "salesRows") {
    const original = output.sourcePayload && typeof output.sourcePayload === "object" ? output.sourcePayload : {};
    Object.assign(output, original, output);
    output.groupKey = output.groupKey ?? original.groupKey;
    output.skuKey = output.skuKey ?? original.skuKey;
  }
  if (tableName === "erpCostRows") {
    const original = output.evidence && typeof output.evidence === "object" ? output.evidence : {};
    output.evidence = original;
  }
  if (tableName === "costApprovals" && output.referenceSnapshot != null) {
    output.referenceCost = output.referenceSnapshot;
  }
  if (tableName === "auditEvents") {
    output.eventId = output.eventId ?? output.id;
    output.objectType = output.objectType;
    output.objectId = output.objectId;
    output.actorId = output.actorId ?? "cloud-postgres";
    output.before = output.beforeSnapshot ?? null;
    output.after = output.afterSnapshot ?? null;
    delete output.beforeSnapshot;
    delete output.afterSnapshot;
  }
  return output;
}

function currentCursor(auditEvents) {
  const versions = auditEvents.map((row) => row.syncVersion).filter((value) => value != null).map(String);
  if (versions.length > 0) return versions.at(-1);
  const created = auditEvents.map((row) => row.createdAt).filter(Boolean).map(String);
  return created.at(-1) ?? null;
}

export function buildPostgresRecoveryPlan(workspaceId, context = {}) {
  const normalizedWorkspaceId = String(workspaceId ?? "").trim();
  if (!normalizedWorkspaceId) throw new Error("恢复工作区不能为空。");
  const selectionContext = recoverySelectionContext(context);
  return {
    workspaceId: normalizedWorkspaceId,
    transaction: {
      begin: "begin isolation level repeatable read read only",
      commit: "commit",
      rollback: "rollback",
    },
    queries: TABLE_QUERIES.map(([table, baseText]) => {
      const text = selectionContext.canSeeAllSelection || !SELECTION_VISIBILITY_QUERIES[table]
        ? baseText
        : SELECTION_VISIBILITY_QUERIES[table];
      const values = selectionContext.canSeeAllSelection || !SELECTION_VISIBILITY_QUERIES[table]
        ? [normalizedWorkspaceId]
        : [normalizedWorkspaceId, selectionContext.actor || null, false];
      return { table, text, values };
    }),
  };
}

export async function loadPostgresRecovery(workspaceId, { client, context = {}, now = () => new Date().toISOString() } = {}) {
  if (!client || typeof client.query !== "function") throw new Error("PostgreSQL 客户端必须提供 query 方法。");
  const plan = buildPostgresRecoveryPlan(workspaceId, context);
  await client.query(plan.transaction.begin);
  try {
    const tables = {};
    for (const query of plan.queries) {
      const result = await client.query(query.text, query.values);
      tables[query.table] = (result?.rows ?? []).map((row) => mapRow(query.table, row));
    }
    const workspace = tables.workspaces?.[0];
    if (!workspace) {
      const error = new Error("找不到对应的工作区。");
      error.code = "WORKSPACE_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const seed = {
      format: CLOUD_SEED_FORMAT,
      formatVersion: CLOUD_SEED_VERSION,
      applicationVersion: "0.1.0",
      target: "shopeers-postgres-v1",
      workspaceId: plan.workspaceId,
      currency: "CNY",
      generatedAt: now(),
      source: { format: "postgres-recovery", formatVersion: 1, generatedAt: now(), databaseVersion: 1 },
      excludedTables: ["settings"],
      tables,
    };
    const inspection = inspectCloudSeedRelations(seed);
    seed.recordCount = inspection.recordCount;
    seed.tableCount = inspection.tableCount;
    const events = tables.auditEvents.map((row) => ({
      eventId: row.eventId,
      workspaceId: plan.workspaceId,
      objectType: row.objectType,
      objectId: row.objectId,
      action: row.action,
      actorId: row.actorId,
      createdAt: timestamp(row.createdAt),
      before: row.before,
      after: row.after,
    }));
    const recovery = buildSyncRecoveryPayload({
      workspaceId: plan.workspaceId,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        defaultCurrency: "CNY",
        timezone: workspace.timezone,
        selectionStatusDefinitions: workspace.selectionStatusDefinitions ?? [],
        createdAt: timestamp(workspace.createdAt),
        updatedAt: timestamp(workspace.updatedAt),
      },
      baseline: seed,
      events,
      cursor: currentCursor(tables.auditEvents),
      generatedAt: now(),
    });
    await client.query(plan.transaction.commit);
    return recovery;
  } catch (error) {
    try { await client.query(plan.transaction.rollback); } catch { /* preserve original failure */ }
    throw error;
  }
}

export const postgresRecoveryRepository = Object.freeze({ load: loadPostgresRecovery });
export { TABLE_QUERIES as POSTGRES_RECOVERY_TABLE_QUERIES };
