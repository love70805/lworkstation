import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, bulkUpdateProductCatalogSalesStatus, getActiveMemberContext } from './database';

beforeEach(async () => { await db.delete(); await db.open(); await getActiveMemberContext(); });
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete(); });

it('updates 51 products with 2040 SKUs without scanning ERP, profit or sales history, preserving costs and audit', async () => {
  const products = Array.from({ length: 51 }, (_, i) => ({ id: `P${i}`, workspaceId: 'workspace-default', name: `批量商品${i}`, platformSkc: `SKC${i}`, status: 'active', productStatus: 'observing', salesStatus: 'testing', visibility: 'workspace', attributes: {} }));
  const skus = products.flatMap(product => Array.from({ length: 40 }, (_, i) => ({ id: `${product.id}-${i}`, workspaceId: product.workspaceId, productId: product.id, platformSkc: product.platformSkc, platformSku: `${product.id}-SKU-${i}`, canonicalPlatformSku: `${product.id}-SKU-${i}`, attribute: `规格${i}`, salePrice: 20 })));
  await db.products.bulkAdd(products); await db.platformSkus.bulkAdd(skus);
  await db.catalogManualCosts.add({ id: 'MANUAL', workspaceId: 'workspace-default', platformSku: 'P0-SKU-0', amount: 8, status: 'active' });
  const before = await db.catalogManualCosts.toArray();
  const erp = vi.spyOn(db.erpCostRows, 'toArray').mockRejectedValue(new Error('must not load ERP history'));
  const profit = vi.spyOn(db.profitLines, 'toArray').mockRejectedValue(new Error('must not load monthly history'));
  const updated = await bulkUpdateProductCatalogSalesStatus({ productIds: [...products.map(p => p.id), products[0].id], salesStatus: 'on_sale' });
  expect(updated).toHaveLength(51); expect(erp).not.toHaveBeenCalled(); expect(profit).not.toHaveBeenCalled();
  expect((await db.platformSkus.toArray()).toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(skus.toSorted((a, b) => a.id.localeCompare(b.id))); expect(await db.catalogManualCosts.toArray()).toEqual(before);
  const events = (await db.auditEvents.toArray()).filter(e => e.action === 'product_sales_status_bulk_updated');
  expect(events).toHaveLength(51); expect(events.every(e => e.before.salesStatus === 'observing' && e.after.salesStatus === 'on_sale' && e.after.batchSize === 51)).toBe(true);
  expect((await db.products.toArray()).every(p => p.productStatus === 'on_sale' && p.salesStatus === 'testing')).toBe(true);
});

it('rejects mixed-workspace or unsupported status atomically before any writes', async () => {
  const products = [{ id: 'A', workspaceId: 'workspace-default', name: '当前商品', status: 'active', visibility: 'workspace' }, { id: 'B', workspaceId: 'OTHER', name: '其他工作区', status: 'active', visibility: 'workspace' }];
  await db.products.bulkAdd(products);
  await expect(bulkUpdateProductCatalogSalesStatus({ productIds: ['A', 'B'], salesStatus: 'off_sale' })).rejects.toThrow('无权');
  await expect(bulkUpdateProductCatalogSalesStatus({ productIds: ['A'], salesStatus: 'missing-status' })).rejects.toThrow('不支持');
  expect(await db.products.toArray()).toEqual(products); expect((await db.auditEvents.toArray()).filter(e => e.action === 'product_sales_status_bulk_updated')).toEqual([]);
});
