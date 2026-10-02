import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { liveQuery } from 'dexie';
import { db, getWorkspaceOperationalSummary, setActiveMemberContext } from './database';
import { clearDerivedMemory, derivedCacheDb } from './db/derivedCache';

beforeEach(async () => {
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  clearDerivedMemory(); await db.delete(); await db.open(); await derivedCacheDb.delete(); await derivedCacheDb.open();
  await setActiveMemberContext({ workspaceId: 'W', memberId: 'admin' });
  await db.workspaces.put({ id: 'W' });
  await db.ledgers.put({ id: 'L', workspaceId: 'W', period: '2026-08' });
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', platformSku: 'A', quantity: 1 });
});
afterEach(async () => { await db.delete(); await derivedCacheDb.delete(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reuses a persisted sales count after catalog edits but invalidates ledger writes and member scope', async () => {
  const originalCount = db.Collection.prototype.count;
  let countReads = 0;
  vi.spyOn(db.Collection.prototype, 'count').mockImplementation(function (...args) {
    if (this._ctx.table.name === 'salesRows') countReads++;
    return originalCount.apply(this, args);
  });
  const initial = await getWorkspaceOperationalSummary();
  expect(countReads).toBe(1);
  clearDerivedMemory();
  expect(await getWorkspaceOperationalSummary()).toEqual(initial);
  expect(countReads).toBe(1);
  await db.products.put({ id: 'P', workspaceId: 'W', name: '私有商品', visibility: 'private', ownerId: 'admin' });
  await db.auditEvents.add({ workspaceId: 'W', createdAt: '2026-10-02T12:00:00Z', after: { snapshot: { raw: 'complete audit remains here' } } });
  expect(await getWorkspaceOperationalSummary()).toMatchObject({ productCount: 1, recordCount: initial.recordCount + 2, latestActivityAt: '2026-10-02T12:00:00Z' });
  expect(countReads).toBe(1);
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', platformSku: 'B', quantity: 1 });
  expect((await getWorkspaceOperationalSummary()).recordCount).toBe(initial.recordCount + 3);
  expect(countReads).toBe(2);
  await setActiveMemberContext({ workspaceId: 'W', memberId: 'other', role: 'selection' });
  expect((await getWorkspaceOperationalSummary()).productCount).toBe(0);
  await setActiveMemberContext({ workspaceId: 'OTHER', memberId: 'other', role: 'admin' });
  expect(await getWorkspaceOperationalSummary()).toMatchObject({ productCount: 0, openLedgerCount: 0, recordCount: 1, latestActivityAt: null });
});

it('notifies a live reader that began from a cached summary after same-count ledger changes', async () => {
  await getWorkspaceOperationalSummary();
  await new Promise((resolve, reject) => {
    let wrote = false;
    const timer = setTimeout(() => { subscription.unsubscribe(); reject(new Error('summary did not refresh')); }, 3000);
    const subscription = liveQuery(getWorkspaceOperationalSummary).subscribe({
      next(summary) {
        if (summary.missingCostCount === 4) { clearTimeout(timer); subscription.unsubscribe(); resolve(); }
        else if (!wrote) { wrote = true; setTimeout(() => db.ledgers.update('L', { costSummary: { missingCount: 4 } }), 0); }
      }, error(error) { clearTimeout(timer); reject(error); },
    });
  });
});

it('retries a member/workspace change while reading the summary context', async () => {
  const get = db.settings.get.bind(db.settings); let changed = false;
  vi.spyOn(db.settings, 'get').mockImplementation(async key => {
    const row = await get(key);
    if (!changed && row?.workspaceId === 'W') { changed = true; await setActiveMemberContext({ workspaceId: 'OTHER' }); }
    return row;
  });
  expect(await getWorkspaceOperationalSummary()).toMatchObject({ productCount: 0, openLedgerCount: 0, recordCount: 1 });
});
