import { describe, expect, it } from "vitest";
import { productLibraryReturnPath, readProductLibraryViewState, saveProductLibraryViewState } from "./productLibraryViewState";

describe("product detail return state", () => {
  it("accepts only known product list return routes", () => {
    expect(productLibraryReturnPath("/products?view=reference")).toBe("/products?view=reference");
    for (const unsafe of ["https://example.com", "//example.com", "/products/edit", "/products?redirect=outside", null]) {
      expect(productLibraryReturnPath(unsafe)).toBe("/products?view=official");
    }
  });
  it("keeps search, filters and table position isolated by workspace and view", () => {
    const snapshot = { query: "红色 SKU", filters: { store: "店铺 A" }, table: { pageIndex: 3, windowScrollY: 650, scrollLeft: 120 } };
    saveProductLibraryViewState("workspace-A", "official", snapshot);
    expect(readProductLibraryViewState("workspace-A", "official")).toEqual(snapshot);
    expect(readProductLibraryViewState("workspace-B", "official")).toBeUndefined();
    expect(readProductLibraryViewState("workspace-A", "reference")).toBeUndefined();
    saveProductLibraryViewState("workspace-A", "reference", { query: "参考" });
    expect(readProductLibraryViewState("workspace-A", "official")).toEqual(snapshot);
  });
});
