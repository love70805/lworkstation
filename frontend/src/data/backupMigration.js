import Dexie from 'dexie';
import { db, createClientDatabase, createBackupSeedDatabase, BACKUP_MIGRATION_DATABASE_PREFIX, CLIENT_DATABASE_BACKUP_SCHEMAS } from './db/clientDatabase';
import { createWorkspaceBackupManifest, validateWorkspaceBackupPayload } from '../domain/workspaceBackup';
import { validateReportBackup } from '../domain/profitReportBackup';

function validateUpgradedSales(tables) {
  const ledgers = new Map(tables.ledgers.map(ledger => [ledger.id, ledger]));
  const batches = new Map(tables.importBatches.map(batch => [batch.id, batch]));
  for (const row of tables.salesRows) {
    const ledger = ledgers.get(row.ledgerId), batch = batches.get(row.batchId);
    // Some supported historical rows predate batch provenance; their owned
    // ledger is sufficient. An explicit batch reference must still resolve.
    if (!ledger || (row.batchId != null && row.batchId !== '' && (!batch || batch.ledgerId !== ledger.id))
      || row.workspaceId && row.workspaceId !== ledger.workspaceId
      || batch?.workspaceId && batch.workspaceId !== ledger.workspaceId) {
      throw new Error('旧备份销售记录缺少有效账本或导入归属，未替换现有数据。');
    }
  }
}

// Never seed an old backup directly into the already-upgraded business database:
// Dexie runs content upgrades only while opening a lower schema version.
export async function prepareWorkspaceBackupForRestore(payload) {
  const validation = { tableNames: db.tables.map(table => table.name), schemas: CLIENT_DATABASE_BACKUP_SCHEMAS };
  validateWorkspaceBackupPayload(payload, validation);
  await validateReportBackup(payload.tables);
  const version = Number(payload.databaseVersion);
  if (version === db.verno) return payload;
  const historicalTables = new Set(CLIENT_DATABASE_BACKUP_SCHEMAS[version]);
  if (Object.entries(payload.tables).some(([name, rows]) => !historicalTables.has(name) && rows.length)) {
    throw new Error('备份包含声明数据库版本之后的数据表，未替换现有数据。');
  }

  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request === 'function') {
    // A cross-document lock proves that matching databases left by a terminated
    // restore are no longer in use. Unsupported tooling only deletes its own DB.
    return locks.request('shopeers-backup-migration', async () => {
      const pattern = new RegExp(`^${BACKUP_MIGRATION_DATABASE_PREFIX}[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`);
      for (const name of await Dexie.getDatabaseNames()) if (pattern.test(name)) await Dexie.delete(name);
      return migrateBackup(payload, version, validation);
    });
  }
  return migrateBackup(payload, version, validation);
}

async function migrateBackup(payload, version, validation) {
  const name = `${BACKUP_MIGRATION_DATABASE_PREFIX}${crypto.randomUUID()}`;
  const seed = createBackupSeedDatabase(name, version);
  let upgraded;
  try {
    await seed.open();
    await seed.transaction('rw', seed.tables, async () => {
      for (const table of seed.tables) {
        const rows = payload.tables[table.name] ?? [];
        if (rows.length) await table.bulkAdd(rows);
      }
    });
    seed.close();
    upgraded = createClientDatabase(name);
    await upgraded.open();
    const tables = await upgraded.transaction('r', upgraded.tables, async () => Object.fromEntries(
      await Promise.all(upgraded.tables.map(async table => [table.name, await table.toArray()]))));
    validateUpgradedSales(tables);
    const result = { ...payload, databaseVersion: upgraded.verno, tables,
      recordCount: Object.values(tables).reduce((total, rows) => total + rows.length, 0) };
    result.manifest = createWorkspaceBackupManifest(result);
    validateWorkspaceBackupPayload(result, validation);
    await validateReportBackup(tables);
    return result;
  } finally {
    seed.close();
    upgraded?.close();
    // A failed upgrade or cleanup must finish before the caller can clear live data.
    await seed.delete();
  }
}
