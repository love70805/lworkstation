import { describe, expect, it } from "vitest";
import { calculateExactProfitLine, calculateReferenceProfitLine, PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { resolveFormalCostDecision } from "../domain/costPolicy";
import { calculateWarehouseCostDecision } from "../domain/erpCostResolution";
import { buildProfitExportRows, formatErpUnitCost, formatProfitAmount, savedProfitRows, savedProfitSummary, summarizeProfitRows } from "./profitPrecision";
import { groupProfitRowsBySkc } from "./profit";
import { filterProfitRows } from "./profitFilter";

function line(unitCost, quantity, revenue = 0, platformSku = "SKU") {
  return { platformSku, canonicalPlatformSku: platformSku, qty: quantity, groupSkc: "SKC", store: "店铺",
    ...calculateExactProfitLine({ revenue, quantity, warehouseRate: 0,
      costDecision: resolveFormalCostDecision({ platformSku, erpCost: { unitCost, resolutionStatus: "resolved" } }) }) };
}

describe("ERP precision from evidence to ledger exits", () => {
  it("publishes real low weighted prices without invented corrections", () => {
    const purchaseRecords = [
      [0.01, 100], [0.009, 5], [0.009, 30], [0.1433, 5], [0.1433, 5], [0.1433, 33],
    ].map(([unitPrice, quantity], index) => ({ recordId: `R${index}`, unitPrice, quantity, purchaseDate: `2026-07-${20-index}`, order1688: "ORDER" }));
    const original = structuredClone(purchaseRecords);
    expect(calculateWarehouseCostDecision({ warehouseSku: "WH", purchaseRecords })).toMatchObject({
      unitCost: 0.0097, formalUnitCost: 0.0097, resolutionStatus: "resolved", anomalies: [], selectedRecordIds: ["R0", "R1", "R2"],
    });
    expect(purchaseRecords).toEqual(original);
  });

  it.each([[0.0001, "resolved", 0.0001], [0.00009, "pending", 0], [0, "pending", 0]])("guards precision boundary %s", (unitPrice, resolutionStatus, unitCost) => {
    const decision = calculateWarehouseCostDecision({ warehouseSku: "WH", purchaseRecords: [{ recordId: "R", unitPrice, quantity: 2, purchaseDate: "2026-07-01" }] });
    expect(decision).toMatchObject({ unitCost, resolutionStatus });
    expect(decision.purchaseRecords[0].unitPrice).toBe(unitPrice);
    expect(resolveFormalCostDecision({ platformSku: "SKU", erpCost: { unitCost: unitPrice, resolutionStatus: "resolved" } }).eligibleForExactProfit).toBe(unitPrice >= 0.0001);
  });

  it.each([[0.003, 2, 0.006, 0.01], [0.009, 1, 0.009, 0.01], [0.0001, 1, 0.0001, 0]])("accumulates untruncated %s × %s", (cost, qty, raw, total) => {
    const rows = [line(cost, qty), line(cost, qty)];
    expect(rows[0]).toMatchObject({ unitCost: cost, purchaseCost: raw, profit: -raw });
    expect(summarizeProfitRows(rows)).toMatchObject({ purchaseCosts: total, matchedProfit: total ? -total : 0 });
  });

  it("preserves ten decimal places and large repeated sums", () => {
    const row = line(1.2345, 1.234567);
    expect(row.purchaseCost).toBe(1.5240729615);
    expect(row.profit).toBe(-1.5240729615);
    expect(summarizeProfitRows(Array.from({ length: 10000 }, () => row))).toMatchObject({ purchaseCosts: 15240.72, matchedProfit: -15240.72 });
  });

  it("does not accumulate group or filtered summaries into ledger totals", () => {
    const rows = [line(0.003, 2, 1, "A"), { ...line(0.003, 2, 1, "B"), groupSkc: "OTHER" }];
    const before = summarizeProfitRows(rows);
    groupProfitRowsBySkc(rows);
    const filtered = filterProfitRows(rows, { query: "A", storeFilter: "all", supplierSelection: null, missingOnly: false });
    expect(filtered).toHaveLength(1);
    expect(summarizeProfitRows(filtered).purchaseCosts).toBe(0);
    expect(summarizeProfitRows(rows.toReversed())).toEqual(before);
    expect(before).toMatchObject({ purchaseCosts: 0.01, matchedProfit: 1.98, profitRate: 99.4 });
  });

  it("sums 1.2301-cost line profits before truncation", () => {
    const rows = [line(1.2301, 1, 2), line(1.2301, 1, 2)];
    expect(rows[0].profit).toBe(0.7699);
    expect(summarizeProfitRows(rows).matchedProfit).toBe(1.53);
  });

  it("preserves raw subprecision confirmation values while blocking formal publication", () => {
    const records = Array.from({ length: 6 }, (_, index) => ({ recordId: `R${index}`, unitPrice: index === 0 ? 0.00009 : 2, quantity: index === 0 ? 1000000 : 1, purchaseDate: `2026-07-${20-index}` }));
    const decision = calculateWarehouseCostDecision({ warehouseSku: "WH", purchaseRecords: records, resolutions: [{ warehouseSku: "WH", recordId: "R0", action: "confirm_true_price", originalUnitPrice: 0.00009, resolvedUnitPrice: 0.00009, resolvedBy: "qa", resolvedAt: "2026-09-08T00:00:00Z" }] });
    expect(decision).toMatchObject({ unitCost: 0, formalUnitCost: null, resolutionStatus: "pending", resolvedAnomalyCount: 1 });
    expect(decision.resolutions[0]).toMatchObject({ originalUnitPrice: 0.00009, resolvedUnitPrice: 0.00009 });
  });

  it("adapts cloud snapshot aliases without changing monetary facts", () => {
    const row = savedProfitRows([{ platformSku: "CLOUD", quantity: 1, formalUnitCost: 0.0097, formalCostSource: "erp", purchaseCost: 0.0097, profit: -0.0097 }])[0];
    expect(row).toMatchObject({ unitCost: 0.0097, costSource: "erp", formalUnitCost: 0.0097, purchaseCost: 0.0097, profit: -0.0097 });
  });

  it("keeps ERP reference precision and leaves supplier/manual rules unchanged", () => {
    for (const referenceKind of ["erp", "erp_history", "supplier_landed", "manual_confirmed"]) {
      const result = calculateReferenceProfitLine({ revenue: 2, quantity: 2, warehouseRate: 0, referenceCost: { referenceKind, unitCost: 0.0097 } });
      expect(result.unitCost).toBe(referenceKind.startsWith("erp") ? 0.0097 : 0);
      expect(result.finalizable).toBe(false);
    }
  });

  it("distinguishes real zero and signed tiny amounts and exports numbers", () => {
    expect(formatProfitAmount(0)).toBe("¥0.00");
    expect(formatProfitAmount(0.006)).toBe("<0.01元");
    expect(formatProfitAmount(-0.006)).toBe("-<0.01元");
    expect(formatProfitAmount(-1.239)).toBe("¥-1.23");
    expect(formatErpUnitCost(0.0097)).toBe("¥0.0097");
    const rows = [line(0.003, 2), line(0.003, 2)];
    const exported = buildProfitExportRows(rows, { status: "ready" }, summarizeProfitRows(rows));
    expect(exported[0]["总件数*成本"]).toBe(0.006);
    expect(exported[0].利润).toBe(-0.006);
    expect(exported[2]["总件数*成本"]).toBe(0.01);
    expect(exported[0].公式版本).toBe(PROFIT_FORMULA_VERSION);
  });

  it.each(["finalized", "locked"])("preserves %s historical facts for display/export", (status) => {
    const facts = [{ platformSku: "OLD", quantity: 2, unitCost: 1.23, purchaseCost: 2.46, profit: 7.54, revenue: 10, costSource: "erp" }];
    const ledger = { status, formulaVersion: "old-formula", profitSummary: { quantity: 2, revenue: 10, purchaseCost: 2.46, profit: 7.54, warehouseCost: 0, penalty: 0 } };
    const rows = savedProfitRows(facts);
    const exported = buildProfitExportRows(rows, ledger, savedProfitSummary(ledger.profitSummary));
    expect(rows[0]).toMatchObject(facts[0]);
    expect(exported[0]).toMatchObject({ 单件平均成本: 1.23, 利润: 7.54, 公式版本: "old-formula" });
    expect(exported[1].利润).toBe(7.54);
    expect(exported[0].汇总规则).toContain("不重新计算");
  });
});
