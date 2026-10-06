import { describe, expect, it } from "vitest";
import { createSelectionSearchIndex, matchesSelectionSearch, normalizeSelectionSearchQuery } from "./selectionSearch";

describe("selection workspace search", () => {
  it("matches the catalog identity fields used by the selection workspace", () => {
    const fields = ["夏季连衣裙", "SKC-100", "PLATFORM-SKU-RED", "WH-LEAD-01", "杭州供应商"];

    expect(matchesSelectionSearch("skc-100", fields)).toBe(true);
    expect(matchesSelectionSearch("wh-lead", fields)).toBe(true);
    expect(matchesSelectionSearch("供应商", fields)).toBe(true);
    expect(normalizeSelectionSearchQuery("  PLATFORM-SKU  ")).toBe("platform-sku");
  });

  it("does not make 1688 source links part of the search index", () => {
    const fields = ["夏季连衣裙", "SKC-100", "PLATFORM-SKU-RED", "WH-LEAD-01", "杭州供应商"];

    expect(matchesSelectionSearch("detail.1688.com", fields)).toBe(false);
    expect(matchesSelectionSearch("offer/9988", fields)).toBe(false);
  });

  it("indexes nested identity fields lazily and reuses a row across successive queries", () => {
    let reads = 0;
    const index = createSelectionSearchIndex((row) => { reads += 1; return [row.name, row.skus.map(sku => [sku.platformSku, sku.warehouseSku])]; });
    const row = { name: "夏季", skus: [{ platformSku: "SKU-RED", warehouseSku: "WAREHOUSE-BLUE" }] };
    expect(index(row, "")).toBe(true);
    expect(reads).toBe(0);
    expect(index(row, "sku-red")).toBe(true);
    expect(index(row, "warehouse-blue")).toBe(true);
    expect(reads).toBe(1);
    expect(index({ ...row, name: "冬季" }, "冬季")).toBe(true);
    expect(reads).toBe(2);
    expect(matchesSelectionSearch("red,warehouse", [row.skus.map(sku => [sku.platformSku, sku.warehouseSku])])).toBe(false);
  });
});
