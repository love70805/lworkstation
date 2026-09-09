import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { db, DEFAULT_WORKSPACE_ID as workspaceId, setActiveMemberContext, saveManualCostOverride, revokeManualCostOverride, getLedgerSnapshot, finalizeMonthlyLedger, reopenLedgerForCostCorrection } from "./database";
import { calculateFormalLedgerRows } from "../domain/ledgerProfit";
import { PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { buildSyncEnvelope } from "../domain/syncEnvelope";
import { buildSyncPostgresPlan } from "../domain/syncPostgresPlan";
import { buildSyncRecoveryPayload, replaySyncRecoveryPayload } from "../domain/syncRecovery";
import { selectAtomicSyncEventSelection, normalizeErpVoidLifecycleSequence } from "../domain/syncLifecycleGroup";
import { createCloudAuthorizer } from "../domain/cloudAuthorization";

const ledgerId = "REOPEN-L";
const save = (store, unitCost) => saveManualCostOverride({ ledgerId, store, platformSku: "SHARED", unitCost, reason: "采购价格复核" });
async function finalize() {
  const snapshot = await getLedgerSnapshot(ledgerId);
  const profitLines = calculateFormalLedgerRows({ ledger: snapshot.ledger, salesRows: snapshot.rows, erpCosts: snapshot.costs, approvals: snapshot.approvals });
  return finalizeMonthlyLedger({ ledgerId, formulaVersion: PROFIT_FORMULA_VERSION, profitLines, profitSummary: {} });
}
beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId, memberId: "finance-real", role: "finance" });
  await db.ledgers.put({ id: ledgerId, workspaceId, period: "2026-08", status: "cost_pending", warehouseRate: 0, currency: "CNY" });
  await db.salesRows.bulkAdd(["甲", "乙"].map((store) => ({ ledgerId, workspaceId, store, platformSku: "SHARED", platformSkc: "SKC", quantity: 2, amount: 10, penalty: 0 })));
  await save("甲", 0); await save("乙", 0.2); await finalize();
});
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete(); });

it("explicitly reopens a pure manual ledger, preserves snapshots and permits correction then fresh finalization", async () => {
  const original = await getLedgerSnapshot(ledgerId);
  await expect(save("甲", 1)).rejects.toThrow("定稿");
  const approval = original.approvals.find((row) => row.referenceCost.store === "乙");
  await expect(revokeManualCostOverride({ ledgerId, approvalId: approval.id })).rejects.toThrow("定稿");
  await reopenLedgerForCostCorrection({ ledgerId, reason: "复核人工成本" });
  expect(await db.profitLines.count()).toBe(0);
  const audit = (await db.auditEvents.toArray()).find((event) => event.action === "ledger_reopened_for_cost_correction");
  expect(audit).toMatchObject({ actorId: "finance-real", after: { reason: "复核人工成本" }, before: { snapshot: { ledger: original.ledger, profitLines: original.profitLines } } });
  await save("甲", 0.1);
  await revokeManualCostOverride({ ledgerId, approvalId: approval.id });
  await expect(finalize()).rejects.toThrow("缺少正式成本");
  await save("乙", 0.3); await finalize();
  expect((await getLedgerSnapshot(ledgerId)).ledger.profitSummary.profit).toBe(19.2);
  expect((await db.auditEvents.get(audit.id)).before.snapshot.profitLines).toEqual(original.profitLines);
});

it("keeps ERP published and restores it when a manual override is revoked after reopening", async () => {
  await db.erpCostBatches.put({ id: "ERP", ledgerId, workspaceId, status: "published" });
  await db.erpCostRows.add({ batchId: "ERP", ledgerId, workspaceId, platformSku: "SHARED", unitCost: 0.5, resolutionStatus: "resolved", publishedAt: new Date().toISOString() });
  await reopenLedgerForCostCorrection({ ledgerId, reason: "复核混合成本" });
  for (const approval of await db.costApprovals.toArray()) await revokeManualCostOverride({ ledgerId, approvalId: approval.id });
  expect(await db.erpCostBatches.get("ERP")).toMatchObject({ status: "published" });
  await finalize();
  expect((await getLedgerSnapshot(ledgerId)).profitLines.every((row) => row.costSource === "erp" && row.unitCost === 0.5)).toBe(true);
});

it("requires a reason and active financial permission and rejects locked or already-open ledgers", async () => {
  await expect(reopenLedgerForCostCorrection({ ledgerId, reason: " " })).rejects.toThrow("原因");
  for (const role of ["viewer", "operations", "selection"]) {
    await setActiveMemberContext({ workspaceId, memberId: "other", role });
    await expect(reopenLedgerForCostCorrection({ ledgerId, reason: "test" })).rejects.toThrow("权限");
  }
  await setActiveMemberContext({ workspaceId: "other", memberId: "admin", role: "admin" });
  await expect(reopenLedgerForCostCorrection({ ledgerId, reason: "test" })).rejects.toThrow("权限");
  await setActiveMemberContext({ workspaceId, memberId: "finance-real", role: "finance" });
  await db.ledgers.update(ledgerId, { status: "locked" });
  await expect(reopenLedgerForCostCorrection({ ledgerId, reason: "test" })).rejects.toThrow("未锁定");
  await db.ledgers.update(ledgerId, { status: "finalized" });
  await reopenLedgerForCostCorrection({ ledgerId, reason: "test" });
  await expect(reopenLedgerForCostCorrection({ ledgerId, reason: "test" })).rejects.toThrow("已定稿");
});

it("rolls back the whole reopen when audit persistence fails", async () => {
  const snapshot = await getLedgerSnapshot(ledgerId);
  vi.spyOn(db.auditEvents, "add").mockRejectedValueOnce(new Error("audit failed"));
  await expect(reopenLedgerForCostCorrection({ ledgerId, reason: "test" })).rejects.toThrow("audit failed");
  expect((await getLedgerSnapshot(ledgerId)).profitLines).toEqual(snapshot.profitLines);
  expect((await db.ledgers.get(ledgerId)).status).toBe("finalized");
});

it("selects, validates, projects and recovers the standalone action without weakening ERP lifecycle pairing", async () => {
  await reopenLedgerForCostCorrection({ ledgerId, reason: "独立成本复核" });
  const events = (await db.auditEvents.toArray()).map((event) => ({ ...event, eventId: `E-${event.id}` }));
  const reopened = events.find((event) => event.action === "ledger_reopened_for_cost_correction");
  expect(selectAtomicSyncEventSelection([reopened], 1)).toEqual([reopened]);
  expect(normalizeErpVoidLifecycleSequence([reopened]).valid).toBe(true);
  expect(() => normalizeErpVoidLifecycleSequence([{ ...reopened, action: "reopened_for_cost_recalculation" }])).toThrow("unpaired");
  const plan = await buildSyncPostgresPlan(buildSyncEnvelope({ workspaceId, events: [reopened] }));
  expect(plan.eventPlans[0].operations).toHaveLength(1);
  expect(plan.eventPlans[0].operations[0]).toMatchObject({ kind: "reopen_finalized_ledger", values: [workspaceId, ledgerId, "ready", {}, expect.any(Object), expect.any(String), "独立成本复核"] });
  const recovery = replaySyncRecoveryPayload(buildSyncRecoveryPayload({ workspaceId, events }));
  expect(recovery.tables.profitLines).toHaveLength(0);
  expect(recovery.tables.ledgers[0].status).toBe("ready");
  expect(recovery.tables.auditEvents.find((event) => event.action === reopened.action).before.snapshot.profitLines).toHaveLength(2);
  for (const role of ["viewer", "operations", "selection", "finance", "admin"]) expect(createCloudAuthorizer({ role })({ events: [reopened] })).toBe(["finance", "admin"].includes(role));
});
