import { describe, expect, it } from "vitest";
import { profitOrderNumberForExport } from "./profitOrderDisplay";

describe("single associated order for profit exports", () => {
  it("keeps the selected order and cannot skip a newer purchase to choose an older 1688 order", () => {
    const row = { orderNumber: "OLDER-1688 / NEWER-PO", costPurchaseRecords: [
      { purchaseDate: "2026-08-30", purchaseOrderNo: "00000000000000000123" },
      { purchaseDate: "2026-08-29", order1688: "123456789012345678901234567890" },
    ] };
    const before = structuredClone(row);
    expect(profitOrderNumberForExport(row)).toBe("00000000000000000123");
    expect(row).toEqual(before);
  });
  it("prefers 1688 only within the first record that has a valid identifier", () => {
    expect(profitOrderNumberForExport({ costPurchaseRecords: [
      { order1688: "  ", purchaseOrderNo: null },
      { order1688: "000123456789012345678901234", purchaseOrderNo: "PO-2", purchaseOrderId: "ID-2" },
      { order1688: "OLDER-1688" },
    ] })).toBe("000123456789012345678901234");
    expect(profitOrderNumberForExport({ costPurchaseRecords: [{ order1688: "", purchaseOrderNo: "  ", purchaseOrderId: "00000001" }] })).toBe("00000001");
  });
  it.each([undefined, [], [{ order1688: " ", purchaseOrderNo: null, purchaseOrderId: "" }]])("leaves rows with no usable order blank: %j", costPurchaseRecords => {
    expect(profitOrderNumberForExport({ costPurchaseRecords })).toBe("");
  });
  it("does not fall back to stale ERP display orders when selected evidence is empty or unnumbered", () => {
    expect(profitOrderNumberForExport({ costSource: "manual_override", costPurchaseRecords: [], orderNumber: "STALE-ERP" })).toBe("");
    expect(profitOrderNumberForExport({ costPurchaseRecords: [{}], orderNumber: "UNSELECTED-ERP" })).toBe("");
  });
  it.each([
    ["00000000000000000123 / 123456789012345678901234", "00000000000000000123"],
    ["PO/2026/00001", "PO/2026/00001"],
    ["PO/2026/00001 / OTHER/PO", "PO/2026/00001"],
    [" 0000123 ", "0000123"],
    [" / 0000123", "0000123"],
    ["", ""],
    [null, ""],
  ])("uses only the known old join separator in %j", (orderNumber, expected) => {
    expect(profitOrderNumberForExport({ orderNumber })).toBe(expected);
  });
});
