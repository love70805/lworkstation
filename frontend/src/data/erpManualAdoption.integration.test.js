import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { db, DEFAULT_WORKSPACE_ID, createOrGetMonthlyLedger, setActiveMemberContext, saveErpCostRequest, savePublishedErpCostBatch, saveManualCostOverride, revokeManualCostOverride, getLedgerSnapshot } from "./database";
import { buildErpCostRequest, reconcileErpCostRows } from "../domain/erpCosts";
import { buildErpCostBatchEnvelope, validateErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { resolveFormalCostDecision } from "../domain/costPolicy";
import { selectManualOverride } from "../domain/manualCostOverride";

beforeEach(async () => { await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId: DEFAULT_WORKSPACE_ID, memberId: "finance", role: "finance" }); });
afterEach(async () => { await db.delete(); });
async function seed({ secondStore = false, third = false } = {}) {
  const ledger = await createOrGetMonthlyLedger({ period: "2026-08" });
  const skus = third ? ["A", "B", "C"] : ["A", "B"];
  const expectedSkus = skus.map(platformSku => ({ platformSku, platformSkc: `SKC-${platformSku}` }));
  await db.salesRows.bulkAdd([...skus.map(platformSku => ({ workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: "甲", platformSku, platformSkc: `SKC-${platformSku}`, quantity: 1, amount: 100 })), ...(secondStore ? [{ workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: "乙", platformSku: "B", platformSkc: "SKC-B", quantity: 1, amount: 100 }] : [])]);
  const request = buildErpCostRequest({ id: `REQ-${crypto.randomUUID()}`, workspaceId: ledger.workspaceId, ledgerId: ledger.id, platformSkcs: expectedSkus.map(row => row.platformSkc), expectedSkus, requestedBy: "finance", requestedAt: new Date().toISOString() });
  await saveErpCostRequest(request);
  const batch = buildErpCostBatchEnvelope({ batchId: `BATCH-${crypto.randomUUID()}`, workspaceId: ledger.workspaceId, ledgerId: ledger.id, requestId: request.id, platformSkcs: request.platformSkcs, expectedSkus, generatedAt: new Date().toISOString(), results: skus.map(sku => ({ warehouseSku: `WH-${sku}`, mappings: [{ platformSku: sku, platformSkc: `SKC-${sku}` }], previewUnitCost: sku === "A" ? 10 : 0 })), warehouseEvidence: skus.map(sku => ({ warehouseSku: `WH-${sku}`, evidenceComplete: true, purchaseRecords: [{ recordId: `REC-${sku}`, warehouseSku: `WH-${sku}`, purchaseDate: "2026-08-10", quantity: 1, unitPrice: sku === "A" ? 10 : 0, eligible: true, exclusionReasons: [] }] })) });
  const inputRows = validateErpCostBatchEnvelope(batch, { expectedWorkspaceId: ledger.workspaceId, expectedLedgerId: ledger.id, expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus }).rows;
  const reconciliation = reconcileErpCostRows({ workspaceId: ledger.workspaceId, period: ledger.period, expectedSkus, costRows: inputRows });
  return { ledger, batch, reconciliation, args: { ledgerId: ledger.id, workspaceId: ledger.workspaceId, requestId: request.id, sourceEnvelope: batch, reconciliation } };
}
it("adopts A after B manual coverage, preserves zero evidence and restores missing when manual is revoked", async () => {
  const { ledger, args } = await seed();
  const manual = await saveManualCostOverride({ ledgerId: ledger.id, store: "甲", platformSku: "B", unitCost: 0, reason: "真实零" });
  const result = await savePublishedErpCostBatch(args);
  expect(result).toMatchObject({ matchedCount: 1, manuallyCoveredCount: 1, blockedAnomalyCount: 0 });
  let snapshot = await getLedgerSnapshot(ledger.id);
  expect(snapshot.costs.map(row => row.platformSku)).toEqual(["A"]);
  expect(snapshot.ledger.status).toBe("ready");
  expect((await db.erpCostBatches.get(result.batchId)).sourceContract.warehouseEvidence.find(row => row.warehouseSku === "WH-B").purchaseRecords[0].unitPrice).toBe(0);
  const scope = { workspaceId: ledger.workspaceId, ledgerId: ledger.id, period: ledger.period, store: "甲", platformSku: "B" };
  expect(resolveFormalCostDecision({ ...scope, manualOverride: selectManualOverride(snapshot.approvals, scope) })).toMatchObject({ source: "manual_override", unitCost: 0 });
  await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: manual.id });
  snapshot = await getLedgerSnapshot(ledger.id);
  expect(snapshot.ledger.status).toBe("cost_pending");
  expect(snapshot.costs.map(row => row.platformSku)).toEqual(["A"]);
});
it("checks hidden stores instead of trusting current page coverage", async () => {
  const { ledger, args } = await seed({ secondStore: true });
  await saveManualCostOverride({ ledgerId: ledger.id, store: "甲", platformSku: "B", unitCost: 5, reason: "甲店更正" });
  await expect(savePublishedErpCostBatch(args)).rejects.toThrow("全部店铺");
  expect(await db.erpCostBatches.count()).toBe(0);
  await saveManualCostOverride({ ledgerId: ledger.id, store: "乙", platformSku: "B", unitCost: 0.0000001, reason: "乙店微小成本" });
  expect(await savePublishedErpCostBatch(args)).toMatchObject({ matchedCount: 1, manuallyCoveredCount: 1 });
});
it("rejects a revoked manual exemption and independently detects an omitted unresolved C", async () => {
  const { ledger, args } = await seed({ third: true });
  const manual = await saveManualCostOverride({ ledgerId: ledger.id, store: "甲", platformSku: "B", unitCost: 5, reason: "人工" });
  const hiddenC = { ...args, reconciliation: { ...args.reconciliation, matches: args.reconciliation.matches.filter(row => row.platformSku !== "C") } };
  await expect(savePublishedErpCostBatch(hiddenC)).rejects.toThrow("异常");
  await saveManualCostOverride({ ledgerId: ledger.id, store: "甲", platformSku: "C", unitCost: 5, reason: "人工" });
  await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: manual.id });
  await expect(savePublishedErpCostBatch(args)).rejects.toThrow("全部店铺");
  expect(await db.erpCostRows.count()).toBe(0);
});
