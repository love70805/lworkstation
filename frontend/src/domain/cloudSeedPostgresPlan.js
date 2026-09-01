import { inspectCloudSeedRelations } from "./cloudSeedImportContract.js";
import { isCloudRole } from "./cloudPermissions.js";
import { auditEventToSyncEvent } from "./syncEnvelope.js";
import { syncEventContentHash } from "./syncEventHash.js";

const TABLE_ORDER = Object.freeze([
  "workspaces",
  "products",
  "platformSkus",
  "supplierOffers",
  "catalogManualCosts",
  "captures",
  "ledgers",
  "importBatches",
  "salesRows",
  "erpCostRequests",
  "erpCostBatches",
  "erpCostRows",
  "erpCostInbox",
  "costApprovals",
  "profitLines",
  "auditEvents",
]);

const TABLE_COLUMNS = Object.freeze({
  workspaces: ["id", "name", "default_currency", "timezone", "selection_status_definitions", "created_at", "updated_at"],
  products: ["id", "workspace_id", "name", "english_title", "sales_platform", "publication_status", "platform_skc", "canonical_platform_skc", "store", "image_url", "supplier_code", "supplier_name", "source_product_id", "source_url", "owner_id", "visibility", "status", "currency", "attributes", "created_at", "updated_at"],
  platformSkus: ["id", "workspace_id", "product_id", "platform_skc", "canonical_platform_skc", "platform_sku", "canonical_platform_sku", "warehouse_sku", "canonical_warehouse_sku", "source_sku", "attribute", "sale_price", "image_url", "status", "created_at", "updated_at"],
  supplierOffers: ["id", "workspace_id", "product_id", "platform_sku_id", "platform_sku", "canonical_platform_sku", "source_sku", "supplier_id", "offer_key", "source", "source_product_id", "source_url", "supplier_code", "supplier_name", "purchase_unit_price", "shipping_amount", "handling_fee", "purchase_pack_count", "total_purchase_packs", "units_per_pack", "landed_unit_cost", "reference_unit_cost", "currency", "input_snapshot", "calculated_at", "status", "superseded_at", "created_at", "updated_at"],
  catalogManualCosts: ["id", "workspace_id", "product_id", "platform_sku_id", "platform_sku", "canonical_platform_sku", "amount", "currency", "kind", "status", "note", "confirmed_by", "confirmed_at", "superseded_at", "created_at", "updated_at"],
  captures: ["id", "workspace_id", "request_id", "batch_id", "source", "source_product_id", "source_url", "source_title", "image_url", "supplier_code", "owner_id", "visibility", "status", "draft", "validation", "captured_by", "captured_at", "updated_at"],
  ledgers: ["id", "workspace_id", "period", "type", "status", "currency", "warehouse_rate", "summary", "cost_summary", "profit_summary", "formula_version", "finalized_at", "finalized_by", "created_by", "created_at", "updated_at"],
  importBatches: ["id", "workspace_id", "ledger_id", "file_name", "file_hash", "mapping", "status", "store", "period", "source_row_count", "valid_row_count", "error_count", "skipped_row_count", "replaced_group_count", "added_group_count", "created_at"],
  salesRows: ["workspace_id", "ledger_id", "batch_id", "group_key", "sku_key", "store", "supplier_number", "platform_skc", "canonical_platform_skc", "platform_sku", "canonical_platform_sku", "attribute", "order_id", "order_date", "quantity", "revenue", "penalty", "is_deduction", "source_row", "source_payload", "created_at"],
  erpCostRequests: ["id", "workspace_id", "ledger_id", "platform_skcs", "query_unit", "status", "requested_by", "requested_at", "created_at", "updated_at"],
  erpCostBatches: ["id", "workspace_id", "ledger_id", "request_id", "source_name", "input_hash", "status", "currency", "summary", "source_contract", "published_by", "published_at", "created_at", "voided_at", "voided_by", "void_reason"],
  erpCostRows: ["workspace_id", "batch_id", "ledger_id", "platform_sku", "canonical_platform_sku", "platform_skc", "canonical_platform_skc", "warehouse_sku", "unit_cost", "currency", "order_number", "order_type", "total_quantity", "total_price", "selected_record_ids", "evidence", "published_at"],
  erpCostInbox: ["id", "workspace_id", "delivery_id", "batch_id", "ledger_id", "request_id", "status", "received_via", "sent_at", "received_at", "envelope", "applied_batch_id", "voided_batch_id", "applied_at", "rejected_at", "rejected_by", "voided_at", "voided_by", "void_reason", "updated_at"],
  costApprovals: ["id", "workspace_id", "ledger_id", "platform_sku", "canonical_platform_sku", "reference_cost_id", "approved_amount", "currency", "reason", "approved_by", "approved_at", "status", "reference_snapshot", "revoked_at", "revoked_by", "revoke_reason"],
  profitLines: ["workspace_id", "ledger_id", "platform_sku", "canonical_platform_sku", "platform_skc", "store", "attribute", "quantity", "revenue", "penalty", "formal_cost_source", "formal_unit_cost", "purchase_cost", "warehouse_cost", "profit", "profit_rate", "cost_batch_id", "cost_approval_id", "calculation_mode", "formula_version", "finalized_at", "finalized_by"],
  auditEvents: ["workspace_id", "event_id", "object_type", "object_id", "action", "actor_id", "before_snapshot", "after_snapshot", "content_hash", "created_at", "sync_version"],
});

function value(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return null;
}

function supplierIdentity(row = {}) {
  const explicit = String(row.supplierId ?? "").trim();
  if (explicit) return explicit;
  const natural = [row.supplierCode, row.supplierName, row.sourceProductId, row.sourceUrl]
    .map((item) => String(item ?? "").trim().toLowerCase())
    .join("\u001f");
  return `SUP-${natural || String(row.id ?? "legacy").trim() || "legacy"}`;
}

function supplierOfferKey(row = {}) {
  return String(row.offerKey ?? "").trim()
    || [String(row.productId ?? "").trim(), supplierIdentity(row), String(row.canonicalPlatformSku ?? row.platformSku ?? "").trim().toUpperCase()].join("\u001f");
}

async function rowValues(tableName, row) {
  switch (tableName) {
    case "workspaces": return [row.id, row.name, value(row, "defaultCurrency", "currency") ?? "CNY", row.timezone ?? "Asia/Shanghai", row.selectionStatusDefinitions ?? [], row.createdAt, row.updatedAt];
    case "products": return [row.id, row.workspaceId, row.name, row.englishTitle, row.salesPlatform ?? "", row.publicationStatus ?? "unpublished", row.platformSkc, row.canonicalPlatformSkc, row.store, row.imageUrl, row.supplierCode, row.supplierName, row.sourceProductId, row.sourceUrl, row.ownerId ?? row.attributes?.ownerId ?? null, row.visibility ?? row.attributes?.visibility ?? "workspace", row.status, row.currency ?? "CNY", row.attributes ?? { variants: row.variants ?? [] }, row.createdAt, row.updatedAt];
    case "platformSkus": return [row.id, row.workspaceId, row.productId, row.platformSkc, row.canonicalPlatformSkc, row.platformSku, row.canonicalPlatformSku, row.warehouseSku ?? null, row.canonicalWarehouseSku ?? null, row.sourceSku, row.attribute, row.salePrice ?? row.price ?? null, row.imageUrl ?? null, row.status, row.createdAt, row.updatedAt];
    case "supplierOffers": return [row.id, row.workspaceId, row.productId, row.platformSkuId ?? null, row.platformSku, row.canonicalPlatformSku, row.sourceSku ?? null, supplierIdentity(row), supplierOfferKey(row), row.source ?? "1688", row.sourceProductId, row.sourceUrl, row.supplierCode, row.supplierName, row.purchaseUnitPrice, row.shippingAmount ?? 0, row.handlingFee ?? 0, row.purchasePackCount, row.totalPurchasePacks, row.unitsPerPack ?? 1, row.landedUnitCost, row.referenceUnitCost, row.currency ?? "CNY", row.inputSnapshot ?? {}, row.calculatedAt, row.status ?? "active", row.supersededAt ?? null, row.createdAt, row.updatedAt];
    case "catalogManualCosts": return [row.id, row.workspaceId, row.productId, row.platformSkuId, row.platformSku, row.canonicalPlatformSku, row.amount ?? row.unitCost, row.currency ?? "CNY", row.kind ?? "manual_confirmed", row.status ?? "active", row.note ?? "", row.confirmedBy ?? "local-user", row.confirmedAt, row.supersededAt ?? null, row.createdAt ?? row.confirmedAt, row.updatedAt ?? row.confirmedAt];
    case "captures": return [row.id, row.workspaceId, row.requestId, row.batchId, row.source ?? "1688", row.sourceProductId, row.sourceUrl, row.sourceTitle, row.imageUrl, row.supplierCode, row.ownerId ?? row.draft?.ownerId ?? null, row.visibility ?? row.draft?.visibility ?? "workspace", row.status, row.draft ?? {}, row.validation ?? {}, row.capturedBy, row.capturedAt, row.updatedAt];
    case "ledgers": return [row.id, row.workspaceId, row.period, row.type ?? "monthly_profit", row.status, row.currency ?? "CNY", row.warehouseRate ?? 0.7, row.summary ?? {}, row.costSummary ?? {}, row.profitSummary ?? null, row.formulaVersion, row.finalizedAt, row.finalizedBy, row.createdBy ?? "local-user", row.createdAt, row.updatedAt];
    case "importBatches": return [row.id, row.workspaceId, row.ledgerId, row.fileName, row.fileHash, row.mapping ?? {}, row.status, row.store, row.period, row.sourceRowCount ?? 0, row.validRowCount ?? 0, row.errorCount ?? 0, row.skippedRowCount ?? 0, row.replacedGroupCount ?? 0, row.addedGroupCount ?? 0, row.createdAt];
    case "salesRows": return [row.workspaceId, row.ledgerId, row.batchId, row.groupKey, row.skuKey, row.store, row.supplierNumber, row.platformSkc, row.canonicalPlatformSkc, row.platformSku ?? row.sku, row.canonicalPlatformSku, row.attribute, row.orderId, row.orderDate || null, row.quantity ?? 0, row.revenue ?? row.amount ?? 0, row.penalty ?? row.deductionAmount ?? 0, row.isDeduction ?? false, row.sourceRow, row, row.createdAt ?? row.importedAt];
    case "erpCostRequests": return [row.id, row.workspaceId, row.ledgerId, row.platformSkcs ?? [], row.queryUnit ?? "platform_skc", row.status, row.requestedBy, row.requestedAt, row.createdAt, row.updatedAt];
    case "erpCostBatches": return [row.id, row.workspaceId, row.ledgerId, row.requestId, row.sourceName, row.inputHash, row.status, row.currency ?? "CNY", row.summary ?? {}, row.sourceContract ?? null, row.publishedBy, row.publishedAt, row.createdAt, row.voidedAt ?? null, row.voidedBy ?? null, row.voidReason ?? null];
    case "erpCostRows": return [row.workspaceId, row.batchId, row.ledgerId, row.platformSku, row.canonicalPlatformSku, row.platformSkc, row.canonicalPlatformSkc, row.warehouseSku ?? row.sourceWarehouseSku, row.unitCost, row.currency ?? "CNY", row.orderNumber, row.orderType, row.totalQuantity, row.totalPrice, row.selectedRecordIds ?? [], row.evidence ?? row, row.publishedAt];
    case "erpCostInbox": return [row.id, row.workspaceId, row.deliveryId, row.batchId, row.ledgerId, row.requestId, row.status, row.receivedVia, row.sentAt ?? null, row.receivedAt, row.envelope, row.appliedBatchId ?? null, row.voidedBatchId ?? null, row.appliedAt ?? null, row.rejectedAt ?? null, row.rejectedBy ?? null, row.voidedAt ?? null, row.voidedBy ?? null, row.voidReason ?? null, row.updatedAt ?? row.appliedAt ?? row.voidedAt ?? row.receivedAt];
    case "costApprovals": return [row.id, row.workspaceId, row.ledgerId, row.platformSku, row.canonicalPlatformSku, row.referenceCostId, row.approvedAmount ?? row.unitCost, row.currency ?? "CNY", row.reason, row.approvedBy, row.approvedAt, row.status, row.referenceSnapshot ?? row.referenceCost ?? {}, row.revokedAt, row.revokedBy, row.revokeReason];
    case "profitLines": return [row.workspaceId, row.ledgerId, row.platformSku, row.canonicalPlatformSku, row.platformSkc, row.store, row.attribute, row.quantity ?? 0, row.revenue ?? 0, row.penalty ?? 0, row.formalCostSource ?? row.costSource, row.formalUnitCost ?? row.unitCost, row.purchaseCost, row.warehouseCost, row.profit, row.profitRate, row.costBatchId, row.costApprovalId, row.calculationMode ?? "exact", row.formulaVersion, row.finalizedAt, row.finalizedBy];
    case "auditEvents": {
      const normalized = auditEventToSyncEvent({ ...row, eventId: row.eventId ?? row.id });
      return [row.workspaceId, normalized.eventId, row.objectType, row.objectId, row.action, row.actorId ?? "cloud-seed", row.before ?? null, row.after ?? null, row.contentHash ?? await syncEventContentHash(normalized), row.createdAt, row.syncVersion ?? null];
    }
    default: throw new Error(`不支持的云端种子表：${tableName}`);
  }
}

function sqlFor(tableName) {
  const columns = TABLE_COLUMNS[tableName];
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  return `insert into public.${tableName === "platformSkus" ? "platform_skus" : tableName === "supplierOffers" ? "supplier_offers" : tableName === "catalogManualCosts" ? "catalog_manual_costs" : tableName === "importBatches" ? "import_batches" : tableName === "salesRows" ? "sales_rows" : tableName === "erpCostRequests" ? "erp_cost_requests" : tableName === "erpCostBatches" ? "erp_cost_batches" : tableName === "erpCostRows" ? "erp_cost_rows" : tableName === "erpCostInbox" ? "erp_cost_inbox" : tableName === "costApprovals" ? "cost_approvals" : tableName === "profitLines" ? "profit_lines" : tableName === "auditEvents" ? "audit_events" : tableName} (${columns.join(", ")}) values (${placeholders})`;
}

export async function buildCloudSeedPostgresPlan(seed, { workspaceMember = null } = {}) {
  const inspection = inspectCloudSeedRelations(seed);
  const operations = [];
  let membershipOperation = null;
  if (workspaceMember) {
    const role = String(workspaceMember.role ?? "admin").trim().toLowerCase();
    if (!isCloudRole(role)) throw new Error(`工作区初始化成员角色无效：${workspaceMember.role}`);
    const memberColumns = ["workspace_id", "user_id", "role", "status", "created_at"];
    membershipOperation = {
      table: "workspace_members",
      text: `insert into public.workspace_members (${memberColumns.join(", ")}) values ($1, $2, $3, $4, $5) on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status`,
      values: [inspection.workspaceId, workspaceMember.userId, role, workspaceMember.status ?? "active", workspaceMember.createdAt ?? new Date().toISOString()],
    };
  }
  for (const tableName of TABLE_ORDER) {
    for (const row of seed.tables[tableName] ?? []) {
      operations.push({ table: tableName, text: sqlFor(tableName), values: await rowValues(tableName, row) });
    }
    if (tableName === "workspaces" && membershipOperation) operations.push(membershipOperation);
  }
  return {
    workspaceId: inspection.workspaceId,
    fingerprint: inspection.fingerprint,
    recordCount: inspection.recordCount,
    operations,
    businessOperationCount: operations.filter((operation) => operation.table !== "workspace_members").length,
    membershipBootstrapped: Boolean(workspaceMember),
    transaction: { begin: "begin", commit: "commit", rollback: "rollback" },
  };
}

export async function importCloudSeedWithPostgresClient(seed, { client, workspaceMember = null } = {}) {
  if (!client || typeof client.query !== "function") throw new Error("PostgreSQL 客户端必须提供 query 方法。");
  if (!workspaceMember?.userId) throw new Error("云端种子导入必须提供当前管理员 userId，以初始化工作区成员关系。");
  const plan = await buildCloudSeedPostgresPlan(seed, { workspaceMember });
  await client.query(plan.transaction.begin);
  try {
    for (const operation of plan.operations) await client.query(operation.text, operation.values);
    await client.query(plan.transaction.commit);
    return { workspaceId: plan.workspaceId, fingerprint: plan.fingerprint, insertedCount: plan.businessOperationCount, membershipBootstrapped: plan.membershipBootstrapped, transaction: "committed" };
  } catch (error) {
    try { await client.query(plan.transaction.rollback); } catch { /* preserve original failure */ }
    throw error;
  }
}

export { TABLE_ORDER as CLOUD_SEED_POSTGRES_TABLE_ORDER, TABLE_COLUMNS as CLOUD_SEED_POSTGRES_COLUMNS };
