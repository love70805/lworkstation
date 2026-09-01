import { buildCloudSeedPayload } from "../../domain/cloudSeed";
import { CLOUD_SEED_TABLES } from "../../domain/cloudSeed";
import { replaySyncRecoveryPayload } from "../../domain/syncRecovery";
import {
  validateWorkspaceBackupPayload,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_VERSION,
} from "../../domain/workspaceBackup";
import { buildWorkspaceOperationalSummary } from "../../domain/workspaceSummary";
import { db } from "../db/clientDatabase";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
} from "../db/constants";
import {
  ensureDefaultWorkspace,
  getActiveMemberContext,
  selectionRecordVisible,
} from "./selectionRepository";
export async function getWorkspaceOperationalSummary() {
  const [captures, products, platformSkus, ledgers, auditEvents, tableCountEntries, context] = await Promise.all([
    db.captures.toArray(),
    db.products.toArray(),
    db.platformSkus.toArray(),
    db.ledgers.toArray(),
    db.auditEvents.toArray(),
    Promise.all(db.tables.map(async (table) => [table.name, await table.count()])),
    getActiveMemberContext(),
  ]);

  const visibleProducts = products.filter((product) => selectionRecordVisible(product, context));
  const visibleProductIds = new Set(visibleProducts.map((product) => product.id));
  const visibleCaptures = captures.filter((capture) => selectionRecordVisible(capture, context));
  const visibleSkus = platformSkus.filter((sku) => !sku.productId || visibleProductIds.has(sku.productId));
  const tableCounts = Object.fromEntries(tableCountEntries);
  tableCounts.products = visibleProducts.length;
  tableCounts.captures = visibleCaptures.length;
  tableCounts.platformSkus = visibleSkus.length;

  return buildWorkspaceOperationalSummary({
    captures: visibleCaptures,
    products: visibleProducts,
    platformSkus: visibleSkus,
    ledgers,
    auditEvents,
    tableCounts,
  });
}

export async function createWorkspaceBackupPayload() {
  await ensureDefaultWorkspace();
  const generatedAt = new Date().toISOString();
  const tableEntries = await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()]));
  const tables = Object.fromEntries(tableEntries);
  const recordCount = tableEntries.reduce((sum, [, rows]) => sum + rows.length, 0);

  return {
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_VERSION,
    applicationVersion: "0.1.0",
    databaseName: db.name,
    databaseVersion: db.verno,
    workspaceId: DEFAULT_WORKSPACE_ID,
    currency: "CNY",
    generatedAt,
    recordCount,
    tables,
  };
}

export async function createWorkspaceCloudSeedPayload() {
  const backupPayload = await createWorkspaceBackupPayload();
  return buildCloudSeedPayload(backupPayload);
}

export async function recordWorkspaceBackupExport({
  fileName,
  sizeBytes,
  recordCount,
  generatedAt,
  exportedBy = "local-user",
  exportKind = "local_backup",
}) {
  const createdAt = generatedAt ?? new Date().toISOString();
  const metadata = {
    fileName,
    sizeBytes: Number(sizeBytes ?? 0),
    recordCount: Number(recordCount ?? 0),
    generatedAt: createdAt,
    exportKind,
  };
  const settingKey = exportKind === "cloud_seed" ? "lastCloudSeedExport" : "lastBackupExport";
  await db.transaction("rw", db.settings, db.auditEvents, async () => {
    if (exportKind === "cloud_seed") {
      const legacyBackupSetting = await db.settings.get("lastBackupExport");
      if (legacyBackupSetting?.value?.exportKind === "cloud_seed") await db.settings.delete("lastBackupExport");
    }
    await db.settings.put({ key: settingKey, value: metadata, updatedAt: createdAt });
    await db.auditEvents.add({
      workspaceId: DEFAULT_WORKSPACE_ID,
      objectType: "backup",
      objectId: fileName,
      action: exportKind === "cloud_seed" ? "cloud_seed_exported" : "backup_exported",
      actorId: exportedBy,
      createdAt,
      after: metadata,
    });
  });
  return metadata;
}

export async function recordCloudSeedImportReceipt({
  fileName,
  preflight,
  receipt,
  importedBy = "local-user",
}) {
  const importedAt = new Date().toISOString();
  const metadata = {
    fileName,
    workspaceId: receipt.workspaceId,
    seedFingerprint: receipt.seedFingerprint,
    importVersion: receipt.importVersion,
    insertedCount: Number(receipt.insertedCount ?? 0),
    unchangedCount: Number(receipt.unchangedCount ?? 0),
    conflictCount: Number(preflight?.conflictCount ?? 0),
    idempotent: Boolean(receipt.idempotent),
    importedAt,
  };
  await db.transaction("rw", db.settings, db.auditEvents, async () => {
    await db.settings.put({ key: "lastCloudSeedImport", value: metadata, updatedAt: importedAt });
    await db.auditEvents.add({
      workspaceId: receipt.workspaceId ?? DEFAULT_WORKSPACE_ID,
      objectType: "cloud_migration",
      objectId: receipt.seedFingerprint ?? fileName,
      action: "cloud_seed_imported",
      actorId: importedBy,
      createdAt: importedAt,
      after: metadata,
    });
  });
  return metadata;
}

export async function getDataSecuritySnapshot() {
  const [summary, lastBackupSetting, lastCloudSeedSetting, lastCloudImportSetting, lastSyncRecoverySetting, auditEvents, tableCountEntries] = await Promise.all([
    getWorkspaceOperationalSummary(),
    db.settings.get("lastBackupExport"),
    db.settings.get("lastCloudSeedExport"),
    db.settings.get("lastCloudSeedImport"),
    db.settings.get("lastSyncRecovery"),
    db.auditEvents.toArray(),
    Promise.all(db.tables.map(async (table) => [table.name, await table.count()])),
  ]);
  const securityEvents = auditEvents
    .filter((event) => ["backup", "cloud_migration", "cloud_recovery"].includes(event.objectType) || event.action === "workspace_reset")
    .toSorted((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, 20);
  return {
    summary,
    lastBackup: lastBackupSetting?.value ?? null,
    lastCloudSeed: lastCloudSeedSetting?.value ?? null,
    lastCloudImport: lastCloudImportSetting?.value ?? null,
    lastSyncRecovery: lastSyncRecoverySetting?.value ?? null,
    backupEvents: securityEvents.filter((event) => event.objectType === "backup"),
    securityEvents,
    tableCounts: Object.fromEntries(tableCountEntries),
  };
}

export async function restoreWorkspaceBackupPayload(payload, restoredBy = "local-user") {
  const tableNames = db.tables.map((table) => table.name);
  const inspection = validateWorkspaceBackupPayload(payload, { tableNames });
  const restoredAt = new Date().toISOString();

  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    for (const table of db.tables) {
      const rows = payload.tables[table.name] ?? [];
      if (rows.length > 0) await table.bulkAdd(rows);
    }
    if (await db.workspaces.count() === 0) {
      await db.workspaces.put({
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        defaultCurrency: "CNY",
        timezone: "Asia/Shanghai",
        createdAt: restoredAt,
        updatedAt: restoredAt,
      });
    }
    await db.auditEvents.add({
      workspaceId: payload.workspaceId ?? DEFAULT_WORKSPACE_ID,
      objectType: "backup",
      objectId: `RESTORE-${restoredAt}`,
      action: "backup_restored",
      actorId: restoredBy,
      createdAt: restoredAt,
      after: {
        sourceGeneratedAt: payload.generatedAt ?? null,
        recordCount: inspection.recordCount,
        databaseVersion: payload.databaseVersion ?? null,
      },
    });
  });

  return inspection;
}

export async function restoreWorkspaceSyncRecoveryPayload(payload, restoredBy = "local-user") {
  const recovery = replaySyncRecoveryPayload(payload);
  const restoredAt = new Date().toISOString();
  const restorableTables = CLOUD_SEED_TABLES.filter((name) => db.tables.some((table) => table.name === name));

  await db.transaction("rw", db.tables, async () => {
    for (const tableName of restorableTables) await db.table(tableName).clear();
    for (const tableName of restorableTables) {
      const rows = recovery.tables[tableName] ?? [];
      if (rows.length > 0) await db.table(tableName).bulkAdd(rows);
    }
    await db.settings.put({
      key: "lastSyncRecovery",
      value: {
        workspaceId: recovery.workspaceId,
        sourceGeneratedAt: recovery.generatedAt,
        sourceCursor: recovery.cursor,
        recordCount: recovery.recordCount,
        restoredAt,
      },
      updatedAt: restoredAt,
    });
    await db.auditEvents.add({
      workspaceId: recovery.workspaceId,
      objectType: "cloud_recovery",
      objectId: `RECOVERY-${restoredAt}`,
      action: "sync_recovery_restored",
      actorId: restoredBy,
      createdAt: restoredAt,
      after: {
        sourceGeneratedAt: recovery.generatedAt,
        sourceCursor: recovery.cursor,
        recordCount: recovery.recordCount,
      },
    });
  });

  return {
    workspaceId: recovery.workspaceId,
    recordCount: recovery.recordCount,
    eventCount: recovery.tables.auditEvents.length,
    cursor: recovery.cursor,
    restoredAt,
  };
}

export async function clearLocalWorkspaceData(clearedBy = "local-user") {
  const clearedAt = new Date().toISOString();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await db.workspaces.put({
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
      createdAt: clearedAt,
      updatedAt: clearedAt,
    });
    await db.auditEvents.add({
      workspaceId: DEFAULT_WORKSPACE_ID,
      objectType: "workspace",
      objectId: DEFAULT_WORKSPACE_ID,
      action: "workspace_reset",
      actorId: clearedBy,
      createdAt: clearedAt,
      after: { status: "empty", currency: "CNY" },
    });
  });
}

