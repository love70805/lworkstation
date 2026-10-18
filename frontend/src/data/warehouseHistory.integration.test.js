import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { db } from './db/clientDatabase';
import { DEFAULT_WORKSPACE_ID as workspaceId } from './db/constants';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { previewWarehouseHistoryCosts, saveWarehouseHistoryCosts, saveManualCostOverride, revokeManualCostOverride, getLedgerSnapshot } from './repositories/profitRepository';
import { historyTarget, warehouseHistoryFixture } from '../testFixtures/warehouseHistory';
const ledgerId='HISTORY-LEDGER';
beforeEach(async()=>{
  await db.delete();await db.open();await setActiveMemberContext({workspaceId,memberId:'history-finance',role:'finance'});
  await db.ledgers.put({id:ledgerId,workspaceId,period:'2026-09',status:'cost_pending',warehouseRate:0.7});
  await db.salesRows.add({ledgerId,workspaceId,store:'甲店',platformSku:'SKU-A',platformSkc:'SKC-A',supplierNumber:'S',quantity:1,amount:20,sourceRow:2});
});
afterEach(async()=>{await db.delete();});
it('automatically completes unique missing targets once and preserves raw evidence and revocation',async()=>{
  const history=warehouseHistoryFixture();
  expect((await previewWarehouseHistoryCosts({ledgerId,history})).ready).toHaveLength(1);
  const result=await saveWarehouseHistoryCosts({ledgerId,history,sourceName:'history.json'});
  expect(result.savedCount).toBe(1);
  const approval=await db.costApprovals.get(result.savedIds[0]);
  expect(approval).toMatchObject({approvedAmount:0.35,approvedBy:'history-finance',referenceCost:{kind:'manual_override',historyEvidence:{ledgerPeriod:'2026-09',warehouseSku:'WH-A',sourceName:'history.json',selectedRecordIds:['R2','R1']}}});
  history.warehouseEvidence.warehouses[0].purchaseRecords[0].unitPrice=99;
  expect(approval.referenceCost.historyEvidence.warehouseEvidence.purchaseRecords[0].unitPrice).toBe(0.2);
  expect((await saveWarehouseHistoryCosts({ledgerId,history:warehouseHistoryFixture()})).savedCount).toBe(0);
  expect(await db.costApprovals.count()).toBe(1);
  expect((await db.auditEvents.where('objectId').equals(approval.id).toArray()).some(x=>x.action==='manual_override_saved')).toBe(true);
  await revokeManualCostOverride({ledgerId,approvalId:approval.id});
  expect((await db.ledgers.get(ledgerId)).costSummary.missingCount).toBe(1);
});
it('preserves effective manual costs and valid ERP costs',async()=>{
  await saveManualCostOverride({ledgerId,store:'甲店',platformSku:'SKU-A',unitCost:0,reason:'真实零成本'});
  expect((await saveWarehouseHistoryCosts({ledgerId,history:warehouseHistoryFixture()})).savedCount).toBe(0);
  expect((await db.costApprovals.toArray())[0].approvedAmount).toBe(0);
  await db.salesRows.add({ledgerId,workspaceId,store:'乙店',platformSku:'SKU-ERP',platformSkc:'SKC-E',supplierNumber:'S',quantity:1,amount:20,sourceRow:3});
  await db.erpCostBatches.put({id:'ERP',workspaceId,ledgerId,status:'published',publishedAt:'2026-10-01T00:00:00Z'});
  await db.erpCostRows.add({batchId:'ERP',ledgerId,workspaceId,platformSku:'SKU-ERP',canonicalPlatformSku:'SKU-ERP',platformSkc:'SKC-E',warehouseSku:'WH-E',unitCost:5,resolutionStatus:'resolved',selectedRecordIds:['R'],purchaseRecords:[{recordId:'R',purchaseDate:'2026-09-01',quantity:1,unitPrice:5}],publishedAt:'2026-10-01T00:00:00Z'});
  expect((await previewWarehouseHistoryCosts({ledgerId,history:warehouseHistoryFixture()})).ready).toHaveLength(0);
});
it('blocks finalized ledgers, foreign workspaces and incomplete reads without partial writes',async()=>{
  await db.ledgers.update(ledgerId,{status:'finalized'});
  await expect(saveWarehouseHistoryCosts({ledgerId,history:warehouseHistoryFixture()})).rejects.toThrow('定稿');
  await db.ledgers.update(ledgerId,{status:'cost_pending',workspaceId:'foreign'});
  await expect(saveWarehouseHistoryCosts({ledgerId,history:warehouseHistoryFixture()})).rejects.toThrow('权限');
  await db.ledgers.update(ledgerId,{workspaceId});
  const history=warehouseHistoryFixture();history.sourceMeta.detailFailureCount=1;
  await expect(saveWarehouseHistoryCosts({ledgerId,history})).rejects.toThrow('未完成');
  expect(await db.costApprovals.count()).toBe(0);
});
