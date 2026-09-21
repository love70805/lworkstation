import "fake-indexeddb/auto";
import { adoptZeroDispatch } from "../testFixtures/reportWorkflow";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { db, DEFAULT_WORKSPACE_ID as workspaceId, setActiveMemberContext, saveManualCostOverride, revokeManualCostOverride, getLedgerSnapshot, finalizeMonthlyLedger, createWorkspaceBackupPayload } from "./database";
import { calculateFormalLedgerRows } from "../domain/ledgerProfit";
import { PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { buildSyncEnvelope } from "../domain/syncEnvelope";
import { buildSyncPostgresPlan } from "../domain/syncPostgresPlan";
import { buildSyncRecoveryPayload, replaySyncRecoveryPayload } from "../domain/syncRecovery";

const ledgerId = "MANUAL-LEDGER";
beforeEach(async () => {
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId, memberId: "finance-test", role: "finance" });
  await db.ledgers.put({ id: ledgerId, workspaceId, period: "2026-08", status: "cost_pending", warehouseRate: 0, currency: "CNY" });
  await db.salesRows.bulkAdd(["甲", "乙"].map((store) => ({ ledgerId, workspaceId, store, platformSku: "SHARED", platformSkc: "SKC", quantity: 100000, amount: 1, penalty: 0 })));
});
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete(); });
const save = (store, unitCost) => saveManualCostOverride({ ledgerId, store, platformSku: "SHARED", unitCost, reason: "实价更正" });
async function lines() { const snapshot = await getLedgerSnapshot(ledgerId); return calculateFormalLedgerRows({ ledger: snapshot.ledger, salesRows: snapshot.rows, erpCosts: snapshot.costs, approvals: snapshot.approvals }); }

describe("manual exact cost overrides", () => {
  it("isolates same SKU across stores and preserves zero versus missing and tiny positive values", async () => {
    const zero = await save("甲", 0);
    expect(zero).toMatchObject({ approvedBy: "finance-test", approvedAmount: 0, referenceCost: { kind: "manual_override", store: "甲", previousUnitCost: null } });
    let result = await lines();
    expect(result[0]).toMatchObject({ finalizable: true, unitCost: 0, purchaseCost: 0, costSource: "manual_override" });
    expect(result[1]).toMatchObject({ finalizable: false, purchaseCost: null });
    expect((await db.ledgers.get(ledgerId)).costSummary).toMatchObject({ expectedCount: 2, missingCount: 1 });
    await save("乙", 0.0000001);
    result = await lines();
    expect(result[1]).toMatchObject({ unitCost: 0.0000001, purchaseCost: 0.01, profit: 0.99 });
    expect((await db.ledgers.get(ledgerId)).status).toBe("ready");
  });
  it.each(["2026-07-01", "2026-08-31"])("keeps manual priority and revocation restores latest eligible ERP: %s", async purchaseDate => {
    const manual = await save("甲", 0.003);
    await db.erpCostBatches.put({ id: "ERP", ledgerId, workspaceId, status: "published" });
    await db.erpCostRows.add({ batchId: "ERP", ledgerId, workspaceId, warehouseSku: "WH", platformSku: "SHARED", unitCost: 0.009, resolutionStatus: "resolved", publishedAt: new Date().toISOString(), selectedRecordIds: ["R1"], purchaseRecords: [{ recordId: "R1", purchaseDate, unitPrice: 0.009, quantity: 1 }] });
    expect((await lines())[0].unitCost).toBe(0.003);
    await revokeManualCostOverride({ ledgerId, approvalId: manual.id });
    expect((await lines())[0]).toMatchObject({ unitCost: 0.009, costSource: "erp" });
  });
  it.each(["2026-09-01", null])("does not restore future or undated ERP after manual revocation: %s", async purchaseDate => {
    const manual = await save("甲", 0.003);
    await db.erpCostBatches.put({ id: "ERP", ledgerId, workspaceId, status: "published" });
    await db.erpCostRows.add({ batchId: "ERP", ledgerId, workspaceId, platformSku: "SHARED", unitCost: 0.009, resolutionStatus: "resolved", publishedAt: new Date().toISOString(), selectedRecordIds: ["R1"], purchaseRecords: [{ recordId: "R1", purchaseDate, unitPrice: 0.009, quantity: 1 }] });
    expect((await lines())[0]).toMatchObject({ unitCost: 0.003, costSource: "manual_override" });
    await revokeManualCostOverride({ ledgerId, approvalId: manual.id });
    expect((await lines())[0]).toMatchObject({ unitCost: null, costSource: null });
    expect((await db.ledgers.get(ledgerId)).status).toBe("cost_pending");
  });
  it("retains manual priority over Beta.2 adoption pending review and revokes to missing without changing its evidence", async () => {
    const manual = await save("甲", 0);
    await db.erpCostBatches.put({ id: "BETA2", ledgerId, workspaceId, status: "published" });
    const id = await db.erpCostRows.add({ batchId: "BETA2", ledgerId, workspaceId, warehouseSku: "WH", platformSku: "SHARED", unitCost: 4, resolutionStatus: "resolved", publishedAt: "2026-08-31T10:00:00Z",
      selectedRecordIds: ["JULY"], costDecision: { resolutionVersion: "shopeers-cost-resolution@4-unit-4dp-beta-prior-month-latest-three" },
      purchaseRecords: [
        { recordId: "JULY", purchaseDate: "2026-07-31", quantity: 1, unitPrice: 4 },
        { recordId: "AUGUST", purchaseDate: "2026-08-31", quantity: 1, unitPrice: 8, eligible: false, exclusionReasons: ["on_or_after_ledger_period"] },
      ] });
    const stored = await db.erpCostRows.get(id);
    expect((await lines())[0]).toMatchObject({ unitCost: 0, costSource: "manual_override" });
    expect((await lines())[1]).toMatchObject({ unitCost: null, finalizable: false });
    await revokeManualCostOverride({ ledgerId, approvalId: manual.id });
    expect((await lines())[0]).toMatchObject({ unitCost: null, finalizable: false });
    expect(await db.erpCostRows.get(id)).toEqual(stored);
    expect((await db.ledgers.get(ledgerId)).status).toBe("cost_pending");
  });
  it("rejects stale UI after replacement/revocation and freezes successful full-ledger finalization", async () => {
    await save("甲", 0); const other = await save("乙", 0.0000001);
    const old = await lines();
    await save("甲", 0.0000002);
    await expect(finalizeMonthlyLedger({ ledgerId, formulaVersion: PROFIT_FORMULA_VERSION, profitLines: old, profitSummary: {} })).rejects.toThrow("已变化");
    const current = await lines();
    await adoptZeroDispatch(ledgerId);
    await finalizeMonthlyLedger({ ledgerId, formulaVersion: PROFIT_FORMULA_VERSION, profitLines: current, profitSummary: { profit: 999 } });
    const snapshot = await getLedgerSnapshot(ledgerId);
    expect(snapshot.ledger.profitSummary).toMatchObject({ purchaseCost: 0.03, profit: 1.97 });
    await expect(save("甲", 1)).rejects.toThrow("定稿");
    await expect(revokeManualCostOverride({ ledgerId, approvalId: other.id })).rejects.toThrow("定稿");
    expect((await getLedgerSnapshot(ledgerId)).profitLines).toEqual(snapshot.profitLines);
  });
  it.each([null, "", -1, Infinity, NaN])("rejects invalid value %s", async (value) => { await expect(save("甲", value)).rejects.toThrow("非负有限"); });
  it("rejects wrong store, month, workspace and role", async () => {
    await expect(save("不存在", 0)).rejects.toThrow("不属于");
    await expect(saveManualCostOverride({ ledgerId: "OTHER", store: "甲", platformSku: "SHARED", unitCost: 0, reason: "test" })).rejects.toThrow();
    await setActiveMemberContext({ workspaceId, memberId: "viewer", role: "viewer" });
    await expect(save("甲", 0)).rejects.toThrow("财务写权限");
    await setActiveMemberContext({ workspaceId: "other", memberId: "admin", role: "admin" });
    expect(await getLedgerSnapshot(ledgerId)).toBeNull();
    await expect(save("甲", 0)).rejects.toThrow("财务写权限");
  });
  it("rolls back cost and coverage if audit persistence fails", async () => {
    vi.spyOn(db.auditEvents, "add").mockRejectedValueOnce(new Error("audit failed"));
    await expect(save("甲", 0)).rejects.toThrow("audit failed");
    expect(await db.costApprovals.count()).toBe(0);
    expect((await db.ledgers.get(ledgerId)).status).toBe("cost_pending");
  });
  it("preserves manual type, store and precision in backup and sync projection/recovery", async () => {
    const manual = await save("甲", 0.0000001);
    const backup = JSON.parse(JSON.stringify(await createWorkspaceBackupPayload()));
    expect(backup.tables.costApprovals[0]).toMatchObject({ approvedAmount: 0.0000001, referenceCost: { store: "甲", kind: "manual_override" } });
    const events = (await db.auditEvents.toArray()).filter((item) => item.action === "manual_override_saved").map((item) => ({ ...item, eventId: `E-${item.id}` }));
    const envelope = buildSyncEnvelope({ workspaceId, events, generatedAt: new Date().toISOString() });
    const plan = await buildSyncPostgresPlan(envelope);
    const operation = plan.eventPlans[0].operations.find((item) => item.table === "cost_approvals");
    expect(operation.values).toContain(0.0000001);
    expect(operation.values.find((value) => value?.kind === "manual_override")).toMatchObject({ store: "甲" });
    const recovery = replaySyncRecoveryPayload(buildSyncRecoveryPayload({ workspaceId, events }));
    expect(recovery.tables.costApprovals.find((item) => item.id === manual.id)).toMatchObject({ referenceCost: { store: "甲", kind: "manual_override" } });
  });
});
