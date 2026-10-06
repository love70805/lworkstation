import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db, DEFAULT_WORKSPACE_ID as workspaceId, setActiveMemberContext, getLedgerSnapshot, getSelectionReferenceSnapshot } from './database';
import { filterOperatorRows } from '../domain/operatorScope';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import { projectOperatorLedgers } from './repositories/operatorLedgerProjection';
import { readLedgerSalesAnalytics, readWorkspaceSalesMonths } from './repositories/salesAnalyticsRepository';

const scope = { mode: 'mine', pairs: [{ store: '甲店', supplierNumber: '001' }] };
const ledger = { id: 'OP-L', workspaceId, period: '2026-09', status: 'finalized', warehouseRate: 0.7, profitSummary: { profit: 999 } };
beforeEach(async () => {
  await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId, memberId: 'scope-test', role: 'admin' });
  await db.ledgers.put(ledger);
  await db.importBatches.bulkPut(['甲店', '乙店'].map(store => ({ id: `B-${store}`, workspaceId, ledgerId: ledger.id, store, status: 'completed' })));
  const rows = [
    { store: '甲店', supplierNumber: '001', platformSku: 'SKU-A', platformSkc: 'SKC-A', quantity: 3, amount: 30 },
    { store: '甲店', supplierNumber: '', platformSku: 'SKU-A', platformSkc: 'SKC-A', quantity: -1, amount: -10 },
    { store: '乙店', supplierNumber: '001', platformSku: 'SKU-B', platformSkc: 'SKC-B', quantity: 5, amount: 50 },
  ];
  await db.salesRows.bulkAdd(rows.map(row => ({ ...row, workspaceId, ledgerId: ledger.id, batchId: `B-${row.store}`, sourceAddedDate: '2026-09-01', penalty: 0 })));
  await db.profitLines.bulkAdd(rows.filter(row => row.supplierNumber).map((row, i) => ({ ...row, workspaceId, ledgerId: ledger.id, quantity: i ? 5 : 2, revenue: i ? 50 : 20, profit: i ? 40 : 17, unitCost: i ? 2 : 0, purchaseCost: i ? 10 : 0, costSource: i ? 'erp' : 'manual_override', warehouseCost: i ? 0 : 3, penalty: 0 })));
});
afterEach(async () => { db.close(); await db.delete(); });
it('projects valid catalog identities without crossing stores and preserves frozen profits and every source row', async () => {
  const before = await getLedgerSnapshot(ledger.id);
  const reference = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
  expect(filterOperatorRows(reference, scope).map(row => row.platformSku)).toEqual(['SKU-A']);
  const projected = await projectOperatorLedgers([ledger], scope);
  expect(projected).toHaveLength(1);
  expect(projected[0].summary).toMatchObject({ quantity: 2, revenue: 20 });
  expect(projected[0].currentResult).toMatchObject({ profit: 17, label: '我的商品 · 定稿快照' });
  expect(await projectOperatorLedgers([ledger], { mode: 'mine', pairs: [] })).toEqual([]);
  const after = await getLedgerSnapshot(ledger.id);
  expect(after.rows).toEqual(before.rows);
  expect(after.profitLines).toEqual(before.profitLines);
  expect(after.ledger).toEqual(before.ledger);
});
it('isolates cached trend scopes while retaining refunds and original monthly facts', async () => {
  const mine = await readLedgerSalesAnalytics({ workspaceId, ledgerId: ledger.id, operatorScope: scope });
  expect(mine.sourceRows).toHaveLength(2);
  expect(mine.sourceRows.reduce((sum, row) => sum + row.amount, 0)).toBe(20);
  expect((await readLedgerSalesAnalytics({ workspaceId, ledgerId: ledger.id })).sourceRows).toHaveLength(3);
  expect((await readLedgerSalesAnalytics({ workspaceId, ledgerId: ledger.id, operatorScope: { mode: 'mine', pairs: [] } })).sourceRows).toEqual([]);
  await readWorkspaceSalesMonths({ workspaceId, operatorScope: scope });
  expect(await db.salesRows.count()).toBe(3);
});

it('does not replace a missing finalized snapshot with zero or current costs', async () => {
  await db.profitLines.clear();
  await expect(projectOperatorLedgers([ledger], scope)).rejects.toThrow('历史定稿快照缺失');
  expect((await db.ledgers.get(ledger.id)).profitSummary.profit).toBe(999);
});
