import { assertUniquePlatformSkus } from "./identifiers.js";
import { validateSalesRowsAuditSnapshot } from "./salesRowsAuditSnapshot.js";
import { validateBusinessPreferences } from '../lib/businessPreferencesBackup.js';
import {validateCostDraftBackup} from '../lib/costMatchingDraft.js';
import {validateDesktopInboxBackup} from '../../../integrations/contracts/desktop-inbox-backup.mjs';

export const WORKSPACE_BACKUP_FORMAT = "shopeers-local-backup";
export const WORKSPACE_BACKUP_VERSION = 1;

export function createWorkspaceBackupManifest(payload) {
  return { version: 1, databaseVersion: payload.databaseVersion,
    tableCounts: Object.fromEntries(Object.entries(payload.tables).map(([name, rows]) => [name, rows.length])),
    businessPreferencesIncluded: payload.businessPreferences !== undefined,
    ...(payload.localCostDrafts===undefined?{}:{localCostDraftsIncluded:true}),
    ...(payload.desktopInbox===undefined?{}:{desktopInboxIncluded:true,desktopRecordCount:payload.desktopInbox.recordCount,desktopLeaseCount:payload.desktopInbox.leaseCount}),
  };
}

export function validateWorkspaceBackupPayload(payload, { tableNames = [], schemas } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("备份文件内容无效。");
  if (payload.format !== WORKSPACE_BACKUP_FORMAT) throw new Error("这不是 Lworkstation 本机备份文件。");
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
  if (schemas) {
    const version = Number(payload.databaseVersion), requiredTables = schemas[version];
    if (!Number.isFinite(version) || !requiredTables) throw new Error('备份数据库版本不受支持。');
    const missing = requiredTables.filter(name => !Object.hasOwn(payload.tables, name));
    if (missing.length) throw new Error(`备份缺少数据库版本 ${version} 必需的数据表：${missing.join(', ')}`);
    if (payload.recordCount === undefined) throw new Error('备份缺少声明记录数。');
  }
  for (const event of payload.tables.auditEvents ?? []) {
    if (event.action === "imported" && event.after?.snapshot?.salesRows != null) {
      validateSalesRowsAuditSnapshot(event.after.snapshot.salesRows);
    }
  }

  const platformSkus = payload.tables.platformSkus ?? [];
  assertUniquePlatformSkus(platformSkus.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId ?? payload.workspaceId,
    platformSku: row.platformSku,
  })));

  const recordCount = Object.values(payload.tables).reduce((sum, rows) => sum + rows.length, 0);
  if (payload.recordCount !== undefined && (!Number.isSafeInteger(payload.recordCount) || payload.recordCount !== recordCount)) {
    throw new Error('备份声明记录数与实际记录数不一致。');
  }
  if (payload.manifest !== undefined) {
    const manifest = payload.manifest, expected = createWorkspaceBackupManifest(payload);
    const names = manifest?.tableCounts && typeof manifest.tableCounts === 'object' && !Array.isArray(manifest.tableCounts)
      ? Object.keys(manifest.tableCounts) : [];
    if (manifest?.version !== 1 || manifest.databaseVersion !== payload.databaseVersion || payload.recordCount === undefined
      || manifest.businessPreferencesIncluded !== expected.businessPreferencesIncluded
      || names.length !== Object.keys(payload.tables).length
      || names.some(name => manifest.tableCounts[name] !== expected.tableCounts[name])
      || ['localCostDraftsIncluded','desktopInboxIncluded','desktopRecordCount','desktopLeaseCount'].some(key=>manifest[key]!==expected[key])) {
      throw new Error('备份完整清单与数据内容校验失败。');
    }
  }
  validateBusinessPreferences(payload.businessPreferences, (payload.tables.workspaces ?? []).map(workspace => workspace.id));
  validateCostDraftBackup(payload.localCostDrafts);
  validateDesktopInboxBackup(payload.desktopInbox);
  return {
    recordCount,
    tableCount: Object.keys(payload.tables).length,
    generatedAt: payload.generatedAt ?? null,
    workspaceId: payload.workspaceId ?? null,
    databaseVersion: Number(payload.databaseVersion ?? 0),
    businessPreferencesIncluded: payload.businessPreferences !== undefined,
  };
}
