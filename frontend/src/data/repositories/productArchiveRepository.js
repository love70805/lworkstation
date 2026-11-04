import { db } from '../db/clientDatabase';
import { getActiveMemberContext } from './selectionRepository';
import { projectProductArchiveRows } from '../../domain/productArchive';

export async function previewProductArchive(archive) {
  const context = await getActiveMemberContext();
  if (!context.canSeeAllSelection) throw new Error('当前成员无批量导入商品资料权限。');
  const [platformSkus, products, erpCosts, erpBatches] = await Promise.all([
    db.platformSkus.where('workspaceId').equals(context.workspaceId).toArray(), db.products.where('workspaceId').equals(context.workspaceId).toArray(),
    db.erpCostRows.filter(row => row.workspaceId === context.workspaceId).toArray(), db.erpCostBatches.where('workspaceId').equals(context.workspaceId).toArray(),
  ]);
  const result = projectProductArchiveRows({ archives: [{ ...archive, workspaceId: context.workspaceId }], platformSkus, products, erpCosts, erpBatches, workspaceId: context.workspaceId });
  return { ...result, workspaceId: context.workspaceId };
}
export async function saveProductArchive(archive, expectedWorkspaceId) {
  if (!/^[a-f0-9]{64}$/.test(archive.hash) || !Array.isArray(archive.rows) || !archive.rows.length) throw new Error('商品档案未通过读取。');
  return db.transaction('rw', db.settings, db.auditEvents, async () => {
    const member = await getActiveMemberContext();
    if (member.workspaceId !== expectedWorkspaceId) throw new Error('工作区已变化，请重新读取商品档案。');
    if (!member.canSeeAllSelection) throw new Error('当前成员无批量导入商品资料权限。');
    const key = `product-archive:${member.workspaceId}:${archive.hash}`;
    if (await db.settings.get(key)) return { idempotent: true };
    const importedAt = new Date().toISOString();
    const rows = archive.rows.map(({ warehouseSku, productName, imageUrl, color, attribute, supplier1688Links }) => ({ warehouseSku, productName, imageUrl, color, attribute, supplier1688Links }));
    await db.settings.put({ key, kind: 'product_archive', workspaceId: member.workspaceId, fileName: archive.fileName, hash: archive.hash, rows, importedAt });
    await db.auditEvents.add({ workspaceId: member.workspaceId, objectType: 'product_archive', objectId: key, action: 'metadata_imported', actorId: member.memberId, createdAt: importedAt,
      after: { fileName: archive.fileName, hash: archive.hash, rowCount: archive.rows.length, purpose: 'product_metadata_only' } });
    return { idempotent: false };
  });
}
