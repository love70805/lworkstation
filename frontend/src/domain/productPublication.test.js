import { describe, expect, it } from "vitest";
import {
  buildProductDataReadiness,
  normalizeProductPublicationStatus,
  productPublicationStatusById,
} from "./productPublication";

describe("product publication lifecycle", () => {
  it("keeps a distinct lifecycle for unpublished, pending, and listed products", () => {
    expect(normalizeProductPublicationStatus("approved_pending_listing")).toBe("approved_pending_listing");
    expect(normalizeProductPublicationStatus("unknown")).toBe("unpublished");
    expect(productPublicationStatusById("listed")).toMatchObject({ label: "已上架", tone: "success" });
  });

  it("reports procurement, profit, and warehouse-mapping coverage independently", () => {
    expect(buildProductDataReadiness({
      skuCount: 2,
      erpCoveredSkuCount: 1,
      profitHistorySkuCount: 0,
      warehouseMappedSkuCount: 2,
    })).toMatchObject({
      purchase: { status: "partial", missingSkuCount: 1 },
      profit: { status: "missing", missingSkuCount: 2 },
      warehouseMapping: { status: "complete", missingSkuCount: 0 },
      hasGaps: true,
    });
  });

  it("does not treat an unfinalized month as missing catalog data when reference profit is available", () => {
    expect(buildProductDataReadiness({ skuCount: 5, erpCoveredSkuCount: 5, warehouseMappedSkuCount: 5, referenceProfitSkuCount: 5 }))
      .toMatchObject({ profit: { status: "missing" }, referenceProfit: { status: "complete" }, hasGaps: false });
    expect(buildProductDataReadiness({ skuCount: 5, erpCoveredSkuCount: 5, warehouseMappedSkuCount: 5, referenceProfitSkuCount: 4 }))
      .toMatchObject({ referenceProfit: { status: "partial", missingSkuCount: 1 }, hasGaps: true });
  });
});
