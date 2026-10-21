// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {db,getWorkspaceOperationalSummary,setActiveMemberContext} from './database';

beforeEach(async()=>{
  localStorage.clear();await db.delete();await db.open();
  await setActiveMemberContext({workspaceId:'projection',memberId:'reader',role:'admin'});
  await db.workspaces.put({id:'projection'});
  await db.products.put({id:'P',workspaceId:'projection',status:'active',draft:{raw:'large'.repeat(5000)}});
  await db.platformSkus.put({id:'S',workspaceId:'projection',productId:'P',platformSku:'SKU'});
  await db.captures.put({id:'C',workspaceId:'projection',status:'pending',validation:{blocking:[{raw:'large'.repeat(5000)}]}});
});
afterEach(async()=>{vi.restoreAllMocks();db.close();await db.delete();localStorage.clear();});

it('reuses compact catalog projections across audit-only writes and invalidates equal-count edits',async()=>{
  const read=vi.spyOn(Object.getPrototypeOf(db.products),'each');
  const productReads=()=>read.mock.contexts.filter(table=>table.name==='products').length;
  const first=await getWorkspaceOperationalSummary();
  expect(first).toMatchObject({productCount:1,platformSkuCount:1,blockedCaptureCount:1});
  expect(productReads()).toBe(1);
  await db.auditEvents.add({workspaceId:'projection',createdAt:'2026-10-22',objectType:'fixture'});
  const second=await getWorkspaceOperationalSummary();
  expect(second.recordCount).toBe(first.recordCount+1);
  expect(second.productCount).toBe(1);expect(productReads()).toBe(1);
  await db.products.update('P',{status:'deleted'});
  expect(await getWorkspaceOperationalSummary()).toMatchObject({productCount:0,platformSkuCount:0});
  expect(productReads()).toBe(2);
});

it('does not reuse private ownership or stale cached values when the revision store is unavailable',async()=>{
  await getWorkspaceOperationalSummary();
  await db.products.update('P',{visibility:'private',ownerId:'other'});
  await setActiveMemberContext({workspaceId:'projection',memberId:'reader',role:'member'});
  expect(await getWorkspaceOperationalSummary()).toMatchObject({productCount:0,platformSkuCount:0});
  const get=vi.spyOn(localStorage,'getItem').mockImplementation(()=>{throw Error('fixture clock unavailable');});
  try {
    await db.products.update('P',{visibility:'workspace'});
    expect(await getWorkspaceOperationalSummary()).toMatchObject({productCount:1,platformSkuCount:1});
  }finally{get.mockRestore();}
});
