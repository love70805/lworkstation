// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, clearLocalWorkspaceData, DEFAULT_WORKSPACE_ID, createOrGetMonthlyLedger } from './database';
import { costDraftKey } from '../lib/costMatchingDraft';
import { BUSINESS_PREFERENCE_FIELDS } from '../lib/businessPreferencesBackup';
import { runWorkspaceBackgroundTask } from '../lib/workspaceBackgroundTasks';

let clearInboxData,saveClearBackup;
beforeEach(async () => {
  await db.delete(); await db.open(); localStorage.clear(); sessionStorage.clear();
  clearInboxData = vi.fn().mockResolvedValue({ ok: true, clearedCount: 5 });
  saveClearBackup=vi.fn().mockResolvedValue({status:'saved',filePath:'synthetic-backup.json',backupToken:'synthetic-token',sha256:'synthetic-sha'});
  window.shopeersDesktopRuntime = { desktop: true, clearInboxData,saveClearBackup,cancelClearBackup:vi.fn().mockResolvedValue({ok:true}) };
  await db.workspaces.put({ id: DEFAULT_WORKSPACE_ID, name: '旧工作区' });
  await db.ledgers.put({ id: 'OLD-LEDGER', workspaceId: DEFAULT_WORKSPACE_ID, period: '2026-09', status: 'finalized' });
  await db.erpCostRequests.put({ id: 'OLD-REQUEST', workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: 'OLD-LEDGER' });
  await db.erpCostRows.add({ workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: 'OLD-LEDGER', platformSku: 'OLD-SKU', unitCost: 9 });
  await db.profitReports.put({ id: 'OLD-REPORT', workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: 'OLD-LEDGER', kind: 'monthly', revision: 1 });
  localStorage.setItem(costDraftKey('OLD-LEDGER'), '{"sourceText":"old evidence"}');
  localStorage.setItem('shopeers:erp-cost-draft:LEGACY', '{}');
  localStorage.setItem('shopeers-appearance', 'dark');
  for(const prefix of Object.values(BUSINESS_PREFERENCE_FIELDS))for(const id of ['default','old-workspace'])localStorage.setItem(prefix+id,'malformed old preference');
  localStorage.setItem('fixture-auth-token','keep');
  localStorage.setItem('shopeers:profit-filter:last','old suppliers');
  localStorage.setItem('shopeers-product-library-filters-v1:old','old product query');
  sessionStorage.setItem('shopeers:profit-filter:scope:old','old suppliers');
});
afterEach(async () => {
  delete window.shopeersDesktopRuntime; localStorage.clear(); sessionStorage.clear();
  db.close(); await db.delete();
});

it('clears all local business tables and cost drafts after desktop histories are removed, including frozen reports', async () => {
  clearInboxData.mockImplementation(async () => {
    expect(await db.profitReports.count()).toBe(1);
    return { ok: true };
  });
  await clearLocalWorkspaceData();
  expect(clearInboxData).toHaveBeenCalledOnce();
  expect(clearInboxData).toHaveBeenCalledWith({confirmation:'清空本机数据'});
  expect(saveClearBackup).not.toHaveBeenCalled();
  for (const table of db.tables) {
    if (!['workspaces', 'auditEvents'].includes(table.name)) expect(await table.count(), table.name).toBe(0);
  }
  expect(await db.workspaces.toArray()).toEqual([expect.objectContaining({ id: DEFAULT_WORKSPACE_ID, defaultCurrency: 'CNY' })]);
  expect(await db.auditEvents.toArray()).toEqual([expect.objectContaining({ action: 'workspace_reset' })]);
  expect(localStorage.getItem(costDraftKey('OLD-LEDGER'))).toBeNull();
  expect(localStorage.getItem('shopeers:erp-cost-draft:LEGACY')).toBeNull();
  expect(localStorage.getItem('shopeers-appearance')).toBe('dark');
  expect(localStorage.getItem('fixture-auth-token')).toBe('keep');
  expect(localStorage.getItem('shopeers:profit-filter:last')).toBeNull();
  expect(localStorage.getItem('shopeers-product-library-filters-v1:old')).toBeNull();
  expect(sessionStorage.getItem('shopeers:profit-filter:scope:old')).toBeNull();
  for(const prefix of Object.values(BUSINESS_PREFERENCE_FIELDS))expect(Object.keys(localStorage).some(key=>key.startsWith(prefix))).toBe(false);
  db.close(); await db.open();
  await createOrGetMonthlyLedger({ period: '2026-09' });
  expect(await db.erpCostRequests.count()).toBe(0);
  expect(await db.erpCostRows.count()).toBe(0);
  expect(await db.profitReports.count()).toBe(0);
});

it.each(['failure', 'missing-api', 'invalid-response'])('retains IndexedDB and drafts when desktop clearing fails: %s', async kind => {
  if (kind === 'failure') clearInboxData.mockResolvedValue({ ok: false, error: '收件文件写入失败' });
  if (kind === 'missing-api') delete window.shopeersDesktopRuntime.clearInboxData;
  if (kind === 'invalid-response') clearInboxData.mockResolvedValue(undefined);
  await expect(clearLocalWorkspaceData()).rejects.toThrow();
  expect(await db.profitReports.count()).toBe(1);
  expect(await db.erpCostRows.count()).toBe(1);
  expect(localStorage.getItem(costDraftKey('OLD-LEDGER'))).not.toBeNull();
  expect(await runWorkspaceBackgroundTask(() => 'resumed')).toBe('resumed');
});

it('drains an in-flight delivery before reset and prevents another recovery cycle during clearing', async () => {
  let finishDelivery;
  const ready = new Promise(resolve => { finishDelivery = resolve; });
  const delivery = runWorkspaceBackgroundTask(async () => {
    await ready;
    await db.erpCostRows.add({ ledgerId: 'OLD-LEDGER', platformSku: 'LATE', unitCost: 10 });
  });
  const reset = clearLocalWorkspaceData();
  expect(clearInboxData).not.toHaveBeenCalled();
  const lateCycle = vi.fn();
  expect(await runWorkspaceBackgroundTask(lateCycle)).toBeNull();
  expect(lateCycle).not.toHaveBeenCalled();
  finishDelivery(); await delivery; await reset;
  expect(await db.erpCostRows.count()).toBe(0);
  expect(await runWorkspaceBackgroundTask(() => 'new cycle')).toBe('new cycle');
});

it('clears browser-only data without requiring a backup API', async () => {
  delete window.shopeersDesktopRuntime;
  await clearLocalWorkspaceData();
  expect(clearInboxData).not.toHaveBeenCalled();
  expect(await db.profitReports.count()).toBe(0);
});

it('never reads or serializes the business tables or calls an automatic backup API', async () => {
  const read=vi.spyOn(db.profitReports,'toArray').mockRejectedValue(new RangeError('Invalid string length'));
  saveClearBackup.mockRejectedValue(new RangeError('Invalid string length'));
  try {
    await clearLocalWorkspaceData();
    expect(saveClearBackup).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect((await db.auditEvents.toArray())[0].after).toEqual({status:'empty',currency:'CNY',automaticBackup:false});
  } finally {read.mockRestore();}
});

it('does not erase the database or claim success when cost-draft storage cannot be cleared', async () => {
  const remove = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('fixture storage unavailable'); });
  try {
    await expect(clearLocalWorkspaceData()).rejects.toThrow('fixture storage unavailable');
    expect(await db.profitReports.count()).toBe(1);
    expect(await db.erpCostRows.count()).toBe(1);
  } finally { remove.mockRestore(); }
});
