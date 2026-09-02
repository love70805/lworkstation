import { describe, expect, it } from "vitest";
import { resolveFormalCostDecision, selectSelectionReferenceCost } from "./costPolicy";

const referenceCost = {
  id: "REF-1",
  platformSku: "SKU-1",
  unitCost: 5.2,
  currency: "CNY",
};

const approval = {
  id: "APR-1",
  status: "approved",
  ledgerId: "LEDGER-1",
  platformSku: "SKU-1",
  referenceCostId: "REF-1",
  approvedAmount: 5.2,
  currency: "CNY",
  approvedBy: "finance-1",
  approvedAt: "2026-08-06T08:00:00.000Z",
  reason: "ERP 本月无可用采购记录，已复核 1688 落地成本。",
};

describe("formal cost policy", () => {
  it("always prefers an ERP cost over an approved 1688 reference", () => {
    const decision = resolveFormalCostDecision({
      ledgerId: "LEDGER-1",
      platformSku: "SKU-1",
      erpCost: { id: "ERP-1", platformSku: "SKU-1", unitCost: 4.25, currency: "CNY", resolutionStatus: "resolved" },
      reference1688Cost: referenceCost,
      approval,
    });

    expect(decision).toMatchObject({
      status: "final",
      eligibleForExactProfit: true,
      source: "erp",
      unitCost: 4.25,
      sourceRecordId: "ERP-1",
    });
  });

  it("keeps a 1688 cost reference-only without approval", () => {
    const decision = resolveFormalCostDecision({
      ledgerId: "LEDGER-1",
      platformSku: "SKU-1",
      reference1688Cost: referenceCost,
    });

    expect(decision).toMatchObject({
      status: "reference_only",
      calculationMode: "reference",
      eligibleForExactProfit: false,
      source: "1688_reference",
    });
  });

  it("keeps an audited 1688 fallback as reference-only when ERP cost is missing", () => {
    const decision = resolveFormalCostDecision({
      ledgerId: "LEDGER-1",
      platformSku: "SKU-1",
      reference1688Cost: referenceCost,
      approval,
    });

    expect(decision).toMatchObject({
      status: "manual_fallback",
      calculationMode: "reference",
      eligibleForExactProfit: false,
      source: "approved_1688",
      unitCost: 5.2,
      approvalId: "APR-1",
    });
  });

  it("rejects an ERP cost while purchase anomalies are still pending", () => {
    const decision = resolveFormalCostDecision({
      ledgerId: "LEDGER-1",
      platformSku: "SKU-1",
      erpCost: {
        id: "ERP-ANOMALY",
        platformSku: "SKU-1",
        unitCost: 4.25,
        currency: "CNY",
        resolutionStatus: "pending",
        unresolvedAnomalyCount: 1,
      },
    });
    expect(decision.status).toBe("missing");
    expect(decision.eligibleForExactProfit).toBe(false);
    expect(decision.reasons).toContain("erp_cost_anomaly_pending");
  });

  it("blocks an approval that belongs to another ledger", () => {
    const decision = resolveFormalCostDecision({
      ledgerId: "LEDGER-2",
      platformSku: "SKU-1",
      reference1688Cost: referenceCost,
      approval,
    });

    expect(decision.status).toBe("pending_approval");
    expect(decision.eligibleForExactProfit).toBe(false);
    expect(decision.reasons).toContain("approval_ledger_mismatch");
  });

  it("truncates new ERP and 1688 unit costs to two decimals", () => {
    const erp = resolveFormalCostDecision({
      ledgerId: "LEDGER-1",
      platformSku: "SKU-1",
      erpCost: { id: "ERP-TRUNCATE", platformSku: "SKU-1", unitCost: 4.239, currency: "CNY", resolutionStatus: "resolved" },
    });
    const fallback = resolveFormalCostDecision({
      ledgerId: "LEDGER-1",
      platformSku: "SKU-1",
      reference1688Cost: { ...referenceCost, unitCost: 5.239 },
      approval: { ...approval, approvedAmount: 5.239 },
    });

    expect(erp.unitCost).toBe(4.23);
    expect(fallback.unitCost).toBe(5.23);
  });
});

describe("selection reference cost", () => {
  it("uses ERP history before finalized profit history and supplier landed cost", () => {
    expect(selectSelectionReferenceCost({
      erpHistory: [
        { id: "ERP-OLD", unitCost: 4, calculatedAt: "2026-05-01T00:00:00Z", resolutionStatus: "resolved" },
        { id: "ERP-NEW", unitCost: 4.5, calculatedAt: "2026-07-01T00:00:00Z", resolutionStatus: "resolved" },
      ],
      finalizedProfitHistory: [{ id: "FINAL-1", unitCost: 5, finalizedAt: "2026-07-31T00:00:00Z" }],
      supplierLandedCost: { id: "SUP-1", unitCost: 3.5 },
    })).toMatchObject({
      id: "ERP-NEW",
      unitCost: 4.5,
      referenceKind: "erp_history",
      calculationMode: "reference",
      authoritativeSource: "erp",
    });
  });

  it("uses a catalog-confirmed cost only as a selection reference, after ERP but before history and 1688", () => {
    const selected = selectSelectionReferenceCost({
      manualConfirmedCost: { id: "MANUAL-1", platformSku: "SKU-1", amount: 4.8, currency: "CNY", confirmedAt: "2026-08-09T08:00:00.000Z" },
      finalizedProfitHistory: [{ id: "FINAL-1", platformSku: "SKU-1", unitCost: 5.2, finalizedAt: "2026-08-08T08:00:00.000Z" }],
      supplierLandedCost: { id: "SUP-1", platformSku: "SKU-1", unitCost: 5.6 },
    });
    expect(selected).toMatchObject({ id: "MANUAL-1", unitCost: 4.8, referenceKind: "manual_confirmed", authoritativeSource: "manual_confirmed" });

    const erpPreferred = selectSelectionReferenceCost({
      erpHistory: [{ id: "ERP-1", platformSku: "SKU-1", unitCost: 4.1, calculatedAt: "2026-08-10T08:00:00.000Z", resolutionStatus: "resolved" }],
      manualConfirmedCost: { id: "MANUAL-1", platformSku: "SKU-1", amount: 4.8, currency: "CNY", confirmedAt: "2026-08-09T08:00:00.000Z" },
    });
    expect(erpPreferred).toMatchObject({ id: "ERP-1", referenceKind: "erp_history", authoritativeSource: "erp" });
  });

  it("does not use unconfirmed anomalous ERP history as a selection reference", () => {
    expect(selectSelectionReferenceCost({
      erpHistory: [{ id: "ERP-PENDING", unitCost: 4.1, resolutionStatus: "pending", unresolvedAnomalyCount: 1 }],
      supplierLandedCost: { id: "SUP-1", unitCost: 5.6 },
    })).toMatchObject({ id: "SUP-1", authoritativeSource: "1688_reference" });
  });

  it("does not rewrite the stored cost on finalized profit history", () => {
    expect(selectSelectionReferenceCost({
      finalizedProfitHistory: [{ id: "FINAL-PRECISION", unitCost: 5.239, finalizedAt: "2026-08-08T08:00:00.000Z" }],
    })).toMatchObject({ id: "FINAL-PRECISION", unitCost: 5.239, referenceKind: "finalized_profit_history" });
  });
});
