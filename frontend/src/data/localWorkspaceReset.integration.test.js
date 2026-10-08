// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, clearLocalWorkspaceData, DEFAULT_WORKSPACE_ID, createOrGetMonthlyLedger } from './database';
import { costDraftKey } from '../lib/costMatchingDraft';
import { runWorkspaceBackgroundTask } from '../lib/workspaceBackgroundTasks';

let clearInboxData;
beforeEach(async () => {
  await db.delete(); await db.open(); localStorage.clear();
  clearInboxData = vi.fn().mockResolvedValue({ ok: true, clearedCount: 5 });
  window.shopeersDesktopRuntime = { desktop: true, clearInboxData };
  await db.workspaces.put({ id: DEFAULT_WORKSPACE_ID, name: '旧工作区' });
  await db.ledgers.put({ id: 'OLD-LEDGER', workspaceId: DEFAULT_WORKSPACE_ID, period: '2026-09', status: 'finalized' });
  await db.erpCostRequests.put({ id: 'OLD-REQUEST', workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: 'OLD-LEDGER' });
  await db.erpCostRows.add({ workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: 'OLD-LEDGER', platformSku: 'OLD-SKU', unitCost: 9 });
  await db.profitReports.put({ id: 'OLD-REPORT', workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: 'OLD-LEDGER', kind: 'monthly', revision: 1 });
  localStorage.setItem(costDraftKey('OLD-LEDGER'), '{"sourceText":"old evidence"}');
  localStorage.setItem('shopeers:erp-cost-draft:LEGACY', '{}');
  localStorage.setItem('shopeers-appearance', 'dark');
});
afterEach(async () => {
  delete window.shopeersDesktopRuntime; localStorage.clear();
  db.close(); await db.delete();
});

it('clears all local business tables and cost drafts after desktop histories are removed, including frozen reports', async () => {
  clearInboxData.mockImplementation(async () => {
    expect(await db.profitReports.count()).toBe(1);
    return { ok: true };
  });
  await clearLocalWorkspaceData();
  expect(clearInboxData).toHaveBeenCalledOnce();
  for (const table of db.tables) {
    if (!['workspaces', 'auditEvents'].includes(table.name)) expect(await table.count(), table.name).toBe(0);
  }
  expect(await db.workspaces.toArray()).toEqual([expect.objectContaining({ id: DEFAULT_WORKSPACE_ID, defaultCurrency: 'CNY' })]);
  expect(await db.auditEvents.toArray()).toEqual([expect.objectContaining({ action: 'workspace_reset' })]);
  expect(localStorage.getItem(costDraftKey('OLD-LEDGER'))).toBeNull();
  expect(localStorage.getItem('shopeers:erp-cost-draft:LEGACY')).toBeNull();
  expect(localStorage.getItem('shopeers-appearance')).toBe('dark');
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

it('clears browser-only data without requiring a desktop service', async () => {
  delete window.shopeersDesktopRuntime;
  await clearLocalWorkspaceData();
  expect(clearInboxData).not.toHaveBeenCalled();
  expect(await db.profitReports.count()).toBe(0);
});

it('does not erase the database or claim success when cost-draft storage cannot be cleared', async () => {
  const remove = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('fixture storage unavailable'); });
  try {
    await expect(clearLocalWorkspaceData()).rejects.toThrow('fixture storage unavailable');
    expect(await db.profitReports.count()).toBe(1);
    expect(await db.erpCostRows.count()).toBe(1);
  } finally { remove.mockRestore(); }
});
