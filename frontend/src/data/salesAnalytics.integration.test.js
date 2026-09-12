import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { db } from "./db/clientDatabase";
import { setActiveMemberContext } from "./repositories/selectionRepository";
import { readLedgerSalesAnalytics } from "./repositories/salesAnalyticsRepository";
import { listLedgerSummaries } from "./repositories/profitRepository";
beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: "W", memberId: "member" });
  await db.ledgers.bulkPut([{ id: "L", workspaceId: "W", period: "2026-08" }, { id: "F", workspaceId: "foreign", period: "2026-08" }]);
  await db.salesRows.bulkAdd([{ ledgerId: "L", workspaceId: "W", store: "甲", platformSku: "A", quantity: 1, amount: 0.009, amountExact: "0.009" }, { ledgerId: "L", workspaceId: "W", store: "乙", platformSku: "A", quantity: 2, amount: 4 }, { ledgerId: "L", workspaceId: "foreign", store: "污染行", quantity: 99, amount: 99 }]);
});
afterEach(async () => { await db.delete(); });
it("reads exact scoped rows and rejects foreign workspaces, ledgers and stores at repository", async () => {
  expect(db.verno).toBe(15);
  expect((await listLedgerSummaries()).map((ledger) => ledger.id)).toEqual(["L"]);
  expect((await readLedgerSalesAnalytics({ workspaceId: "W", ledgerId: "L", store: "甲" })).monthTotalsExact.revenueExact).toBe("0.009");
  expect((await readLedgerSalesAnalytics({ workspaceId: "W", ledgerId: "L" })).monthTotalsExact.revenueExact).toBe("4.009");
  for (const scope of [{ workspaceId: "foreign", ledgerId: "F" }, { workspaceId: "W", ledgerId: "F" }, { workspaceId: "W", ledgerId: "L", store: "不存在" }]) await expect(readLedgerSalesAnalytics(scope)).rejects.toThrow();
});
