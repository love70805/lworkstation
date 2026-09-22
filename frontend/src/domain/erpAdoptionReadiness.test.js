import { expect, it } from "vitest";
import { erpAdoptionReadiness } from "./erpAdoptionReadiness";
const ledger = { id: "L", workspaceId: "W", period: "2026-08" };
const sale = (store, platformSku = "B") => ({ workspaceId: "W", ledgerId: "L", store, platformSku });
const approval = (store, patch = {}) => ({ id: store, workspaceId: "W", ledgerId: "L", platformSku: "B", status: "approved", currency: "CNY", approvedAmount: 0, approvedBy: "finance", approvedAt: "2026-09-01T00:00:00Z", reason: "真实零", referenceCost: { kind: "manual_override", store }, ...patch });
const reconciliation = { matches: [{ platformSku: "A", status: "matched" }, { platformSku: "B", status: "anomaly_pending" }] };
it("requires manual coverage in every ledger store and never converts anomalous evidence", () => {
  const rows = [sale("甲"), sale("乙")];
  expect(erpAdoptionReadiness({ ledger, salesRows: rows, approvals: [approval("甲")], reconciliation }).canAdopt).toBe(false);
  const result = erpAdoptionReadiness({ ledger, salesRows: rows, approvals: [approval("甲"), approval("乙", { approvedAmount: 0.0000001 })], reconciliation });
  expect(result.canAdopt).toBe(true);
  expect(result.manuallyCovered[0]).toMatchObject({ platformSku: "B", stores: ["甲", "乙"], approvalIds: ["甲", "乙"] });
  expect(result.matchedRows.map(row => row.platformSku)).toEqual(["A"]);
  expect(reconciliation.matches[1].status).toBe("anomaly_pending");
});
it.each([{ status: "revoked" }, { workspaceId: "OTHER" }, { ledgerId: "OTHER" }])("rejects manual override from stale or foreign scope %j", patch => {
  expect(erpAdoptionReadiness({ ledger, salesRows: [sale("甲")], approvals: [approval("甲", patch)], reconciliation }).canAdopt).toBe(false);
});
it("does not use vacuous manual coverage or let another unresolved candidate through", () => {
  expect(erpAdoptionReadiness({ ledger, reconciliation }).canAdopt).toBe(false);
  const result = erpAdoptionReadiness({ ledger, salesRows: [sale("甲"), sale("甲", "C")], approvals: [approval("甲")], reconciliation: { matches: [...reconciliation.matches, { platformSku: "C", status: "anomaly_pending" }] } });
  expect(result.summary).toMatchObject({ erpAdoptableCount: 1, manuallyCoveredCount: 1, blockedAnomalyCount: 1 });
  expect(result.canAdopt).toBe(false);
});
