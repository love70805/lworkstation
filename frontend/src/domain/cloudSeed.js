import { assertUniquePlatformSkus } from "./identifiers.js";
import {
  validateWorkspaceBackupPayload,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_VERSION,
} from "./workspaceBackup.js";

export const CLOUD_SEED_FORMAT = "shopeers-cloud-seed";
export const CLOUD_SEED_VERSION = 1;

export const CLOUD_SEED_TABLES = Object.freeze([
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

export const CLOUD_SEED_EXCLUDED_TABLES = Object.freeze(["settings"]);

const LOCAL_ONLY_FIELDS = new Set([
  "syncState",
  "syncAttempts",
  "syncError",
  "syncClaimedAt",
  "syncFailedAt",
  "syncedAt",
  "syncVersion",
]);

function cloneWithoutLocalFields(value) {
  if (Array.isArray(value)) return value.map(cloneWithoutLocalFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !LOCAL_ONLY_FIELDS.has(key))
    .map(([key, child]) => [key, cloneWithoutLocalFields(child)]));
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function inspectTables(tables, workspaceId) {
  const unknownTables = Object.keys(tables).filter((name) => !CLOUD_SEED_TABLES.includes(name));
  if (unknownTables.length > 0) throw new Error(`云端种子包包含当前版本不识别的数据表：${unknownTables.join(", ")}`);

  for (const tableName of CLOUD_SEED_TABLES) {
    const rows = tables[tableName] ?? [];
    if (!Array.isArray(rows)) throw new Error(`云端种子包数据表 ${tableName} 不是有效记录列表。`);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`云端种子包数据表 ${tableName} 包含无效记录。`);
      if (row.workspaceId != null && String(row.workspaceId) !== workspaceId) {
        throw new Error(`云端种子包数据表 ${tableName} 包含跨工作区记录。`);
      }
    }
  }

  const workspaces = tables.workspaces ?? [];
  if (workspaces.length !== 1 || String(workspaces[0]?.id ?? "") !== workspaceId) {
    throw new Error("云端种子包必须且只能包含当前工作区记录。");
  }

  const currencyRows = CLOUD_SEED_TABLES.flatMap((tableName) => (tables[tableName] ?? [])
    .filter((row) => row.currency != null || row.defaultCurrency != null)
    .map((row) => ({ tableName, currency: row.currency ?? row.defaultCurrency })));
  const invalidCurrency = currencyRows.find((item) => String(item.currency).toUpperCase() !== "CNY");
  if (invalidCurrency) throw new Error(`云端种子包数据表 ${invalidCurrency.tableName} 的币种必须为人民币（CNY）。`);

  const platformSkus = tables.platformSkus ?? [];
  assertUniquePlatformSkus(platformSkus.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId ?? workspaceId,
    platformSku: row.platformSku,
  })));

  const ledgerPeriods = new Set();
  for (const ledger of tables.ledgers ?? []) {
    const periodKey = `${workspaceId}\u001f${ledger.period}\u001f${ledger.type ?? "monthly_profit"}`;
    if (ledgerPeriods.has(periodKey)) throw new Error(`月度账本 ${ledger.period} 在工作区内重复。`);
    ledgerPeriods.add(periodKey);
  }

  for (const request of tables.erpCostRequests ?? []) {
    if (request.queryUnit != null && request.queryUnit !== "platform_skc") {
      throw new Error("ERP 成本请求必须以平台 SKC 为查询单位。");
    }
  }

  for (const line of tables.profitLines ?? []) {
    if (line.calculationMode != null && line.calculationMode !== "exact") {
      throw new Error("云端种子包中的正式利润行必须使用精确核算模式。");
    }
    const source = line.formalCostSource ?? line.costSource;
    if (source != null && !["erp", "approved_1688"].includes(source)) {
      throw new Error("正式利润成本来源只能是 ERP 或已审批的 1688 兜底成本。");
    }
  }

  const recordCount = CLOUD_SEED_TABLES.reduce((sum, name) => sum + (tables[name]?.length ?? 0), 0);
  return {
    recordCount,
    tableCount: CLOUD_SEED_TABLES.filter((name) => (tables[name]?.length ?? 0) > 0).length,
    workspaceId,
    currency: "CNY",
  };
}

export function buildCloudSeedPayload(backupPayload, { generatedAt = new Date().toISOString() } = {}) {
  if (!backupPayload || typeof backupPayload !== "object") throw new Error("本机备份内容无效。不能生成云端种子包。");
  if (backupPayload.format !== WORKSPACE_BACKUP_FORMAT || Number(backupPayload.formatVersion) !== WORKSPACE_BACKUP_VERSION) {
    throw new Error("只能从受支持的 Shopeers 本机备份生成云端种子包。");
  }
  validateWorkspaceBackupPayload(backupPayload, {
    tableNames: [...CLOUD_SEED_TABLES, ...CLOUD_SEED_EXCLUDED_TABLES],
  });
  const workspaceId = requiredText(backupPayload.workspaceId, "种子包工作区");
  const tables = Object.fromEntries(CLOUD_SEED_TABLES.map((name) => [
    name,
    cloneWithoutLocalFields(backupPayload.tables?.[name] ?? []),
  ]));
  const inspection = inspectTables(tables, workspaceId);
  return {
    format: CLOUD_SEED_FORMAT,
    formatVersion: CLOUD_SEED_VERSION,
    applicationVersion: backupPayload.applicationVersion ?? "0.1.0",
    target: "shopeers-postgres-v1",
    workspaceId,
    currency: "CNY",
    generatedAt,
    source: {
      format: backupPayload.format,
      formatVersion: Number(backupPayload.formatVersion),
      generatedAt: backupPayload.generatedAt ?? null,
      databaseVersion: Number(backupPayload.databaseVersion ?? 0),
    },
    excludedTables: [...CLOUD_SEED_EXCLUDED_TABLES],
    tables,
    recordCount: inspection.recordCount,
    tableCount: inspection.tableCount,
  };
}

export function validateCloudSeedPayload(payload, { tableNames = CLOUD_SEED_TABLES } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("云端种子包内容无效。");
  if (payload.format !== CLOUD_SEED_FORMAT) throw new Error("这不是 Shopeers 云端种子包。");
  if (Number(payload.formatVersion) !== CLOUD_SEED_VERSION) throw new Error("云端种子包版本不受支持。");
  const workspaceId = requiredText(payload.workspaceId, "种子包工作区");
  if (payload.currency !== "CNY") throw new Error("云端种子包币种必须为人民币（CNY）。");
  if (!payload.tables || typeof payload.tables !== "object" || Array.isArray(payload.tables)) {
    throw new Error("云端种子包缺少数据表。");
  }
  const allowedTables = new Set(tableNames);
  const unknownTables = Object.keys(payload.tables).filter((name) => !allowedTables.has(name));
  if (unknownTables.length > 0) throw new Error(`云端种子包包含当前版本不识别的数据表：${unknownTables.join(", ")}`);
  const inspection = inspectTables(payload.tables, workspaceId);
  return {
    ...inspection,
    generatedAt: payload.generatedAt ?? null,
    sourceGeneratedAt: payload.source?.generatedAt ?? null,
    excludedTables: Array.isArray(payload.excludedTables) ? payload.excludedTables : [],
  };
}
