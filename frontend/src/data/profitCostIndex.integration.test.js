import 'fake-indexeddb/auto';
import { afterEach,beforeEach,expect,it } from 'vitest';
import { db } from './db/clientDatabase';
import { completeProfitResolutionIndex,readIndexedProfitCosts } from './repositories/profitCostIndex';
import { profitCostFields } from '../domain/profitPageProjection';

const ledger={id:'L',workspaceId:'W',period:'2026-10'}, allowed=new Set(['A','B','void']), published=new Set(['A','B']);
let rows;
beforeEach(async()=>{
  await db.delete();await db.open();
  rows=Array.from({length:300},(_,i)=>{
    const cycle=Math.floor(i/100),n=i%100,sku='SKU-'+n;
    return { id:i+1, ledgerId:'L',workspaceId:'W',batchId:cycle===1&&n===3?'void':cycle===0?'A':'B',
      platformSku:sku,canonicalPlatformSku:sku, publishedAt:['2026-11-01','2026-11-22', n===1?'2026-11-22':'2026-11-12'][cycle],
      unitCost:cycle+1,sourceEnvelopeBatchId:cycle+'',...(n===2?{resolutions:[{recordId:'purchase-'+i}]}:{}) };
  });
  await db.erpCostRows.bulkAdd(rows);
});
afterEach(()=>db.delete());
it('looks up current prices by publication then ID; historical resolutions remain available in source order',async()=>{
  // A prior filtered request must never drop the other 99 SKUs from this view.
  await db.erpCostRequests.put({id:'R',workspaceId:'W',ledgerId:'L',expectedSkus:[{platformSku:'SKU-1'}]});
  const result=await readIndexedProfitCosts(ledger,allowed,published);
  const expected=rows.slice(100,200).map(row=> row.platformSku==='SKU-1'?rows[201]:row).filter(row=>row.batchId!=='void');
  expect(result.costs).toEqual(expected.map(row=>profitCostFields(row,ledger.period)));
  const complete=await completeProfitResolutionIndex(ledger,result.resolutionIndex);
  expect(complete.resolutions.map(r=>r.resolutions[0].recordId)).toEqual(['purchase-2','purchase-102','purchase-202']);
});
it('allows an exact scope hint to skip history only when every cost key was covered',async()=>{
  await db.erpCostRequests.put({id:'R',workspaceId:'W',ledgerId:'L',expectedSkus:rows.slice(0,100).map(({platformSku})=>({platformSku}))});
  const result=await readIndexedProfitCosts(ledger,allowed,published);
  expect(result.costs).toHaveLength(99);
  expect(result.costs.find(row=>row.platformSku==='SKU-1').id).toBe(202);
});
it.each([{workspaceId:'other'}, {batchId:'orphan'}, {canonicalPlatformSku:undefined}, {publishedAt:undefined}])('requires the authoritative scan when an index cannot prove its head: %j',async change=>{
  await db.erpCostRows.update(101,change);
  expect(await readIndexedProfitCosts(ledger,allowed,published)).toBeNull();
});
