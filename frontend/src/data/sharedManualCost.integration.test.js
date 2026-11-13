import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db, createOrGetMonthlyLedger, setActiveMemberContext, DEFAULT_WORKSPACE_ID, saveErpCostRequest, receiveErpCostInboxEnvelope, saveManualCostOverride } from './database';
import { previewSharedManualCost, saveSharedManualCost } from './repositories/sharedManualCostRepository';
import { buildErpCostRequest } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';
let ledger, protectedManual, send;
beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: DEFAULT_WORKSPACE_ID, memberId: 'finance', role: 'finance' });
  ledger = await createOrGetMonthlyLedger({ period: '2026-09' });
  const expectedSkus = ['A','B','C','D'].map(platformSku => ({ platformSku, platformSkc: 'SKC-'+platformSku }));
  await db.salesRows.bulkAdd([...expectedSkus.map(row=>({...row,store:'甲'})),{...expectedSkus[0],store:'乙'}].map(row=>({...row,workspaceId:ledger.workspaceId,ledgerId:ledger.id,quantity:2,amount:40})));
  send = async (n=1, unitPrice=1) => {
    const at=`2026-10-0${n}T00:00:00Z`;
    const request=buildErpCostRequest({id:'R'+n,workspaceId:ledger.workspaceId,ledgerId:ledger.id,ledgerPeriod:ledger.period,platformSkcs:expectedSkus.map(r=>r.platformSkc),expectedSkus,requestedBy:'finance',requestedAt:at});
    await saveErpCostRequest(request);
    const batch=buildErpCostBatchEnvelope({batchId:'B'+n,generatedAt:at,workspaceId:ledger.workspaceId,ledgerId:ledger.id,requestId:request.id,platformSkcs:request.platformSkcs,expectedSkus,
      results:[{warehouseSku:'WH',mappings:expectedSkus.slice(0,3),previewUnitCost:unitPrice},{warehouseSku:'OTHER',mappings:expectedSkus.slice(3),previewUnitCost:1}],
      warehouseEvidence:['WH','OTHER'].map(warehouseSku=>({warehouseSku,evidenceComplete:true,purchaseRecords:[{recordId:'P'+warehouseSku,purchaseDate:'2026-09-01',quantity:2,unitPrice:warehouseSku==='WH'?unitPrice:1}]}))});
    return receiveErpCostInboxEnvelope({envelope:buildErpCostInboxEnvelope({batch,deliveryId:'D'+n,sentAt:at})});
  };
  await send();
  protectedManual=await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'B',unitCost:7,reason:'已经确认'});
});
afterEach(async()=>{vi.restoreAllMocks();await db.delete()});
const input=()=>({ledgerId:ledger.id,store:'甲',platformSku:'A'});
const apply=async(unitCost,plan)=>saveSharedManualCost({...input(),unitCost,fingerprint:(plan??await previewSharedManualCost(input())).fingerprint});
it.each([0,0.0000001,3])('writes %s once to current same-evidence store SKUs, preserves prior manual values and excludes other warehouses',async unitCost=>{
  const plan=await previewSharedManualCost(input());
  expect(plan.rows).toHaveLength(4);expect(plan.rows.filter(r=>r.included)).toHaveLength(3);
  const saved=await apply(unitCost,plan);expect(saved).toHaveLength(3);expect(saved.every(r=>r.approvedAmount===unitCost)).toBe(true);
  expect(await db.costApprovals.get(protectedManual.id)).toEqual(protectedManual);
  expect((await db.costApprovals.toArray()).some(r=>r.platformSku==='D')).toBe(false);
  db.close();await db.open();expect(await db.costApprovals.count()).toBe(4);
});
it('rejects a changed evidence group and a newly entered manual override rather than overwriting a stale preview',async()=>{
  const plan=await previewSharedManualCost(input());
  await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'C',unitCost:6,reason:'另一操作'});
  await expect(apply(3,plan)).rejects.toThrow('已变化');
  const fresh=await previewSharedManualCost(input());await send(2,2);
  await expect(apply(3,fresh)).rejects.toThrow('已变化');
});
it('rolls back every target if a later write fails',async()=>{
  const before=await db.costApprovals.toArray(),audit=await db.auditEvents.toArray();
  const original=db.costApprovals.add.bind(db.costApprovals);let count=0;
  vi.spyOn(db.costApprovals,'add').mockImplementation(value=>++count===2?Promise.reject(new Error('synthetic disk failure')):original(value));
  await expect(apply(3)).rejects.toThrow('synthetic disk failure');
  expect(await db.costApprovals.toArray()).toEqual(before);expect(await db.auditEvents.toArray()).toEqual(audit);
});
it('does not share incomplete evidence or a conflicting platform identity',async()=>{
  await db.salesRows.add({workspaceId:ledger.workspaceId,ledgerId:ledger.id,store:'甲',platformSku:'C',platformSkc:'CONFLICT',quantity:1,amount:20});
  expect((await previewSharedManualCost(input())).rows.some(r=>r.platformSku==='C')).toBe(false);
  for(const row of await db.erpCostInbox.toArray())await db.erpCostInbox.update(row.id,{envelope:{...row.envelope,batch:{...row.envelope.batch,warehouseEvidence:[]}}});
  expect(await previewSharedManualCost(input())).toBeNull();
});
