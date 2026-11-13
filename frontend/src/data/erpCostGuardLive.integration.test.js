import 'fake-indexeddb/auto';
import { liveQuery } from 'dexie';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from './db/clientDatabase';
import { derivedCacheDb, clearDerivedMemory } from './db/derivedCache';
import { setActiveMemberContext } from './repositories/selectionRepository';
import { listErpCostAdoptionStates } from './repositories/profitRepository';
import { erpCostEditingGuard } from '../domain/erpCostEditingGuard';
const task = { workspaceId: 'W', ledgerId: 'L', requestId: 'R', status: 'cost_complete', batches: [{ deliveryId: 'D' }] };
const receipt = { id: 'I', workspaceId: 'W', ledgerId: 'L', requestId: 'R', deliveryId: 'D', status: 'pending', adoptionPending: true };
let subscription;
beforeEach(async () => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) });
  clearDerivedMemory(); await derivedCacheDb.delete(); await derivedCacheDb.open(); await db.delete(); await db.open();
  await setActiveMemberContext({workspaceId:'W',memberId:'M',role:'finance'});
  await db.ledgers.put({id:'L',workspaceId:'W',period:'2026-10'});
});
afterEach(async () => { subscription?.unsubscribe(); subscription=null; await db.delete(); await derivedCacheDb.delete(); vi.unstubAllGlobals(); });
async function watchWarmCache() {
  await listErpCostAdoptionStates({ workspaceId: 'W' }); // Background reporter/another component reads first.
  const states = [], errors = [];
  subscription = liveQuery(async () => erpCostEditingGuard({workspaceId:'W',ledgerId:'L',tasks:[task],inboxes:await listErpCostAdoptionStates({workspaceId:'W'})})).subscribe({next:state=>states.push(state),error:error=>errors.push(error)});
  await vi.waitFor(()=>expect(states.length).toBeGreaterThan(0));
  return {states,errors};
}
it('refreshes a warm cached guard when the last delivery arrives, then unlocks with one settled price anomaly',async()=>{
  const {states,errors}=await watchWarmCache();
  expect(states.at(-1).title).toBe('成本已送达，正在完成本机核算');
  await db.erpCostInbox.put(receipt);
  await vi.waitFor(()=>expect(states.at(-1).title).toBe('正在核验采购证据并更新成本'),{timeout:1500});
  await db.erpCostInbox.update('I',{adoptionPending:false,adoption:{state:'partial',summary:{adoptedCount:354,anomalyCount:1}}});
  await vi.waitFor(()=>expect(states.at(-1).blocked).toBe(false),{timeout:1500});
  expect(errors).toEqual([]);
});
it('observes equal-count adoption updates after every consumer starts from a cached pending projection',async()=>{
  await db.erpCostInbox.put(receipt);
  const {states,errors}=await watchWarmCache();expect(states.at(-1).blocked).toBe(true);
  await db.erpCostInbox.update('I',{adoptionPending:false,adoption:{state:'blocked',summary:{anomalyCount:1}}});
  await vi.waitFor(()=>expect(states.at(-1).blocked).toBe(false),{timeout:1500});expect(errors).toEqual([]);
});
it('falls back to observing inbox rows if disposable cache observation is unavailable',async()=>{
  await db.erpCostInbox.put(receipt);
  const probe=vi.spyOn(derivedCacheDb.revisions,'get').mockRejectedValue(new Error('synthetic cache unavailable'));
  try {
    const {states,errors}=await watchWarmCache();expect(states.at(-1).blocked).toBe(true);
    await db.erpCostInbox.update('I',{adoptionPending:false,adoption:{state:'blocked',summary:{anomalyCount:1}}});
    await vi.waitFor(()=>expect(states.at(-1).blocked).toBe(false),{timeout:1500});expect(errors).toEqual([]);
  }finally{probe.mockRestore()}
});
