import { describe, expect, it } from "vitest";
import { matchesSelectionSearch, normalizeSelectionSearchQuery } from "./selectionSearch";

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
});
