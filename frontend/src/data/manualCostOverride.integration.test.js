import "fake-indexeddb/auto";
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
  it("keeps manual priority over later ERP and revocation restores the latest ERP", async () => {
    const manual = await save("甲", 0.003);
    await db.erpCostBatches.put({ id: "ERP", ledgerId, workspaceId, status: "published" });
    await db.erpCostRows.add({ batchId: "ERP", ledgerId, workspaceId, platformSku: "SHARED", unitCost: 0.009, resolutionStatus: "resolved", publishedAt: new Date().toISOString() });
    expect((await lines())[0].unitCost).toBe(0.003);
    await revokeManualCostOverride({ ledgerId, approvalId: manual.id });
    expect((await lines())[0]).toMatchObject({ unitCost: 0.009, costSource: "erp" });
  });
  it("rejects stale UI after replacement/revocation and freezes successful full-ledger finalization", async () => {
    await save("甲", 0); const other = await save("乙", 0.0000001);
    const old = await lines();
    await save("甲", 0.0000002);
    await expect(finalizeMonthlyLedger({ ledgerId, formulaVersion: PROFIT_FORMULA_VERSION, profitLines: old, profitSummary: {} })).rejects.toThrow("已变化");
    const current = await lines();
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
