import { describe, expect, it } from "vitest";
import { buildCostMatchingHref, buildProfitHref, filterProfitRows, filterProfitRowsByScope, searchProfitRows, readProfitFilter, saveProfitFilter } from "./profitFilter";

describe("profit filter context", () => {
  it("round-trips selected suppliers through profit and ERP routes", () => {
    const href = buildCostMatchingHref({ ledgerId: "L-1", query: "SKC-1", storeFilter: "680店", supplierSelection: ["YW-B", "YW-A"], missingOnly: true });
    const params = new URL(href, "http://localhost").searchParams;
    const filter = readProfitFilter(params, "L-1");
    expect(filter).toEqual({ query: "SKC-1", storeFilter: "680店", supplierSelection: ["YW-A", "YW-B"], missingOnly: true });
    const profitUrl = new URL(buildProfitHref({ ledgerId: "L-1", ...filter }), "http://localhost");
    expect(profitUrl.pathname).toBe("/profit");
    expect(profitUrl.searchParams.get("ledger")).toBe("L-1");
    expect(readProfitFilter(profitUrl.searchParams, "L-1")).toEqual(filter);
  });

  it("keeps an explicitly empty supplier selection when moving to ERP", () => {
    const href = buildCostMatchingHref({ ledgerId: "L-2", missingOnly: true, supplierSelection: [] });
    const filter = readProfitFilter(new URL(href, "http://localhost").searchParams, "L-2");
    expect(filter.supplierSelection).toEqual([]);
    expect(filter.missingOnly).toBe(true);
  });

  it("filters the same sales rows used by the profit and cost pages", () => {
    const rows = [
      { groupSkc: "SKC-1", platformSku: "SKU-1", attribute: "红", supplierNumber: "YW-A", store: "680店", finalizable: false },
      { groupSkc: "SKC-2", platformSku: "SKU-2", attribute: "蓝", supplierNumber: "YW-B", store: "680店", finalizable: true },
    ];
    expect(filterProfitRows(rows, { query: "", storeFilter: "all", supplierSelection: ["YW-A"], missingOnly: false })).toEqual([rows[0]]);
    expect(filterProfitRows(rows, { query: "SKC-2", storeFilter: "680店", supplierSelection: null, missingOnly: true })).toEqual([]);
  });

  it("restores the most recent filter when the profit route has no ledger query", () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    };
    const expected = { query: "SKU-9", storeFilter: "680店", supplierSelection: ["YW-A"], missingOnly: true };
    saveProfitFilter("L-9", expected);
    expect(readProfitFilter(new URLSearchParams(), "")).toEqual(expected);
    expect(readProfitFilter(new URLSearchParams(), "L-9")).toEqual(expected);
    delete globalThis.localStorage;
  });

  it("narrows the ledger before constructing search text and reuses it for repeated queries", () => {
    let reads = 0;
    const selected = { store: "甲店", supplierNumber: "货号1", platformSku: "SKU-A", platformSkc: "SKC-A", get attribute() { reads += 1; return "红色"; } };
    const excluded = { store: "乙店", supplierNumber: "货号2", get attribute() { throw Error("outside selected store"); } };
    const filter = { storeFilter: "甲店", supplierSelection: ["货号1"], missingOnly: false };
    const scoped = filterProfitRowsByScope([selected, excluded], filter);
    expect(searchProfitRows(scoped, " skc-a ")).toEqual([selected]);
    expect(searchProfitRows(scoped, "sku-a")).toEqual([selected]);
    expect(reads).toBe(1);
    expect(filterProfitRows([selected, excluded], { ...filter, query: "货号1" })).toEqual([selected]);
    expect(searchProfitRows(scoped, "")).toBe(scoped);
  });
});
