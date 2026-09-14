import 'fake-indexeddb/auto';
import { liveQuery } from 'dexie';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from './db/clientDatabase';
import { derivedCacheDb, cachedDerived, clearDerivedMemory, sourceRevision, StaleDerivedResultError } from './db/derivedCache';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { readLedgerSalesAnalytics } from './repositories/salesAnalyticsRepository';
import { readLedgerSalesRows } from './repositories/ledgerReadCache';
import { getLedgerSnapshot } from './repositories/profitRepository';
import { readCachedReportProducts } from './repositories/derivedComputationService';
import { buildReportProducts } from '../domain/profitReports';
import { readMonthlyReportState } from './repositories/profitReportRepository';

beforeEach(async () => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  clearDerivedMemory();
  await derivedCacheDb.delete(); await derivedCacheDb.open();
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: 'W', memberId: 'M' });
  await db.ledgers.put({ id: 'L', workspaceId: 'W', period: '2026-08', warehouseRate: '0' });
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', store: '甲', platformSku: 'A', quantity: 1, amount: 0.009, amountExact: '0.009', sourceAddedDate: '2026-08-01' });
});
afterEach(async () => { await db.delete(); await derivedCacheDb.delete(); vi.unstubAllGlobals(); });

it('reuses persisted exact results after closing databases and discarding process memory', async () => {
  const compute = vi.fn(async () => ({ exact: '0.00000001' }));
  const options = { scope: ['W', 'L', '甲'], formula: 'test@1', compute };
  await cachedDerived(options);
  db.close(); derivedCacheDb.close(); clearDerivedMemory();
  await db.open(); await derivedCacheDb.open();
  expect(await cachedDerived(options)).toEqual({ exact: '0.00000001' });
  expect(compute).toHaveBeenCalledTimes(1);
  await cachedDerived({ ...options, formula: 'test@2' });
  await cachedDerived({ ...options, scope: ['other', 'L', '甲'] });
  expect(compute).toHaveBeenCalledTimes(3);
});

it('shares one raw snapshot and persists consumed sales summaries', async () => {
  const first = await readLedgerSalesRows('W', 'L');
  expect(await readLedgerSalesRows('W', 'L')).toBe(first);
  expect(await readLedgerSalesRows('foreign', 'L')).toEqual([]);
  const result = await readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' });
  expect(result.sourceRows).toBe(first);
  expect(result.monthTotalsExact.revenueExact).toBe('0.009');
  expect(await derivedCacheDb.entries.count()).toBe(1);
  clearDerivedMemory();
  expect((await readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' })).monthTotalsExact.revenueExact).toBe('0.009');
});

it('invalidates same-count row replacement, formal costs, approvals, rate and restore clear', async () => {
  const compute = vi.fn(async () => 'value');
  const options = { scope: ['W', 'L'], formula: 'test', compute };
  await cachedDerived(options);
  const mutations = [
    () => db.salesRows.where('ledgerId').equals('L').modify({ amountExact: '2' }),
    () => db.erpCostRows.add({ ledgerId: 'L', platformSku: 'A', unitCost: 0 }),
    () => db.costApprovals.put({ id: 'manual', ledgerId: 'L', status: 'approved' }),
    () => db.costApprovals.update('manual', { status: 'revoked' }),
    () => db.ledgers.update('L', { warehouseRate: '0.12' }),
    () => db.monthlySupplementRows.add({ id: 'supplement', ledgerId: 'L' }),
    () => db.salesRows.clear(),
  ];
  for (const mutate of mutations) {
    const previous = sourceRevision(); await mutate();
    expect(sourceRevision()).not.toBe(previous);
    await cachedDerived(options);
  }
  expect(compute).toHaveBeenCalledTimes(mutations.length + 1);
});

it('rejects an old worker result and a stale profit snapshot after mutation', async () => {
  let finish;
  const result = cachedDerived({ scope: ['W', 'L'], formula: 'race', persist: false, compute: () => new Promise(resolve => { finish = resolve; }) });
  await Promise.resolve();
  const snapshot = await getLedgerSnapshot('L');
  await db.ledgers.update('L', { warehouseRate: 2 });
  finish('old');
  await expect(result).rejects.toBeInstanceOf(StaleDerivedResultError);
  await expect(readCachedReportProducts({ snapshot })).rejects.toBeInstanceOf(StaleDerivedResultError);
  expect(await derivedCacheDb.entries.count()).toBe(0);
});

it('bounds disposable disk entries and preserves source data', async () => {
  for (let index = 0; index < 30; index++) await cachedDerived({ scope: [index], formula: 'bound', compute: () => index });
  expect(await derivedCacheDb.entries.count()).toBe(24);
  expect(await db.salesRows.count()).toBe(1);
});

it('persists consumed profit exact fields and compact provenance across a restart', async () => {
  await db.salesRows.where('ledgerId').equals('L').modify({ platformSkc: 'SKC' });
  const snapshot = await getLedgerSnapshot('L');
  const exact = buildReportProducts({ ledger: snapshot.ledger, salesRows: snapshot.rows, erpCosts: snapshot.costs, approvals: snapshot.approvals, allowMissing: true });
  const cold = await readCachedReportProducts({ snapshot });
  expect(cold).toEqual(exact.map(row => ({ ...row, sourceRowCount: row.sourceRows.length })));
  expect(await derivedCacheDb.entries.count()).toBe(1);
  db.close(); derivedCacheDb.close(); clearDerivedMemory();
  await db.open(); await derivedCacheDb.open();
  expect(await readCachedReportProducts({ snapshot: await getLedgerSnapshot('L') })).toEqual(cold);
});

it('persists report headers without report files while keeping original evidence', async () => {
  await db.profitReports.put({ id: 'R', ledgerId: 'L', workspaceId: 'W', createdAt: '2026-08-01', fileBase64: 'original-evidence' });
  expect((await readMonthlyReportState('L')).reports[0].fileBase64).toBeUndefined();
  clearDerivedMemory();
  const stored = await derivedCacheDb.entries.toArray();
  expect(JSON.stringify(stored)).not.toContain('original-evidence');
  expect((await readMonthlyReportState('L')).reports[0].id).toBe('R');
  expect((await db.profitReports.get('R')).fileBase64).toBe('original-evidence');
});

it('observes same-count value edits for each live query even after a shared memory hit', async () => {
  await readLedgerSalesRows('W', 'L');
  const emissions = [];
  const subscription = liveQuery(() => readLedgerSalesRows('W', 'L')).subscribe(rows => emissions.push(rows[0]?.amountExact));
  try {
    await vi.waitFor(() => expect(emissions.at(-1)).toBe('0.009'));
    await db.salesRows.where('ledgerId').equals('L').modify({ amountExact: '0.0001' });
    await vi.waitFor(() => expect(emissions.at(-1)).toBe('0.0001'));
  } finally { subscription.unsubscribe(); }
});

it('falls back to correct calculation and source reads when optional cache storage fails', async () => {
  const get = vi.spyOn(derivedCacheDb.entries, 'get').mockRejectedValue(new Error('cache unavailable'));
  const revisionGet = vi.spyOn(derivedCacheDb.revisions, 'get').mockRejectedValue(new Error('cache unavailable'));
  try {
    expect(await cachedDerived({ scope: ['W'], formula: 'fallback', compute: () => ({ exact: '0.0001' }) })).toEqual({ exact: '0.0001' });
    expect((await readLedgerSalesRows('W', 'L'))[0].amountExact).toBe('0.009');
  } finally { get.mockRestore(); revisionGet.mockRestore(); }
});
