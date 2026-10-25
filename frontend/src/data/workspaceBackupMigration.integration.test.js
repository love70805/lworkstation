// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, CLIENT_DATABASE_NAME, CLIENT_DATABASE_BACKUP_SCHEMAS, BACKUP_MIGRATION_DATABASE_PREFIX, createBackupSeedDatabase } from './db/clientDatabase';
import { prepareWorkspaceBackupForRestore } from './backupMigration';
import { restoreWorkspaceBackupPayload } from './repositories/workspaceRepository';
import { getLedgerSnapshot, listLedgerSummaries } from './repositories/profitRepository';
import { setWorkspaceRecoveryError } from '../lib/workspaceBackgroundTasks';

const workspaceId = 'workspace-default';
const legacyPayload = (version, rows) => {
  const tables = Object.fromEntries(CLIENT_DATABASE_BACKUP_SCHEMAS[version].map(name => [name, rows[name] ?? []]));
  return { format: 'shopeers-local-backup', formatVersion: 1, databaseName: CLIENT_DATABASE_NAME,
    databaseVersion: version, workspaceId, tables,
    recordCount: Object.values(tables).reduce((total, entries) => total + entries.length, 0) };
};
const versionOne = () => legacyPayload(1, {
  importBatches: [{ id: 'B1', createdAt: '2026-08-05T00:00:00Z', status: 'imported', store: '合成甲店', fileName: 'synthetic.csv' }],
  salesRows: [{ id: 1, batchId: 'B1', sku: 'AUDIT-SKU', store: '合成甲店', orderId: 'SYNTHETIC-1', quantity: 2, amount: 100 }],
});
const temporaryNames = async () => (await Dexie.getDatabaseNames()).filter(name => name.startsWith(BACKUP_MIGRATION_DATABASE_PREFIX));
beforeEach(async () => {
  localStorage.clear(); setWorkspaceRecoveryError();
  await db.delete(); await db.open();
  await db.captures.put({ id: 'CURRENT', workspaceId, name: 'keep unless restore succeeds' });
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  db.close(); await db.delete(); localStorage.clear(); setWorkspaceRecoveryError();
  for (const name of await temporaryNames()) await Dexie.delete(name);
});

it('restores nonempty v1 sales into an accessible monthly ledger without mutating the source', async () => {
  const payload = versionOne(), original = structuredClone(payload);
  const receipt = await restoreWorkspaceBackupPayload(payload);
  const ledgers = await listLedgerSummaries();
  expect(ledgers).toHaveLength(1);
  expect(ledgers[0]).toMatchObject({ period: '2026-08', workspaceId, currency: 'CNY', summary: { quantity: 2, revenue: 100 } });
  const snapshot = await getLedgerSnapshot(ledgers[0].id);
  expect(snapshot.rows).toHaveLength(1);
  expect(snapshot.rows[0]).toMatchObject({ ledgerId: ledgers[0].id, workspaceId, platformSku: 'AUDIT-SKU', store: '合成甲店', quantity: 2, amount: 100 });
  expect(receipt.databaseVersion).toBe(db.verno);
  expect(await db.captures.get('CURRENT')).toBeUndefined();
  expect((await db.auditEvents.toArray()).find(event => event.action === 'backup_restored').after).toMatchObject({ sourceDatabaseVersion: 1, databaseVersion: db.verno });
  expect(payload).toEqual(original);
  expect(await temporaryNames()).toEqual([]);
});

it('runs v9 offer migration while preserving finalized financial and manual snapshots exactly', async () => {
  const ledger = { id: 'L9', workspaceId, period: '2026-09', status: 'finalized', summary: { revenue: 10 }, finalizedAt: '2026-09-30' };
  const financial = { id: 1, ledgerId: 'L9', workspaceId, platformSku: 'S9', unitCost: 0.0000001, finalizedAt: '2026-09-30' };
  const approval = { id: 'A9', workspaceId, ledgerId: 'L9', platformSku: 'S9', status: 'approved', unitCost: 0, reason: '合成零成本' };
  const evidence = { id: 1, ledgerId: 'L9', platformSku: 'S9', unitCost: 0.0000001, evidence: { purchases: [{ quantity: 2, amount: 0.0000002 }] } };
  const payload = legacyPayload(9, { workspaces: [{ id: workspaceId }], ledgers: [ledger], profitLines: [financial], costApprovals: [approval], erpCostRows: [evidence],
    products: [{ id: 'P9', workspaceId }], supplierOffers: [{ id: 'O9', workspaceId, productId: 'P9', platformSku: 'S9', supplierName: '合成供应商' }] });
  const original = structuredClone(payload);
  await restoreWorkspaceBackupPayload(payload);
  expect(await db.ledgers.get('L9')).toEqual(ledger);
  expect(await db.profitLines.get(1)).toEqual(financial);
  expect(await db.costApprovals.get('A9')).toEqual(approval);
  expect(await db.erpCostRows.get(1)).toEqual(evidence);
  expect(await db.supplierOffers.get('O9')).toMatchObject({ status: 'active', supplierId: expect.any(String), offerKey: 'P9\u001fO9\u001fS9' });
  expect(payload).toEqual(original);
  expect(await temporaryNames()).toEqual([]);
});

it('rejects orphaned legacy sales before rollback backup or live replacement', async () => {
  const payload = versionOne(); payload.tables.importBatches = []; payload.recordCount = 1;
  const beforeRestore = vi.fn();
  await expect(restoreWorkspaceBackupPayload(payload, 'audit', { beforeRestore })).rejects.toThrow('缺少有效账本');
  expect(beforeRestore).not.toHaveBeenCalled();
  expect(await db.captures.get('CURRENT')).toBeTruthy();
  expect(await temporaryNames()).toEqual([]);
});

it('cleans a failed content upgrade and preserves current data and cache clocks', async () => {
  const payload = legacyPayload(9, { supplierOffers: [{ id: 'INVALID', productId: 'P', workspaceId, platformSku: '' }] });
  const keys = ['shopeers-derived-source-revision-v1', 'shopeers-selection-facts-revision-v1'];
  const before = keys.map(key => localStorage.getItem(key));
  await expect(restoreWorkspaceBackupPayload(payload)).rejects.toThrow('SKU');
  expect(await db.captures.get('CURRENT')).toBeTruthy();
  expect(await temporaryNames()).toEqual([]);
  expect(keys.map(key => localStorage.getItem(key))).toEqual(before);
});

it('rejects extra nonempty tables that cannot belong to the declared source version', async () => {
  const payload = versionOne(); payload.tables.captures = [{ id: 'NEWER' }]; payload.recordCount++;
  await expect(restoreWorkspaceBackupPayload(payload)).rejects.toThrow('声明数据库版本之后');
  expect(await db.captures.get('CURRENT')).toBeTruthy();
  expect(await temporaryNames()).toEqual([]);
});

it('reclaims interrupted migration databases only under the cross-document lock', async () => {
  const abandonedName = `${BACKUP_MIGRATION_DATABASE_PREFIX}${crypto.randomUUID()}`;
  const abandoned = createBackupSeedDatabase(abandonedName, 1);
  await abandoned.open(); await abandoned.salesRows.add({ batchId: 'ABANDONED' }); abandoned.close();
  const request = vi.fn(async (_name, action) => action());
  vi.stubGlobal('navigator', { locks: { request } });
  const before = await db.captures.get('CURRENT');
  const result = await prepareWorkspaceBackupForRestore(versionOne());
  expect(request).toHaveBeenCalledWith('shopeers-backup-migration', expect.any(Function));
  expect(await temporaryNames()).toEqual([]);
  expect(result.databaseName).toBe(CLIENT_DATABASE_NAME);
  expect(await db.captures.get('CURRENT')).toEqual(before);
});
