import { describe, it, expect } from 'vitest';
import { readWarehouseHistory, planWarehouseHistoryCosts } from './erpWarehouseHistory';
import { historyTarget, warehouseHistoryFixture } from '../testFixtures/warehouseHistory';
const plan = history => planWarehouseHistoryCosts({ history, period:'2026-09', targets:[historyTarget] });
describe('warehouse history cost completion', () => {
  it('recalculates the weighted latest purchases through the ledger cutoff', () => {
    const history=warehouseHistoryFixture(); history.proposedUnitCost=999;
    expect(plan(history).ready[0]).toMatchObject({unitCost:0.35,selectedRecordIds:['R2','R1']});
    expect(plan(history).ready[0].historyEvidence.warehouseEvidence.decision.purchaseRecords).toContainEqual(expect.objectContaining({recordId:'FUTURE',eligible:false}));
  });
  it('uses an existing exact relationship without per-SKU confirmation', () => {
    const history=warehouseHistoryFixture();history.historicalMappings=[];
    expect(planWarehouseHistoryCosts({ history,period:'2026-09',targets:[historyTarget],knownMappings:[historyTarget] }).ready).toHaveLength(1);
  });
  it('keeps conflicting and mismatched historical identities pending', () => {
    const history=warehouseHistoryFixture();history.historicalMappings.push({...historyTarget,warehouseSku:'WH-OTHER'});
    expect(plan(history)).toMatchObject({ready:[],pending:[expect.objectContaining({reason:'历史仓库关联存在冲突'})]});
    history.historicalMappings=[{...historyTarget,platformSkc:'OTHER'}];
    expect(plan(history).ready).toHaveLength(0);
  });
  it('keeps zero purchase prices pending rather than assigning zero cost', () => {
    const history=warehouseHistoryFixture();history.warehouseEvidence.warehouses[0].purchaseRecords[1].unitPrice=0;
    expect(plan(history).ready).toHaveLength(0);
    expect(plan(history).pending[0].reason).toContain('异常');
  });
  it('rejects incomplete, wrong-month and contradictory evidence', () => {
    const history=warehouseHistoryFixture();
    expect(()=>readWarehouseHistory({...history,ledgerPeriod:'2026-10'},'2026-09')).toThrow('月份');
    history.sourceMeta.complete=false; expect(()=>plan(history)).toThrow('未完成');
    history.sourceMeta.complete=true; const entry=history.warehouseEvidence.warehouses[0];
    entry.purchaseRecords.push({...entry.purchaseRecords[0],unitPrice:3}); expect(()=>plan(history)).toThrow('重复');
  });
  it('does not resolve ledger parent conflicts using an imported amount', () => {
    expect(planWarehouseHistoryCosts({history:warehouseHistoryFixture(),period:'2026-09',targets:[historyTarget,{...historyTarget,platformSkc:'SKC-OTHER'}]}).ready).toHaveLength(0);
  });
  it('retains the historical source and does not silently ignore unit conversion', () => {
    const history=warehouseHistoryFixture();history.historicalMappings[0].observedAt='2026-09-21T00:00:00Z';
    expect(plan(history).ready[0].historyEvidence.historicalMappingSources[0].observedAt).toBe('2026-09-21T00:00:00Z');
    history.historicalMappings[0].unitConversion={warehouseUnits:10,platformUnits:1};
    expect(plan(history).pending[0].reason).toContain('单位换算');
  });
});
