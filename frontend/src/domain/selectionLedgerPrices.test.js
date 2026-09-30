import { describe, expect, it } from "vitest";
import { buildSelectionLedgerPriceIndex, selectionLedgerPrice } from "./selectionLedgerPrices";
const sale = (patch = {}) => ({ id: "R", workspaceId: "W", ledgerId: "L", batchId: "B", store: "甲店", platformSku: "A", platformSkc: "SKC", sourceRow: 2, rawAddedAt: "2026-08-31 12:30:00", quantityExact: "1", unitPriceRaw: "10", ...patch });
const resolve = (rows, context = {}, patch = {}) => selectionLedgerPrice(buildSelectionLedgerPriceIndex({ workspaceId: "W", ledgers: [{ id: "L", workspaceId: "W", period: "2026-08" }], importBatches: [{ id: "B", workspaceId: "W", ledgerId: "L", status: "completed", store: "甲店", fileHash: "H" }], salesRows: rows, ...patch }), "A", context);
describe("ledger selling price contract", () => {
  it("uses full Beijing time rather than import/row order, keeping unique latest over historical volume", () => {
    const result = resolve([sale({ sourceRow: 90, rawAddedAt: "2026-08-31 12:29:59", quantityExact: "999", unitPriceRaw: "9" }), sale()]);
    expect(result).toMatchObject({ status: "ready", value: 10, sourceAddedAt: "2026-08-31T12:30:00.000+08:00" });
    expect(result.sources).toMatchObject([{ batchId: "B", sourceRow: 2, store: "甲店" }]);
  });
  it("compares month net units only among prices at the latest instant", () => {
    const rows = [sale(), sale({ sourceRow: 3, unitPriceRaw: "12", quantityExact: "2" }), sale({ sourceRow: 4, rawAddedAt: "2026-08-01 01:00:00", unitPriceRaw: "10", quantityExact: "9" }), sale({ sourceRow: 5, rawAddedAt: "2026-08-31 13:00:00", movementType: "退货", unitPriceRaw: "10", quantityExact: "-2" }), sale({ sourceRow: 6, rawAddedAt: "2026-08-02 01:00:00", unitPriceRaw: "3", quantityExact: "1000" })];
    const result = resolve(rows);
    expect(result).toMatchObject({ status: "ready", value: 10, reason: "net_quantity" });
    expect(result.candidates.map(item => [item.value, item.quantityExact])).toEqual([[10, "8"], [12, "2"]]);
  });
  it("keeps a tied latest price pending without averaging or choosing by price/order", () => {
    expect(resolve([sale(), sale({ sourceRow: 3, unitPriceRaw: "12" })])).toMatchObject({ status: "choose", value: null });
  });
  it("supports true zero and ignores returns, deductions, missing prices and unrelated SKUs", () => {
    const rows = [sale({ unitPriceRaw: "0" }), sale({ sourceRow: 3, rawAddedAt: "2026-08-31 11:00:00", unitPriceRaw: "", unitPrice: null }), sale({ sourceRow: 4, unitPriceRaw: "99", movementType: "扣款" }), sale({ sourceRow: 5, unitPriceRaw: "99", quantityExact: "-10" }), sale({ sourceRow: 6, unitPriceRaw: "99", platformSku: "B" })];
    expect(resolve(rows)).toMatchObject({ status: "ready", value: 0 });
    expect(resolve([sale({ quantityExact: "-1" })])).toMatchObject({ status: "missing", value: null });
  });
  it("preserves Excel fractional time and source-coordinate replay idempotence", () => {
    const rows = [sale({ rawAddedAt: 46265.5 }), sale({ id: "COPY", rawAddedAt: 46265.5 }), sale({ sourceRow: 3, rawAddedAt: 46265.75, unitPriceRaw: "12" })];
    expect(resolve(rows)).toMatchObject({ value: 12, sourceAddedAt: "2026-08-31T18:00:00.000+08:00" });
    expect(resolve([sale(), sale({ id: "COPY" })]).candidates[0].quantityExact).toBe("1");
  });
  it("never chooses another shop or month just because it imported later", () => {
    const patch = { ledgers: [{ id: "L", workspaceId: "W", period: "2026-08" }, { id: "L2", workspaceId: "W", period: "2026-09" }], importBatches: [{ id: "B", workspaceId: "W", ledgerId: "L", status: "completed", store: "甲店" }, { id: "B2", workspaceId: "W", ledgerId: "L2", status: "completed", store: "乙店" }] };
    const rows = [sale(), sale({ id: "R2", ledgerId: "L2", batchId: "B2", store: "乙店", rawAddedAt: "2026-09-20 12:00:00", unitPriceRaw: "99" })];
    expect(resolve(rows, { ledgerId: "L", store: "甲店" }, patch)).toMatchObject({ value: 10, period: "2026-08" });
    expect(resolve(rows, { ledgerId: "L", store: "乙店" }, patch)).toMatchObject({ status: "missing", value: null });
  });
});

it("does not invent same-second ordering when a legacy source contains only dates", () => {
  const rows = [sale({ rawAddedAt: "2026-08-31", unitPriceRaw: "11", quantityExact: "100" }), sale({ rawAddedAt: "2026-08-31 12:00:00", unitPriceRaw: "12", sourceRow: 3 })];
  expect(resolve(rows)).toMatchObject({ status: "choose", value: null, reason: "missing_time" });
});

it("keeps anomalous return signs and negative monthly candidate units pending", () => {
  expect(resolve([sale(), sale({ sourceRow: 3, movementType: "退货", quantityExact: "-2" })])).toMatchObject({ status: "choose", value: null });
  expect(resolve([sale(), sale({ sourceRow: 3, movementType: "退货", quantityExact: "20" })])).toMatchObject({ status: "choose", value: null });
});

it("keeps the latest normal sale with no price empty instead of reviving an older price", () => {
  const missing = sale({ sourceRow: 3, rawAddedAt: "2026-08-31 13:00:00", unitPriceRaw: "", unitPrice: null });
  for (const rows of [[sale(), missing], [missing, sale()]]) {
    expect(resolve(rows)).toMatchObject({ status: "missing", value: null, kind: "ledger", sourceAddedAt: "2026-08-31T13:00:00.000+08:00" });
    expect(resolve(rows).sources).toMatchObject([{ sourceRow: 3 }]);
    expect(resolve(rows).candidates).toEqual([]);
  }
});
it("leaves same-instant missing and valid prices pending, including date-only legacy uncertainty", () => {
  expect(resolve([sale(), sale({ sourceRow: 3, unitPriceRaw: "" })])).toMatchObject({ status: "choose", value: null, reason: "missing_latest_price" });
  expect(resolve([sale(), sale({ sourceRow: 3, rawAddedAt: "2026-08-31", unitPriceRaw: "" })])).toMatchObject({ status: "choose", value: null, reason: "missing_time" });
});
it("does not choose a volume winner when a month's price-less rows could change candidate units", () => {
  expect(resolve([sale(), sale({ sourceRow: 3, unitPriceRaw: "12", quantityExact: "2" }), sale({ sourceRow: 4, rawAddedAt: "2026-08-30 12:00:00", unitPriceRaw: "", quantityExact: "100" })])).toMatchObject({ status: "choose", value: null });
});
