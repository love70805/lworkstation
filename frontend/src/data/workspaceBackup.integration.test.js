// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, CLIENT_DATABASE_BACKUP_SCHEMAS } from './db/clientDatabase';
import { createWorkspaceBackupPayload, inspectWorkspaceBackupPayload, restoreWorkspaceBackupPayload, recoverWorkspacePreferenceRestore } from './repositories/workspaceRepository';
import { getActiveMemberContext, setActiveMemberContext, receiveSelectionCaptureEnvelope } from './repositories/selectionRepository';
import { readSupplierGroups, saveSupplierGroup, rememberSupplierGroupSelection } from '../lib/importSupplierGroups';
import { readImportPreference, saveImportNumbers } from '../lib/importSupplierPreferences';
import { runWorkspaceBackgroundTask, setWorkspaceRecoveryError, getWorkspaceRecoveryError } from '../lib/workspaceBackgroundTasks';
import { receiveAndAcknowledgeInboxRecord } from '../lib/inboxDelivery';
import { captureBusinessPreferences, preparePreferenceRestore, applyPreferenceRestore, PREFERENCE_RESTORE_JOURNAL, PREFERENCE_RESTORE_COMMIT } from '../lib/businessPreferencesBackup';

const workspace = 'workspace-default';
const groupKey = id => `lworkstation:import-supplier-groups:v1:${id}`;
const preferenceKey = id => `lworkstation:import-suppliers:v2:${id}`;
const group = name => saveSupplierGroup(workspace, { id: 'group', name, aliases: ['LBYY', 'LBY'], mode: 'suffix' });
const count = tables => Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
beforeEach(async () => {
  const values = new Map();
  vi.stubGlobal('localStorage', { get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key), clear: () => values.clear() });
  setWorkspaceRecoveryError();
  await db.delete(); await db.open();
  await setActiveMemberContext({ memberId: 'review-user', role: 'admin', workspaceId: workspace });
});
afterEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); setWorkspaceRecoveryError();
  db.close(); await db.delete();
  vi.unstubAllGlobals();
  delete window.shopeersDesktopRuntime;
});

it('round trips desktop receipts, exact manual rows and cost drafts using a commit marker',async()=>{
  const draftKey='shopeers:erp-cost-draft:v12:fixture';
  localStorage.setItem(draftKey,'{"sourceText":"synthetic raw evidence"}');
  await db.erpCostRows.add({ledgerId:'fixture',platformSku:'synthetic',unitCost:0.0000001,source:'manual_override'});
  const payload=await createWorkspaceBackupPayload();
  payload.desktopInbox={format:'lworkstation-desktop-inbox-backup',formatVersion:1,recordCount:1,leaseCount:0,records:[{kind:'batch',deliveryId:'synthetic',status:'pending',envelope:{zero:0}}],leases:[]};
  payload.manifest={...payload.manifest,desktopInboxIncluded:true,desktopRecordCount:1,desktopLeaseCount:0};
  const recover=vi.fn().mockImplementation(async input=>input.committedId?{ok:true,id:input.committedId,phase:'committed'}:{ok:true});
  window.shopeersDesktopRuntime={desktop:true,prepareInboxRestore:vi.fn().mockResolvedValue({ok:true,id:'restore-synthetic'}),recoverInboxRestore:recover,finishInboxRestore:vi.fn().mockResolvedValue({ok:true})};
  await db.erpCostRows.clear();localStorage.removeItem(draftKey);
  await restoreWorkspaceBackupPayload(payload);
  expect((await db.erpCostRows.toArray())[0].unitCost).toBe(0.0000001);
  expect(localStorage.getItem(draftKey)).toContain('synthetic raw evidence');
  expect(recover).toHaveBeenCalledWith({committedId:'restore-synthetic'});
  expect(await db.settings.get('desktopInboxRestoreCommit')).toBeUndefined();
  expect(window.shopeersDesktopRuntime.finishInboxRestore).toHaveBeenCalledWith({id:'restore-synthetic'});
});

it('keeps a failed desktop completion blocked and finishes from its durable IndexedDB marker',async()=>{
  const payload=await createWorkspaceBackupPayload();
  payload.desktopInbox={format:'lworkstation-desktop-inbox-backup',formatVersion:1,recordCount:0,leaseCount:0,records:[],leases:[]};
  payload.manifest={...payload.manifest,desktopInboxIncluded:true,desktopRecordCount:0,desktopLeaseCount:0};
  let failing=true;
  window.shopeersDesktopRuntime={desktop:true,prepareInboxRestore:vi.fn().mockResolvedValue({ok:true,id:'pending-synthetic'}),recoverInboxRestore:vi.fn().mockImplementation(async input=>{
    if(input.committedId&&failing)return {ok:false,error:'synthetic desktop disk failure'};
    return input.committedId?{ok:true,id:input.committedId}:{ok:true};
  }),finishInboxRestore:vi.fn().mockResolvedValue({ok:true})};
  await expect(restoreWorkspaceBackupPayload(payload)).rejects.toThrow('synthetic desktop disk failure');
  expect((await db.settings.get('desktopInboxRestoreCommit')).value).toBe('pending-synthetic');
  expect(await runWorkspaceBackgroundTask(()=> 'must wait')).toBeNull();
  failing=false;await recoverWorkspacePreferenceRestore();
  expect(await db.settings.get('desktopInboxRestoreCommit')).toBeUndefined();
  expect(await runWorkspaceBackgroundTask(()=> 'resumed')).toBe('resumed');
  expect(window.shopeersDesktopRuntime.prepareInboxRestore).toHaveBeenCalledOnce();
});

it('derives required tables from all declared schemas and accepts genuine earlier versions', () => {
  expect(Object.keys(CLIENT_DATABASE_BACKUP_SCHEMAS)).toHaveLength(15);
  expect(CLIENT_DATABASE_BACKUP_SCHEMAS[1]).toEqual(['importBatches', 'salesRows', 'settings']);
  expect(CLIENT_DATABASE_BACKUP_SCHEMAS[15]).toEqual(db.tables.map(table => table.name));
  for (const [version, names] of Object.entries(CLIENT_DATABASE_BACKUP_SCHEMAS)) {
    const payload = { format: 'shopeers-local-backup', formatVersion: 1, databaseVersion: Number(version), recordCount: 0,
      tables: Object.fromEntries(names.map(name => [name, []])) };
    expect(inspectWorkspaceBackupPayload(payload).recordCount).toBe(0);
  }
});

it('rejects missing current tables, wrong totals and wrong manifests before any write', async () => {
  await db.captures.put({ id: 'KEEP', workspaceId: workspace });
  const backup = await createWorkspaceBackupPayload();
  const missing = structuredClone(backup); delete missing.tables.captures;
  await expect(restoreWorkspaceBackupPayload(missing)).rejects.toThrow('必需的数据表');
  const wrongCount = structuredClone(backup); wrongCount.recordCount++;
  await expect(restoreWorkspaceBackupPayload(wrongCount)).rejects.toThrow('记录数不一致');
  const wrongManifest = structuredClone(backup); wrongManifest.manifest.tableCounts.captures++;
  await expect(restoreWorkspaceBackupPayload(wrongManifest)).rejects.toThrow('完整清单');
  const missingPreferences = structuredClone(backup); delete missingPreferences.businessPreferences;
  await expect(restoreWorkspaceBackupPayload(missingPreferences)).rejects.toThrow('完整清单');
  expect(await db.captures.get('KEEP')).toBeTruthy();
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).toBeNull();
});

it('restores a real v14-shaped package without removing newer local business preferences', async () => {
  const backup = await createWorkspaceBackupPayload();
  backup.databaseVersion = 14; delete backup.manifest; delete backup.businessPreferences;
  for (const name of Object.keys(backup.tables)) if (!CLIENT_DATABASE_BACKUP_SCHEMAS[14].includes(name)) delete backup.tables[name];
  backup.recordCount = count(backup.tables);
  group('keep old-format preference');
  await restoreWorkspaceBackupPayload(backup);
  expect(readSupplierGroups(workspace).groups[0].name).toBe('keep old-format preference');
  expect(await db.profitReports.count()).toBe(0);
});

it('round trips groups, last selection, per-store overrides and both import preference versions only', async () => {
  const rule = group('LBYY / LBY');
  rememberSupplierGroupSelection(workspace, [{ storeName: '甲', supplierGroupRule: rule,
    facets: { supplierNumbers: ['A-LBYY', 'B-LBY', 'EXTRA'] }, filterOptions: { supplierNumbers: ['A-LBYY', 'EXTRA'] } }]);
  saveImportNumbers(workspace, [{ storeName: '甲', supplierKeywords: ['LBY'], facets: { supplierNumbers: ['B-LBY'] }, filterOptions: { supplierNumbers: ['B-LBY'] } }]);
  localStorage.setItem(`lworkstation:import-suppliers:v1:${workspace}`, JSON.stringify({ 乙: ['legacy'] }));
  localStorage.setItem('sb-auth-token', 'must-not-export');
  localStorage.setItem('shopeers-appearance', 'dark');
  const saved = captureBusinessPreferences([workspace]), backup = await createWorkspaceBackupPayload();
  expect(JSON.stringify(backup)).not.toContain('must-not-export');
  expect(JSON.stringify(backup)).not.toContain('shopeers-appearance');
  localStorage.clear();
  saveSupplierGroup('OTHER', { id: 'other', name: 'unrelated', aliases: ['OTHER'], mode: 'suffix' });
  await restoreWorkspaceBackupPayload(backup);
  expect(captureBusinessPreferences([workspace])).toEqual(saved);
  expect(readSupplierGroups(workspace)).toMatchObject({ lastAppliedId: rule.id, overrides: { 甲: { include: ['EXTRA'], exclude: ['B-LBY'] } } });
  expect(readImportPreference(workspace, '甲').selected).toEqual(['B-LBY']);
  expect(readSupplierGroups('OTHER').groups).toHaveLength(1);
});

it('rejects unknown preference fields and foreign workspace preferences before restoring', async () => {
  const backup = await createWorkspaceBackupPayload();
  const bad = structuredClone(backup); bad.businessPreferences.workspaces[0].token = 'forbidden';
  await expect(restoreWorkspaceBackupPayload(bad)).rejects.toThrow('筛选配置校验失败');
  const foreign = structuredClone(backup); foreign.businessPreferences.workspaces[0].workspaceId = 'FOREIGN';
  await expect(restoreWorkspaceBackupPayload(foreign)).rejects.toThrow('筛选配置校验失败');
});

it('rejects an unwritable recovery journal before changing either store', async () => {
  group('target'); const backup = await createWorkspaceBackupPayload();
  group('current'); await db.captures.put({ id: 'KEEP', workspaceId: workspace });
  const set = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === PREFERENCE_RESTORE_JOURNAL) throw Error('fixture journal quota');
    set(key, value);
  });
  await expect(restoreWorkspaceBackupPayload(backup)).rejects.toThrow('fixture journal quota');
  expect(await db.captures.get('KEEP')).toBeTruthy();
  expect(readSupplierGroups(workspace).groups[0].name).toBe('current');
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).toBeNull();
  expect(await runWorkspaceBackgroundTask(() => 'resumed')).toBe('resumed');
});

it('rolls back both stores when a preference write fails after an earlier key was written', async () => {
  group('target'); saveImportNumbers(workspace, [{ storeName: '甲', filterOptions: { supplierNumbers: ['NEW'] } }]);
  const backup = await createWorkspaceBackupPayload();
  group('current'); localStorage.removeItem(preferenceKey(workspace));
  await db.captures.put({ id: 'KEEP', workspaceId: workspace });
  const current = captureBusinessPreferences([workspace]);
  const set = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === preferenceKey(workspace)) throw Error('fixture quota');
    set(key, value);
  });
  await expect(restoreWorkspaceBackupPayload(backup)).rejects.toThrow('fixture quota');
  expect(await db.captures.get('KEEP')).toBeTruthy();
  expect(captureBusinessPreferences([workspace])).toEqual(current);
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).toBeNull();
  expect(await runWorkspaceBackgroundTask(() => 'resumed')).toBe('resumed');
});

it('rolls preferences back when IndexedDB aborts after synchronous preference writes', async () => {
  group('target'); const backup = await createWorkspaceBackupPayload();
  group('current'); await db.captures.put({ id: 'KEEP', workspaceId: workspace });
  const set = localStorage.setItem.bind(localStorage); let aborted = false;
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    set(key, value);
    if (!aborted && key === groupKey(workspace) && value.includes('target')) { aborted = true; Dexie.currentTransaction.abort(); }
  });
  await expect(restoreWorkspaceBackupPayload(backup)).rejects.toThrow();
  expect(await db.captures.get('KEEP')).toBeTruthy();
  expect(readSupplierGroups(workspace).groups[0].name).toBe('current');
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).toBeNull();
});

it('holds background work if rollback storage also fails, then recovers from the durable journal', async () => {
  group('target'); saveImportNumbers(workspace, [{ storeName: '甲', filterOptions: { supplierNumbers: ['NEW'] } }]);
  const backup = await createWorkspaceBackupPayload();
  group('current'); localStorage.removeItem(preferenceKey(workspace));
  await db.captures.put({ id: 'KEEP', workspaceId: workspace });
  const set = localStorage.setItem.bind(localStorage); let failed = false;
  const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === preferenceKey(workspace)) { failed = true; throw Error('fixture storage offline'); }
    if (failed && key === groupKey(workspace)) throw Error('rollback offline');
    set(key, value);
  });
  await expect(restoreWorkspaceBackupPayload(backup)).rejects.toThrow('rollback offline');
  expect(await db.captures.get('KEEP')).toBeTruthy();
  expect(getWorkspaceRecoveryError()).toContain('恢复未完成');
  expect(await runWorkspaceBackgroundTask(() => 'must not run')).toBeNull();
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).not.toBeNull();
  spy.mockRestore(); await recoverWorkspacePreferenceRestore();
  expect(readSupplierGroups(workspace).groups[0].name).toBe('current');
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).toBeNull();
  expect(await runWorkspaceBackgroundTask(() => 'resumed')).toBe('resumed');
});

it('does not report success when cleanup fails after commit and completes the committed side on retry', async () => {
  group('target'); const backup = await createWorkspaceBackupPayload();
  group('current'); await db.captures.put({ id: 'KEEP', workspaceId: workspace });
  const remove = localStorage.removeItem.bind(localStorage);
  const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
    if (key === PREFERENCE_RESTORE_JOURNAL) throw Error('fixture cleanup offline');
    remove(key);
  });
  await expect(restoreWorkspaceBackupPayload(backup)).rejects.toThrow('fixture cleanup offline');
  expect(await db.captures.get('KEEP')).toBeUndefined();
  expect(readSupplierGroups(workspace).groups[0].name).toBe('target');
  expect(getWorkspaceRecoveryError()).toContain('恢复未完成');
  expect(await runWorkspaceBackgroundTask(() => 'must not run')).toBeNull();
  spy.mockRestore(); await recoverWorkspacePreferenceRestore();
  expect(readSupplierGroups(workspace).groups[0].name).toBe('target');
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).toBeNull();
  expect(await runWorkspaceBackgroundTask(() => 'resumed')).toBe('resumed');
});

it.each([false, true])('uses the durable database commit marker after interrupted restoration: committed=%s', async committed => {
  group('target'); const preferences = captureBusinessPreferences([workspace]);
  group('current'); const journal = preparePreferenceRestore(preferences);
  applyPreferenceRestore(journal, true);
  if (committed) await db.settings.put({ key: PREFERENCE_RESTORE_COMMIT, value: journal.id });
  await recoverWorkspacePreferenceRestore();
  expect(readSupplierGroups(workspace).groups[0].name).toBe(committed ? 'target' : 'current');
  expect(localStorage.getItem(PREFERENCE_RESTORE_JOURNAL)).toBeNull();
});

it('drains an old scoped receipt before rollback backup and restore; rejects stale scope at the receiver', async () => {
  await setActiveMemberContext({ memberId: 'b', role: 'admin', workspaceId: 'B' });
  await db.workspaces.put({ id: 'B', name: 'B' });
  const backupB = await createWorkspaceBackupPayload();
  await setActiveMemberContext({ memberId: 'a', role: 'admin', workspaceId: 'A' });
  let release, started;
  const ready = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const record = { captureId: 'OLD-A', deliveryId: 'DELIVERY-A', workspaceId: 'A', envelope: {
    schemaVersion: 1, requestId: 'REQUEST-A', source: '1688', product: { name: 'A product', sourceProductId: '123', skus: [] },
  } };
  const ack = vi.fn(), beforeRestore = vi.fn();
  const task = runWorkspaceBackgroundTask(async () => {
    const context = await getActiveMemberContext(); started(); await gate;
    return receiveAndAcknowledgeInboxRecord({ record,
      receive: () => receiveSelectionCaptureEnvelope({ envelope: record.envelope, inboxRecord: record, expectedWorkspaceId: context.workspaceId }),
      acknowledge: () => ack(context.workspaceId),
    });
  });
  await ready;
  const restore = restoreWorkspaceBackupPayload(backupB, 'tester', { beforeRestore });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(beforeRestore).not.toHaveBeenCalled();
  expect(await runWorkspaceBackgroundTask(() => 'late')).toBeNull();
  release(); await task; await restore;
  expect(ack).toHaveBeenCalledWith('A'); expect(beforeRestore).toHaveBeenCalledOnce();
  expect((await getActiveMemberContext()).workspaceId).toBe('B');
  expect(await db.captures.count()).toBe(0);
  await expect(receiveSelectionCaptureEnvelope({ envelope: record.envelope, inboxRecord: record, expectedWorkspaceId: 'A' })).rejects.toThrow('不属于当前工作区');
  expect(await db.captures.count()).toBe(0);
});
