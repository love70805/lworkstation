import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { db, DEFAULT_WORKSPACE_ID, previewSalesImports, saveSalesImports } from './database';
import { validateSalesRows } from '../lib/salesImport';
import { listSalesSourceConfirmations, confirmSalesSourceCoverage } from './repositories/salesSourceCoverageRepository';
const mapping = { platformSku: 'SKU', platformSkc: 'SKC', quantity: '数量', amount: '金额', sourceAddedAt: '日期' };
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { db.close(); await db.delete(); });
async function fixture() {
  const raw = [{ SKU: 'SYN-SKU', SKC: 'SYN-SKC', 数量: 3, 金额: 9, 日期: '2026-08-30' }];
  const rows = validateSalesRows(raw, mapping, { defaultStore: '合成店', period: '2026-08' }).rows;
  const input = { period: '2026-08', items: [{ itemId: 'synthetic', fileName: 'synthetic.csv', fileHash: 'synthetic', mapping, storeName: '合成店', rows, summary: { sourceRowCount: 1, errorCount: 0, ignoredCount: 0 } }] };
  const result = await saveSalesImports({ ...input, preview: await previewSalesImports(input) });
  return { ledgerId: result.ledgerId, batchId: result.items[0].batchId };
}
it('confirms once with audit, preserving financial rows', async () => {
  const scope = await fixture();
  const before = await db.salesRows.toArray();
  expect(await listSalesSourceConfirmations(scope.ledgerId)).toMatchObject([{ eligible: true }]);
  await expect(confirmSalesSourceCoverage(scope)).rejects.toThrow('确认');
  expect(await confirmSalesSourceCoverage({ ...scope, confirmed: true })).toMatchObject({ scope: 'full_month', declarationSource: 'manual' });
  expect(await listSalesSourceConfirmations(scope.ledgerId)).toEqual([]);
  expect(await db.salesRows.toArray()).toEqual(before);
  expect(await db.profitLines.count()).toBe(0);
  expect((await db.auditEvents.toArray()).find(event => event.action === 'confirm_sales_source_coverage')).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, objectType: 'sales_import_batch', objectId: scope.batchId, actorId: 'local-user', after: { sourceCoverage: { scope: 'full_month' } } });
});
it('rejects residual scope, cross-workspace and finalized changes', async () => {
  const scope = await fixture();
  const row = (await db.salesRows.toArray())[0];
  await db.salesRows.add({ ...row, id: 'residual', batchId: 'other' });
  await expect(confirmSalesSourceCoverage({ ...scope, confirmed: true })).rejects.toThrow('残留');
  await db.salesRows.delete('residual');
  await db.ledgers.update(scope.ledgerId, { status: 'finalized' });
  await expect(confirmSalesSourceCoverage({ ...scope, confirmed: true })).rejects.toThrow('重开');
  await db.ledgers.update(scope.ledgerId, { workspaceId: 'other' });
  await expect(confirmSalesSourceCoverage({ ...scope, confirmed: true })).rejects.toThrow('权限');
});
