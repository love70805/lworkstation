import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, DEFAULT_WORKSPACE_ID, previewSalesImports, saveSalesImports, createWorkspaceBackupPayload, restoreWorkspaceBackupPayload, setActiveMemberContext } from './database';
import { validateSalesRows } from '../lib/salesImport';
import { buildSyncRecoveryPayload, replaySyncRecoveryPayload } from '../domain/syncRecovery';
import { createImportStage, appendImportStage, sealImportStage, clearImportStages } from '../lib/salesImportStage';

const mapping = { platformSku: 'SKU', platformSkc: 'SKC', supplierNumber: '货号', attribute: '属性', quantity: '数量', amount: '金额' };
function item(raw, fileHash = 'one') {
  const validation = validateSalesRows(raw, mapping, { defaultStore: '甲店' });
  expect(validation.errors).toEqual([]);
  return { itemId: 'one', fileName: '甲店.csv', fileHash, storeName: '甲店', mapping, rows: validation.rows,
    summary: { sourceRowCount: raw.length, validRowCount: validation.rows.length, errorCount: 0, ignoredCount: 0, errors: [] } };
}
const row = (sku, skc = '父A', attribute = '红色') => ({ SKU: sku, SKC: skc, 货号: '货号HHHX', 属性: attribute, 数量: 2, 金额: 30 });
async function commit(source, extra = {}) {
  const input = { period: '2026-08', items: [source], ...extra };
  const preview = await previewSalesImports(input);
  return saveSalesImports({ ...input, preview, overwriteSignature: preview.targetSignature });
}
async function state() {
  return { products: await db.products.toArray(), skus: await db.platformSkus.toArray(),
    sales: await db.salesRows.toArray(), batches: await db.importBatches.toArray(), audits: await db.auditEvents.toArray() };
}
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { vi.restoreAllMocks(); await clearImportStages('catalog-test'); db.close(); await db.delete(); });

it('atomically creates one basic draft per SKC and global SKU, without inventing prices or formal costs', async () => {
  const result = await commit(item([row('001'), row('001'), row('002', '父A', '蓝色'), row('003', '父B')]));
  expect(result.catalog).toMatchObject({ createdProductCount: 2, addedSkuCount: 3, issues: [] });
  const snapshot = await state();
  expect(snapshot.products).toHaveLength(2);
  expect(snapshot.products.every(product => product.name === '未命名商品' && product.status === 'draft' && product.currency === 'CNY')).toBe(true);
  expect(snapshot.skus.map(sku => sku.platformSku).sort()).toEqual(['001', '002', '003']);
  expect(snapshot.skus.every(sku => sku.salePrice === null && sku.warehouseSku === '')).toBe(true);
  expect(await db.erpCostRows.count()).toBe(0);
  expect(snapshot.products[0].attributes.ledgerImport).toMatchObject({ period: '2026-08', batchIds: [result.items[0].batchId] });
  const recovery = replaySyncRecoveryPayload(buildSyncRecoveryPayload({ workspaceId: DEFAULT_WORKSPACE_ID, events: snapshot.audits }));
  const byId = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  expect(byId(recovery.tables.products)).toEqual(byId(snapshot.products));
  expect(byId(recovery.tables.platformSkus)).toEqual(byId(snapshot.skus));
  const backup = JSON.parse(JSON.stringify(await createWorkspaceBackupPayload()));
  await restoreWorkspaceBackupPayload(backup);
  const restored = await state();
  expect(restored.audits.filter(event => event.action === 'backup_restored')).toHaveLength(1);
  restored.audits = restored.audits.filter(event => event.action !== 'backup_restored');
  expect(restored).toEqual(snapshot);
});

it('is idempotent, and extends an existing draft without removing previously imported branches', async () => {
  const first = item([row('001')]);
  await commit(first);
  const before = await state();
  const repeated = await commit(first);
  expect(repeated.items[0].status).toBe('skipped_duplicate');
  expect(await state()).toEqual(before);
  const next = await commit(item([row('002', '父A', '蓝色')], 'two'));
  expect(next.catalog).toMatchObject({ createdProductCount: 0, addedSkuCount: 1 });
  expect(await db.products.count()).toBe(1);
  expect((await db.products.toArray())[0].skuCount).toBe(2);
  expect(await db.platformSkus.count()).toBe(2);
});

it('preserves manual catalog fields, selling prices and status while linking owned SKUs', async () => {
  await db.products.add({ id: 'P', workspaceId: DEFAULT_WORKSPACE_ID, platformSkc: '父A', canonicalPlatformSkc: '父A', store: '甲店',
    name: '人工名称', imageUrl: 'https://example.com/manual.png', notes: '人工说明', status: 'active', productStatus: 'observing', skuCount: 1, attributes: { fieldEdits: { name: true } } });
  await db.platformSkus.add({ id: 'S', workspaceId: DEFAULT_WORKSPACE_ID, productId: 'P', platformSku: '001', canonicalPlatformSku: '001', platformSkc: '父A', attribute: '人工规格', salePrice: 999, status: 'active' });
  const before = (await state()).products[0], sku = (await state()).skus[0];
  const result = await commit(item([row('001'), row('002', '父A', '蓝色')]));
  expect(result.catalog).toMatchObject({ createdProductCount: 0, linkedSkuCount: 1, addedSkuCount: 1 });
  expect(await db.products.get('P')).toMatchObject({ ...before, skuCount: 2 });
  expect(await db.platformSkus.get('S')).toEqual(sku);
});

it('reports ambiguous or unavailable ownership and keeps the sales import and other valid drafts', async () => {
  await db.products.bulkAdd([
    { id: 'P', workspaceId: DEFAULT_WORKSPACE_ID, platformSkc: '父X', store: '甲店', status: 'active' },
    { id: 'D1', workspaceId: DEFAULT_WORKSPACE_ID, platformSkc: '重复', store: '甲店', status: 'active' },
    { id: 'D2', workspaceId: DEFAULT_WORKSPACE_ID, platformSkc: '重复', store: '甲店', status: 'active' },
  ]);
  await db.platformSkus.bulkAdd([
    { id: 'S', workspaceId: DEFAULT_WORKSPACE_ID, productId: 'P', platformSku: 'owned', canonicalPlatformSku: 'OWNED', platformSkc: '父X' },
    { id: 'COLLIDE1', workspaceId: DEFAULT_WORKSPACE_ID, productId: 'D1', platformSku: 'collision', canonicalPlatformSku: 'COLLISION', platformSkc: '重复' },
    { id: 'COLLIDE2', workspaceId: DEFAULT_WORKSPACE_ID, productId: 'D2', platformSku: 'collision', platformSkc: '重复' },
  ]);
  const result = await commit(item([row('owned'), row('missing', ''), row('duplicate', '重复'),
    row('multi', '父A'), row('multi', '父B'), row('attrs', '父C', '红'), row('attrs', '父C', '蓝'), row('collision', '重复'), row('ok', '父D')]));
  expect(result.catalog.createdProductCount).toBe(1);
  expect(result.catalog.issues.map(issue => issue.reason).sort()).toEqual(['attribute_conflict', 'duplicate_skc', 'duplicate_sku', 'missing_skc', 'owned_other_skc', 'skc_conflict'].sort());
  expect(await db.salesRows.count()).toBe(9);
  expect((await db.platformSkus.get('S')).productId).toBe('P');
});

it('creates drafts from disk chunks and rolls back all tables if catalog persistence fails', async () => {
  const source = item([row('001'), row('002', '父B')]);
  const stage = await createImportStage('catalog-test');
  await appendImportStage(stage, 0, source.rows.slice(0, 1));
  await appendImportStage(stage, 1, source.rows.slice(1));
  const rowSource = await sealImportStage(stage, 2, 2);
  const staged = { ...source, rowSource }; delete staged.rows;
  vi.spyOn(db.products, 'put').mockRejectedValueOnce(new Error('catalog write failed'));
  await expect(commit(staged)).rejects.toThrow('catalog write failed');
  expect((await state()).sales).toEqual([]);
  expect((await state()).skus).toEqual([]);
  expect((await state()).audits).toEqual([]);
  expect((await commit(staged)).catalog).toMatchObject({ createdProductCount: 2, addedSkuCount: 2 });
});

it('respects private ownership and reports incomplete legacy parents without interrupting other drafts', async () => {
  await setActiveMemberContext({ memberId:'operator', role:'selection', workspaceId:DEFAULT_WORKSPACE_ID });
  await db.products.bulkAdd([
    {id:'PRIVATE',workspaceId:DEFAULT_WORKSPACE_ID,platformSkc:'父A',visibility:'private',ownerId:'other',status:'active'},
    {id:'LEGACY',workspaceId:DEFAULT_WORKSPACE_ID,status:'draft'},
  ]);
  await db.platformSkus.bulkAdd([
    {id:'PRIVATE-SKU',workspaceId:DEFAULT_WORKSPACE_ID,productId:'PRIVATE',platformSku:'private',canonicalPlatformSku:'PRIVATE',platformSkc:'父A'},
    {id:'LEGACY-SKU',workspaceId:DEFAULT_WORKSPACE_ID,productId:'LEGACY',platformSku:'legacy',canonicalPlatformSku:'LEGACY'},
  ]);
  const result=await commit(item([row('private'),row('legacy'),row('new','新父级')]));
  expect(result.catalog).toMatchObject({createdProductCount:1,addedSkuCount:1});
  expect(result.catalog.issues.map(issue=>issue.reason)).toEqual(['unavailable_owner','owned_other_skc']);
  const created=(await db.products.toArray()).find(product=>product.platformSkc==='新父级');
  expect(created).toMatchObject({ownerId:'operator',visibility:'private'});
  expect(await db.platformSkus.get('PRIVATE-SKU')).toMatchObject({productId:'PRIVATE'});
});

it('rolls back both sales and catalog when the import is cancelled', async () => {
  const controller = new AbortController();
  await expect(commit(item([row('001')]), { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow('取消');
  const snapshot = await state();
  expect(snapshot.products).toEqual([]); expect(snapshot.skus).toEqual([]);
  expect(snapshot.sales).toEqual([]); expect(snapshot.audits).toEqual([]);
});
