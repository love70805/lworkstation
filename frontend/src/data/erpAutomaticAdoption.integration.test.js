import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db, DEFAULT_WORKSPACE_ID, createOrGetMonthlyLedger, setActiveMemberContext, saveErpCostRequest, receiveErpCostInboxEnvelope, getLatestLedgerCosts, processErpCostInboxAdoption, recoverErpCostInboxAdoptions, saveManualCostOverride, revokeManualCostOverride, getLedgerSnapshot, voidPublishedErpCostBatch, rejectErpCostInboxBatches, createWorkspaceBackupPayload } from './database';
import { buildErpCostRequest } from '../domain/erpCosts';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';
import { selectManualOverride } from '../domain/manualCostOverride';
import { resolveFormalCostDecision } from '../domain/costPolicy';
import { costDraftKey } from '../lib/costMatchingDraft';
import { recoverCompleteErpCostDrafts } from '../lib/erpLegacyDraftRecovery';
beforeEach(async()=>{await db.delete();await db.open();await setActiveMemberContext({workspaceId:DEFAULT_WORKSPACE_ID,memberId:'finance',role:'finance'});});
afterEach(async()=>{vi.restoreAllMocks();await db.delete();});
async function seed({prices=[5,0],incomplete=false,requestAt='2026-09-01T00:00:00Z',id='1'}={}){
 const ledger=await createOrGetMonthlyLedger({period:'2026-08'});
 const expectedSkus=['A','B'].map(platformSku=>({platformSku,platformSkc:`SKC-${platformSku}`}));
 if(!await db.salesRows.count())await db.salesRows.bulkAdd(expectedSkus.map(row=>({...row,workspaceId:ledger.workspaceId,ledgerId:ledger.id,store:'甲',quantity:2,amount:100,importedAt:'2026-08-31T00:00:00Z'})));
 const request=buildErpCostRequest({id:`REQ-${id}`,workspaceId:ledger.workspaceId,ledgerId:ledger.id,ledgerPeriod:ledger.period,platformSkcs:expectedSkus.map(row=>row.platformSkc),expectedSkus,requestedAt:requestAt,requestedBy:'finance'});await saveErpCostRequest(request);
 const batch=buildErpCostBatchEnvelope({batchId:`B-${id}`,workspaceId:ledger.workspaceId,ledgerId:ledger.id,requestId:request.id,platformSkcs:request.platformSkcs,expectedSkus,generatedAt:requestAt,results:expectedSkus.map((row,i)=>({warehouseSku:`WH-${row.platformSku}`,mappings:[row],previewUnitCost:prices[i]})),warehouseEvidence:expectedSkus.map((row,i)=>({warehouseSku:`WH-${row.platformSku}`,evidenceComplete:!(incomplete&&i===1),purchaseRecords:[{recordId:`R-${row.platformSku}`,purchaseDate:'2026-08-01',quantity:2,unitPrice:prices[i]}]}))});
 return {ledger,request,batch,envelope:buildErpCostInboxEnvelope({batch,deliveryId:`D-${id}`,sentAt:requestAt})};
}
it('automatically adopts only normal items on receipt, preserves partial history and is idempotent across retry/restart',async()=>{
 const {ledger,envelope}=await seed();const receipt=await receiveErpCostInboxEnvelope({envelope});
 expect(receipt.adoptionError).toBeUndefined();expect(receipt).toMatchObject({status:'pending',adoption:{state:'partial',summary:{adoptedCount:1,anomalyCount:1,remainingCount:1}}});
 expect((await getLatestLedgerCosts(ledger.id)).map(row=>[row.platformSku,row.unitCost])).toEqual([['A',5]]);
 const before={rows:await db.erpCostRows.count(),audit:await db.auditEvents.count()};
 await Promise.all([receiveErpCostInboxEnvelope({envelope}),receiveErpCostInboxEnvelope({envelope:{...envelope,deliveryId:'D-OTHER'}}),processErpCostInboxAdoption({inboxId:receipt.id})]);
 db.close();await db.open();await recoverErpCostInboxAdoptions({workspaceId:ledger.workspaceId});
 expect({rows:await db.erpCostRows.count(),audit:await db.auditEvents.count()}).toEqual(before);expect(await db.erpCostBatches.count()).toBe(1);
 await expect(rejectErpCostInboxBatches({ids:[receipt.id]})).rejects.toThrow('删除');
 await voidPublishedErpCostBatch({inboxId:receipt.id,reason:'合成撤回'});await recoverErpCostInboxAdoptions({workspaceId:ledger.workspaceId});expect(await getLatestLedgerCosts(ledger.id)).toEqual([]);expect((await db.erpCostInbox.get(receipt.id)).status).toBe('voided');
});
it('isolates local incomplete evidence without turning it into a global envelope failure',async()=>{
 const {envelope}=await seed({prices:[5,8],incomplete:true});
 // The real inbox adapter reports evidenceComplete=false for this scoped failure.
 envelope.batch.sourceMeta.evidenceComplete=false;
 delete envelope.batch.sourceMeta.completenessScope;
 const receipt=await receiveErpCostInboxEnvelope({envelope});
 expect(receipt.adoptionError).toBeUndefined();expect(receipt.adoption.summary).toMatchObject({adoptedCount:1,evidenceIncompleteCount:1});
});
it('blocks an unexplained source-level incomplete flag without adopting healthy-looking rows',async()=>{
 const {envelope}=await seed({prices:[5,8]});envelope.batch.sourceMeta.evidenceComplete=false;delete envelope.batch.sourceMeta.completenessScope;
 const receipt=await receiveErpCostInboxEnvelope({envelope});
 expect((await db.erpCostInbox.get(receipt.id)).envelope.batch.sourceMeta.completenessScope).toBe('source');
 expect(receipt.adoption).toMatchObject({state:'blocked',summary:{adoptedCount:0,evidenceIncompleteCount:2}});
 expect(await db.erpCostRows.count()).toBe(0);
});
it('stores healthy background ERP while manual zero remains effective, then restores ERP on revoke',async()=>{
 const {ledger,envelope}=await seed({prices:[5,8]});const manual=await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'A',unitCost:0,reason:'真实零'});
 const receipt=await receiveErpCostInboxEnvelope({envelope});expect(receipt.adoptionError).toBeUndefined();expect(receipt.adoption).toMatchObject({state:'applied',summary:{adoptedCount:2,manualEffectiveCount:1}});
 let snapshot=await getLedgerSnapshot(ledger.id);const scope={workspaceId:ledger.workspaceId,ledgerId:ledger.id,period:ledger.period,store:'甲',platformSku:'A'};
 expect(resolveFormalCostDecision({...scope,erpCost:snapshot.costs.find(row=>row.platformSku==='A'),manualOverride:selectManualOverride(snapshot.approvals,scope)}).unitCost).toBe(0);
 await revokeManualCostOverride({ledgerId:ledger.id,approvalId:manual.id});snapshot=await getLedgerSnapshot(ledger.id);expect(resolveFormalCostDecision({...scope,erpCost:snapshot.costs.find(row=>row.platformSku==='A'),manualOverride:selectManualOverride(snapshot.approvals,scope)}).unitCost).toBe(5);
});
it.each(['finalized','locked'])('retains incoming evidence without changing %s ledger',async status=>{
 const {ledger,envelope}=await seed({prices:[5,8]});await db.ledgers.update(ledger.id,{status,profitSummary:{sentinel:123}});
 const before=await db.ledgers.get(ledger.id);const receipt=await receiveErpCostInboxEnvelope({envelope});expect(receipt.adoptionError).toBeUndefined();expect(receipt.adoption.state).toBe('protected');expect(await db.erpCostRows.count()).toBe(0);expect(await db.ledgers.get(ledger.id)).toEqual(before);
});
it('does not roll back new costs for late old requests and rejects mutated source IDs',async()=>{
 const older=await seed({prices:[5,8],id:'old'}),newer=await seed({prices:[10,12],id:'new',requestAt:'2026-09-02T00:00:00Z'});
 await receiveErpCostInboxEnvelope({envelope:newer.envelope});const late=await receiveErpCostInboxEnvelope({envelope:older.envelope});expect(late.adoption.summary).toMatchObject({supersededCount:2,adoptedCount:0});expect((await getLatestLedgerCosts(older.ledger.id)).map(row=>row.unitCost)).toEqual([10,12]);
 const changed=structuredClone(newer.envelope);changed.batch.warehouseEvidence[0].purchaseRecords[0].unitPrice=99;
 await expect(receiveErpCostInboxEnvelope({envelope:changed})).rejects.toThrow('不同证据');
});
it('retains durable receipt after an adoption transaction fails and recovery retries it',async()=>{
 const {ledger,envelope}=await seed({prices:[5,8]});const add=vi.spyOn(db.erpCostRows,'bulkAdd').mockRejectedValueOnce(new Error('synthetic failure'));
 const receipt=await receiveErpCostInboxEnvelope({envelope});expect(receipt.adoptionError).toBe('synthetic failure');expect(await db.erpCostInbox.count()).toBe(1);expect(await db.erpCostBatches.count()).toBe(0);add.mockRestore();
 await recoverErpCostInboxAdoptions({workspaceId:ledger.workspaceId});expect(await db.erpCostRows.count()).toBe(2);
 const backup=JSON.parse(JSON.stringify(await createWorkspaceBackupPayload()));expect(JSON.stringify(backup)).toContain('erp-auto-adoption@1');
});
it('rejects corrupt envelope counts and foreign workspace; wrong ledger period remains blocked',async()=>{
 const {ledger,envelope,request}=await seed();await expect(receiveErpCostInboxEnvelope({envelope:{...envelope,batch:{...envelope.batch,summary:{...envelope.batch.summary,outputRowCount:99}}}})).rejects.toThrow('行数');
 await db.erpCostRequests.update(request.id,{ledgerPeriod:'2026-07'});const receipt=await receiveErpCostInboxEnvelope({envelope});expect(receipt.adoption.reason).toBe('ledger_period_mismatch');expect(await db.erpCostRows.count()).toBe(0);
 await setActiveMemberContext({workspaceId:'foreign',memberId:'other',role:'finance'});await expect(receiveErpCostInboxEnvelope({envelope})).rejects.toThrow('工作区');await expect(recoverErpCostInboxAdoptions({workspaceId:ledger.workspaceId})).rejects.toThrow('工作区');
});
it('exception correction appends only the affected item to one batch and repeats without duplicate audit',async()=>{
 const {envelope}=await seed();const receipt=await receiveErpCostInboxEnvelope({envelope});const before=(await db.erpCostRows.toArray())[0];
 const resolutions=[{warehouseSku:'WH-B',recordId:'R-B',action:'correct_price',originalUnitPrice:0,resolvedUnitPrice:7,reason:'合成核对',resolvedBy:'finance',resolvedAt:'2026-09-03T00:00:00Z'}];
 const result=await processErpCostInboxAdoption({inboxId:receipt.id,resolutions});expect(result.adoption.summary).toMatchObject({adoptedCount:2,remainingCount:0});expect(result.status).toBe('applied');expect(await db.erpCostBatches.count()).toBe(1);expect(await db.erpCostRows.get(before.id)).toEqual(before);
 const count=await db.auditEvents.count();await processErpCostInboxAdoption({inboxId:receipt.id,resolutions});expect(await db.erpCostRows.count()).toBe(2);expect(await db.auditEvents.count()).toBe(count);
});
it('rechecks lock and workspace ownership inside the processing transaction',async()=>{
 const {ledger,envelope}=await seed({prices:[5,8]});await db.ledgers.update(ledger.id,{status:'locked'});const received=await receiveErpCostInboxEnvelope({envelope});await db.ledgers.update(ledger.id,{status:'draft'});
 await setActiveMemberContext({workspaceId:'foreign',memberId:'other',role:'finance'});await expect(processErpCostInboxAdoption({inboxId:received.id})).rejects.toThrow('工作区');expect(await db.erpCostRows.count()).toBe(0);
 await setActiveMemberContext({workspaceId:ledger.workspaceId,memberId:'finance',role:'finance'});await processErpCostInboxAdoption({inboxId:received.id});expect(await db.erpCostRows.count()).toBe(2);
});
it('blocks unscoped global collection failures while preserving all original evidence',async()=>{
 const {envelope}=await seed({prices:[5,8]});envelope.batch.sourceMeta.sourceWarnings=['采购页不完整'];const received=await receiveErpCostInboxEnvelope({envelope});expect(received.adoption.state).toBe('blocked');expect(await db.erpCostRows.count()).toBe(0);expect((await db.erpCostInbox.get(received.id)).envelope.batch.warehouseEvidence).toHaveLength(2);
});
it('keeps missing expected SKU pending without blocking a normal returned SKU',async()=>{
 const {envelope}=await seed({prices:[5,8]});envelope.batch.rows.pop();envelope.batch.summary.outputRowCount=1;envelope.batch.summary.warehouseSkuCount=1;
 const received=await receiveErpCostInboxEnvelope({envelope});expect(received.adoptionError).toBeUndefined();expect(received.adoption.summary).toMatchObject({adoptedCount:1,missingCount:1,remainingCount:1});
});
it('recovers a Beta.5 pending inbox whose request recorded only SKCs, using the ledger SKU mapping',async()=>{
 const {ledger,request,envelope}=await seed({prices:[4.59,0],id:'legacy-inbox'});
 envelope.batch.warehouseEvidence[0].purchaseRecords=[
  {recordId:'P-1',purchaseDate:'2026-08-15',quantity:20,unitPrice:4.5},
  {recordId:'P-2',purchaseDate:'2026-08-10',quantity:15,unitPrice:4.5},
  {recordId:'P-3',purchaseDate:'2026-08-03',quantity:15,unitPrice:4.8},
 ];
 await db.erpCostRequests.update(request.id,{expectedSkus:[]});
 await db.erpCostInbox.add({id:'INBOX-D-legacy-inbox',deliveryId:envelope.deliveryId,batchId:envelope.batch.batchId,workspaceId:ledger.workspaceId,ledgerId:ledger.id,requestId:request.id,status:'loaded',receivedVia:'browser-message',receivedAt:envelope.sentAt,sentAt:envelope.sentAt,envelope});
 const recovered=await recoverErpCostInboxAdoptions({workspaceId:ledger.workspaceId});
 expect(recovered[0].error).toBeUndefined();
 expect(recovered[0].adoption).toMatchObject({state:'partial',summary:{adoptedCount:1,anomalyCount:1}});
 expect((await getLatestLedgerCosts(ledger.id)).map(row=>[row.platformSku,row.unitCost])).toEqual([['A',4.59]]);
});
it('refuses a legacy SKC-only request when the ledger maps one platform SKU to conflicting SKCs',async()=>{
 const {ledger,request,envelope}=await seed({prices:[4.59,8],id:'ambiguous'});
 await db.erpCostRequests.update(request.id,{expectedSkus:[]});
 await db.salesRows.add({workspaceId:ledger.workspaceId,ledgerId:ledger.id,store:'乙',platformSku:'A',platformSkc:'SKC-B',quantity:1,amount:10,importedAt:'2026-08-31T00:00:00Z'});
 await db.erpCostInbox.add({id:'INBOX-D-ambiguous',deliveryId:envelope.deliveryId,batchId:envelope.batch.batchId,workspaceId:ledger.workspaceId,ledgerId:ledger.id,requestId:request.id,status:'pending',receivedVia:'browser-message',receivedAt:envelope.sentAt,sentAt:envelope.sentAt,envelope});
 const recovered=await recoverErpCostInboxAdoptions({workspaceId:ledger.workspaceId});
 expect(recovered[0].adoption).toMatchObject({state:'blocked',reason:'legacy_request_ambiguous_scope'});
 expect(await getLatestLedgerCosts(ledger.id)).toEqual([]);
});
it('does not expand an old SKC-only request to a SKU imported after the request',async()=>{
 const {ledger,request}=await seed({prices:[4.59,8],id:'scope-time'});
 await db.erpCostRequests.update(request.id,{expectedSkus:[]});
 await db.salesRows.add({workspaceId:ledger.workspaceId,ledgerId:ledger.id,store:'甲',platformSku:'C',platformSkc:'SKC-A',quantity:1,amount:10,importedAt:'2026-09-02T00:00:00Z'});
 const expectedSkus=[{platformSku:'A',platformSkc:'SKC-A'},{platformSku:'B',platformSkc:'SKC-B'}];
 const results=[['A',4.59],['B',8],['C',99]].map(([sku,price])=>({warehouseSku:`WH-${sku}`,mappings:[{platformSku:sku,platformSkc:sku==='C'?'SKC-A':`SKC-${sku}`}],previewUnitCost:price}));
 const evidence=results.map((row,index)=>({warehouseSku:row.warehouseSku,evidenceComplete:true,purchaseRecords:[{recordId:`P-${index}`,purchaseDate:'2026-08-15',quantity:1,unitPrice:row.previewUnitCost}]}));
 const batch=buildErpCostBatchEnvelope({batchId:'B-scope-time',workspaceId:ledger.workspaceId,ledgerId:ledger.id,requestId:request.id,platformSkcs:request.platformSkcs,expectedSkus,generatedAt:'2026-09-01T00:00:00Z',results,warehouseEvidence:evidence});
 const receipt=await receiveErpCostInboxEnvelope({envelope:buildErpCostInboxEnvelope({batch,deliveryId:'D-scope-time',sentAt:'2026-09-01T00:00:00Z'})});
 expect(receipt.adoptionError).toBeUndefined();
 expect(receipt.adoption.summary).toMatchObject({expectedCount:2,adoptedCount:2});
 expect((await getLatestLedgerCosts(ledger.id)).map(row=>row.platformSku)).toEqual(['A','B']);
});
it('promotes a Beta.5 local full-evidence draft to a durable inbox and automatically adopts valid rows',async()=>{
 const {ledger,request,envelope}=await seed({prices:[4.59,0],id:'legacy-draft'});
 await db.erpCostRequests.update(request.id,{expectedSkus:[]});
 const draftText=JSON.stringify({sourceText:JSON.stringify(envelope.batch),updatedAt:0});
 const values=new Map([[costDraftKey(ledger.id),draftText]]);
 const storage={get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key)};
 const manual=await saveManualCostOverride({ledgerId:ledger.id,store:'甲',platformSku:'A',unitCost:0,reason:'真实零价'});
 const result=await recoverCompleteErpCostDrafts({workspaceId:ledger.workspaceId,storage});
 expect(result).toEqual({recovered:1,failures:[]});
 expect(storage.length).toBe(0);
 expect((await getLatestLedgerCosts(ledger.id)).map(row=>[row.platformSku,row.unitCost])).toEqual([['A',4.59]]);
 expect((await db.erpCostInbox.toArray())[0]).toMatchObject({receivedVia:'restored-cost-draft',adoption:{state:'partial'}});
 const scope={workspaceId:ledger.workspaceId,ledgerId:ledger.id,period:ledger.period,store:'甲',platformSku:'A'};
 let snapshot=await getLedgerSnapshot(ledger.id);
 expect(resolveFormalCostDecision({...scope,erpCost:snapshot.costs[0],manualOverride:selectManualOverride(snapshot.approvals,scope)}).unitCost).toBe(0);
 const before={rows:await db.erpCostRows.count(),audit:await db.auditEvents.count()};
 values.set(costDraftKey(ledger.id),draftText);
 await recoverCompleteErpCostDrafts({workspaceId:ledger.workspaceId,storage});
 expect({rows:await db.erpCostRows.count(),audit:await db.auditEvents.count()}).toEqual(before);
 await revokeManualCostOverride({ledgerId:ledger.id,approvalId:manual.id});
 snapshot=await getLedgerSnapshot(ledger.id);
 expect(resolveFormalCostDecision({...scope,erpCost:snapshot.costs[0],manualOverride:selectManualOverride(snapshot.approvals,scope)}).unitCost).toBe(4.59);
});
it('preserves finalized ledger state when promoting a complete old draft to the inbox',async()=>{
 const {ledger,envelope}=await seed({prices:[4.59,8],id:'draft-locked'});
 await db.ledgers.update(ledger.id,{status:'finalized',profitSummary:{sentinel:1}});
 const values=new Map([[costDraftKey(ledger.id),JSON.stringify({sourceText:JSON.stringify(envelope.batch),updatedAt:0})]]);
 const storage={get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key)};
 expect(await recoverCompleteErpCostDrafts({workspaceId:ledger.workspaceId,storage})).toEqual({recovered:1,failures:[]});
 expect((await db.erpCostInbox.toArray())[0].adoption.state).toBe('protected');
 expect(await db.erpCostRows.count()).toBe(0);
 expect((await db.ledgers.get(ledger.id)).status).toBe('finalized');
});
it('keeps an unrelated draft untouched and never adopts it in the active workspace',async()=>{
 const {ledger,envelope}=await seed({prices:[4.59,8],id:'foreign-draft'});
 const values=new Map([[costDraftKey(ledger.id),JSON.stringify({sourceText:JSON.stringify({...envelope.batch,workspaceId:'foreign'}),updatedAt:0})]]);
 const storage={get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key)};
 expect(await recoverCompleteErpCostDrafts({workspaceId:ledger.workspaceId,storage})).toEqual({recovered:0,failures:[]});
 expect(storage.length).toBe(1);
 expect(await db.erpCostRows.count()).toBe(0);
});
it('keeps a voided newer source as a tombstone so old ERP evidence cannot revive',async()=>{
 const older=await seed({prices:[4.59,8],id:'late-old'}),newer=await seed({prices:[10,12],id:'late-new',requestAt:'2026-09-02T00:00:00Z'});
 const newerReceipt=await receiveErpCostInboxEnvelope({envelope:newer.envelope});
 await voidPublishedErpCostBatch({inboxId:newerReceipt.id,reason:'隔离撤回'});
 const received=await receiveErpCostInboxEnvelope({envelope:older.envelope});
 expect(received.adoption.summary).toMatchObject({adoptedCount:0,supersededCount:2});
 expect(await getLatestLedgerCosts(older.ledger.id)).toEqual([]);
});
