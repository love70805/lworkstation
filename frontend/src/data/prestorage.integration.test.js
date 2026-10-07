import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db, DEFAULT_WORKSPACE_ID, getProductEditorSnapshot, getSelectionPrestorageSnapshot, saveProductCatalogRecord, promoteSelectionPrestorageRecord, promoteSelectionPrestorageRecords, setActiveMemberContext } from './database';

const full = {
  name: '分阶段商品', platformSkc: 'STAGE-SKC', store: '甲店', imageUrl: 'https://example.com/image.png',
  sourceUrl: 'https://detail.1688.com/offer/123.html', productStatus: 'observing', prestorage: true,
  variants: [{ platformSku: 'STAGE-SKU', attribute: '红色', salePrice: 20, purchaseUnitPrice: 8, purchasePackCount: 1, unitsPerPack: 1 }],
};
const save = (draft, productId) => saveProductCatalogRecord({ draft, productId, status: 'draft' });
const promote = productId => promoteSelectionPrestorageRecord({ productId, expectedWorkspaceId: DEFAULT_WORKSPACE_ID });
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete(); });

it('saves identifiers and missing names incrementally, without treating incomplete data as formal', async () => {
  const first = await save({ ...full, name: '', imageUrl: '', sourceUrl: '', variants: [{ platformSku: 'STAGE-SKU' }] });
  expect(first.product.status).toBe('draft');
  const snapshot = await getSelectionPrestorageSnapshot();
  expect(snapshot.products[0].readiness.labels).toEqual(expect.arrayContaining(['商品名称', '商品图片', '供应商来源链接', '属性/规格', '售价', '参考成本']));
  expect((await promote(first.product.id)).skipped).toBe('incomplete');
  expect(await db.erpCostRows.count()).toBe(0);
});

it('requires every SKU and automatically promotes once on the final saved field, preserving the business status and references', async () => {
  const variants = [...full.variants, { ...full.variants[0], platformSku: 'STAGE-B', salePrice: '' }];
  const first = await save({ ...full, variants });
  expect(first.product.status).toBe('draft');
  expect((await getSelectionPrestorageSnapshot()).products[0].readiness.missing).toContainEqual(expect.objectContaining({ label: '售价', platformSku: 'STAGE-B' }));
  const second = await save({ ...full, variants: variants.map(variant => ({ ...variant, salePrice: 0 })) }, first.product.id);
  expect(second.product).toMatchObject({ status: 'active', productStatus: 'observing' });
  expect((await db.platformSkus.toArray()).every(row => row.status === 'active' && row.salePrice === 0)).toBe(true);
  expect(await db.supplierOffers.count()).toBe(2);
  expect(await db.erpCostRows.count()).toBe(0);
  expect(await db.profitLines.count()).toBe(0);
  expect((await getSelectionPrestorageSnapshot()).products).toHaveLength(0);
  await Promise.all([promote(first.product.id), promote(first.product.id)]);
  expect((await db.auditEvents.toArray()).filter(row => row.after?.systemSource === 'prestorage-auto-promotion')).toHaveLength(1);
});

it('promotes a prior ledger-import draft with late reference costs and serializes simultaneous attempts', async () => {
  const first = await save({ ...full, variants: [{ ...full.variants[0], purchaseUnitPrice: '' }] });
  await db.products.update(first.product.id, { attributes: { ...first.product.attributes, catalogOrigin: 'ledger_import', prestorage: undefined } });
  await db.erpCostRows.add({ workspaceId: DEFAULT_WORKSPACE_ID, platformSku: 'STAGE-SKU', canonicalPlatformSku: 'STAGE-SKU', unitCost: 7, publishedAt: '2026-08-31T00:00:00Z' });
  expect((await getSelectionPrestorageSnapshot()).products[0].readiness.ready).toBe(true);
  await Promise.all([promote(first.product.id), promote(first.product.id)]);
  expect((await db.products.get(first.product.id)).status).toBe('active');
  expect((await db.auditEvents.toArray()).filter(row => row.after?.systemSource === 'prestorage-auto-promotion')).toHaveLength(1);
});

it('rechecks the actual stored draft, workspace and permissions before promoting a stale ready projection', async () => {
  const first = await save({ ...full, variants: [{ ...full.variants[0], purchaseUnitPrice: '' }] });
  await db.erpCostRows.add({ workspaceId: DEFAULT_WORKSPACE_ID, platformSku: 'STAGE-SKU', canonicalPlatformSku: 'STAGE-SKU', unitCost: 7, publishedAt: "2026-08-31T00:00:00Z" });
  expect((await getSelectionPrestorageSnapshot()).products[0].readiness.ready).toBe(true);
  await db.products.update(first.product.id, { imageUrl: '', attributes: { ...first.product.attributes, fieldEdits: { imageUrl: true } } });
  expect((await promote(first.product.id)).skipped).toBe('incomplete');
  await setActiveMemberContext({ workspaceId: 'another', memberId: 'other', role: 'operations' });
  expect((await promote(first.product.id)).skipped).toBe('workspace_changed');
  await setActiveMemberContext({ workspaceId: DEFAULT_WORKSPACE_ID, memberId: 'other', role: 'member' });
  await db.products.update(first.product.id, { visibility: 'private' });
  expect((await promote(first.product.id)).skipped).toBe('unavailable');
  expect((await db.products.get(first.product.id)).status).toBe('draft');
});

it('does not automatically publish an old manually saved draft or demote a formal record', async () => {
  const first = await saveProductCatalogRecord({ draft: { ...full, prestorage: false, imageUrl: '' }, status: 'draft' });
  await db.products.update(first.product.id, { imageUrl: full.imageUrl });
  expect((await promote(first.product.id)).skipped).toBe('unavailable');
  const snapshot = await getProductEditorSnapshot({ productId: first.product.id });
  const second = await save({ ...snapshot.draft, prestorage: true }, first.product.id);
  expect(second.product.status).toBe('active');
  await save({ ...snapshot.draft, imageUrl: '', prestorage: true }, first.product.id);
  expect((await db.products.get(first.product.id)).status).toBe('active');
});

it('rolls back promotion atomically after an audit failure, then allows a clean retry', async () => {
  const first = await save({ ...full, variants: [{ ...full.variants[0], purchaseUnitPrice: '' }] });
  await db.erpCostRows.add({ workspaceId: DEFAULT_WORKSPACE_ID, platformSku: 'STAGE-SKU', canonicalPlatformSku: 'STAGE-SKU', unitCost: 7, publishedAt: "2026-08-31T00:00:00Z" });
  const add = db.auditEvents.add.bind(db.auditEvents);
  const spy = vi.spyOn(db.auditEvents, 'add').mockImplementation(record => record.after?.systemSource === 'prestorage-auto-promotion' ? Promise.reject(new Error('isolated audit failure')) : add(record));
  await expect(promote(first.product.id)).rejects.toThrow('isolated audit failure');
  expect((await db.products.get(first.product.id)).status).toBe('draft');
  expect((await db.platformSkus.toArray())[0].status).toBe('draft');
  spy.mockRestore();
  expect((await promote(first.product.id)).product.status).toBe('active');
});

it('blocks legacy duplicate ownership and parent identities without silently choosing one', async () => {
  const first = await save({ ...full, imageUrl: '' });
  await db.products.update(first.product.id, { imageUrl: full.imageUrl });
  const sku = (await db.platformSkus.toArray())[0];
  await db.platformSkus.add({ ...sku, id: 'DUPLICATE', productId: 'OTHER', canonicalPlatformSku: undefined });
  expect((await getSelectionPrestorageSnapshot()).products[0].readiness.labels).toContain('商品归属待核对');
  expect((await promote(first.product.id)).skipped).toBe('identity_conflict');
  await db.platformSkus.delete('DUPLICATE');
  await db.products.add({ ...first.product, id: 'PARENT-DUPLICATE' });
  expect((await promote(first.product.id)).skipped).toBe('identity_conflict');
  expect((await db.products.get(first.product.id)).status).toBe('draft');
});

it('publishes a bounded group with one fresh projection and rolls back the entire group on failure', async () => {
  const ids = [];
  for (let index = 0; index < 3; index++) {
    const saved = await save({ ...full, platformSkc: `GROUP-${index}`, imageUrl: '', variants: [{ ...full.variants[0], platformSku: `GROUP-SKU-${index}` }] });
    ids.push(saved.product.id);
    await db.products.update(saved.product.id, { imageUrl: full.imageUrl });
  }
  const add = db.auditEvents.add.bind(db.auditEvents);
  let writes = 0;
  const spy = vi.spyOn(db.auditEvents, 'add').mockImplementation(record => record.after?.systemSource === 'prestorage-auto-promotion' && ++writes === 2 ? Promise.reject(new Error('batch failure')) : add(record));
  await expect(promoteSelectionPrestorageRecords({ productIds: ids, expectedWorkspaceId: DEFAULT_WORKSPACE_ID })).rejects.toThrow('batch failure');
  expect((await db.products.toArray()).every(product => product.status === 'draft')).toBe(true);
  spy.mockRestore();
  const results = await promoteSelectionPrestorageRecords({ productIds: [...ids, ...ids], expectedWorkspaceId: DEFAULT_WORKSPACE_ID });
  expect(results.filter(result => result.product)).toHaveLength(3);
});
