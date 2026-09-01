import { describe, expect, it } from "vitest";
import { buildCostMatchingHref, buildProfitHref, filterProfitRows, readProfitFilter, saveProfitFilter } from "./profitFilter";

describe("profit filter context", () => {
  it("round-trips selected suppliers through profit and ERP routes", () => {
    const href = buildCostMatchingHref({ ledgerId: "L-1", query: "SKC-1", storeFilter: "680店", supplierSelection: ["YW-B", "YW-A"], missingOnly: true });
    const params = new URL(href, "http://localhost").searchParams;
    const filter = readProfitFilter(params, "L-1");
    expect(filter).toEqual({ query: "SKC-1", storeFilter: "680店", supplierSelection: ["YW-A", "YW-B"], missingOnly: true });
    expect(buildProfitHref({ ledgerId: "L-1", ...filter })).toContain("/profit?");
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
});
