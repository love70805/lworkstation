import { describe, expect, it } from "vitest";
import { calculateLedgerCostCoverage, ledgerStatusFromCoverage } from "./costCoverage";

describe("ledger cost coverage", () => {
  const salesRows = [
    { platformSku: "SKU-A" },
    { platformSku: "sku-a" },
    { platformSku: "SKU-B" },
    { platformSku: "SKU-C" },
  ];

  it("counts approved fallbacks separately without treating them as ERP coverage", () => {
    const coverage = calculateLedgerCostCoverage({
      salesRows,
      erpCosts: [{ platformSku: "SKU-A", unitCost: 3, resolutionStatus: "resolved" }],
      approvals: [{ platformSku: "SKU-B", approvedAmount: 4, status: "approved" }],
    });

    expect(coverage).toMatchObject({
      expectedCount: 3,
      erpMatchedCount: 1,
      approvedFallbackCount: 1,
      formalMatchedCount: 1,
      missingCount: 2,
      unresolvedSkus: ["SKU-B", "SKU-C"],
    });
    expect(ledgerStatusFromCoverage(coverage)).toBe("approval_pending");
  });

  it("keeps ERP authoritative when an approval exists for the same SKU", () => {
    const coverage = calculateLedgerCostCoverage({
      salesRows,
      erpCosts: [
        { platformSku: "SKU-A", unitCost: 3, resolutionStatus: "resolved" },
        { platformSku: "SKU-B", unitCost: 4, resolutionStatus: "resolved" },
        { platformSku: "SKU-C", unitCost: 5, resolutionStatus: "resolved" },
      ],
      approvals: [{ platformSku: "SKU-B", approvedAmount: 9, status: "approved" }],
    });

    expect(coverage).toMatchObject({
      expectedCount: 3,
      erpMatchedCount: 3,
      approvedFallbackCount: 0,
      formalMatchedCount: 3,
      missingCount: 0,
    });
    expect(ledgerStatusFromCoverage(coverage)).toBe("ready");
  });

  it("ignores revoked approvals and invalid amounts", () => {
    const coverage = calculateLedgerCostCoverage({
      salesRows,
      erpCosts: [{ platformSku: "SKU-A", unitCost: 0 }],
      approvals: [
        { platformSku: "SKU-B", approvedAmount: 4, status: "revoked" },
        { platformSku: "SKU-C", approvedAmount: -1, status: "approved" },
      ],
    });

    expect(coverage.missingCount).toBe(3);
    expect(ledgerStatusFromCoverage(coverage)).toBe("cost_pending");
  });

  it("does not count a positive ERP amount while its purchase anomaly is pending", () => {
    const coverage = calculateLedgerCostCoverage({
      salesRows,
      erpCosts: [{
        platformSku: "SKU-A",
        unitCost: 3,
        resolutionStatus: "pending",
        unresolvedAnomalyCount: 1,
      }],
    });
    expect(coverage).toMatchObject({ erpMatchedCount: 0, missingCount: 3 });
    expect(ledgerStatusFromCoverage(coverage)).toBe("cost_pending");
  });
});
