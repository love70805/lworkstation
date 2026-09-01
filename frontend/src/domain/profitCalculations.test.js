import { describe, expect, it } from "vitest";
import { calculateExactProfitLine, calculateReferenceProfitLine } from "./profitCalculations";

describe("exact and reference profit", () => {
  it("reproduces the verified legacy profit example", () => {
    const result = calculateExactProfitLine({
      revenue: 20,
      quantity: 2,
      warehouseRate: 0.7,
      penalty: 0,
      costDecision: {
        id: "DEC-1",
        status: "final",
        calculationMode: "exact",
        eligibleForExactProfit: true,
        source: "erp",
        unitCost: 4.25,
        currency: "CNY",
      },
    });

    expect(result).toMatchObject({
      calculationMode: "exact",
      finalizable: true,
      purchaseCost: 8.5,
      warehouseCost: 1.4,
      profit: 10.1,
      costSource: "erp",
    });
  });

  it("blocks exact profit when the cost is reference-only", () => {
    const result = calculateExactProfitLine({
      revenue: 20,
      quantity: 2,
      costDecision: {
        status: "reference_only",
        calculationMode: "reference",
        eligibleForExactProfit: false,
        unitCost: 4,
      },
    });

    expect(result).toMatchObject({
      calculationMode: "exact",
      status: "blocked",
      finalizable: false,
      purchaseCost: null,
      profit: null,
    });
  });

  it("calculates a reference result without making it finalizable", () => {
    const result = calculateReferenceProfitLine({
      revenue: 20,
      quantity: 2,
      warehouseRate: 0.7,
      referenceCost: { unitCost: 4, currency: "CNY", referenceKind: "supplier_landed" },
    });

    expect(result).toMatchObject({
      calculationMode: "reference",
      status: "reference",
      finalizable: false,
      purchaseCost: 8,
      warehouseCost: 1.4,
      profit: 10.6,
      referenceKind: "supplier_landed",
    });
  });
});
