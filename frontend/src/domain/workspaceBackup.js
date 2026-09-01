import { assertUniquePlatformSkus } from "./identifiers.js";

export const WORKSPACE_BACKUP_FORMAT = "shopeers-local-backup";
export const WORKSPACE_BACKUP_VERSION = 1;

export function validateWorkspaceBackupPayload(payload, { tableNames = [] } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("备份文件内容无效。");
  if (payload.format !== WORKSPACE_BACKUP_FORMAT) throw new Error("这不是 Shopeers 本机备份文件。");
  if (Number(payload.formatVersion) !== WORKSPACE_BACKUP_VERSION) throw new Error("备份格式版本不受支持。");
  if (!payload.tables || typeof payload.tables !== "object" || Array.isArray(payload.tables)) {
    throw new Error("备份文件缺少数据表。");
  }

  const allowedTables = new Set(tableNames);
  const unknownTables = Object.keys(payload.tables).filter((name) => !allowedTables.has(name));
  if (unknownTables.length > 0) throw new Error(`备份包含当前版本不识别的数据表：${unknownTables.join(", ")}`);

  for (const [name, rows] of Object.entries(payload.tables)) {
    if (!Array.isArray(rows)) throw new Error(`备份数据表 ${name} 不是有效记录列表。`);
  }

  const platformSkus = payload.tables.platformSkus ?? [];
  assertUniquePlatformSkus(platformSkus.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId ?? payload.workspaceId,
    platformSku: row.platformSku,
  })));

  const recordCount = Object.values(payload.tables).reduce((sum, rows) => sum + rows.length, 0);
  return {
    recordCount,
    tableCount: Object.keys(payload.tables).length,
    generatedAt: payload.generatedAt ?? null,
    workspaceId: payload.workspaceId ?? null,
    databaseVersion: Number(payload.databaseVersion ?? 0),
  };
}
