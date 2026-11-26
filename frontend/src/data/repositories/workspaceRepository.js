import { buildCloudSeedPayload } from "../../domain/cloudSeed";
import { CLOUD_SEED_TABLES } from "../../domain/cloudSeed";
import { REPORT_TABLES } from "../../domain/profitReports";
import { replaySyncRecoveryPayload } from "../../domain/syncRecovery";
import { clearDesktopInboxData } from "../../lib/clearDesktopInboxData";
import { clearAllCostDrafts,captureCostDrafts } from "../../lib/costMatchingDraft";
import {callWorkspaceSafety,prepareDesktopRestore} from '../../lib/workspaceSafety';
import {DESKTOP_RESTORE_COMMIT,WORKSPACE_CLEAR_CONFIRMATION} from '../../../../integrations/contracts/desktop-inbox-backup.mjs';
import applicationPackage from '../../../package.json';
import { withWorkspaceReset, setWorkspaceRecoveryError } from "../../lib/workspaceBackgroundTasks";
import { captureBusinessPreferences, preparePreferenceRestore, applyPreferenceRestore, finishPreferenceRestore,
  readPreferenceRestoreJournal, PREFERENCE_RESTORE_COMMIT, clearBusinessPreferences } from '../../lib/businessPreferencesBackup';
import {
  validateWorkspaceBackupPayload,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_VERSION,
  createWorkspaceBackupManifest,
} from "../../domain/workspaceBackup";
import { buildWorkspaceOperationalSummary } from "../../domain/workspaceSummary";
import { db, CLIENT_DATABASE_BACKUP_SCHEMAS } from "../db/clientDatabase";
import { prepareWorkspaceBackupForRestore } from '../backupMigration';
import { withVerifiedLedgerCostSummaries } from "./profitRepository";
import { cachedDerived, observeSourceRevision, sourceRevision, observeTableRevision, tableRevisionReader, assertSourceRevision, retrySourceRead } from "../db/derivedCache";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
} from "../db/constants";
import {
  ensureDefaultWorkspace,
  getActiveMemberContext,
  selectionRecordVisible,
} from "./selectionRepository";
let lastNavigationSummary;
export async function getWorkspaceOperationalSummary({ includeRecordCount = true, navigationOnly = false } = {}) {
  return retrySourceRead(async () => {
    const observable = await observeSourceRevision();
    const revision = sourceRevision();
    const context = await getActiveMemberContext();
    assertSourceRevision(revision);
    const scope = [context.workspaceId, context.memberId, context.role];
    const key = JSON.stringify([revision, ...scope]);
    if (navigationOnly) {
      if (observable && lastNavigationSummary?.key === key) return lastNavigationSummary.value;
      const captures = (await summaryProjection('captures')).filter(row => selectionRecordVisible(row, context));
      assertSourceRevision(revision);
      return { ...buildWorkspaceOperationalSummary({ captures }), navigationOnly: true, recordCount: null };
    }
    const compute = () => readWorkspaceOperationalSummary(context, observable, includeRecordCount);
    const summary = observable ? await cachedDerived({
      scope, formula: includeRecordCount ? "workspace-operational-summary@5-confirmed-zero" : "workspace-shell-summary@3-confirmed-zero", revision, compute,
    }) : await compute();
    assertSourceRevision(revision);
    const {pendingCaptureCount, blockedCaptureCount, latestCaptureAt, missingCostCount, latestOpenLedger} = summary;
    lastNavigationSummary = {key, value: {pendingCaptureCount, blockedCaptureCount, latestCaptureAt, missingCostCount,
      latestOpenLedger: latestOpenLedger && {id:latestOpenLedger.id, period:latestOpenLedger.period, status:latestOpenLedger.status, updatedAt:latestOpenLedger.updatedAt}, recordCount:null}};
    return summary;
  });
}

// These counters never need images, product drafts or immutable purchase
// evidence. Cache compact projections against the actual table revision so
// unrelated audit/receipt updates do not clone the catalog on every page.
async function summaryProjection(name) {
  const table=db.table(name),revisionReader=tableRevisionReader(name);
  await observeTableRevision(name);
  await table.count(); // Independent live-query dependency if the sidecar fails.
  const compute=async()=>{
    const rows=[];
    await table.each(row=>{
      const fields=['id','workspaceId','status','visibility','ownerId','productId','capturedAt','updatedAt','createdAt'];
      const value=Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
      if(name==='captures')value.validation={blockingCount:Number(row.validation?.blockingCount??0),blocking:row.validation?.blocking?.length?[true]:[]};
      if(name==='captures'&&row.blockingIssues?.length)value.blockingIssues=[true];
      rows.push(value);
    });
    return rows;
  };
  const revision=revisionReader();
  return revision?cachedDerived({scope:[],formula:`workspace-summary-projection@1:${name}`,revision,revisionReader,boundedMemory:true,compute}):compute();
}

async function cachedWorkspaceCount(table,context,ledgerIds) {
  const revisionReader=tableRevisionReader(table.name);
  await observeTableRevision(table.name);
  // Counting primary keys observes equal-count value changes without reading
  // large records. Ledger ownership remains part of the legacy cost key.
  await table.count();
  const compute=()=>table.name==='erpCostRows'
    ?table.where('ledgerId').anyOf(ledgerIds).filter(row=>!row.workspaceId||row.workspaceId===context.workspaceId).count()
    :table.where('workspaceId').equals(context.workspaceId).count();
  const revision=revisionReader();
  return revision?cachedDerived({scope:[context.workspaceId,...(table.name==='erpCostRows'?[ledgerIds.toSorted()]:[])],formula:`workspace-summary-count@1:${table.name}`,revision,revisionReader,boundedMemory:true,compute}):compute();
}

async function readWorkspaceOperationalSummary(context, observable, includeRecordCount) {
  const inWorkspace = (record) => record.workspaceId === context.workspaceId;
  const ledgers = await db.ledgers.where("workspaceId").equals(context.workspaceId).toArray();
  const ledgerIds = ledgers.map((ledger) => ledger.id);
  const [captures, products, platformSkus, latestActivity, tableCountEntries] = await Promise.all([
    summaryProjection('captures'),
    summaryProjection('products'),
    summaryProjection('platformSkus'),
    // The shell displays one timestamp, not the immutable audit payloads.
    db.auditEvents.orderBy("createdAt").reverse().filter(inWorkspace).first(),
    includeRecordCount ? Promise.all(db.tables.map(async (table) => {
      if (table.name === "workspaces") return [table.name, await table.where("id").equals(context.workspaceId).count()];
      // Settings are device metadata. Keep their existing global count semantics.
      if (table.name === "settings") return [table.name, await table.count()];
      if (table.name === "salesRows" && observable) {
        // Indexed workspace counts still walk a million index entries. Catalog
        // saves cannot change this count; all ledger/context writes invalidate
        // the conservative financial-source version before and after commit.
        const count = await cachedWorkspaceCount(table,context,ledgerIds);
        return [table.name, count];
      }
      if (table.schema.idxByName.workspaceId) return [table.name, await table.where("workspaceId").equals(context.workspaceId).count()];
      // Legacy ERP rows have no workspace index; derive ownership through their ledger.
      if (table.name === "erpCostRows") return [table.name, await cachedWorkspaceCount(table,context,ledgerIds)];
      return [table.name, 0];
    })) : [],
  ]);

  const visibleProducts = products.filter((product) => selectionRecordVisible(product, context));
  const visibleProductIds = new Set(visibleProducts.map((product) => product.id));
  const visibleCaptures = captures.filter((capture) => selectionRecordVisible(capture, context));
  const visibleSkus = platformSkus.filter((sku) => (
    (inWorkspace(sku) || (!sku.workspaceId && sku.productId && visibleProductIds.has(sku.productId)))
    && (!sku.productId || visibleProductIds.has(sku.productId))
  ));
  const tableCounts = Object.fromEntries(tableCountEntries);
  tableCounts.products = visibleProducts.length;
  tableCounts.captures = visibleCaptures.length;
  tableCounts.platformSkus = visibleSkus.length;
  const verifiedLedgers = await withVerifiedLedgerCostSummaries(ledgers);

  const summary = buildWorkspaceOperationalSummary({
    captures: visibleCaptures,
    products: visibleProducts,
    platformSkus: visibleSkus,
    ledgers: verifiedLedgers.filter(inWorkspace),
    auditEvents: latestActivity ? [{ createdAt: latestActivity.createdAt }] : [],
    tableCounts,
  });
  return includeRecordCount ? summary : { ...summary, recordCount: null };
}

export async function createWorkspaceBackupPayload() {
  if (readPreferenceRestoreJournal()) throw new Error('上次业务筛选配置恢复尚未完成，请先重试恢复检查。');
  if(await db.settings.get(DESKTOP_RESTORE_COMMIT))throw new Error('上次完整恢复尚未完成，请先重试恢复检查。');
  await ensureDefaultWorkspace();
  const generatedAt = new Date().toISOString();
  const tableEntries = await db.transaction("r", db.tables, () => Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])));
  const tables = Object.fromEntries(tableEntries);
  const recordCount = tableEntries.reduce((sum, [, rows]) => sum + rows.length, 0);

  const payload = {
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_VERSION,
    applicationVersion: applicationPackage.version,
    databaseName: db.name,
    databaseVersion: db.verno,
    workspaceId: DEFAULT_WORKSPACE_ID,
    currency: "CNY",
    generatedAt,
    recordCount,
    tables,
  };
  const businessPreferences = captureBusinessPreferences((tables.workspaces ?? []).map(workspace => workspace.id));
  if (businessPreferences !== undefined) payload.businessPreferences = businessPreferences;
  payload.localCostDrafts=captureCostDrafts();
  payload.manifest = createWorkspaceBackupManifest(payload);
  return payload;
}

export async function createWorkspaceCloudSeedPayload() {
  const backupPayload = await createWorkspaceBackupPayload();
  if (REPORT_TABLES.some(name => backupPayload.tables[name]?.length)) throw new Error("本机报告及补充来源不支持云端种子，请使用完整本机备份。");
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
  // This panel reports the local database that the backup and clear commands
  // operate on. Counting object stores needs neither ledger coverage nor evidence.
  const [lastBackupSetting, lastCloudSeedSetting, lastCloudImportSetting, lastSyncRecoverySetting, tableCountEntries, auditEvents] = await Promise.all([
    db.settings.get("lastBackupExport"),
    db.settings.get("lastCloudSeedExport"),
    db.settings.get("lastCloudSeedImport"),
    db.settings.get("lastSyncRecovery"),
    Promise.all(db.tables.map(async (table) => [table.name, await table.count()])),
    recentSecurityEvents(),
  ]);
  const tableCounts = Object.fromEntries(tableCountEntries);
  return {
    summary: { recordCount: Object.values(tableCounts).reduce((sum, count) => sum + count, 0) },
    lastBackup: lastBackupSetting?.value ?? null,
    lastCloudSeed: lastCloudSeedSetting?.value ?? null,
    lastCloudImport: lastCloudImportSetting?.value ?? null,
    lastSyncRecovery: lastSyncRecoverySetting?.value ?? null,
    backupEvents: auditEvents.filter((event) => event.objectType === "backup"),
    securityEvents: auditEvents,
    tableCounts,
  };
}

async function recentSecurityEvents() {
  const events = [];
  await db.auditEvents.where('objectType').anyOf(['backup','cloud_migration','cloud_recovery','workspace']).each(event => {
    if (event.objectType === 'workspace' && event.action !== 'workspace_reset') return;
    const { id, createdAt, action, objectId, objectType, after = {} } = event;
    const { fileName, recordCount, sourceGeneratedAt, importVersion, insertedCount, sourceCursor } = after ?? {};
    events.push({id, createdAt, action, objectId, objectType, after: {fileName, recordCount, sourceGeneratedAt, importVersion, insertedCount, sourceCursor}});
    events.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    if (events.length > 20) events.pop();
  });
  return events;
}
export function inspectWorkspaceBackupPayload(payload) {
  return validateWorkspaceBackupPayload(payload, {
    tableNames: db.tables.map(table => table.name), schemas: CLIENT_DATABASE_BACKUP_SCHEMAS,
  });
}

async function resolvePreferenceJournal() {
  try {
    const desktopMarker=await db.settings.get(DESKTOP_RESTORE_COMMIT);
    const desktopRecovery=await callWorkspaceSafety('recoverInboxRestore',{committedId:desktopMarker?.value},{optional:!desktopMarker});
    if(desktopMarker)await db.settings.delete(DESKTOP_RESTORE_COMMIT);
    if(desktopRecovery?.id)await callWorkspaceSafety('finishInboxRestore',{id:desktopRecovery.id});
    const journal = readPreferenceRestoreJournal();
    if (journal) {
      const marker = await db.settings.get(PREFERENCE_RESTORE_COMMIT);
      applyPreferenceRestore(journal, marker?.value === journal.id);
      finishPreferenceRestore();
    }
    setWorkspaceRecoveryError();
  } catch (error) {
    setWorkspaceRecoveryError(`业务筛选配置恢复未完成：${error.message} 请重试恢复检查。`);
    throw error;
  }
}
let preferenceRecovery;
export function recoverWorkspacePreferenceRestore() {
  preferenceRecovery ??= withWorkspaceReset(resolvePreferenceJournal).finally(() => { preferenceRecovery = null; });
  return preferenceRecovery;
}

export async function restoreWorkspaceBackupPayload(payload, restoredBy = "local-user", { beforeRestore } = {}) {
  const sourceDatabaseVersion = Number(payload?.databaseVersion);
  return withWorkspaceReset(async () => {
    payload = await prepareWorkspaceBackupForRestore(payload);
    const inspection = inspectWorkspaceBackupPayload(payload);
    await resolvePreferenceJournal();
    await beforeRestore?.();
    const restoredAt = new Date().toISOString();
    let journal, committed = false;
    try {
      const desktop=payload.desktopInbox?await prepareDesktopRestore(payload.desktopInbox,await createWorkspaceBackupPayload(),payload):null;
      journal = preparePreferenceRestore(payload.businessPreferences,globalThis.localStorage,{costDrafts:payload.localCostDrafts});
      await db.transaction("rw", db.tables, async () => {
        for (const table of db.tables) await table.clear();
        for (const table of db.tables) {
          const rows = (payload.tables[table.name] ?? []).filter(row=>table.name!=='settings'||row.key!==DESKTOP_RESTORE_COMMIT);
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
            sourceDatabaseVersion,
          },
        });
        if (journal) {
          await db.settings.put({ key: PREFERENCE_RESTORE_COMMIT, value: journal.id, updatedAt: restoredAt });
          applyPreferenceRestore(journal, true);
        }
        if(desktop)await db.settings.put({key:DESKTOP_RESTORE_COMMIT,value:desktop.id,updatedAt:restoredAt});
      });
      committed = true;
      if(desktop)await resolvePreferenceJournal();
      if (journal) finishPreferenceRestore();
    } catch (error) {
      // IndexedDB is atomic. The durable marker selects rollback or completion
      // after a failed write, failed commit, or an interrupted process.
      await resolvePreferenceJournal();
      if (!committed) throw error;
    }
    return inspection;
  });
}

export async function restoreWorkspaceSyncRecoveryPayload(payload, restoredBy = "local-user", { beforeRestore } = {}) {
  const recovery = replaySyncRecoveryPayload(payload);
  return withWorkspaceReset(async () => {
    await resolvePreferenceJournal();
    await beforeRestore?.();
    const restoredAt = new Date().toISOString();
    const restorableTables = CLOUD_SEED_TABLES.filter((name) => db.tables.some((table) => table.name === name));

    await db.transaction("rw", db.tables, async () => {
      if ((await Promise.all(REPORT_TABLES.map(name => db.table(name).count()))).some(Boolean)) throw new Error("已有本机报告或补充来源，不能使用旧云恢复替换父账本；请恢复完整本机备份。");
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
  });
}

export async function clearLocalWorkspaceData(clearedBy = "local-user",{onProgress}={}) {
  onProgress?.('正在等待后台完成当前写入…');
  return withWorkspaceReset(async () => {
    if(readPreferenceRestoreJournal()||await db.settings.get(DESKTOP_RESTORE_COMMIT))throw new Error('上次恢复尚未完成，请先重试恢复检查。');
    let desktopCleared=false;
    try {
      onProgress?.('正在清空桌面收件和采集任务…');
      await clearDesktopInboxData(undefined,{confirmation:WORKSPACE_CLEAR_CONFIRMATION});
      desktopCleared=true;
      clearAllCostDrafts();
      clearBusinessPreferences();
      onProgress?.('正在清空本机账本和业务记录…');
      await clearWorkspaceTables(clearedBy);
      return {ok:true};
    }catch(error){error.clearStarted=desktopCleared||error.clearStarted===true;throw error;}
  });
}

async function clearWorkspaceTables(clearedBy) {
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
      after: { status: "empty", currency: "CNY", automaticBackup: false },
    });
  });
}

