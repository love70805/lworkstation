import { describe, expect, it } from "vitest";
import { calculateWarehouseCostDecision } from "./erpCostResolution";
import { reconcileErpCostRows } from "./erpCosts";
import { isErpCostWithinPeriod, purchaseRecordPeriod } from "./erpCostPeriod";
import { resolveFormalCostDecision } from "./costPolicy";
import { buildReportProducts } from "./profitReports";
import { calculateLedgerCostCoverage } from "./costCoverage";

const record = (id, purchaseDate, unitPrice = 5, quantity = 1, extra = {}) => ({
  recordId: id, warehouseSku: "WH", purchaseDate, unitPrice, quantity, ...extra,
});
const cost = (records, period = "2026-06") => calculateWarehouseCostDecision({ warehouseSku: "WH", purchaseRecords: records, period });
const published = decision => ({ platformSku: "SKU", unitCost: decision.unitCost, resolutionStatus: "resolved", costDecision: decision });

describe("Beta purchases strictly before ledger month", () => {
  it("selects b,a,b from b,a,b,b,a,a without preferring 1688 and preserves weighted precision", () => {
    const records = ["b", "a", "b", "b", "a", "a"].map((kind, i) => record(
      `R${i}`, `2026-05-${30 - i}`, 4 + i, i + 1,
      { purchaseOrderNo: `P${i}`, ...(kind === "a" ? { order1688: `A${i}` } : {}) },
    ));
    const decision = cost([...records].reverse());
    expect(decision.selectedRecordIds).toEqual(["R0", "R1", "R2"]);
    expect(decision).toMatchObject({ totalQuantity: 6, totalPrice: 32, unitCost: 5.3333 });
    const result = reconcileErpCostRows({ workspaceId: "W", period: "2026-06", expectedSkus: ["SKU"],
      costRows: [{ platformSku: "SKU", warehouseSku: "WH", evidenceComplete: true, purchaseRecords: records }] });
    expect(result.matches[0]).toMatchObject({ orderType: "mixed", orderNumber: "P0 / A1 / P2", unitCost: 5.3333 });
    const oldDecision = { ...decision, selectedRecordIds: ["R1", "R4", "R5"], selectedRecords: [records[1], records[4], records[5]] };
    const old = { ...published(oldDecision), unitCost: 8.2, warehouseSku: "WH", publishedAt: "2026-06-01" };
    expect(isErpCostWithinPeriod(old, "2026-06")).toBe(false);
    expect(isErpCostWithinPeriod(published(decision), "2026-06")).toBe(true);
    expect(old.unitCost).toBe(8.2);
  });

  it("normalizes cancellation evidence for old adoption and exports its actual selected records", () => {
    const records = [
      record("CANCELLED", "2026-05-31", 100, 1, { statusFields: { status: "11" } }),
      record("GOOD", "2026-05-30", 5, 2, { purchaseOrderNo: "P-GOOD" }),
    ];
    const old = { platformSku: "SKU", unitCost: 5, warehouseSku: "WH", purchaseRecords: records, selectedRecordIds: ["GOOD"], resolutionStatus: "resolved" };
    expect(isErpCostWithinPeriod(old, "2026-06")).toBe(true);
    expect(isErpCostWithinPeriod({ ...old, selectedRecordIds: ["CANCELLED", "GOOD"] }, "2026-06")).toBe(false);
    expect(isErpCostWithinPeriod({ ...old, evidenceComplete: false }, "2026-06")).toBe(false);
    const products = buildReportProducts({ ledger: { id: "L", workspaceId: "W", period: "2026-06", warehouseRate: 0 },
      salesRows: [{ store: "S", platformSkc: "SKC", platformSku: "SKU", quantity: 2, amount: 20 }], erpCosts: [old] });
    expect(products[0].costPurchaseRecords).toEqual([expect.objectContaining({ recordId: "GOOD", effectiveUnitPrice: 5 })]);
    expect(old.purchaseRecords).toEqual(records);
    const nested = { ...old, purchaseRecords: undefined, selectedRecordIds: undefined,
      evidence: { purchaseRecords: records, costDecision: { selectedRecordIds: ["GOOD"] } } };
    expect(isErpCostWithinPeriod(nested, "2026-06")).toBe(true);
  });

  it("orders by business date despite forged timestamps and deterministically breaks ties", () => {
    const records = [
      record("R1", "2026-05-01", 5, 1, { timestamp: Date.parse("2026-05-31") }),
      record("R2", "2026-05-02"),
      record("R3", "2026-05-03"),
      record("R4", "2026-05-04"),
    ];
    expect(cost(records).selectedRecordIds).toEqual(["R4", "R3", "R2"]);
    const sameDate = ["R2", "R4", "R1", "R3"].map(id => record(id, "2026-05-01"));
    expect(cost(sameDate).selectedRecordIds).toEqual(cost(sameDate.toReversed()).selectedRecordIds);
    expect(cost([
      record("LATEST", "2026-05-31 23:59:59"),
      record("ZONE", "2026-05-31T15:59:58Z"),
      record("DATE-ONLY", "2026-05-31"),
      record("OLDER", "2026-05-30T17:00:00Z"),
    ]).selectedRecordIds).toEqual(["LATEST", "ZONE", "OLDER"]);
  });

  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("excludes month %s itself and later months", month => {
    const period = `2026-${String(month).padStart(2, "0")}`;
    const nextPeriod = month === 12 ? "2027-01" : `2026-${String(month + 1).padStart(2, "0")}`;
    const previousDate = new Date(Date.UTC(2026, month - 1, 0)).toISOString().slice(0, 10);
    const decision = cost([
      record("BEFORE", `${previousDate} 23:59:59`),
      record("FIRST", `${period}-01 00:00:00`),
      record("LAST", `${period}-28 23:59:59`, 7),
      record("AFTER", `${nextPeriod}-01 00:00:00`, 999),
    ], period);
    expect(decision.selectedRecordIds).toEqual(["BEFORE"]);
    expect(decision).toMatchObject({ costPeriod: period, resolutionStatus: "resolved", unitCost: 5 });
    expect(decision.purchaseRecords.at(-1)).toMatchObject({ eligible: false, exclusionReasons: ["on_or_after_ledger_period"] });
  });

  it("filters before latest-three and the anomaly baseline", () => {
    const records = [
      ...Array.from({ length: 10 }, (_, i) => record(`FUTURE-${i}`, `2026-07-${i + 1}`, 100, 1, { order1688: "FUTURE" })),
      record("JUNE", "2026-06-30", 6, 2),
      record("MAY", "2026-05-31", 3, 1),
      record("APRIL", "2026-04-30", 2, 1),
      record("OLDER", "2026-03-31", 9),
    ];
    const before = structuredClone(records);
    const result = cost(records);
    expect(result.selectedRecordIds).toEqual(["MAY", "APRIL", "OLDER"]);
    expect(result).toMatchObject({ unitCost: 4.6666, totalQuantity: 3, baseline: { sampleCount: 3 }, anomalies: [] });
    expect(records).toEqual(before);
  });

  it("excludes same-month purchases regardless of collection month", () => {
    expect(calculateWarehouseCostDecision({
      warehouseSku: "WH", period: "2026-06", currentYearMonth: 202606,
      purchaseRecords: [record("CURRENT", "2026-06-15")],
    })).toMatchObject({ formalUnitCost: null, selectedRecordIds: [] });
  });

  it("never falls back to future preview values when the cutoff leaves no records", () => {
    const row = { platformSku: "SKU", warehouseSku: "WH", unitCost: 999, evidenceComplete: true, purchaseRecords: [record("FUTURE", "2026-07-01", 999)] };
    const result = reconcileErpCostRows({ workspaceId: "W", expectedSkus: ["SKU"], costRows: [row], period: "2026-06" });
    expect(result.matches[0]).toMatchObject({ status: "anomaly_pending", unitCost: null, formalUnitCost: null, calculationCount: 0, dateRange: null });
    expect(result.summary.periodMissingCount).toBe(1);
  });

  it("uses business dates rather than forged timestamps and rejects invalid calendar dates", () => {
    const decision = cost([
      record("FORGED", "2026-07-01", 100, 1, { timestamp: Date.parse("2026-05-01") }),
      record("INVALID", "2026-02-30", 100),
      record("VALID", "2026-05-01"),
    ]);
    expect(decision.selectedRecordIds).toEqual(["VALID"]);
    expect(purchaseRecordPeriod(record("ZONE", "2026-06-30T17:00:00Z"))).toBe("2026-07");
    expect(() => cost([], "2026-13")).toThrow("账本月份");
  });

  it("does not relabel an invalid adopted price as a newly recalculated matched cost", () => {
    const decision = cost([record("FUTURE", "2026-07-01", 10), record("VALID", "2026-05-01", 4)], "2026-08");
    const row = { ...published(decision), warehouseSku: "WH", publishedAt: "2026-08-01", purchaseRecords: decision.purchaseRecords, selectedRecordIds: decision.selectedRecordIds };
    const result = reconcileErpCostRows({ workspaceId: "W", expectedSkus: ["SKU"], costRows: [row], period: "2026-06" });
    expect(result.matches[0]).toMatchObject({ status: "anomaly_pending", unitCost: null, formalUnitCost: null, adoptedUnitCost: 7, periodReviewRequired: true });
    expect(result.summary.periodReviewCount).toBe(1);
    expect(row.unitCost).toBe(7);
  });

  it("requires recollection when the old current-month exclusion omitted eligible history", () => {
    const decision = cost([record("MAY", "2026-05-01", 4)]);
    const row = { ...published(decision), warehouseSku: "WH", purchaseRecords: decision.purchaseRecords, selectedRecordIds: decision.selectedRecordIds, evidenceComplete: true,
      excludedRecords: [record("OMITTED", "2026-05-02", 10, 1, { eligible: false, exclusionReasons: ["current_month"] })] };
    expect(isErpCostWithinPeriod(row, "2026-06")).toBe(false);
    const result = reconcileErpCostRows({ workspaceId: "W", expectedSkus: ["SKU"], costRows: [row], period: "2026-06" });
    expect(result.matches[0]).toMatchObject({ status: "anomaly_pending", formalUnitCost: null, legacyMonthExclusions: true });
    expect(isErpCostWithinPeriod({ ...row, excludedRecords: [record("CURRENT", "2026-06-01", 10, 1, { eligible: false, exclusionReasons: ["current_month"] })] }, "2026-06")).toBe(true);
  });

  it("keeps old approved costs immutable but excludes future or unverifiable evidence from live profits and coverage", () => {
    const oldCost = published(cost([record("JULY", "2026-07-01", 8)], "2026-08"));
    const original = structuredClone(oldCost);
    const salesRows = [{ store: "店铺", platformSkc: "SKC", platformSku: "SKU", quantity: 2, amount: 20 }];
    const ledger = { workspaceId: "W", id: "L", period: "2026-06", warehouseRate: 0.7 };
    expect(isErpCostWithinPeriod(oldCost, ledger.period)).toBe(false);
    expect(isErpCostWithinPeriod({ unitCost: 5 }, ledger.period)).toBe(false);
    const lines = buildReportProducts({ ledger, salesRows, erpCosts: [oldCost], approvals: [], allowMissing: true });
    expect(lines[0]).toMatchObject({ purchaseCostExact: null, profitExact: null });
    expect(calculateLedgerCostCoverage({ salesRows, erpCosts: [oldCost], period: ledger.period })).toMatchObject({ formalMatchedCount: 0, missingCount: 1 });
    expect(() => buildReportProducts({ ledger, salesRows, erpCosts: [oldCost], approvals: [] })).toThrow("尚缺正式成本");
    expect(oldCost).toEqual(original);
    expect(resolveFormalCostDecision({ platformSku: "SKU", period: ledger.period, erpCost: published(cost([record("MAY", "2026-05-31")])) })).toMatchObject({ source: "erp", unitCost: 5 });
  });
});
