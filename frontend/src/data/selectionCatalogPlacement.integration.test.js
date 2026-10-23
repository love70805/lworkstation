import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db, getProductEditorSnapshot, getSelectionReferenceSnapshot, listProductCatalogRecords, saveProductCatalogRecord, setActiveMemberContext } from './database';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import { selectionCatalogPlacement } from '../domain/selectionCatalogPlacement';

beforeEach(async () => { await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId: 'workspace-default' }); });
afterEach(async () => { db.close(); await db.delete(); });

it('continues a new SKU in the same catalog and preserves manual fields and financial rows through save/reopen', async () => {
  const platformSkc = 'st900000000000000000008', workspaceId = 'workspace-default';
  const { product } = await saveProductCatalogRecord({ draft: { name: '挂钩档案', platformSkc, store: '甲店',
    imageUrl: 'https://example.com/hook.png', notes: '保留人工说明', variants: [{ platformSku: 'SAVED-SKU', attribute: '红色', salePrice: 18, purchaseUnitPrice: 2, purchasePackCount: 1, unitsPerPack: 1 }],
    suppliers: [{ supplierId: 'SUPPLIER', supplierName: '原供应商', sourceUrl: 'https://detail.1688.com/offer/900000000002.html', variants: [{ platformSku: 'SAVED-SKU', purchaseUnitPrice: 2, purchasePackCount: 1, unitsPerPack: 1 }] }] } });
  await db.ledgers.add({ id: 'PLACEMENT-L', workspaceId, period: '2026-09', status: 'finalized' });
  await db.importBatches.add({ id: 'PLACEMENT-B', workspaceId, ledgerId: 'PLACEMENT-L', store: '乙店', status: 'completed' });
  await db.salesRows.add({ id: 'PLACEMENT-R', workspaceId, ledgerId: 'PLACEMENT-L', batchId: 'PLACEMENT-B', store: '乙店', platformSkc: platformSkc.toUpperCase(), platformSku: 'NEW-SKU', attribute: '蓝色', quantity: 1, amount: 22, sourceRow: 2 });
  await db.erpCostRows.add({ id: 'PLACEMENT-COST', workspaceId, platformSkc, platformSku: 'NEW-SKU', warehouseSku: 'WH-NEW', unitCost: 3, publishedAt: '2026-10-15T00:00:00Z' });
  await db.profitLines.add({ id: 'PLACEMENT-PROFIT', workspaceId, ledgerId: 'PLACEMENT-L', period: '2026-09', platformSku: 'SAVED-SKU', platformSkc, formalUnitCost: 2, profit: 12, finalizedAt: '2026-10-14T00:00:00Z' });
  const finance = async () => ({ costs: await db.erpCostRows.toArray(), lines: await db.profitLines.toArray(), ledgers: await db.ledgers.toArray(), sales: await db.salesRows.toArray() });
  const before = await finance();
  const rows = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
  const placement = selectionCatalogPlacement({ products: await listProductCatalogRecords(), rows });
  expect(placement.pendingRows).toEqual([]);
  expect(placement.incomingByProduct.get(product.id).map(row => row.platformSku)).toEqual(['NEW-SKU']);
  expect(await db.platformSkus.count()).toBe(1);
  const editor = await getProductEditorSnapshot({ productId: product.id });
  expect(editor.draft.variants.map(row => row.platformSku).sort()).toEqual(['NEW-SKU', 'SAVED-SKU']);
  await saveProductCatalogRecord({ productId: product.id, draft: editor.draft, status: 'active' });
  db.close(); await db.open();
  const saved = await getProductEditorSnapshot({ productId: product.id });
  expect(saved.draft).toMatchObject({ name: '挂钩档案', notes: '保留人工说明' });
  expect(saved.draft.variants.find(row => row.platformSku === 'SAVED-SKU').salePrice).toBe(18);
  expect(await db.products.count()).toBe(1);
  expect((await db.platformSkus.toArray()).every(row => row.productId === product.id)).toBe(true);
  expect(await finance()).toEqual(before);
  const after = selectionCatalogPlacement({ products: await listProductCatalogRecords(), rows: buildSelectionReferenceRows(await getSelectionReferenceSnapshot()) });
  expect(after.pendingRows).toEqual([]);
  expect(after.incomingByProduct.size).toBe(0);
});
