import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db, getWorkspaceOperationalSummary, setActiveMemberContext } from "./database";

const current = "workspace-summary-a";
const foreign = "workspace-summary-b";
beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: current, memberId: "summary-admin", role: "admin" });
  await db.workspaces.bulkPut([{ id: current, name: "本工作区" }, { id: foreign, name: "其他工作区" }]);
  // Deliberately insert the older ledger and activity last.
  await db.ledgers.bulkPut([
    { id: "A-NEW", workspaceId: current, period: "2026-08", updatedAt: "2026-09-08", status: "ready", costSummary: { missingCount: 0 } },
    { id: "A-CLOSED", workspaceId: current, period: "2026-06", updatedAt: "2026-09-06", finalizedAt: "2026-09-06", status: "finalized" },
    { id: "A-OLD", workspaceId: current, period: "2026-07", updatedAt: "2026-09-07", status: "cost_pending", costSummary: { missingCount: 3 } },
  ]);
  await db.auditEvents.bulkAdd([
    { workspaceId: current, createdAt: "2026-09-08T08:00:00Z", action: "created" },
    { workspaceId: current, createdAt: "2026-09-01T08:00:00Z", action: "created" },
  ]);
  await db.products.put({ id: "A-P", workspaceId: current, status: "active" });
  await db.captures.put({ id: "A-C", workspaceId: current, status: "pending", capturedAt: "2026-09-08" });
  await db.platformSkus.put({ id: "A-S", workspaceId: current, platformSku: "A-S", productId: "A-P" });
});
afterEach(async () => { db.close(); await db.delete(); });

it("keeps latest ledgers, activity, pending costs and all counts isolated regardless of foreign dates and insertion order", async () => {
  const original = await getWorkspaceOperationalSummary();
  expect(original).toMatchObject({ productCount: 1, platformSkuCount: 1, pendingCaptureCount: 1, openLedgerCount: 2, finalizedLedgerCount: 1, readyLedgerCount: 1, missingCostCount: 3,
    latestLedger: { id: "A-NEW" }, latestOpenLedger: { id: "A-NEW" }, latestFinalizedLedger: { id: "A-CLOSED" }, latestActivityAt: "2026-09-08T08:00:00Z" });
  expect(original.pendingLedgerTasks).toEqual([
    { ledgerId: "A-OLD", period: "2026-07", kind: "cost", missingCount: 3 },
    { ledgerId: "A-NEW", period: "2026-08", kind: "profit", missingCount: 0 },
  ]);
  await db.ledgers.bulkPut([
    { id: "B-LATEST", workspaceId: foreign, period: "2099-12", updatedAt: "2099-12-31", status: "cost_pending", costSummary: { missingCount: 900, identityPolicyVersion: "ledger-cost-identity@1" } },
    { id: "B-CLOSED", workspaceId: foreign, period: "2099-11", finalizedAt: "2099-12-30", status: "locked" },
    { id: "B-OLD", workspaceId: foreign, period: "2000-01", updatedAt: "2000-01-01", status: "ready" },
  ]);
  await db.auditEvents.add({ workspaceId: foreign, createdAt: "2099-12-31T23:59:59Z", action: "FOREIGN-SECRET" });
  await db.products.put({ id: "B-P", workspaceId: foreign, status: "active" });
  await db.captures.put({ id: "B-C", workspaceId: foreign, status: "blocked", capturedAt: "2099-12-31" });
  await db.platformSkus.bulkPut([
    { id: "B-S", workspaceId: foreign, platformSku: "B-S", productId: "B-P" },
    { id: "B-ORPHAN", workspaceId: foreign, platformSku: "B-ORPHAN" },
  ]);
  await db.salesRows.add({ workspaceId: foreign, ledgerId: "B-LATEST", platformSku: "B-S", quantity: 999 });
  expect(await getWorkspaceOperationalSummary()).toEqual(original);
  await setActiveMemberContext({ workspaceId: foreign, memberId: "summary-admin", role: "admin" });
  expect(await getWorkspaceOperationalSummary()).toMatchObject({ productCount: 1, platformSkuCount: 2, blockedCaptureCount: 1, openLedgerCount: 2, finalizedLedgerCount: 1, readyLedgerCount: 1, missingCostCount: 900,
    latestLedger: { id: "B-LATEST" }, latestOpenLedger: { id: "B-LATEST" }, latestFinalizedLedger: { id: "B-CLOSED" }, latestActivityAt: "2099-12-31T23:59:59Z" });
});

it("projects a legacy ready identity conflict as a cost task without writing the saved ledger", async () => {
  const ledger = await db.ledgers.get("A-NEW");
  await db.salesRows.bulkAdd([
    { workspaceId: current, ledgerId: ledger.id, store: "甲", platformSku: "SHARED", platformSkc: "SKC-A" },
    { workspaceId: current, ledgerId: ledger.id, store: "乙", platformSku: "SHARED", platformSkc: "SKC-B" },
  ]);
  const summary = await getWorkspaceOperationalSummary();
  expect(summary.readyLedgerCount).toBe(0);
  expect(summary.pendingLedgerTasks.find(task => task.ledgerId === ledger.id)).toMatchObject({ kind: "cost", missingCount: 2 });
  expect(summary.latestOpenLedger.costSummary.identityIssues).toMatchObject([{ code: "ledger_sku_skc_conflict", ledgerPlatformSkcs: ["SKC-A", "SKC-B"] }]);
  expect(await db.ledgers.get(ledger.id)).toEqual(ledger);
});

it("a newer draft does not remove an earlier ready month from the persisted summary", async () => {
  await db.ledgers.put({ id: "A-DRAFT", workspaceId: current, period: "2026-09", updatedAt: "2026-10-12", status: "draft" });
  const summary = await getWorkspaceOperationalSummary();
  expect(summary.latestOpenLedger.id).toBe("A-DRAFT");
  expect(summary.pendingLedgerTasks).toEqual([
    { ledgerId: "A-OLD", period: "2026-07", kind: "cost", missingCount: 3 },
    { ledgerId: "A-NEW", period: "2026-08", kind: "profit", missingCount: 0 },
    { ledgerId: "A-DRAFT", period: "2026-09", kind: "ledger", missingCount: 0 },
  ]);
});

it("keeps provable legacy child ownership and global settings counts without assigning ownerless records to a workspace", async () => {
  const original = await getWorkspaceOperationalSummary();
  await db.platformSkus.put({ id: "LEGACY-SKU", platformSku: "LEGACY-SKU", productId: "A-P" });
  await db.erpCostRows.add({ ledgerId: "A-NEW", platformSku: "A-S", unitCost: 1 });
  await db.settings.put({ key: "summary-global-setting", value: "device-only" });
  const withLegacy = await getWorkspaceOperationalSummary();
  expect(withLegacy.platformSkuCount).toBe(original.platformSkuCount + 1);
  expect(withLegacy.recordCount).toBe(original.recordCount + 3);
  await db.platformSkus.put({ id: "OWNERLESS", platformSku: "OWNERLESS" });
  await db.ledgers.put({ id: "OWNERLESS-L", period: "2099-12", status: "cost_pending", costSummary: { missingCount: 99 } });
  await db.auditEvents.add({ createdAt: "2099-12-31", action: "OWNERLESS" });
  expect(await getWorkspaceOperationalSummary()).toEqual(withLegacy);
});
