import {
  CLOUD_SEED_FORMAT,
  CLOUD_SEED_TABLES,
  CLOUD_SEED_VERSION,
  validateCloudSeedPayload,
} from "./cloudSeed.js";
import { listBusinessProjectionGaps } from "./syncBusinessProjection.js";
import { inspectCloudSeedRelations } from "./cloudSeedImportContract.js";
import { buildSyncEnvelope } from "./syncEnvelope.js";
import { normalizeErpVoidLifecycleSequence } from "./syncLifecycleGroup.js";

export const SYNC_RECOVERY_FORMAT = "shopeers-sync-recovery";
export const SYNC_RECOVERY_VERSION = 1;

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function cloneRecord(record, excludedKeys = []) {
  const clone = structuredClone(record ?? {});
  for (const key of excludedKeys) delete clone[key];
  return clone;
}

function putRecord(map, record, label) {
  const id = requiredText(record?.id, `${label} ID`);
  map.set(id, cloneRecord(record));
}

function replaceRows(rows, predicate, replacements) {
  return [...rows.filter((row) => !predicate(row)), ...replacements.map((row) => cloneRecord(row))];
}

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function assertFormalInboxSnapshot(inbox, batch, status, eventId) {
  const expectedInboxStatus = status === "published" ? "applied" : "voided";
  if (!inbox.id || inbox.status !== expectedInboxStatus || inbox.appliedBatchId !== batch.id || !inbox.envelope || !inbox.appliedAt) {
    throw new Error(`ERP ${status === "published" ? "正式成本" : "作废"}事件 ${eventId} 缺少 ${expectedInboxStatus} 收件生命周期快照。`);
  }
  if (status === "voided") {
    if (inbox.voidedBatchId !== batch.id || !inbox.voidedAt || !hasText(inbox.voidedBy) || !hasText(inbox.voidReason)
      || !batch.voidedAt || !hasText(batch.voidedBy) || !hasText(batch.voidReason)) {
      throw new Error(`ERP 作废事件 ${eventId} 缺少完整作废元数据。`);
    }
    if (String(inbox.voidedAt) !== String(batch.voidedAt)
      || String(inbox.voidedBy).trim() !== String(batch.voidedBy).trim()
      || String(inbox.voidReason).trim() !== String(batch.voidReason).trim()) {
      throw new Error(`ERP 作废事件 ${eventId} 的批次与收件作废元数据不一致。`);
    }
  }
}

function removeLedgerFacts(state, ledgerId) {
  const hasFormalLifecycle = [...state.erpCostBatches.values()].some((row) => row.ledgerId === ledgerId && ["published", "voided"].includes(row.status))
    || [...state.erpCostInbox.values()].some((row) => row.ledgerId === ledgerId && ["applied", "voided"].includes(row.status));
  if (hasFormalLifecycle) throw new Error("包含 ERP 正式成本生命周期的账本不能通过恢复事件物理删除。");
  state.ledgers.delete(ledgerId);
  const importIds = new Set([...state.importBatches.values()].filter((row) => row.ledgerId === ledgerId).map((row) => row.id));
  const costBatchIds = new Set([...state.erpCostBatches.values()].filter((row) => row.ledgerId === ledgerId).map((row) => row.id));
  for (const [id, row] of state.importBatches) if (row.ledgerId === ledgerId) state.importBatches.delete(id);
  for (const [id, row] of state.erpCostRequests) if (row.ledgerId === ledgerId) state.erpCostRequests.delete(id);
  for (const [id, row] of state.erpCostBatches) if (row.ledgerId === ledgerId) state.erpCostBatches.delete(id);
  for (const [id, row] of state.erpCostInbox) if (row.ledgerId === ledgerId) state.erpCostInbox.delete(id);
  for (const [id, row] of state.costApprovals) if (row.ledgerId === ledgerId) state.costApprovals.delete(id);
  state.salesRows = state.salesRows.filter((row) => row.ledgerId !== ledgerId && !importIds.has(row.batchId));
  state.erpCostRows = state.erpCostRows.filter((row) => row.ledgerId !== ledgerId && !costBatchIds.has(row.batchId));
  state.profitLines = state.profitLines.filter((row) => row.ledgerId !== ledgerId);
}

function removeProductRecord(state, productId) {
  state.products.delete(productId);
  const skuIds = new Set([...state.platformSkus.values()]
    .filter((row) => row.productId === productId)
    .map((row) => row.id));
  for (const [id, row] of state.platformSkus) if (row.productId === productId) state.platformSkus.delete(id);
  for (const [id, row] of state.supplierOffers) {
    if (row.productId === productId || (row.platformSkuId && skuIds.has(row.platformSkuId))) state.supplierOffers.delete(id);
  }
  for (const [id, row] of state.catalogManualCosts) {
    if (row.productId === productId || (row.platformSkuId && skuIds.has(row.platformSkuId))) state.catalogManualCosts.delete(id);
  }
}

function applyProductSnapshot(state, snapshot) {
  putRecord(state.products, snapshot.product, "商品");
  const productId = snapshot.product.id;
  for (const [id, row] of state.platformSkus) if (row.productId === productId) state.platformSkus.delete(id);
  for (const [id, row] of state.supplierOffers) if (row.productId === productId) state.supplierOffers.delete(id);
  for (const row of snapshot.platformSkus ?? []) putRecord(state.platformSkus, row, "平台 SKU");
  for (const row of snapshot.supplierOffers ?? []) putRecord(state.supplierOffers, row, "供应商报价");
}

function initialState(workspace, baselineTables = {}) {
  return {
    workspaces: new Map((baselineTables.workspaces?.length ? baselineTables.workspaces : [workspace]).map((row) => [row.id, cloneRecord(row)])),
    products: new Map((baselineTables.products ?? []).map((row) => [row.id, cloneRecord(row)])),
    platformSkus: new Map((baselineTables.platformSkus ?? []).map((row) => [row.id, cloneRecord(row)])),
    supplierOffers: new Map((baselineTables.supplierOffers ?? []).map((row) => [row.id, cloneRecord(row)])),
    catalogManualCosts: new Map((baselineTables.catalogManualCosts ?? []).map((row) => [row.id, cloneRecord(row)])),
    captures: new Map((baselineTables.captures ?? []).map((row) => [row.id, cloneRecord(row)])),
    ledgers: new Map((baselineTables.ledgers ?? []).map((row) => [row.id, cloneRecord(row)])),
    importBatches: new Map((baselineTables.importBatches ?? []).map((row) => [row.id, cloneRecord(row)])),
    salesRows: (baselineTables.salesRows ?? []).map((row) => cloneRecord(row)),
    erpCostRequests: new Map((baselineTables.erpCostRequests ?? []).map((row) => [row.id, cloneRecord(row)])),
    erpCostBatches: new Map((baselineTables.erpCostBatches ?? []).map((row) => [row.id, cloneRecord(row)])),
    erpCostRows: (baselineTables.erpCostRows ?? []).map((row) => cloneRecord(row)),
    erpCostInbox: new Map((baselineTables.erpCostInbox ?? []).map((row) => [row.id, cloneRecord(row)])),
    costApprovals: new Map((baselineTables.costApprovals ?? []).map((row) => [row.id, cloneRecord(row)])),
    profitLines: (baselineTables.profitLines ?? []).map((row) => cloneRecord(row)),
  };
}

function normalizedRecovery(payload) {
  if (!payload || typeof payload !== "object") throw new Error("同步恢复包内容无效。");
  if (payload.format !== SYNC_RECOVERY_FORMAT) throw new Error("这不是 Shopeers 同步恢复包。");
  if (Number(payload.formatVersion) !== SYNC_RECOVERY_VERSION) throw new Error("同步恢复包版本不受支持。");
  const workspaceId = requiredText(payload.workspaceId, "恢复工作区");
  if (payload.currency !== "CNY") throw new Error("同步恢复包币种必须为人民币（CNY）。");
  normalizeErpVoidLifecycleSequence(Array.isArray(payload.events) ? payload.events : [], { allowLegacy: true });
  const envelope = buildSyncEnvelope({
    workspaceId,
    cursor: payload.cursor,
    generatedAt: payload.generatedAt,
    events: payload.events,
  });
  const gaps = listBusinessProjectionGaps(envelope.events);
  if (gaps.length > 0) {
    throw new Error(`同步恢复包包含缺少完整快照的业务事件：${gaps.map((gap) => gap.eventId).join(", ")}`);
  }
  const generatedAt = requiredText(payload.generatedAt, "恢复包生成时间");
  let baseline = null;
  if (payload.baseline != null) {
    const baselineInspection = validateCloudSeedPayload(payload.baseline);
    if (baselineInspection.workspaceId !== workspaceId) throw new Error("同步恢复基线工作区不一致。");
    baseline = structuredClone(payload.baseline);
  }
  const baselineWorkspace = baseline?.tables?.workspaces?.[0];
  const workspace = {
    id: workspaceId,
    name: String(payload.workspace?.name ?? baselineWorkspace?.name ?? "恢复工作区").trim() || "恢复工作区",
    defaultCurrency: "CNY",
    timezone: String(payload.workspace?.timezone ?? baselineWorkspace?.timezone ?? "Asia/Shanghai").trim() || "Asia/Shanghai",
    selectionStatusDefinitions: payload.workspace?.selectionStatusDefinitions ?? baselineWorkspace?.selectionStatusDefinitions ?? [],
    createdAt: payload.workspace?.createdAt ?? baselineWorkspace?.createdAt ?? generatedAt,
    updatedAt: payload.workspace?.updatedAt ?? baselineWorkspace?.updatedAt ?? generatedAt,
  };
  return { workspaceId, generatedAt, cursor: envelope.cursor, events: envelope.events, workspace, baseline };
}

export function buildSyncRecoveryPayload({
  workspaceId,
  events = [],
  cursor = null,
  generatedAt = new Date().toISOString(),
  workspace = null,
  baseline = null,
} = {}) {
  const normalizedWorkspaceId = requiredText(workspaceId, "恢复工作区");
  normalizeErpVoidLifecycleSequence(Array.isArray(events) ? events : [], { allowLegacy: true });
  const envelope = buildSyncEnvelope({ workspaceId: normalizedWorkspaceId, events, cursor, generatedAt });
  let normalizedBaseline = null;
  let incrementalEvents = envelope.events;
  if (baseline != null) {
    const baselineInspection = validateCloudSeedPayload(baseline);
    if (baselineInspection.workspaceId !== normalizedWorkspaceId) throw new Error("同步恢复基线工作区不一致。");
    normalizedBaseline = structuredClone(baseline);
    const baselineEventIds = new Set((baseline.tables.auditEvents ?? []).map((event) => String(event.eventId ?? event.id)));
    incrementalEvents = envelope.events.filter((event) => !baselineEventIds.has(event.eventId));
  }
  const gaps = listBusinessProjectionGaps(incrementalEvents);
  if (gaps.length > 0) throw new Error("存在无法用于恢复的摘要型业务事件。");
  return {
    format: SYNC_RECOVERY_FORMAT,
    formatVersion: SYNC_RECOVERY_VERSION,
    workspaceId: normalizedWorkspaceId,
    currency: "CNY",
    generatedAt,
    cursor: envelope.cursor,
    workspace: workspace ? cloneRecord(workspace) : null,
    baseline: normalizedBaseline,
    events: incrementalEvents,
  };
}

export function validateSyncRecoveryPayload(payload) {
  const recovery = normalizedRecovery(payload);
  return {
    workspaceId: recovery.workspaceId,
    eventCount: recovery.events.length,
    generatedAt: recovery.generatedAt,
    cursor: recovery.cursor,
    currency: "CNY",
  };
}

export function replaySyncRecoveryPayload(payload) {
  const recovery = normalizedRecovery(payload);
  const baselineTables = recovery.baseline?.tables ?? {};
  const state = initialState(recovery.workspace, baselineTables);

  for (const event of recovery.events) {
    const snapshot = event.after?.snapshot;
    switch (event.action) {
      case "capture_created":
      case "capture_draft_saved":
      case "capture_confirmed":
      case "capture_ignored":
      case "capture_product_relinked":
        putRecord(state.captures, snapshot, "采集记录");
        break;
      case "product_created":
      case "product_updated":
      case "product_merged": {
        applyProductSnapshot(state, snapshot);
        break;
      }
      case "product_deleted":
        removeProductRecord(state, String(event.objectId));
        break;
      case "selection_status_definitions_updated":
        putRecord(state.workspaces, snapshot, "工作区配置");
        break;
      case "catalog_manual_cost_confirmed":
      case "catalog_manual_cost_relinked": {
        const cost = cloneRecord(snapshot.catalogManualCost ?? snapshot);
        putRecord(state.catalogManualCosts, cost, "人工确认成本");
        for (const [id, row] of state.catalogManualCosts) {
          if (id !== cost.id && row.productId === cost.productId && row.canonicalPlatformSku === cost.canonicalPlatformSku && row.status === "active") {
            state.catalogManualCosts.set(id, { ...row, status: "superseded", supersededAt: cost.confirmedAt, updatedAt: cost.confirmedAt });
          }
        }
        break;
      }
      case "created":
      case "warehouse_rate_updated":
        putRecord(state.ledgers, cloneRecord(snapshot, ["profitLines"]), "月度账本");
        break;
      case "imported": {
        const batch = cloneRecord(snapshot.importBatch ?? snapshot, ["importBatch", "salesRows", "ledger"]);
        putRecord(state.importBatches, batch, "销售导入批次");
        const incomingRows = snapshot.salesRows ?? [];
        const groupKeys = new Set(incomingRows.map((row) => String(row.groupKey ?? "")).filter(Boolean));
        state.salesRows = replaceRows(
          state.salesRows,
          (row) => row.ledgerId === batch.ledgerId && groupKeys.has(String(row.groupKey ?? "")),
          incomingRows,
        );
        if (snapshot.ledger) putRecord(state.ledgers, snapshot.ledger, "月度账本");
        break;
      }
      case "skcs_copied":
        putRecord(state.erpCostRequests, snapshot, "ERP 成本请求");
        break;
      case "published": {
        const batch = cloneRecord(snapshot.costBatch ?? snapshot, ["costBatch", "rows", "ledger"]);
        const inbox = cloneRecord(snapshot.inbox);
        assertFormalInboxSnapshot(inbox, batch, "published", event.eventId);
        putRecord(state.erpCostBatches, batch, "ERP 成本批次");
        putRecord(state.erpCostInbox, inbox, "ERP 收件批次");
        state.erpCostRows = replaceRows(
          state.erpCostRows,
          (row) => row.batchId === batch.id,
          snapshot.rows ?? [],
        );
        if (snapshot.ledger) putRecord(state.ledgers, snapshot.ledger, "月度账本");
        break;
      }
      case "voided": {
        const batch = cloneRecord(snapshot.costBatch ?? snapshot);
        const inbox = cloneRecord(snapshot.inbox);
        assertFormalInboxSnapshot(inbox, batch, "voided", event.eventId);
        putRecord(state.erpCostBatches, batch, "ERP 成本批次");
        putRecord(state.erpCostInbox, inbox, "ERP 收件批次");
        if (snapshot.ledger) putRecord(state.ledgers, snapshot.ledger, "月度账本");
        break;
      }
      case "approved_1688_fallback":
      case "revoked": {
        const approval = cloneRecord(snapshot, ["ledger"]);
        putRecord(state.costApprovals, approval, "成本审批");
        if (snapshot.ledger) putRecord(state.ledgers, snapshot.ledger, "月度账本");
        break;
      }
      case "finalized": {
        const ledger = cloneRecord(snapshot, ["profitLines"]);
        putRecord(state.ledgers, ledger, "月度账本");
        state.profitLines = replaceRows(
          state.profitLines,
          (row) => row.ledgerId === ledger.id,
          snapshot.profitLines ?? [],
        );
        break;
      }
      case "reopened_for_cost_recalculation": {
        const ledger = cloneRecord(snapshot);
        putRecord(state.ledgers, ledger, "月度账本");
        state.profitLines = state.profitLines.filter((row) => row.ledgerId !== ledger.id);
        break;
      }
      case "deleted":
        removeLedgerFacts(state, String(event.objectId));
        break;
      default:
        break;
    }
  }

  const syncedAuditEvent = (event) => ({
    ...cloneRecord(event),
    syncState: "synced",
    syncAttempts: 0,
    syncedAt: recovery.generatedAt,
    syncVersion: recovery.cursor,
    syncError: null,
    syncErrorCode: null,
    syncTerminal: false,
    syncClaimedAt: null,
    syncFailedAt: null,
  });
  const baselineAuditEvents = (baselineTables.auditEvents ?? []).map(syncedAuditEvent);
  const baselineEventIds = new Set(baselineAuditEvents.map((event) => String(event.eventId ?? event.id)));
  const incrementalAuditEvents = recovery.events
    .filter((event) => !baselineEventIds.has(event.eventId))
    .map(syncedAuditEvent);
  const auditEvents = [...baselineAuditEvents, ...incrementalAuditEvents];
  const tables = {
    workspaces: [...state.workspaces.values()],
    products: [...state.products.values()],
    platformSkus: [...state.platformSkus.values()],
    supplierOffers: [...state.supplierOffers.values()],
    catalogManualCosts: [...state.catalogManualCosts.values()],
    captures: [...state.captures.values()],
    ledgers: [...state.ledgers.values()],
    importBatches: [...state.importBatches.values()],
    salesRows: state.salesRows,
    erpCostRequests: [...state.erpCostRequests.values()],
    erpCostBatches: [...state.erpCostBatches.values()],
    erpCostRows: state.erpCostRows,
    erpCostInbox: [...state.erpCostInbox.values()],
    costApprovals: [...state.costApprovals.values()],
    profitLines: state.profitLines,
    auditEvents,
  };
  const inspection = inspectCloudSeedRelations({
    format: CLOUD_SEED_FORMAT,
    formatVersion: CLOUD_SEED_VERSION,
    workspaceId: recovery.workspaceId,
    currency: "CNY",
    generatedAt: recovery.generatedAt,
    tables: Object.fromEntries(CLOUD_SEED_TABLES.map((name) => [name, tables[name] ?? []])),
  });
  return { ...inspection, cursor: recovery.cursor, tables };
}
