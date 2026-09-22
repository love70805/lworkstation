import 'fake-indexeddb/auto';
import { liveQuery } from 'dexie';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from './db/clientDatabase';
import { derivedCacheDb, cachedDerived, clearDerivedMemory, sourceRevision, StaleDerivedResultError, invalidateDerivedCache } from './db/derivedCache';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { readLedgerSalesAnalytics } from './repositories/salesAnalyticsRepository';
import { readLedgerSalesRows } from './repositories/ledgerReadCache';
import { getLedgerSnapshot } from './repositories/profitRepository';
import { readCachedReportProducts } from './repositories/derivedComputationService';
import { buildReportProducts } from '../domain/profitReports';
import { readMonthlyReportState } from './repositories/profitReportRepository';
import * as computation from './repositories/derivedComputationService';

function firstLiveResult(querier) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { subscription.unsubscribe(); reject(new Error('live query timed out')); }, 3000);
    const subscription = liveQuery(querier).subscribe({
      next(value) { clearTimeout(timeout); subscription.unsubscribe(); resolve(value); },
      error(error) { clearTimeout(timeout); subscription.unsubscribe(); reject(error); },
    });
  });
}

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
it('keeps durable cache across identical startup identity initialization but invalidates on a real identity change', async () => {
  const compute = vi.fn(async () => 'unchanged-business-result');
  const options = { scope: ['W', 'L'], formula: 'startup-idempotence@1', compute };
  await cachedDerived(options);
  const revision = sourceRevision();
  await Promise.all([setActiveMemberContext({ workspaceId: 'W', memberId: 'M' }), setActiveMemberContext({ workspaceId: 'W', memberId: 'M' })]);
  expect(sourceRevision()).toBe(revision);
  clearDerivedMemory();
  expect(await cachedDerived(options)).toBe('unchanged-business-result');
  expect(compute).toHaveBeenCalledTimes(1);
  await setActiveMemberContext({ workspaceId: 'W', memberId: 'M', role: 'viewer' });
  expect(sourceRevision()).not.toBe(revision);
  await cachedDerived(options);
  expect(compute).toHaveBeenCalledTimes(2);
});

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

it('persists real live-query sales results and reuses them without computation after memory clear and restart', async () => {
  const compute = vi.spyOn(computation, 'runDerivedComputation');
  const query = async () => readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' });
  try {
    const first = await firstLiveResult(query);
    expect(first.monthTotalsExact.revenueExact).toBe('0.009');
    expect(await derivedCacheDb.entries.count()).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
    compute.mockClear(); clearDerivedMemory();
    expect((await firstLiveResult(query)).monthTotalsExact).toEqual(first.monthTotalsExact);
    expect(compute).not.toHaveBeenCalled();
    db.close(); derivedCacheDb.close(); clearDerivedMemory();
    await db.open(); await derivedCacheDb.open();
    expect((await firstLiveResult(query)).chartMonth).toEqual(first.chartMonth);
    expect(compute).not.toHaveBeenCalled();
    // Deferring optional cache persistence must not relax business writes.
    await expect(firstLiveResult(async () => db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', platformSku: 'FORBIDDEN' }))).rejects.toMatchObject({ name: 'ReadOnlyError' });
    expect(await db.salesRows.count()).toBe(1);
  } finally { compute.mockRestore(); }
});

it('observes same-count and same-value writes after a live-query persistent-cache hit', async () => {
  await firstLiveResult(async () => readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' }));
  clearDerivedMemory();
  const emissions = [], errors = [];
  const subscription = liveQuery(async () => readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' })).subscribe({ next: value => emissions.push(value.monthTotalsExact.revenueExact), error: error => errors.push(error) });
  try {
    await vi.waitFor(() => expect(emissions.at(-1)).toBe('0.009'));
    await db.salesRows.where('ledgerId').equals('L').modify({ amountExact: '2', amount: 2 });
    await vi.waitFor(() => expect(emissions.at(-1)).toBe('2'));
    const priorCount = emissions.length, priorRevision = sourceRevision();
    await db.salesRows.where('ledgerId').equals('L').modify({ amountExact: '2', amount: 2 });
    await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(priorCount));
    expect(emissions.at(-1)).toBe('2');
    expect(sourceRevision()).not.toBe(priorRevision);
    expect(errors).toEqual([]);
    expect(await db.salesRows.count()).toBe(1);
  } finally { subscription.unsubscribe(); }
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

it('rejects a revision change while sidecar persistence is queued', async () => {
  const result = cachedDerived({ scope: ['W', 'L'], formula: 'queued-race', compute: () => {
    setTimeout(() => invalidateDerivedCache(false), 0);
    return { exact: 'old-result' };
  } });
  await expect(result).rejects.toBeInstanceOf(StaleDerivedResultError);
  expect(await derivedCacheDb.entries.count()).toBe(0);
  expect(await db.salesRows.count()).toBe(1);
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

it('returns the correct live-query result if detached sidecar persistence fails', async () => {
  const put = vi.spyOn(derivedCacheDb.entries, 'put').mockRejectedValue(new Error('cache quota exceeded'));
  try {
    const result = await firstLiveResult(async () => readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' }));
    expect(result.monthTotalsExact.revenueExact).toBe('0.009');
    expect(put).toHaveBeenCalled();
    expect(await derivedCacheDb.entries.count()).toBe(0);
    expect(await db.salesRows.count()).toBe(1);
  } finally { put.mockRestore(); }
});

it('caches worker chart output and distinguishes a missing comparison store from known zero', async () => {
  const scope = { workspaceId: 'W', ledgerId: 'L' };
  const data = await readLedgerSalesAnalytics(scope);
  expect(data.chartMonth.daily[0].revenueExact).toBe('0.009');
  const missing = await readLedgerSalesAnalytics({ ...scope, store: 'missing', allowMissingStore: true });
  expect(missing.chartMonth.missingStore).toBe(true);
  expect(missing.chartMonth.daily[0].revenueExact).toBeNull();
  await expect(readLedgerSalesAnalytics({ ...scope, store: 'missing' })).rejects.toThrow('店铺');
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', store: 'ALL', platformSku: 'B', quantity: 0, amountExact: '0', sourceAddedDate: '2026-08-01' });
  expect((await readLedgerSalesAnalytics(scope)).monthTotalsExact.revenueExact).toBe('0.009');
  const zero = await readLedgerSalesAnalytics({ ...scope, store: 'ALL' });
  expect(zero.chartMonth.missingStore).toBe(false);
  expect(zero.monthTotalsExact.revenueExact).toBe('0');
});

it('retries a commit revision change during snapshot and sales reads but bounds continuous changes', async () => {
  const original = db.ledgers.get.bind(db.ledgers);
  const get = vi.spyOn(db.ledgers, 'get');
  try {
    get.mockImplementationOnce(async key => { const ledger = await original(key); invalidateDerivedCache(false); return ledger; });
    expect((await getLedgerSnapshot('L')).ledger.id).toBe('L');
    expect(get).toHaveBeenCalledTimes(2);
    get.mockClear();
    get.mockImplementationOnce(async key => { const ledger = await original(key); invalidateDerivedCache(false); return ledger; });
    expect((await readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' })).monthTotalsExact.revenueExact).toBe('0.009');
    expect(get).toHaveBeenCalledTimes(2);
    get.mockClear();
    get.mockImplementation(async key => { const ledger = await original(key); invalidateDerivedCache(false); return ledger; });
    await expect(getLedgerSnapshot('L')).rejects.toBeInstanceOf(StaleDerivedResultError);
    expect(get).toHaveBeenCalledTimes(3);
  } finally { get.mockRestore(); }
});

it('supports save followed immediately by fresh snapshot and sales reads', async () => {
  for (let index = 0; index < 8; index++) {
    await db.ledgers.update('L', { warehouseRate: String(index) });
    expect((await getLedgerSnapshot('L')).ledger.warehouseRate).toBe(String(index));
    await db.salesRows.where('ledgerId').equals('L').modify({ amountExact: String(index) });
    expect((await readLedgerSalesAnalytics({ workspaceId: 'W', ledgerId: 'L' })).monthTotalsExact.revenueExact).toBe(String(index));
  }
});
