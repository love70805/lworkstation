import {
  buildSyncEnvelope,
  SYNC_ACK_FORMAT,
  SYNC_ACK_VERSION,
  SYNC_EVENT_MAX_BATCH,
  validateSyncEnvelope,
} from "./syncEnvelope.js";
import { projectSyncEvent } from "./syncBusinessProjection.js";
import { SyncContractError } from "./syncServerContract.js";
import { syncEventContentHash } from "./syncEventHash.js";
import { normalizeErpVoidLifecycleSequence } from "./syncLifecycleGroup.js";

const TABLES = Object.freeze({
  workspace: "workspaces",
  capture: "captures",
  product: "products",
  catalogManualCost: "catalog_manual_costs",
  ledger: "ledgers",
  importBatch: "import_batches",
  erpRequest: "erp_cost_requests",
  erpBatch: "erp_cost_batches",
  approval: "cost_approvals",
});

function value(row, ...keys) {
  for (const key of keys) if (row?.[key] !== undefined) return row[key];
  return null;
}

function assertWorkspace(row, workspaceId, label) {
  const rowWorkspaceId = String(row?.workspaceId ?? workspaceId);
  if (rowWorkspaceId !== workspaceId) {
    throw new SyncContractError(`${label}不能写入其他工作区。`, { code: "WORKSPACE_MISMATCH", status: 409 });
  }
  return { ...row, workspaceId };
}

function assertEntityId(row, expectedId, label) {
  if (String(row?.id ?? "") !== String(expectedId)) {
    throw new SyncContractError(`${label}快照 ID 与事件对象不一致。`, { code: "ENTITY_ID_MISMATCH", status: 409 });
  }
}

function supplierIdentity(row = {}) {
  const explicit = String(row.supplierId ?? "").trim();
  if (explicit) return explicit;
  const natural = [row.supplierCode, row.supplierName, row.sourceProductId, row.sourceUrl]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("\u001f");
  return `SUP-${natural || String(row.id ?? "legacy").trim() || "legacy"}`;
}

function supplierOfferKey(row = {}, productId) {
  return String(row.offerKey ?? "").trim()
    || [String(productId ?? "").trim(), supplierIdentity(row), String(row.canonicalPlatformSku ?? row.platformSku ?? "").trim().toUpperCase()].join("\u001f");
}

function insertOrUpdate({ table, columns, values, updates, eventId }) {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const assignments = updates.map((column) => `${column} = excluded.${column}`).join(", ");
  return {
    eventId,
    table,
    text: `insert into public.${table} (${columns.join(", ")}) values (${placeholders}) on conflict (id) do update set ${assignments} where public.${table}.workspace_id = excluded.workspace_id`,
    values,
  };
}

function insertOnly({ table, columns, values, eventId }) {
  return {
    eventId,
    table,
    text: `insert into public.${table} (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    values,
  };
}

function bulkInsert({ table, columns, rows, eventId }) {
  if (rows.length === 0) return null;
  const declaration = columns.map(([name, type]) => `${name} ${type}`).join(", ");
  const names = columns.map(([name]) => name);
  return {
    eventId,
    table,
    text: `insert into public.${table} (${names.join(", ")}) select ${names.map((name) => `x.${name}`).join(", ")} from jsonb_to_recordset($2::jsonb) as x(${declaration}) where x.workspace_id = $1`,
    values: [rows[0].workspace_id, JSON.stringify(rows)],
    rowCount: rows.length,
  };
}

function ledgerRow(row, workspaceId) {
  const ledger = assertWorkspace(row, workspaceId, "月度账本");
  return {
    columns: ["id", "workspace_id", "period", "type", "status", "currency", "warehouse_rate", "summary", "cost_summary", "profit_summary", "formula_version", "finalized_at", "finalized_by", "created_by", "created_at", "updated_at"],
    values: [ledger.id, workspaceId, ledger.period, ledger.type ?? "monthly_profit", ledger.status ?? "draft", ledger.currency ?? "CNY", ledger.warehouseRate ?? 0.7, ledger.summary ?? {}, ledger.costSummary ?? {}, ledger.profitSummary ?? null, ledger.formulaVersion ?? null, ledger.finalizedAt ?? null, ledger.finalizedBy ?? null, ledger.createdBy ?? "local-user", ledger.createdAt, ledger.updatedAt ?? ledger.createdAt],
  };
}

function ledgerUpsert(row, workspaceId, eventId) {
  const mapped = ledgerRow(row, workspaceId);
  return insertOrUpdate({
    table: TABLES.ledger,
    columns: mapped.columns,
    values: mapped.values,
    updates: mapped.columns.slice(2).filter((column) => !["created_by", "created_at"].includes(column)),
    eventId,
  });
}

function workspacePlan(snapshot, workspaceId, eventId, entityId) {
  const workspace = assertWorkspace(snapshot, workspaceId, "工作区配置");
  assertEntityId(workspace, entityId, "工作区配置");
  const columns = ["id", "name", "default_currency", "timezone", "selection_status_definitions", "created_at", "updated_at"];
  return [insertOrUpdate({
    table: TABLES.workspace,
    columns,
    values: [
      workspace.id,
      workspace.name ?? workspaceId,
      workspace.defaultCurrency ?? "CNY",
      workspace.timezone ?? "Asia/Shanghai",
      workspace.selectionStatusDefinitions ?? [],
      workspace.createdAt,
      workspace.updatedAt ?? workspace.createdAt,
    ],
    updates: ["name", "default_currency", "timezone", "selection_status_definitions", "updated_at"],
    eventId,
  })];
}

function capturePlan(snapshot, workspaceId, eventId, entityId) {
  const row = assertWorkspace(snapshot, workspaceId, "采集记录");
  assertEntityId(row, entityId, "采集记录");
  const columns = ["id", "workspace_id", "request_id", "batch_id", "source", "source_product_id", "source_url", "source_title", "image_url", "supplier_code", "owner_id", "visibility", "status", "draft", "validation", "captured_by", "captured_at", "updated_at"];
  return [insertOrUpdate({
    table: TABLES.capture,
    columns,
    values: [row.id, workspaceId, row.requestId, row.batchId, row.source ?? "1688", row.sourceProductId, row.sourceUrl, row.sourceTitle, row.imageUrl, row.supplierCode, row.ownerId ?? row.draft?.ownerId ?? null, row.visibility ?? row.draft?.visibility ?? "workspace", row.status, row.draft ?? {}, row.validation ?? {}, row.capturedBy ?? "local-user", row.capturedAt, row.updatedAt ?? row.capturedAt],
    updates: columns.slice(2),
    eventId,
  })];
}

const PLATFORM_SKU_COLUMNS = [
  ["id", "text"], ["workspace_id", "text"], ["product_id", "text"], ["platform_skc", "text"],
  ["canonical_platform_skc", "text"], ["platform_sku", "text"], ["canonical_platform_sku", "text"],
  ["warehouse_sku", "text"], ["canonical_warehouse_sku", "text"], ["source_sku", "text"], ["attribute", "text"], ["sale_price", "numeric"], ["image_url", "text"], ["status", "text"], ["created_at", "timestamptz"], ["updated_at", "timestamptz"],
];

const SUPPLIER_OFFER_COLUMNS = [
  ["id", "text"], ["workspace_id", "text"], ["product_id", "text"], ["platform_sku_id", "text"],
  ["platform_sku", "text"], ["canonical_platform_sku", "text"], ["source_sku", "text"], ["supplier_id", "text"], ["offer_key", "text"], ["source", "text"], ["source_product_id", "text"],
  ["source_url", "text"], ["supplier_code", "text"], ["supplier_name", "text"], ["purchase_unit_price", "numeric"],
  ["shipping_amount", "numeric"], ["handling_fee", "numeric"], ["purchase_pack_count", "numeric"],
  ["total_purchase_packs", "numeric"], ["units_per_pack", "numeric"], ["landed_unit_cost", "numeric"],
  ["reference_unit_cost", "numeric"], ["currency", "char(3)"], ["input_snapshot", "jsonb"],
  ["calculated_at", "timestamptz"], ["status", "text"], ["superseded_at", "timestamptz"], ["created_at", "timestamptz"], ["updated_at", "timestamptz"],
];

function productPlan(snapshot, workspaceId, eventId, entityId) {
  const product = assertWorkspace(snapshot.product, workspaceId, "商品");
  assertEntityId(product, entityId, "商品");
  const platformSkus = (snapshot.platformSkus ?? []).map((row) => assertWorkspace(row, workspaceId, "平台 SKU"));
  const supplierOffers = (snapshot.supplierOffers ?? []).map((row) => assertWorkspace(row, workspaceId, "供应商报价"));
  const productColumns = ["id", "workspace_id", "name", "english_title", "sales_platform", "publication_status", "platform_skc", "canonical_platform_skc", "store", "image_url", "supplier_code", "supplier_name", "source_product_id", "source_url", "owner_id", "visibility", "status", "currency", "attributes", "created_at", "updated_at"];
  const attributes = {
    ...(product.attributes ?? {}),
    variants: product.variants ?? product.attributes?.variants ?? [],
    packageWeight: product.packageWeight ?? null,
    sourceCaptureId: product.sourceCaptureId ?? null,
    skuCount: product.skuCount ?? platformSkus.length,
    referenceCost: product.referenceCost ?? null,
    salesStatus: product.salesStatus ?? "pending_review",
    salesPlatform: product.salesPlatform ?? "",
    publicationStatus: product.publicationStatus ?? "unpublished",
    tags: Array.isArray(product.tags) ? product.tags : [],
    notes: product.notes ?? "",
    ownerId: product.ownerId ?? null,
    visibility: product.visibility ?? "workspace",
  };
  const operations = [insertOrUpdate({
    table: TABLES.product,
    columns: productColumns,
    values: [product.id, workspaceId, product.name, product.englishTitle, product.salesPlatform ?? attributes.salesPlatform ?? "", product.publicationStatus ?? attributes.publicationStatus ?? "unpublished", product.platformSkc, product.canonicalPlatformSkc, product.store, product.imageUrl, product.supplierCode, product.supplierName, product.sourceProductId, product.sourceUrl, product.ownerId ?? attributes.ownerId ?? null, product.visibility ?? attributes.visibility ?? "workspace", product.status ?? "draft", product.currency ?? "CNY", attributes, product.createdAt, product.updatedAt ?? product.createdAt],
    updates: productColumns.slice(2).filter((column) => column !== "created_at"),
    eventId,
  }), {
    eventId,
    table: "supplier_offers",
    text: "delete from public.supplier_offers where workspace_id = $1 and product_id = $2",
    values: [workspaceId, product.id],
  }, {
    eventId,
    table: "platform_skus",
    text: "delete from public.platform_skus where workspace_id = $1 and product_id = $2",
    values: [workspaceId, product.id],
  }];
  const skuRows = platformSkus.map((row) => ({
    id: row.id, workspace_id: workspaceId, product_id: product.id, platform_skc: row.platformSkc ?? product.platformSkc,
    canonical_platform_skc: row.canonicalPlatformSkc ?? product.canonicalPlatformSkc, platform_sku: row.platformSku,
    canonical_platform_sku: row.canonicalPlatformSku, warehouse_sku: row.warehouseSku ?? null,
    canonical_warehouse_sku: row.canonicalWarehouseSku ?? null, source_sku: row.sourceSku ?? null, attribute: row.attribute ?? null,
    sale_price: row.salePrice ?? row.price ?? null,
    image_url: row.imageUrl ?? null,
    status: row.status ?? product.status ?? "draft", created_at: row.createdAt ?? product.createdAt, updated_at: row.updatedAt ?? product.updatedAt,
  }));
  const offerRows = supplierOffers.map((row) => ({
    id: row.id, workspace_id: workspaceId, product_id: product.id, platform_sku_id: row.platformSkuId ?? null,
    platform_sku: row.platformSku, canonical_platform_sku: row.canonicalPlatformSku, source_sku: row.sourceSku ?? null,
    supplier_id: supplierIdentity(row), offer_key: supplierOfferKey(row, product.id), source: row.source ?? "1688",
    source_product_id: row.sourceProductId ?? product.sourceProductId, source_url: row.sourceUrl ?? product.sourceUrl,
    supplier_code: row.supplierCode ?? product.supplierCode, supplier_name: row.supplierName ?? product.supplierName,
    purchase_unit_price: row.purchaseUnitPrice ?? null, shipping_amount: row.shippingAmount ?? 0, handling_fee: row.handlingFee ?? 0,
    purchase_pack_count: row.purchasePackCount ?? null, total_purchase_packs: row.totalPurchasePacks ?? null,
    units_per_pack: row.unitsPerPack ?? 1, landed_unit_cost: row.landedUnitCost ?? null,
    reference_unit_cost: row.referenceUnitCost ?? row.landedUnitCost ?? null, currency: row.currency ?? "CNY",
    input_snapshot: row.inputSnapshot ?? {}, calculated_at: row.calculatedAt ?? null,
    status: row.status ?? "active", superseded_at: row.supersededAt ?? null,
    created_at: row.createdAt ?? product.createdAt, updated_at: row.updatedAt ?? product.updatedAt,
  }));
  const skuInsert = bulkInsert({ table: "platform_skus", columns: PLATFORM_SKU_COLUMNS, rows: skuRows, eventId });
  const offerInsert = bulkInsert({ table: "supplier_offers", columns: SUPPLIER_OFFER_COLUMNS, rows: offerRows, eventId });
  if (skuInsert) operations.push(skuInsert);
  if (offerInsert) operations.push(offerInsert);
  return operations;
}

function catalogManualCostPlan(snapshot, workspaceId, eventId, entityId) {
  const cost = assertWorkspace(snapshot.catalogManualCost ?? snapshot, workspaceId, "人工确认成本");
  assertEntityId(cost, entityId, "人工确认成本");
  const columns = ["id", "workspace_id", "product_id", "platform_sku_id", "platform_sku", "canonical_platform_sku", "amount", "currency", "kind", "status", "note", "confirmed_by", "confirmed_at", "superseded_at", "created_at", "updated_at"];
  const values = [
    cost.id, workspaceId, cost.productId, cost.platformSkuId, cost.platformSku, cost.canonicalPlatformSku,
    cost.amount ?? cost.unitCost, cost.currency ?? "CNY", cost.kind ?? "manual_confirmed", cost.status ?? "active",
    cost.note ?? "", cost.confirmedBy ?? "local-user", cost.confirmedAt, cost.supersededAt ?? null,
    cost.createdAt ?? cost.confirmedAt, cost.updatedAt ?? cost.confirmedAt,
  ];
  return [{
    eventId,
    table: TABLES.catalogManualCost,
    text: "update public.catalog_manual_costs set status = 'superseded', superseded_at = $4, updated_at = $4 where workspace_id = $1 and product_id = $2 and canonical_platform_sku = $3 and status = 'active' and id <> $5",
    values: [workspaceId, cost.productId, cost.canonicalPlatformSku, cost.confirmedAt ?? cost.updatedAt ?? cost.createdAt, cost.id],
  }, insertOrUpdate({
    table: TABLES.catalogManualCost,
    columns,
    values,
    updates: columns.slice(2).filter((column) => column !== "created_at"),
    eventId,
  })];
}

const SALES_ROW_COLUMNS = [
  ["workspace_id", "text"], ["ledger_id", "text"], ["batch_id", "text"], ["group_key", "text"], ["sku_key", "text"],
  ["store", "text"], ["supplier_number", "text"], ["platform_skc", "text"], ["canonical_platform_skc", "text"],
  ["platform_sku", "text"], ["canonical_platform_sku", "text"], ["attribute", "text"], ["order_id", "text"],
  ["order_date", "date"], ["quantity", "numeric"], ["revenue", "numeric"], ["penalty", "numeric"],
  ["is_deduction", "boolean"], ["source_row", "integer"], ["source_payload", "jsonb"], ["created_at", "timestamptz"],
];

function salesImportPlan(snapshot, workspaceId, eventId, entityId) {
  const batch = assertWorkspace(snapshot.importBatch ?? snapshot, workspaceId, "销售导入批次");
  assertEntityId(batch, entityId, "销售导入批次");
  const ledger = assertWorkspace(snapshot.ledger, workspaceId, "月度账本");
  const rows = (snapshot.salesRows ?? []).map((row) => assertWorkspace(row, workspaceId, "销售明细"));
  const batchColumns = ["id", "workspace_id", "ledger_id", "file_name", "file_hash", "mapping", "status", "store", "period", "source_row_count", "valid_row_count", "error_count", "skipped_row_count", "replaced_group_count", "added_group_count", "created_at"];
  const operations = [ledgerUpsert(ledger, workspaceId, eventId), insertOrUpdate({
    table: TABLES.importBatch,
    columns: batchColumns,
    values: [batch.id, workspaceId, batch.ledgerId, batch.fileName, batch.fileHash, batch.mapping ?? {}, batch.status ?? "completed", batch.store, batch.period, batch.sourceRowCount ?? 0, batch.validRowCount ?? rows.length, batch.errorCount ?? 0, batch.skippedRowCount ?? 0, batch.replacedGroupCount ?? 0, batch.addedGroupCount ?? 0, batch.createdAt],
    updates: batchColumns.slice(2),
    eventId,
  })];
  const groupKeys = [...new Set(rows.map((row) => String(row.groupKey ?? "").trim()).filter(Boolean))];
  if (rows.length > 0 && groupKeys.length !== new Set(rows.map((row) => String(row.groupKey ?? "").trim())).size) {
    throw new SyncContractError("销售导入快照存在空分组键。", { code: "INVALID_SALES_GROUP", status: 409, eventIds: [eventId] });
  }
  if (groupKeys.length > 0) operations.push({
    eventId,
    table: "sales_rows",
    text: "delete from public.sales_rows where workspace_id = $1 and ledger_id = $2 and group_key = any($3::text[])",
    values: [workspaceId, batch.ledgerId, groupKeys],
  });
  const persistedRows = rows.map((row) => ({
    workspace_id: workspaceId, ledger_id: batch.ledgerId, batch_id: batch.id, group_key: row.groupKey, sku_key: row.skuKey ?? null,
    store: row.store, supplier_number: row.supplierNumber ?? null, platform_skc: row.platformSkc ?? null,
    canonical_platform_skc: row.canonicalPlatformSkc ?? null, platform_sku: row.platformSku ?? row.sku,
    canonical_platform_sku: row.canonicalPlatformSku, attribute: row.attribute ?? null, order_id: row.orderId ?? null,
    order_date: row.orderDate || null, quantity: row.quantity ?? 0, revenue: row.revenue ?? row.amount ?? 0,
    penalty: row.penalty ?? row.deductionAmount ?? 0, is_deduction: row.isDeduction ?? false, source_row: row.sourceRow ?? null,
    source_payload: row, created_at: row.createdAt ?? row.importedAt ?? batch.createdAt,
  }));
  const insert = bulkInsert({ table: "sales_rows", columns: SALES_ROW_COLUMNS, rows: persistedRows, eventId });
  if (insert) operations.push(insert);
  return operations;
}

const ERP_ROW_COLUMNS = [
  ["workspace_id", "text"], ["batch_id", "text"], ["ledger_id", "text"], ["platform_sku", "text"],
  ["canonical_platform_sku", "text"], ["platform_skc", "text"], ["canonical_platform_skc", "text"],
  ["warehouse_sku", "text"], ["unit_cost", "numeric"], ["currency", "char(3)"], ["order_number", "text"],
  ["order_type", "text"], ["total_quantity", "numeric"], ["total_price", "numeric"],
  ["selected_record_ids", "jsonb"], ["evidence", "jsonb"], ["published_at", "timestamptz"],
];

function erpBatchPlan(snapshot, workspaceId, eventId, entityId) {
  const batch = assertWorkspace(snapshot.costBatch ?? snapshot, workspaceId, "ERP 成本批次");
  assertEntityId(batch, entityId, "ERP 成本批次");
  const ledger = assertWorkspace(snapshot.ledger, workspaceId, "月度账本");
  const rows = (snapshot.rows ?? []).map((row) => assertWorkspace(row, workspaceId, "ERP 成本明细"));
  const batchColumns = ["id", "workspace_id", "ledger_id", "request_id", "source_name", "input_hash", "status", "currency", "summary", "source_contract", "published_by", "published_at", "created_at"];
  const operations = [ledgerUpsert(ledger, workspaceId, eventId), insertOnly({
    table: TABLES.erpBatch,
    columns: batchColumns,
    values: [batch.id, workspaceId, batch.ledgerId, batch.requestId, batch.sourceName, batch.inputHash, batch.status ?? "published", batch.currency ?? "CNY", batch.summary ?? {}, batch.sourceContract ?? null, batch.publishedBy, batch.publishedAt, batch.createdAt ?? batch.publishedAt],
    eventId,
  })];
  const insert = bulkInsert({
    table: "erp_cost_rows",
    columns: ERP_ROW_COLUMNS,
    rows: rows.map((row) => ({
      workspace_id: workspaceId, batch_id: batch.id, ledger_id: batch.ledgerId, platform_sku: row.platformSku,
      canonical_platform_sku: row.canonicalPlatformSku, platform_skc: row.platformSkc ?? null,
      canonical_platform_skc: row.canonicalPlatformSkc ?? null, warehouse_sku: row.warehouseSku ?? row.sourceWarehouseSku ?? null,
      unit_cost: row.unitCost, currency: row.currency ?? "CNY", order_number: row.orderNumber ?? null,
      order_type: row.orderType ?? null, total_quantity: row.totalQuantity ?? null, total_price: row.totalPrice ?? null,
      selected_record_ids: row.selectedRecordIds ?? [], evidence: row.evidence ?? row, published_at: row.publishedAt ?? batch.publishedAt,
    })),
    eventId,
  });
  if (insert) operations.push(insert);
  operations.push(erpInboxInsert(snapshot.inbox, workspaceId, eventId, batch.id, "applied"));
  return operations;
}

const ERP_INBOX_COLUMNS = [
  "id", "workspace_id", "delivery_id", "batch_id", "ledger_id", "request_id", "status", "received_via",
  "sent_at", "received_at", "envelope", "applied_batch_id", "voided_batch_id", "applied_at", "rejected_at", "rejected_by",
  "voided_at", "voided_by", "void_reason", "updated_at",
];

function erpInboxInsert(rawInbox, workspaceId, eventId, appliedBatchId, expectedStatus) {
  const inbox = assertWorkspace(rawInbox, workspaceId, "ERP 收件生命周期");
  if (!inbox?.id || !inbox.deliveryId || !inbox.batchId || !inbox.ledgerId || !inbox.envelope) {
    throw new SyncContractError("ERP 正式成本事件缺少完整收件生命周期快照。", {
      code: "INCOMPLETE_ERP_LIFECYCLE", status: 409, eventIds: [eventId],
    });
  }
  if (String(inbox.status ?? "") !== expectedStatus || String(inbox.appliedBatchId ?? "") !== String(appliedBatchId)) {
    throw new SyncContractError("ERP 收件生命周期状态与正式成本批次不一致。", {
      code: "INVALID_ERP_LIFECYCLE", status: 409, eventIds: [eventId],
    });
  }
  if (expectedStatus === "applied" && !inbox.appliedAt) {
    throw new SyncContractError("ERP 正式成本收件生命周期缺少 appliedAt。", {
      code: "INVALID_ERP_LIFECYCLE", status: 409, eventIds: [eventId],
    });
  }
  if (expectedStatus === "voided" && String(inbox.voidedBatchId ?? "") !== String(appliedBatchId)) {
    throw new SyncContractError("ERP 作废收件生命周期缺少一致的 voidedBatchId。", {
      code: "INVALID_ERP_LIFECYCLE", status: 409, eventIds: [eventId],
    });
  }
  return insertOnly({
    table: "erp_cost_inbox",
    columns: ERP_INBOX_COLUMNS,
    values: [
      inbox.id, workspaceId, inbox.deliveryId, inbox.batchId, inbox.ledgerId, inbox.requestId ?? null,
      inbox.status, inbox.receivedVia, inbox.sentAt ?? null, inbox.receivedAt, inbox.envelope,
      inbox.appliedBatchId, inbox.voidedBatchId ?? null, inbox.appliedAt ?? null, inbox.rejectedAt ?? null, inbox.rejectedBy ?? null,
      inbox.voidedAt ?? null, inbox.voidedBy ?? null, inbox.voidReason ?? null,
      inbox.updatedAt ?? inbox.appliedAt ?? inbox.voidedAt ?? inbox.receivedAt,
    ],
    eventId,
  });
}

function requiredVoidMetadata(batch, inbox, eventId) {
  const batchMetadata = {
    voidedAt: String(batch?.voidedAt ?? "").trim(),
    voidedBy: String(batch?.voidedBy ?? "").trim(),
    voidReason: String(batch?.voidReason ?? "").trim(),
  };
  const inboxMetadata = {
    voidedAt: String(inbox?.voidedAt ?? "").trim(),
    voidedBy: String(inbox?.voidedBy ?? "").trim(),
    voidReason: String(inbox?.voidReason ?? "").trim(),
  };
  if ([...Object.values(batchMetadata), ...Object.values(inboxMetadata)].some((value) => !value)) {
    throw new SyncContractError("ERP 正式成本作废必须保留时间、操作者和原因。", {
      code: "VOID_METADATA_REQUIRED", status: 409, eventIds: [eventId],
    });
  }
  for (const [label, field] of [["时间", "voidedAt"], ["操作者", "voidedBy"], ["原因", "voidReason"]]) {
    if (batchMetadata[field] !== inboxMetadata[field]) {
      throw new SyncContractError(`ERP 正式成本批次与收件记录的作废${label}不一致。`, {
        code: "INVALID_ERP_LIFECYCLE", status: 409, eventIds: [eventId],
      });
    }
  }
  return batchMetadata;
}

function voidedErpBatchPlan(snapshot, workspaceId, eventId, entityId) {
  const batch = assertWorkspace(snapshot.costBatch, workspaceId, "作废 ERP 成本批次");
  assertEntityId(batch, entityId, "作废 ERP 成本批次");
  if (String(batch.status ?? "") !== "voided") {
    throw new SyncContractError("ERP 作废事件的成本批次快照必须处于 voided 状态。", {
      code: "INVALID_ERP_LIFECYCLE", status: 409, eventIds: [eventId],
    });
  }
  const ledger = assertWorkspace(snapshot.ledger, workspaceId, "月度账本");
  assertEntityId(ledger, batch.ledgerId, "作废 ERP 成本对应账本");
  const inbox = assertWorkspace(snapshot.inbox, workspaceId, "ERP 收件生命周期");
  if (!inbox?.id || String(inbox.status ?? "") !== "voided"
    || String(inbox.appliedBatchId ?? "") !== String(batch.id)
    || String(inbox.voidedBatchId ?? "") !== String(batch.id)
    || String(inbox.ledgerId ?? "") !== String(batch.ledgerId)) {
    throw new SyncContractError("ERP 作废收件生命周期与正式成本批次不一致。", {
      code: "INVALID_ERP_LIFECYCLE", status: 409, eventIds: [eventId],
    });
  }
  const metadata = requiredVoidMetadata(batch, inbox, eventId);
  const allowFinalizedReopen = false;
  return [{
    eventId,
    table: TABLES.erpBatch,
    kind: "void_guard",
    allowFinalizedReopen,
    expectedLedgerId: ledger.id,
    expectedInboxId: inbox.id,
    text: `select b.status as batch_status, b.ledger_id, l.status as ledger_status,
      i.id as inbox_id, i.status as inbox_status, i.ledger_id as inbox_ledger_id,
      i.applied_batch_id, i.voided_batch_id,
      (select count(*) from public.erp_cost_inbox linked where linked.workspace_id = b.workspace_id and linked.applied_batch_id = b.id) as linked_inbox_count
      from public.erp_cost_batches b
      join public.ledgers l on l.workspace_id = b.workspace_id and l.id = b.ledger_id
      join public.erp_cost_inbox i on i.workspace_id = b.workspace_id and i.id = $3
      where b.workspace_id = $1 and b.id = $2
      for update of b, l, i`,
    values: [workspaceId, batch.id, inbox.id],
  }, {
    eventId,
    table: TABLES.erpBatch,
    kind: "void_transition",
    text: "select * from public.void_erp_cost_batch($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)",
    values: [
      workspaceId, batch.id, inbox.id, ledger.id, ledger.status,
      ledger.summary ?? {}, ledger.costSummary ?? {}, ledger.updatedAt ?? metadata.voidedAt,
      metadata.voidedAt, metadata.voidedBy, metadata.voidReason, allowFinalizedReopen,
    ],
  }];
}

function erpRequestPlan(snapshot, workspaceId, eventId, entityId) {
  const row = assertWorkspace(snapshot, workspaceId, "ERP 成本请求");
  assertEntityId(row, entityId, "ERP 成本请求");
  const columns = ["id", "workspace_id", "ledger_id", "platform_skcs", "query_unit", "status", "requested_by", "requested_at", "created_at", "updated_at"];
  return [insertOrUpdate({
    table: TABLES.erpRequest,
    columns,
    values: [row.id, workspaceId, row.ledgerId ?? null, row.platformSkcs ?? [], row.queryUnit ?? "platform_skc", row.status ?? "copied", row.requestedBy ?? "local-user", row.requestedAt, row.createdAt ?? row.requestedAt, row.updatedAt ?? row.requestedAt],
    updates: columns.slice(2),
    eventId,
  })];
}

function approvalPlan(snapshot, workspaceId, eventId, entityId) {
  const approval = assertWorkspace(snapshot, workspaceId, "1688 成本审批");
  assertEntityId(approval, entityId, "1688 成本审批");
  const columns = ["id", "workspace_id", "ledger_id", "platform_sku", "canonical_platform_sku", "reference_cost_id", "approved_amount", "currency", "reason", "approved_by", "approved_at", "status", "reference_snapshot", "revoked_at", "revoked_by", "revoke_reason"];
  const operations = [insertOrUpdate({
    table: TABLES.approval,
    columns,
    values: [approval.id, workspaceId, approval.ledgerId, approval.platformSku, approval.canonicalPlatformSku, approval.referenceCostId, approval.approvedAmount ?? approval.unitCost, approval.currency ?? "CNY", approval.reason, approval.approvedBy, approval.approvedAt, approval.status, approval.referenceSnapshot ?? approval.referenceCost ?? {}, approval.revokedAt ?? null, approval.revokedBy ?? null, approval.revokeReason ?? null],
    updates: ["status", "revoked_at", "revoked_by", "revoke_reason"],
    eventId,
  })];
  if (snapshot.ledger) operations.push(ledgerUpsert(snapshot.ledger, workspaceId, eventId));
  return operations;
}

const PROFIT_ROW_COLUMNS = [
  ["workspace_id", "text"], ["ledger_id", "text"], ["platform_sku", "text"], ["canonical_platform_sku", "text"],
  ["platform_skc", "text"], ["store", "text"], ["attribute", "text"], ["quantity", "numeric"], ["revenue", "numeric"],
  ["penalty", "numeric"], ["formal_cost_source", "text"], ["formal_unit_cost", "numeric"], ["purchase_cost", "numeric"],
  ["warehouse_cost", "numeric"], ["profit", "numeric"], ["profit_rate", "numeric"], ["cost_batch_id", "text"],
  ["cost_approval_id", "text"], ["calculation_mode", "text"], ["formula_version", "text"],
  ["finalized_at", "timestamptz"], ["finalized_by", "text"],
];

function finalizedLedgerPlan(snapshot, workspaceId, eventId, entityId) {
  const ledger = assertWorkspace(snapshot, workspaceId, "定稿账本");
  assertEntityId(ledger, entityId, "定稿账本");
  const profitLines = (snapshot.profitLines ?? []).map((row) => assertWorkspace(row, workspaceId, "利润明细"));
  const insert = bulkInsert({
    table: "profit_lines",
    columns: PROFIT_ROW_COLUMNS,
    rows: profitLines.map((row) => ({
      workspace_id: workspaceId, ledger_id: ledger.id, platform_sku: row.platformSku,
      canonical_platform_sku: row.canonicalPlatformSku, platform_skc: row.platformSkc ?? null, store: row.store,
      attribute: row.attribute ?? null, quantity: row.quantity ?? 0, revenue: row.revenue ?? 0, penalty: row.penalty ?? 0,
      formal_cost_source: row.formalCostSource ?? row.costSource, formal_unit_cost: row.formalUnitCost ?? row.unitCost,
      purchase_cost: row.purchaseCost, warehouse_cost: row.warehouseCost, profit: row.profit, profit_rate: row.profitRate ?? null,
      cost_batch_id: row.costBatchId ?? null, cost_approval_id: row.costApprovalId ?? null,
      calculation_mode: row.calculationMode ?? "exact", formula_version: row.formulaVersion ?? ledger.formulaVersion,
      finalized_at: row.finalizedAt ?? ledger.finalizedAt, finalized_by: row.finalizedBy ?? ledger.finalizedBy,
    })),
    eventId,
  });
  return [
    { eventId, table: "ledgers", kind: "finalize_guard", text: "select status from public.ledgers where workspace_id = $1 and id = $2 for update", values: [workspaceId, ledger.id] },
    ...(insert ? [insert] : []),
    ledgerUpsert(ledger, workspaceId, eventId),
  ];
}

function reopenedLedgerPlan(snapshot, workspaceId, eventId, entityId, event) {
  const ledger = assertWorkspace(snapshot, workspaceId, "重新打开的月度账本");
  assertEntityId(ledger, entityId, "重新打开的月度账本");
  const reason = String(event?.after?.reason ?? event?.before?.reason ?? "").trim();
  if (!reason) {
    throw new SyncContractError("重新打开定稿账本必须保留原因。", {
      code: "REOPEN_REASON_REQUIRED", status: 409, eventIds: [eventId],
    });
  }
  return [{
    eventId,
    table: "ledgers",
    kind: "reopen_finalized_ledger",
    text: "select public.reopen_ledger_for_cost_recalculation($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)",
    values: [workspaceId, entityId, ledger.status, ledger.summary ?? {}, ledger.costSummary ?? {}, ledger.updatedAt, reason],
  }];
}

function businessOperations(projection, workspaceId) {
  if (projection.kind === "audit_only") return [];
  if (!projection.complete) {
    throw new SyncContractError(`同步事件 ${projection.event.eventId} 缺少完整业务快照。`, {
      code: "INCOMPLETE_EVENT_SNAPSHOT", status: 409, eventIds: [projection.event.eventId],
    });
  }
  const { entityType, snapshot, entityId, event } = projection;
  if (entityType === "workspace") return workspacePlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "capture") return capturePlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "product" && projection.operation === "delete") return [{
    eventId: event.eventId,
    table: "products",
    text: "delete from public.products where workspace_id = $1 and id = $2",
    values: [workspaceId, entityId],
  }];
  if (entityType === "product") return productPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "catalog_manual_cost") return catalogManualCostPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "sales_import_batch") return salesImportPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "erp_cost_batch" && event.action === "voided") return voidedErpBatchPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "erp_cost_batch") return erpBatchPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "erp_cost_request") return erpRequestPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "cost_approval") return approvalPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "monthly_ledger" && projection.operation === "delete") return [{
    eventId: event.eventId,
    table: "ledgers",
    kind: "delete_guard",
    text: "select l.status, (exists (select 1 from public.erp_cost_batches b where b.workspace_id = l.workspace_id and b.ledger_id = l.id and b.status in ('published', 'voided')) or exists (select 1 from public.erp_cost_inbox i where i.workspace_id = l.workspace_id and i.ledger_id = l.id and i.status in ('applied', 'voided'))) as has_formal_lifecycle from public.ledgers l where l.workspace_id = $1 and l.id = $2 for update",
    values: [workspaceId, entityId],
  }, {
    eventId: event.eventId,
    table: "ledgers",
    text: "delete from public.ledgers where workspace_id = $1 and id = $2",
    values: [workspaceId, entityId],
  }];
  if (entityType === "monthly_ledger" && event.action === "finalized") return finalizedLedgerPlan(snapshot, workspaceId, event.eventId, entityId);
  if (entityType === "monthly_ledger" && event.action === "reopened_for_cost_recalculation") return reopenedLedgerPlan(snapshot, workspaceId, event.eventId, entityId, event);
  if (entityType === "monthly_ledger") {
    assertEntityId(snapshot, entityId, "月度账本");
    return [ledgerUpsert(snapshot, workspaceId, event.eventId)];
  }
  throw new SyncContractError(`不支持的业务同步类型：${entityType}`, { code: "UNSUPPORTED_PROJECTION", status: 409 });
}

export async function buildSyncPostgresPlan(payload) {
  const inspection = validateSyncEnvelope(payload);
  if (inspection.eventCount > SYNC_EVENT_MAX_BATCH) {
    throw new SyncContractError(`单批同步事件不能超过 ${SYNC_EVENT_MAX_BATCH} 条。`, {
      code: "SYNC_BATCH_TOO_LARGE",
      status: 400,
    });
  }
  const envelope = buildSyncEnvelope(payload);
  const eventPlans = [];
  for (const [index, event] of envelope.events.entries()) {
    eventPlans.push({
      event,
      actorIdProvided: Boolean(String(payload.events[index]?.actorId ?? "").trim()),
      contentHash: await syncEventContentHash(event),
      operations: businessOperations(projectSyncEvent(event), envelope.workspaceId),
    });
  }
  return {
    workspaceId: envelope.workspaceId,
    cursor: envelope.cursor,
    eventPlans,
    transaction: { begin: "begin", commit: "commit", rollback: "rollback" },
    lock: { text: "select id from public.workspaces where id = $1 for update", values: [envelope.workspaceId] },
    existing: {
      text: "select event_id, content_hash from public.audit_events where workspace_id = $1 and event_id = any($2::text[]) order by event_id for update",
      values: [envelope.workspaceId, envelope.events.map((event) => event.eventId)],
    },
  };
}

function auditInsertOperation(workspaceId, eventPlans, syncVersion) {
  const rows = eventPlans.map(({ event, contentHash }) => ({
    workspace_id: workspaceId,
    event_id: event.eventId,
    object_type: event.objectType,
    object_id: event.objectId,
    action: event.action,
    actor_id: event.actorId,
    before_snapshot: event.before,
    after_snapshot: event.after,
    content_hash: contentHash,
    created_at: event.createdAt,
    sync_version: syncVersion,
  }));
  return bulkInsert({
    table: "audit_events",
    columns: [
      ["workspace_id", "text"], ["event_id", "text"], ["object_type", "text"], ["object_id", "text"],
      ["action", "text"], ["actor_id", "text"], ["before_snapshot", "jsonb"], ["after_snapshot", "jsonb"],
      ["content_hash", "text"], ["created_at", "timestamptz"], ["sync_version", "text"],
    ],
    rows,
    eventId: null,
  });
}

function rowsFrom(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function configurePendingVoidReopenPairs(eventPlans) {
  let inspection;
  try {
    inspection = normalizeErpVoidLifecycleSequence(eventPlans.map(({ event }) => event), { allowLegacy: true });
  } catch (error) {
    throw new SyncContractError(error.message, {
      code: error.code ?? "INVALID_ERP_VOID_REOPEN_PAIR",
      status: Number(error.status) || 409,
      retryable: false,
      eventIds: error.eventIds ?? [],
    });
  }
  for (const group of inspection.groups.filter((item) => item.size === 2)) {
    const eventPlan = eventPlans[group.start];
    const guard = eventPlan.operations.find((operation) => operation.kind === "void_guard");
    const transition = eventPlan.operations.find((operation) => operation.kind === "void_transition");
    if (!guard || !transition) {
      throw new SyncContractError("ERP 作废事件缺少受控数据库转换。", {
        code: "INVALID_ERP_VOID_REOPEN_PAIR", status: 409, eventIds: [eventPlan.event.eventId],
      });
    }
    guard.allowFinalizedReopen = true;
    transition.allowFinalizedReopen = true;
    transition.values[transition.values.length - 1] = true;
  }
}

export async function applySyncEnvelopeWithPostgresClient(payload, {
  client,
  authorize = () => true,
  context = {},
  now = () => new Date().toISOString(),
} = {}) {
  if (!client || typeof client.query !== "function") throw new Error("PostgreSQL 客户端必须提供 query 方法。");
  const plan = await buildSyncPostgresPlan(payload);
  const events = plan.eventPlans.map(({ event, actorIdProvided }) => ({ ...event, actorIdProvided }));
  if (!(await authorize({ workspaceId: plan.workspaceId, actor: context.actor, token: context.token, operation: "audit_events", events }))) {
    throw new SyncContractError("当前身份无权写入该工作区。", { code: "WORKSPACE_FORBIDDEN", status: 403 });
  }
  const syncVersion = String(context.syncVersion ?? now());
  await client.query(plan.transaction.begin);
  try {
    const lockResult = await client.query(plan.lock.text, plan.lock.values);
    if (Number(lockResult?.rowCount ?? rowsFrom(lockResult).length) === 0) {
      throw new SyncContractError("同步工作区不存在或当前身份不可访问。", { code: "WORKSPACE_FORBIDDEN", status: 403 });
    }
    const existingResult = await client.query(plan.existing.text, plan.existing.values);
    const existing = new Map(rowsFrom(existingResult).map((row) => [String(row.event_id), String(row.content_hash)]));
    const conflicts = plan.eventPlans.filter(({ event, contentHash }) => existing.has(event.eventId) && existing.get(event.eventId) !== contentHash);
    if (conflicts.length > 0) {
      throw new SyncContractError(`同步事件 ID 已存在但内容不一致：${conflicts.map(({ event }) => event.eventId).join(", ")}`, {
        code: "EVENT_CONFLICT", status: 409, eventIds: conflicts.map(({ event }) => event.eventId),
      });
    }
    const pending = plan.eventPlans.filter(({ event }) => !existing.has(event.eventId));
    configurePendingVoidReopenPairs(pending);
    for (const eventPlan of pending) {
      for (const operation of eventPlan.operations) {
        const result = await client.query(operation.text, operation.values);
        if (["delete_guard", "finalize_guard"].includes(operation.kind)) {
          const ledger = rowsFrom(result)[0];
          if (!ledger) throw new SyncContractError("找不到同步事件对应的月度账本。", { code: "LEDGER_NOT_FOUND", status: 409, eventIds: [eventPlan.event.eventId] });
          if (operation.kind === "delete_guard" && [true, "true", 1, "1"].includes(ledger.has_formal_lifecycle)) {
            throw new SyncContractError("该账本已有正式 ERP 成本生命周期记录，不能物理删除。", {
              code: "LEDGER_HAS_FORMAL_COST_HISTORY", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          if (["finalized", "locked"].includes(String(ledger.status))) {
            throw new SyncContractError("已定稿或已锁定账本不能再次定稿或删除。", { code: "LEDGER_IMMUTABLE", status: 409, eventIds: [eventPlan.event.eventId] });
          }
        }
        if (operation.kind === "void_guard") {
          const lifecycle = rowsFrom(result)[0];
          if (!lifecycle) {
            throw new SyncContractError("找不到相互关联的 ERP 正式成本批次、收件记录或月度账本。", {
              code: "ERP_VOID_LIFECYCLE_NOT_FOUND", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          if (String(lifecycle.batch_status) !== "published") {
            throw new SyncContractError("只有 published ERP 正式成本批次可以作废。", {
              code: "ERP_BATCH_NOT_PUBLISHED", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          if (String(lifecycle.inbox_status) !== "applied"
            || String(lifecycle.inbox_id) !== String(operation.expectedInboxId)
            || String(lifecycle.applied_batch_id) !== String(operation.values[1])
            || lifecycle.voided_batch_id != null) {
            throw new SyncContractError("只有与正式批次一致的 applied 收件记录可以作废。", {
              code: "ERP_INBOX_NOT_APPLIED", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          if (String(lifecycle.ledger_id) !== String(operation.expectedLedgerId)
            || String(lifecycle.inbox_ledger_id) !== String(operation.expectedLedgerId)) {
            throw new SyncContractError("ERP 正式成本批次、收件记录与月度账本身份不一致。", {
              code: "ERP_VOID_LEDGER_MISMATCH", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          if (Number(lifecycle.linked_inbox_count) !== 1) {
            throw new SyncContractError("ERP 正式成本批次必须且只能关联一个收件记录。", {
              code: "ERP_INBOX_CARDINALITY_CONFLICT", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          const remoteLedgerStatus = String(lifecycle.ledger_status ?? "");
          if (remoteLedgerStatus === "locked") {
            throw new SyncContractError("已锁定账本不能作废 ERP 正式成本。", {
              code: "LEDGER_IMMUTABLE", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          if (remoteLedgerStatus === "finalized" && !operation.allowFinalizedReopen) {
            throw new SyncContractError("远端账本已定稿，作废必须携带 finance-only 的受控重开事件。", {
              code: "ERP_VOID_REOPEN_REQUIRED", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
          if (remoteLedgerStatus !== "finalized" && operation.allowFinalizedReopen) {
            throw new SyncContractError("远端账本不是已定稿状态，拒绝执行伪造或过期的重开事件。", {
              code: "ERP_VOID_REMOTE_STATE_CONFLICT", status: 409, eventIds: [eventPlan.event.eventId],
            });
          }
        }
        if (operation.kind === "void_transition" && Number(result?.rowCount ?? rowsFrom(result).length) === 0) {
          throw new SyncContractError("ERP 正式成本作废未影响任何记录，远端生命周期可能已变化。", {
            code: "ERP_VOID_TRANSITION_CONFLICT", status: 409, eventIds: [eventPlan.event.eventId],
          });
        }
      }
    }
    const auditInsert = auditInsertOperation(plan.workspaceId, pending, syncVersion);
    if (auditInsert) await client.query(`${auditInsert.text} on conflict (workspace_id, event_id) do nothing`, auditInsert.values);
    await client.query(plan.transaction.commit);
    return {
      format: SYNC_ACK_FORMAT,
      formatVersion: SYNC_ACK_VERSION,
      workspaceId: plan.workspaceId,
      eventIds: plan.eventPlans.map(({ event }) => event.eventId),
      cursor: plan.cursor,
      syncVersion,
      insertedEventCount: pending.length,
      replayedEventCount: plan.eventPlans.length - pending.length,
      transaction: "committed",
    };
  } catch (error) {
    try { await client.query(plan.transaction.rollback); } catch { /* preserve original failure */ }
    throw error;
  }
}

export { bulkInsert as buildSyncBulkInsertOperation };
