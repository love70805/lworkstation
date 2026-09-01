import { describe, expect, it } from "vitest";
import { buildSelectionReferenceRows, groupSelectionReferenceRows } from "./selectionReferences";

describe("selection reference rows", () => {
  it("prefers ERP history and calculates a reference unit profit", () => {
    const [row] = buildSelectionReferenceRows({
      erpCosts: [{ id: "ERP-1", platformSku: "SKU-A", unitCost: 4, currency: "CNY", publishedAt: "2026-08-01T00:00:00Z" }],
      profitLines: [{
        id: 1,
        ledgerId: "LEDGER-1",
        period: "2026-07",
        platformSku: "SKU-A",
        quantity: 10,
        revenue: 100,
        warehouseCost: 7,
        profit: 53,
        profitRate: 53,
        unitCost: 4,
        finalizedAt: "2026-07-31T00:00:00Z",
      }],
      supplierOffers: [{ id: "OFFER-1", platformSku: "SKU-A", landedUnitCost: 8 }],
    });

    expect(row.referenceUnitCost).toBe(4);
    expect(row.authoritativeSource).toBe("erp");
    expect(row.referenceUnitProfit).toBe(5.3);
    expect(row.referenceProfitRate).toBe(53);
  });

  it("aggregates the latest three finalized months without mixing reference and exact results", () => {
    const rows = buildSelectionReferenceRows({
      profitLines: [
        { ledgerId: "L1", period: "2026-08", platformSku: "SKU-A", quantity: 2, revenue: 20, profit: 8, unitCost: 5, warehouseCost: 2, finalizedAt: "2026-08-05T00:00:00Z" },
        { ledgerId: "L2", period: "2026-07", platformSku: "SKU-A", quantity: 3, revenue: 30, profit: 12, unitCost: 5, warehouseCost: 3, finalizedAt: "2026-07-31T00:00:00Z" },
        { ledgerId: "L3", period: "2026-06", platformSku: "SKU-A", quantity: 4, revenue: 40, profit: 16, unitCost: 5, warehouseCost: 4, finalizedAt: "2026-06-30T00:00:00Z" },
        { ledgerId: "L4", period: "2026-05", platformSku: "SKU-A", quantity: 100, revenue: 1000, profit: 400, unitCost: 5, warehouseCost: 100, finalizedAt: "2026-05-31T00:00:00Z" },
      ],
    });

    expect(rows[0]).toMatchObject({
      latestPeriod: "2026-08",
      recentMonthCount: 3,
      recentQuantity: 9,
      recentRevenue: 90,
      recentProfit: 36,
      referenceCalculationMode: "reference",
    });
  });

  it("keeps the ERP cost evidence chain available to the selection workspace", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{
        id: "SKU-ROW-1",
        platformSku: "sku-a",
        canonicalPlatformSku: "SKU-A",
        platformSkc: "SKC-A",
        productId: "PROD-1",
      }],
      products: [{ id: "PROD-1", name: "测试商品", status: "active" }],
      supplierOffers: [{ id: "OFFER-1", platformSku: "SKU-A", landedUnitCost: 9, currency: "CNY" }],
      erpCosts: [{
        id: "ERP-COST-1",
        ledgerId: "LEDGER-2026-08",
        platformSku: "SKU-A",
        platformSkc: "SKC-A",
        unitCost: 4,
        currency: "CNY",
        publishedAt: "2026-08-07T00:00:00Z",
      }],
      profitLines: [{
        ledgerId: "LEDGER-2026-07",
        period: "2026-07",
        platformSku: "SKU-A",
        platformSkc: "SKC-A",
        quantity: 10,
        revenue: 100,
        warehouseCost: 7,
        unitCost: 5,
        profit: 43,
        costSource: "approved_1688",
        costApprovalId: "APPROVAL-1",
        finalizedAt: "2026-07-31T00:00:00Z",
      }],
    });

    expect(row).toMatchObject({
      platformSku: "sku-a",
      platformSkc: "SKC-A",
      productId: "PROD-1",
      productName: "测试商品",
      referenceUnitCost: 4,
      referenceKind: "erp_history",
      authoritativeSource: "erp",
      referenceCostId: "ERP-COST-1",
      referenceLedgerId: "LEDGER-2026-08",
      referenceApprovalId: null,
      referenceCurrency: "CNY",
    });
  });

  it("uses the manually registered sale price when there is no finalized month yet", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ platformSku: "SKU-PRICE", platformSkc: "SKC-PRICE", salePrice: 25 }],
      supplierOffers: [{ platformSku: "SKU-PRICE", landedUnitCost: 10, currency: "CNY" }],
    });

    expect(row.averageSalePrice).toBe(25);
    expect(row.referenceUnitCost).toBe(10);
    expect(row.referenceUnitProfit).toBe(14.3);
  });

  it("uses the active SKU-level confirmed cost before a 1688 reference", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ id: "PS-1", platformSku: "SKU-MANUAL", platformSkc: "SKC-MANUAL", salePrice: 30 }],
      catalogManualCosts: [{ id: "MANUAL-1", platformSkuId: "PS-1", platformSku: "SKU-MANUAL", amount: 12, status: "active", confirmedAt: "2026-08-10T08:00:00Z" }],
      supplierOffers: [{ id: "OFFER-1", platformSku: "SKU-MANUAL", landedUnitCost: 10, currency: "CNY" }],
    });
    expect(row).toMatchObject({ referenceUnitCost: 12, referenceKind: "manual_confirmed", authoritativeSource: "manual_confirmed", referenceCostId: "MANUAL-1", manualCostHistoryCount: 1 });
  });

  it("ignores superseded supplier quotations when resolving a current reference", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ platformSku: "SKU-HISTORY", platformSkc: "SKC-HISTORY" }],
      supplierOffers: [
        { id: "OFFER-OLD", platformSku: "SKU-HISTORY", landedUnitCost: 8, status: "superseded", calculatedAt: "2026-08-01T00:00:00Z" },
        { id: "OFFER-CURRENT", platformSku: "SKU-HISTORY", landedUnitCost: 10, status: "active", calculatedAt: "2026-08-02T00:00:00Z" },
      ],
    });
    expect(row).toMatchObject({ referenceUnitCost: 10, referenceCostId: "OFFER-CURRENT", referenceKind: "supplier_landed" });
  });

  it("groups SKU variants by platform SKC for the workbench view", () => {
    const rows = buildSelectionReferenceRows({
      platformSkus: [
        { platformSku: "SKU-RED", platformSkc: "SKC-1" },
        { platformSku: "SKU-BLUE", platformSkc: "SKC-1" },
      ],
    });
    const groups = groupSelectionReferenceRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ platformSkc: "SKC-1", skuCount: 2 });
    expect(groups[0].variants.map((item) => item.platformSku).toSorted()).toEqual(["SKU-BLUE", "SKU-RED"]);
  });
});
