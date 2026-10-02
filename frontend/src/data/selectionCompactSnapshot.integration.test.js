import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { liveQuery } from 'dexie';
import { db, setActiveMemberContext, getSelectionReferenceSnapshot, getProductEditorSnapshot, saveProductCatalogRecord } from './database';
import { derivedCacheDb, clearDerivedMemory } from './db/derivedCache';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import * as computations from './repositories/derivedComputationService';

beforeEach(async () => {
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  clearDerivedMemory(); await db.delete(); await db.open(); await derivedCacheDb.delete(); await derivedCacheDb.open();
  await setActiveMemberContext({ workspaceId: 'W', memberId: 'M' });
  await db.ledgers.put({ id: 'L', workspaceId: 'W', period: '2026-08' });
  await db.importBatches.put({ id: 'B', workspaceId: 'W', ledgerId: 'L', status: 'completed', period: '2026-08', store: '甲', validRowCount: 3, sourceCoverage: { version: 1, period: '2026-08', store: '甲', scope: 'full_month', declarationSource: 'import_preview' } });
  await db.salesRows.bulkAdd([['SKU-A', 'SKC-A', 11], ['SKU-A', 'SKC-A', 2], ['SKU-B', 'SKC-B', 1]].map(([platformSku, platformSkc, quantity], index) => ({ workspaceId: 'W', ledgerId: 'L', batchId: 'B', platformSku, platformSkc, store: '甲', sourceSheet: '明细', sourceRow: index + 2, sourceAddedAt: '2026-08-31T12:00:00+08:00', sourceAddedDate: '2026-08-31', sourceTimePrecision: 'second', quantity, unitPrice: '0.0001', amountExact: String(quantity * 0.0001), raw: { original: 'retained' } })));
});
afterEach(async () => { await db.delete(); await derivedCacheDb.delete(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps price and whole-store seven-day completeness while targeting one product', async () => {
  const full = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
  const snapshot = await getSelectionReferenceSnapshot({ compact: true, platformSkc: 'SKC-A' });
  const [row] = buildSelectionReferenceRows(snapshot);
  expect(snapshot.salesRows).toBeUndefined();
  expect(snapshot.computedReferenceRows).toHaveLength(1);
  expect(row.ledgerSalePrice).toEqual(full.find(item => item.platformSku === 'SKU-A').ledgerSalePrice);
  expect(row.automaticSalesTag).toMatchObject({ status: 'ready', label: '一般', quantityExact: '13' });
  expect(row.platformSkcEvidence[0]).toMatchObject({ sourceCount: 2, sources: [expect.objectContaining({ sourceRow: 2 })] });
  expect((await db.salesRows.toArray()).every(item => item.raw.original === 'retained')).toBe(true);
});

it('reuses after process cache clear, then invalidates same-count edit, replacement and workspace switch', async () => {
  const compute = vi.spyOn(computations, 'runDerivedComputation');
  await getSelectionReferenceSnapshot({ compact: true });
  clearDerivedMemory();
  await getSelectionReferenceSnapshot({ compact: true, platformSkus: ['SKU-A'] });
  expect(compute).toHaveBeenCalledTimes(1);
  const first = await db.salesRows.toCollection().first();
  await db.salesRows.update(first.id, { unitPrice: '2' });
  const updated = await getSelectionReferenceSnapshot({ compact: true });
  expect(updated.computedReferenceRows.find(row => row.platformSku === 'SKU-A').catalogSalePrice).toBe(2);
  await db.importBatches.update('B', { status: 'replaced' });
  expect((await getSelectionReferenceSnapshot({ compact: true })).computedReferenceRows).toHaveLength(0);
  await setActiveMemberContext({ workspaceId: 'OTHER', memberId: 'M' });
  expect((await getSelectionReferenceSnapshot({ compact: true })).workspaceId).toBe('OTHER');
  expect((await getSelectionReferenceSnapshot({ compact: true })).computedReferenceRows).toHaveLength(0);
});

it('observes an ERP cost write even when a live reader starts from a shared cache hit', async () => {
  await getSelectionReferenceSnapshot({ compact: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { subscription.unsubscribe(); reject(new Error('not invalidated')); }, 3000);
    let wrote = false;
    const subscription = liveQuery(() => getSelectionReferenceSnapshot({ compact: true })).subscribe({
      next(snapshot) {
        if (snapshot.computedReferenceRows.some(row => row.referenceUnitCost === 3)) { clearTimeout(timer); subscription.unsubscribe(); resolve(); }
        else if (!wrote) { wrote = true; setTimeout(() => db.erpCostRows.add({ workspaceId: 'W', platformSku: 'SKU-A', unitCost: 3, publishedAt: '2026-09-01' }), 0); }
      }, error(error) { clearTimeout(timer); reject(error); },
    });
  });
});

it('carries editor workspace and rejects saving a stale workspace draft', async () => {
  const snapshot = await getProductEditorSnapshot({ platformSkc: 'SKC-A' });
  expect(snapshot.context.workspaceId).toBe('W');
  await setActiveMemberContext({ workspaceId: 'OTHER', memberId: 'M' });
  await expect(saveProductCatalogRecord({ expectedWorkspaceId: 'W', draft: { ...snapshot.draft, name: '商品A' } })).rejects.toThrow('工作区已变化');
  expect(await db.products.count()).toBe(0);
});

it('isolates store-specific price candidates and sales-label projections', async () => {
  await db.importBatches.put({ id: 'B2', workspaceId: 'W', ledgerId: 'L', status: 'completed', period: '2026-08', store: '乙', validRowCount: 1, sourceCoverage: { version: 1, period: '2026-08', store: '乙', scope: 'full_month', declarationSource: 'import_preview' } });
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', batchId: 'B2', platformSku: 'SKU-A', platformSkc: 'SKC-A', store: '乙', sourceRow: 2, sourceAddedDate: '2026-08-31', sourceAddedAt: '2026-08-31T12:00:00+08:00', quantity: 700, unitPrice: 5 });
  const read = async store => (await getSelectionReferenceSnapshot({ compact: true, store })).computedReferenceRows.find(row => row.platformSku === 'SKU-A');
  expect(await read('甲')).toMatchObject({ catalogSalePrice: 0.0001, automaticSalesTag: { quantityExact: '13', label: '一般' } });
  expect(await read('乙')).toMatchObject({ catalogSalePrice: 5, automaticSalesTag: { quantityExact: '700', label: '爆款' } });
  expect((await read('all')).ledgerSalePrice.status).toBe('choose');
});

it('retries a workspace switch occurring between member-context read and source snapshot', async () => {
  const original = db.settings.get.bind(db.settings);
  let changed = false;
  vi.spyOn(db.settings, 'get').mockImplementation(async key => {
    const value = await original(key);
    if (!changed && value?.workspaceId === 'W' && value?.memberId === 'M') {
      changed = true;
      await setActiveMemberContext({ workspaceId: 'OTHER', memberId: 'M' });
    }
    return value;
  });
  const snapshot = await getSelectionReferenceSnapshot({ compact: true });
  expect(snapshot.workspaceId).toBe('OTHER');
  expect(snapshot.computedReferenceRows).toHaveLength(0);
  expect((await getProductEditorSnapshot()).context.workspaceId).toBe('OTHER');
});

it('preserves legacy sku-alias rows when projecting the latest sale price', async () => {
  await db.salesRows.clear();
  await db.erpCostRows.add({ workspaceId: 'W', platformSku: 'SKU-A', platformSkc: 'SKC-A', unitCost: 1 });
  await db.salesRows.add({ workspaceId: 'W', ledgerId: 'L', batchId: 'B', store: '甲', sku: 'SKU-A', platformSkc: 'SKC-A', quantity: 1, unitPrice: 9, sourceAddedAt: '2026-08-31T12:00:00+08:00', sourceAddedDate: '2026-08-31' });
  const full = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
  const compact = buildSelectionReferenceRows(await getSelectionReferenceSnapshot({ compact: true }));
  expect(full[0].catalogSalePrice).toBe(9);
  expect(compact[0].catalogSalePrice).toBe(9);
});
