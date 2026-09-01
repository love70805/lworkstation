import { describe, expect, it } from "vitest";
import { buildWorkspaceOperationalSummary } from "./workspaceSummary";

describe("buildWorkspaceOperationalSummary", () => {
  it("只统计真实待办、正式商品和未关闭账本", () => {
    const summary = buildWorkspaceOperationalSummary({
      captures: [
        { id: "CAP-1", status: "pending", capturedAt: "2026-08-06T10:00:00.000Z" },
        { id: "CAP-2", status: "blocked", blockingIssues: ["missing_sku"] },
        { id: "CAP-3", status: "confirmed" },
      ],
      products: [{ id: "P-1", status: "active" }, { id: "P-2", status: "deleted" }],
      platformSkus: [{ id: "S-1", status: "active" }],
      ledgers: [
        { id: "L-1", status: "cost_pending", updatedAt: "2026-08-06T09:00:00.000Z", costSummary: { missingCount: 3 } },
        { id: "L-2", status: "finalized", finalizedAt: "2026-08-05T09:00:00.000Z" },
      ],
      tableCounts: { products: 2, captures: 3, ledgers: 2 },
    });

    expect(summary).toMatchObject({
      productCount: 1,
      platformSkuCount: 1,
      pendingCaptureCount: 2,
      blockedCaptureCount: 1,
      openLedgerCount: 1,
      finalizedLedgerCount: 1,
      missingCostCount: 3,
      recordCount: 7,
    });
    expect(summary.latestOpenLedger.id).toBe("L-1");
  });

  it("空工作区返回稳定的零值", () => {
    expect(buildWorkspaceOperationalSummary()).toEqual({
      productCount: 0,
      platformSkuCount: 0,
      pendingCaptureCount: 0,
      blockedCaptureCount: 0,
      openLedgerCount: 0,
      finalizedLedgerCount: 0,
      readyLedgerCount: 0,
      missingCostCount: 0,
      recordCount: 0,
      latestLedger: null,
      latestOpenLedger: null,
      latestFinalizedLedger: null,
      latestCaptureAt: null,
      latestActivityAt: null,
    });
  });
});
