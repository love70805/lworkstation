import {
  CLOUD_SEED_FORMAT,
  CLOUD_SEED_TABLES,
  CLOUD_SEED_VERSION,
  validateCloudSeedPayload,
} from "./cloudSeed.js";
import { canonicalPlatformSku } from "./identifiers.js";

export const CLOUD_SEED_PREFLIGHT_FORMAT = "shopeers-cloud-seed-preflight";
export const CLOUD_SEED_IMPORT_ACK_FORMAT = "shopeers-cloud-seed-import-ack";
export const CLOUD_SEED_IMPORT_VERSION = 1;

export class CloudSeedImportError extends Error {
  constructor(message, { code = "INVALID_CLOUD_SEED", status = 400, conflicts = [], retryable = false } = {}) {
    super(message);
    this.name = "CloudSeedImportError";
    this.code = code;
    this.status = status;
    this.conflicts = conflicts;
    this.retryable = retryable;
  }
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentFingerprint(seed) {
  const source = stableSerialize({ workspaceId: seed.workspaceId, currency: seed.currency, tables: seed.tables });
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function rowIdentity(tableName, row) {
  const value = tableName === "auditEvents" ? row.eventId ?? row.id : row.id;
  const identity = String(value ?? "").trim();
  if (!identity) throw new CloudSeedImportError(`数据表 ${tableName} 包含缺少主键的记录。`, { code: "MISSING_PRIMARY_KEY" });
  return identity;
}

function tableRows(seed, tableName) {
  return seed.tables[tableName] ?? [];
}

function rowIds(seed, tableName) {
  return new Set(tableRows(seed, tableName).map((row) => rowIdentity(tableName, row)));
}

function assertReference(rows, field, targetIds, label, { optional = false } = {}) {
  for (const row of rows) {
    const value = String(row[field] ?? "").trim();
    if (!value && optional) continue;
    if (!value || !targetIds.has(value)) {
      throw new CloudSeedImportError(`${label}引用不存在：${value || "空值"}。`, { code: "BROKEN_REFERENCE" });
    }
  }
}

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

export function inspectCloudSeedRelations(seed) {
  let inspection;
  try {
    inspection = validateCloudSeedPayload(seed);
  } catch (error) {
    throw new CloudSeedImportError(error.message);
  }

  for (const tableName of CLOUD_SEED_TABLES) {
    const identities = new Set();
    for (const row of tableRows(seed, tableName)) {
      const identity = rowIdentity(tableName, row);
      if (identities.has(identity)) {
        throw new CloudSeedImportError(`数据表 ${tableName} 的主键重复：${identity}。`, { code: "DUPLICATE_PRIMARY_KEY" });
      }
      identities.add(identity);
    }
  }

  const products = rowIds(seed, "products");
  const ledgers = rowIds(seed, "ledgers");
  const imports = rowIds(seed, "importBatches");
  const requests = rowIds(seed, "erpCostRequests");
  const costBatches = rowIds(seed, "erpCostBatches");
  const costBatchById = new Map(tableRows(seed, "erpCostBatches").map((batch) => [String(batch.id), batch]));
  const inboxRecords = tableRows(seed, "erpCostInbox");
  const approvals = rowIds(seed, "costApprovals");

  assertReference(tableRows(seed, "platformSkus"), "productId", products, "平台 SKU 商品");
  assertReference(tableRows(seed, "supplierOffers"), "productId", products, "供应商报价商品");
  assertReference(tableRows(seed, "catalogManualCosts"), "productId", products, "人工确认成本商品");
  assertReference(tableRows(seed, "catalogManualCosts"), "platformSkuId", rowIds(seed, "platformSkus"), "人工确认成本平台 SKU");
  const skuById = new Map(tableRows(seed, "platformSkus").map((row) => [String(row.id), row]));
  for (const cost of tableRows(seed, "catalogManualCosts")) {
    const sku = skuById.get(String(cost.platformSkuId));
    if (!sku) continue;
    if (String(sku.productId) !== String(cost.productId)) {
      throw new CloudSeedImportError("人工确认成本的平台 SKU 不属于对应商品。", { code: "BROKEN_REFERENCE" });
    }
    if (canonicalPlatformSku(sku.platformSku) !== canonicalPlatformSku(cost.platformSku)) {
      throw new CloudSeedImportError("人工确认成本的平台 SKU 标识不一致。", { code: "BROKEN_REFERENCE" });
    }
    if (!["active", "superseded"].includes(String(cost.status ?? "active"))) {
      throw new CloudSeedImportError("人工确认成本状态无效。", { code: "INVALID_MANUAL_COST" });
    }
  }
  assertReference(tableRows(seed, "importBatches"), "ledgerId", ledgers, "销售导入批次账本");
  assertReference(tableRows(seed, "salesRows"), "ledgerId", ledgers, "销售明细账本");
  assertReference(tableRows(seed, "salesRows"), "batchId", imports, "销售明细导入批次");
  assertReference(tableRows(seed, "erpCostRequests"), "ledgerId", ledgers, "ERP 成本请求账本", { optional: true });
  assertReference(tableRows(seed, "erpCostBatches"), "ledgerId", ledgers, "ERP 成本批次账本");
  assertReference(tableRows(seed, "erpCostBatches"), "requestId", requests, "ERP 成本请求", { optional: true });
  assertReference(tableRows(seed, "erpCostRows"), "ledgerId", ledgers, "ERP 成本明细账本");
  assertReference(tableRows(seed, "erpCostRows"), "batchId", costBatches, "ERP 成本明细批次");
  assertReference(inboxRecords, "ledgerId", ledgers, "ERP 收件批次账本");
  assertReference(inboxRecords, "requestId", requests, "ERP 收件批次请求", { optional: true });
  assertReference(inboxRecords, "appliedBatchId", costBatches, "ERP 收件批次正式成本", { optional: true });
  assertReference(inboxRecords, "voidedBatchId", costBatches, "ERP 收件批次作废成本", { optional: true });
  const inboxByAppliedBatch = new Map();
  for (const inbox of inboxRecords) {
    const status = String(inbox.status ?? "");
    if (!["pending", "loaded", "applied", "rejected", "voided"].includes(status)) {
      throw new CloudSeedImportError(`ERP 收件批次状态无效：${status || "空值"}。`, { code: "INVALID_ERP_INBOX" });
    }
    if (!inbox.envelope || typeof inbox.envelope !== "object" || Array.isArray(inbox.envelope)) {
      throw new CloudSeedImportError("ERP 收件批次必须保留原始 envelope。", { code: "INVALID_ERP_INBOX" });
    }
    if (["applied", "voided"].includes(status)) {
      const batchId = String(inbox.appliedBatchId ?? "").trim();
      if (!batchId) throw new CloudSeedImportError("已发布或已作废的 ERP 收件批次缺少 appliedBatchId。", { code: "INVALID_ERP_INBOX" });
      if (!inbox.appliedAt) throw new CloudSeedImportError("已发布或已作废的 ERP 收件批次缺少 appliedAt。", { code: "INVALID_ERP_INBOX" });
      if (status === "voided" && String(inbox.voidedBatchId ?? "") !== batchId) {
        throw new CloudSeedImportError("已作废的 ERP 收件批次缺少一致的 voidedBatchId。", { code: "INVALID_ERP_INBOX" });
      }
      if (status === "voided" && (!inbox.voidedAt || !hasText(inbox.voidedBy) || !hasText(inbox.voidReason))) {
        throw new CloudSeedImportError("已作废的 ERP 收件批次缺少时间、操作者或原因。", { code: "INVALID_ERP_INBOX" });
      }
      const batch = costBatchById.get(batchId);
      const expectedBatchStatus = status === "applied" ? "published" : "voided";
      if (!batch || batch.status !== expectedBatchStatus || String(batch.ledgerId ?? "") !== String(inbox.ledgerId ?? "")) {
        throw new CloudSeedImportError("ERP 收件生命周期与正式成本批次状态或账本不一致。", { code: "INVALID_ERP_INBOX" });
      }
      if (status === "voided" && (
        String(batch.voidedAt ?? "") !== String(inbox.voidedAt ?? "")
        || String(batch.voidedBy ?? "").trim() !== String(inbox.voidedBy ?? "").trim()
        || String(batch.voidReason ?? "").trim() !== String(inbox.voidReason ?? "").trim()
      )) {
        throw new CloudSeedImportError("ERP 作废成本批次与收件记录的作废元数据不一致。", { code: "INVALID_ERP_INBOX" });
      }
      if (inboxByAppliedBatch.has(batchId)) {
        throw new CloudSeedImportError(`ERP 正式成本批次关联了多个收件记录：${batchId}。`, { code: "DUPLICATE_ERP_INBOX" });
      }
      inboxByAppliedBatch.set(batchId, inbox);
    }
  }
  for (const batch of tableRows(seed, "erpCostBatches")) {
    const status = String(batch.status ?? "");
    if (!["published", "voided"].includes(status)) continue;
    if (status === "voided" && (!batch.voidedAt || !hasText(batch.voidedBy) || !hasText(batch.voidReason))) {
      throw new CloudSeedImportError(`ERP 作废成本批次 ${batch.id} 缺少时间、操作者或原因。`, { code: "INVALID_ERP_BATCH" });
    }
    const inbox = inboxByAppliedBatch.get(String(batch.id));
    const expectedInboxStatus = status === "published" ? "applied" : "voided";
    if (!inbox || inbox.status !== expectedInboxStatus) {
      throw new CloudSeedImportError(`ERP 正式成本批次 ${batch.id} 缺少 ${expectedInboxStatus} 收件生命周期记录。`, { code: "MISSING_ERP_INBOX_LIFECYCLE" });
    }
  }
  assertReference(tableRows(seed, "costApprovals"), "ledgerId", ledgers, "成本审批账本");
  assertReference(tableRows(seed, "profitLines"), "ledgerId", ledgers, "利润明细账本");
  assertReference(tableRows(seed, "profitLines"), "costBatchId", costBatches, "利润明细 ERP 成本批次", { optional: true });
  assertReference(tableRows(seed, "profitLines"), "costApprovalId", approvals, "利润明细成本审批", { optional: true });

  return { ...inspection, fingerprint: contentFingerprint(seed) };
}

function emptyWorkspaceState() {
  return {
    version: 0,
    importedSeeds: new Map(),
    tables: new Map(CLOUD_SEED_TABLES.map((name) => [name, new Map()])),
  };
}

function cloneWorkspaceState(state) {
  return {
    version: state.version,
    importedSeeds: new Map(state.importedSeeds),
    tables: new Map([...state.tables].map(([name, rows]) => [name, new Map(rows)])),
  };
}

function existingNaturalIndexes(state) {
  const platformSkus = new Map();
  for (const [id, stored] of state.tables.get("platformSkus")) {
    const canonical = canonicalPlatformSku(stored.row.platformSku);
    if (canonical) platformSkus.set(canonical, id);
  }
  const ledgers = new Map();
  for (const [id, stored] of state.tables.get("ledgers")) {
    ledgers.set(`${stored.row.period}\u001f${stored.row.type ?? "monthly_profit"}`, id);
  }
  return { platformSkus, ledgers };
}

function inspectConflicts(state, seed) {
  const conflicts = [];
  let insertCount = 0;
  let unchangedCount = 0;
  const indexes = existingNaturalIndexes(state);

  for (const tableName of CLOUD_SEED_TABLES) {
    const storedRows = state.tables.get(tableName);
    for (const row of tableRows(seed, tableName)) {
      const id = rowIdentity(tableName, row);
      const serialized = stableSerialize(row);
      const existing = storedRows.get(id);
      if (existing) {
        if (existing.serialized === serialized) unchangedCount += 1;
        else conflicts.push({ table: tableName, identity: id, kind: "PRIMARY_KEY_CONFLICT" });
        continue;
      }
      if (tableName === "platformSkus") {
        const canonical = canonicalPlatformSku(row.platformSku);
        const existingId = indexes.platformSkus.get(canonical);
        if (existingId && existingId !== id) {
          conflicts.push({ table: tableName, identity: id, kind: "PLATFORM_SKU_CONFLICT", existingIdentity: existingId });
          continue;
        }
      }
      if (tableName === "ledgers") {
        const periodKey = `${row.period}\u001f${row.type ?? "monthly_profit"}`;
        const existingId = indexes.ledgers.get(periodKey);
        if (existingId && existingId !== id) {
          conflicts.push({ table: tableName, identity: id, kind: "LEDGER_PERIOD_CONFLICT", existingIdentity: existingId });
          continue;
        }
      }
      insertCount += 1;
    }
  }
  return { conflicts, insertCount, unchangedCount };
}

function preflightResponse({ inspection, state, conflicts, insertCount, unchangedCount, preflightId, idempotent }) {
  return {
    format: CLOUD_SEED_PREFLIGHT_FORMAT,
    formatVersion: CLOUD_SEED_IMPORT_VERSION,
    workspaceId: inspection.workspaceId,
    seedFingerprint: inspection.fingerprint,
    preflightId,
    workspaceVersion: state.version,
    canImport: conflicts.length === 0,
    idempotent,
    recordCount: inspection.recordCount,
    insertCount,
    unchangedCount,
    conflictCount: conflicts.length,
    conflicts: conflicts.slice(0, 100),
  };
}

export function createCloudSeedImportStore({ authorize = () => true, beforeCommit = null } = {}) {
  const workspaces = new Map();
  const preflights = new Map();

  function authorized(inspection, context, operation) {
    if (!authorize({ workspaceId: inspection.workspaceId, actor: context.actor, token: context.token, operation })) {
      throw new CloudSeedImportError("当前用户无权迁移该工作区。", { code: "WORKSPACE_FORBIDDEN", status: 403 });
    }
  }

  function preflight(seed, context = {}) {
    const inspection = inspectCloudSeedRelations(seed);
    authorized(inspection, context, "preflight");
    const state = workspaces.get(inspection.workspaceId) ?? emptyWorkspaceState();
    const previousImport = state.importedSeeds.get(inspection.fingerprint);
    const report = inspectConflicts(state, seed);
    const idempotent = Boolean(previousImport);
    const preflightId = `seed-${inspection.fingerprint}-v${state.version}`;
    const response = preflightResponse({
      inspection,
      state,
      ...report,
      preflightId,
      idempotent,
    });
    preflights.set(preflightId, {
      workspaceId: inspection.workspaceId,
      fingerprint: inspection.fingerprint,
      workspaceVersion: state.version,
      canImport: response.canImport,
    });
    return response;
  }

  async function commit(seed, { preflightId, ...context } = {}) {
    const inspection = inspectCloudSeedRelations(seed);
    authorized(inspection, context, "import");
    const state = workspaces.get(inspection.workspaceId) ?? emptyWorkspaceState();
    const prior = state.importedSeeds.get(inspection.fingerprint);
    if (prior) return { ...prior, idempotent: true };

    const preflightRecord = preflights.get(String(preflightId ?? ""));
    if (!preflightRecord || preflightRecord.workspaceId !== inspection.workspaceId || preflightRecord.fingerprint !== inspection.fingerprint) {
      throw new CloudSeedImportError("导入前必须完成与当前种子包一致的预检。", { code: "PREFLIGHT_REQUIRED", status: 409 });
    }
    if (preflightRecord.workspaceVersion !== state.version) {
      throw new CloudSeedImportError("预检后云端数据已发生变化，请重新预检。", { code: "PREFLIGHT_STALE", status: 409, retryable: true });
    }
    const report = inspectConflicts(state, seed);
    if (!preflightRecord.canImport || report.conflicts.length > 0) {
      throw new CloudSeedImportError("种子包与云端数据存在冲突，未执行任何写入。", {
        code: "SEED_CONFLICT",
        status: 409,
        conflicts: report.conflicts.slice(0, 100),
      });
    }

    const staged = cloneWorkspaceState(state);
    for (const tableName of CLOUD_SEED_TABLES) {
      const target = staged.tables.get(tableName);
      for (const row of tableRows(seed, tableName)) {
        const id = rowIdentity(tableName, row);
        if (!target.has(id)) target.set(id, { row: structuredClone(row), serialized: stableSerialize(row) });
      }
    }
    if (typeof beforeCommit === "function") await beforeCommit({ seed, inspection, staged });
    staged.version += 1;
    const ack = {
      format: CLOUD_SEED_IMPORT_ACK_FORMAT,
      formatVersion: CLOUD_SEED_IMPORT_VERSION,
      workspaceId: inspection.workspaceId,
      seedFingerprint: inspection.fingerprint,
      importVersion: `seed-${staged.version}`,
      insertedCount: report.insertCount,
      unchangedCount: report.unchangedCount,
      tableCounts: Object.fromEntries([...staged.tables].map(([name, rows]) => [name, rows.size])),
      idempotent: false,
    };
    staged.importedSeeds.set(inspection.fingerprint, ack);
    workspaces.set(inspection.workspaceId, staged);
    return ack;
  }

  return {
    preflight,
    commit,
    snapshot(workspaceId = null) {
      const entries = workspaceId == null ? [...workspaces] : [...workspaces].filter(([id]) => id === workspaceId);
      return {
        workspaceCount: entries.length,
        importedSeedCount: entries.reduce((sum, [, state]) => sum + state.importedSeeds.size, 0),
        workspaces: entries.map(([id, state]) => ({
          workspaceId: id,
          version: state.version,
          tableCounts: Object.fromEntries([...state.tables].map(([name, rows]) => [name, rows.size])),
        })),
      };
    },
    exportSeed(workspaceId) {
      const normalizedWorkspaceId = String(workspaceId ?? "").trim();
      const state = workspaces.get(normalizedWorkspaceId);
      if (!state) return null;
      const tables = Object.fromEntries([...state.tables].map(([name, rows]) => [
        name,
        [...rows.values()].map(({ row }) => structuredClone(row)),
      ]));
      const recordCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
      return {
        format: CLOUD_SEED_FORMAT,
        formatVersion: CLOUD_SEED_VERSION,
        applicationVersion: "0.1.0",
        target: "shopeers-postgres-v1",
        workspaceId: normalizedWorkspaceId,
        currency: "CNY",
        generatedAt: new Date().toISOString(),
        source: { format: "cloud-import-store", formatVersion: 1, generatedAt: null, databaseVersion: 0 },
        excludedTables: ["settings"],
        tables,
        recordCount,
        tableCount: Object.values(tables).filter((rows) => rows.length > 0).length,
      };
    },
  };
}
