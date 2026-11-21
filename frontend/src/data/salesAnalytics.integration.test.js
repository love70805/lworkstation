import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { db } from "./db/clientDatabase";
import { readSalesCatalogLinks, setActiveMemberContext } from "./repositories/selectionRepository";
import { readLedgerSalesAnalytics, readLedgerDailySalesDetails, readLedgerPeriodSalesDetails, readWorkspaceSalesMonths } from "./repositories/salesAnalyticsRepository";
import { listLedgerSummaries } from "./repositories/profitRepository";
beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: "W", memberId: "member" });
  await db.ledgers.bulkPut([{ id: "L", workspaceId: "W", period: "2026-08" }, { id: "F", workspaceId: "foreign", period: "2026-08" }]);
  await db.salesRows.bulkAdd([{ ledgerId: "L", workspaceId: "W", store: "甲", platformSku: "A", quantity: 1, amount: 0.009, amountExact: "0.009" }, { ledgerId: "L", workspaceId: "W", store: "乙", platformSku: "A", quantity: 2, amount: 4 }, { ledgerId: "L", workspaceId: "foreign", store: "污染行", quantity: 99, amount: 99 }]);
});
it('reads day detail within workspace/month/store and rejects foreign or malformed scope',async()=>{
 await db.salesRows.where('ledgerId').equals('L').modify({sourceAddedDate:'2026-08-01'});
 await db.salesRows.add({ledgerId:'L',workspaceId:'W',store:'甲',platformSku:'OTHER-DAY',quantity:500,amount:500,sourceAddedDate:'2026-08-02'});
 const scope={workspaceId:'W',ledgerId:'L',store:'甲',date:'2026-08-01'};
 const result=await readLedgerDailySalesDetails(scope);
 expect(result.scope).toEqual(scope);expect(result.rows).toHaveLength(1);expect(result.totalsExact.revenueExact).toBe('0.009');
 expect((await readLedgerDailySalesDetails({...scope,store:'all'})).rows).toHaveLength(2);
 for(const patch of [{workspaceId:'foreign',ledgerId:'F'},{ledgerId:'F'},{ledgerId:'missing'},{store:'污染行'},{store:'不存在'},{date:'2026-09-01'},{date:'2026-08-32'}])await expect(readLedgerDailySalesDetails({...scope,...patch})).rejects.toThrow();
 await setActiveMemberContext({workspaceId:'foreign',memberId:'other'});
 await expect(readLedgerDailySalesDetails(scope)).rejects.toThrow('工作区');
});
afterEach(async () => { await db.delete(); });
it('reads monthly series and SKC detail only within the active workspace and invalidates edits', async () => {
  await db.ledgers.add({ id: 'JUL', workspaceId: 'W', period: '2026-07' });
  await db.salesRows.add({ ledgerId: 'JUL', workspaceId: 'W', store: '甲', platformSkc: 'SKC', platformSku: '001', quantity: 3, amount: 6 });
  const months = await readWorkspaceSalesMonths({ workspaceId: 'W' });
  expect(months.map(month => month.ledgerId)).toEqual(['JUL', 'L']);
  expect(months[0].monthTotalsExact.quantityExact).toBe('3');
  const scope = { workspaceId: 'W', ledgerId: 'JUL' };
  expect((await readLedgerPeriodSalesDetails(scope)).rows[0].platformSkc).toBe('SKC');
  await db.salesRows.where('ledgerId').equals('JUL').modify({ quantity: 5 });
  expect((await readLedgerPeriodSalesDetails(scope)).totalsExact.quantityExact).toBe('5');
  expect((await readWorkspaceSalesMonths({ workspaceId: 'W' }))[0].monthTotalsExact.quantityExact).toBe('5');
  expect((await readWorkspaceSalesMonths({ workspaceId: 'W', store: '乙' }))[0].missingStore).toBe(true);
  expect((await readLedgerPeriodSalesDetails({ ...scope, store: '乙' })).status).toBe('unknown');
  await expect(readWorkspaceSalesMonths({ workspaceId: 'foreign' })).rejects.toThrow('工作区');
  await expect(readLedgerPeriodSalesDetails({ ...scope, ledgerId: 'F' })).rejects.toThrow('工作区');
});
it("reads exact scoped rows and rejects foreign workspaces, ledgers and stores at repository", async () => {
  expect(db.verno).toBe(16);
  expect((await listLedgerSummaries()).map((ledger) => ledger.id)).toEqual(["L"]);
  expect((await readLedgerSalesAnalytics({ workspaceId: "W", ledgerId: "L", store: "甲" })).monthTotalsExact.revenueExact).toBe("0.009");
  expect((await readLedgerSalesAnalytics({ workspaceId: "W", ledgerId: "L" })).monthTotalsExact.revenueExact).toBe("4.009");
  for (const scope of [{ workspaceId: "foreign", ledgerId: "F" }, { workspaceId: "W", ledgerId: "F" }, { workspaceId: "W", ledgerId: "L", store: "不存在" }]) await expect(readLedgerSalesAnalytics(scope)).rejects.toThrow();
});

it('looks up catalog links only for unique visible SKCs, including drafts and legacy variant identities', async () => {
  await setActiveMemberContext({workspaceId:'W',memberId:'member',role:'buyer'});
  await db.products.bulkPut([
    {id:'D', workspaceId:'W',status:'draft',platformSkc:'ａ'}, {id:'X',workspaceId:'foreign',platformSkc:'A'},
    {id:'H',workspaceId:'W',platformSkc:'HIDDEN',visibility:'private',ownerId:'other'},
    {id:'DEL',workspaceId:'W',platformSkc:'Z',status:'deleted'}, {id:'OLD',workspaceId:'W'},
    {id:'ONE',workspaceId:'W',platformSkc:'B'}, {id:'TWO',workspaceId:'W',platformSkc:'b'},
  ]);
  await db.platformSkus.put({id:'V',productId:'OLD',workspaceId:'W',platformSkc:'Legacy',canonicalPlatformSku:'V'});
  expect(await readSalesCatalogLinks('W')).toEqual(new Map([['A','D'],['B',null],['LEGACY','OLD']]));
  expect((await readSalesCatalogLinks('foreign')).size).toBe(0);
});

it('opens the first and adjacent day from the chart columns and observes later source edits', async () => {
  const scope={workspaceId:'W',ledgerId:'L'};
  await db.salesRows.where('ledgerId').equals('L').modify({sourceAddedDate:'2026-08-01'});
  await readLedgerSalesAnalytics(scope);
  let reads=0;
  const onRead = row => {reads++; return row};
  db.salesRows.hook('reading', onRead);
  try {
    for (const date of ['2026-08-01','2026-08-02','2026-08-01']) await readLedgerPeriodSalesDetails({...scope,date});
    expect(reads).toBe(0);
    await db.salesRows.add({ledgerId:'L',store:'甲',sku:'LEGACY',quantity:1,amount:-2,sourceAddedDate:'2026-08-02'});
    expect((await readLedgerPeriodSalesDetails({...scope,date:'2026-08-02'})).totalsExact.revenueExact).toBe('-2');
    await setActiveMemberContext({workspaceId:'foreign',memberId:'other'});
    await expect(readLedgerPeriodSalesDetails({...scope,date:'2026-08-01'})).rejects.toThrow('工作区');
  } finally { db.salesRows.hook('reading').unsubscribe(onRead); }
});

it('reuses compact monthly summaries without rescanning raw source rows on warm reads', async () => {
  let reads = 0;
  const onRead = row => { reads++; return row; };
  db.salesRows.hook('reading', onRead);
  try {
    await readWorkspaceSalesMonths({ workspaceId: 'W' });
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    await readWorkspaceSalesMonths({ workspaceId: 'W' });
    expect(reads).toBe(0);
  } finally { db.salesRows.hook('reading').unsubscribe(onRead); }
});
