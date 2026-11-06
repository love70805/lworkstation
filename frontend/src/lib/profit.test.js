import { describe, expect, it } from "vitest";
import { aggregateLedgerRows } from "../domain/ledgerImport";
import { countProfitIdentities, groupImportedSales, groupProfitRowsBySkc } from "./profit";

it("counts platform SKCs across stores and store/SKU pairs across attributes and suppliers", () => {
  const rows = [
    { store: "Ａ店", platformSkc: "父-a", platformSku: "sku-1", supplierNumber: "甲", attribute: "蓝" },
    { store: " A店 ", platformSkc: " 父-Ａ ", platformSku: "ＳＫＵ-１", supplierNumber: "乙", attribute: "红" },
    { store: "B店", platformSkc: "父-A", platformSku: "SKU-1" },
    { store: "B店", platformSkc: " ", groupSkc: "供应商代号", platformSku: "SKU-2" },
    { store: "", platformSkc: "父-B", platformSku: "SKU-3" },
    { store: "B店", platformSku: null },
  ];
  expect(countProfitIdentities(rows)).toEqual({ skcCount: 2, storeSkuCount: 3 });
  expect(countProfitIdentities([])).toEqual({ skcCount: 0, storeSkuCount: 0 });
  const [group] = groupProfitRowsBySkc([
    { store: "A店", groupSkc: "父-A", platformSku: "SKU-1", attribute: "红" },
    { store: "A店", groupSkc: "父-A", platformSku: "SKU-1", attribute: "蓝" },
  ]);
  expect(group.skuCount).toBe(1);
  expect(group.variants).toHaveLength(2);
});

describe("legacy-compatible profit grouping", () => {
  it("groups by shop/SKC/supplier then platform SKU/attribute and applies ERP costs", () => {
    const rows = [
      { store: "US", platformSkc: "SKC-1", supplierNumber: "SUP-1", platformSku: "abc", attribute: "Black", quantity: 2, amount: 10.1, isDeduction: false, penalty: 0, sourceRow: 2, orderId: "O-1" },
      { store: "US", platformSkc: "SKC-1", supplierNumber: "SUP-1", platformSku: "ABC", attribute: "Black", quantity: 1, amount: 5.2, isDeduction: false, penalty: 0, sourceRow: 3, orderId: "O-2" },
      { store: "US", platformSkc: "SKC-1", supplierNumber: "SUP-1", platformSku: "ABC", attribute: "Black", quantity: 0, amount: 0, isDeduction: true, deductionAmount: 0.2, sourceRow: 4 },
    ];
    const result = groupImportedSales(rows, [{ platformSku: "ABC", name: "Product", unitCost: 1.5, source: "erp", image: null }]);

    expect(result).toEqual([expect.objectContaining({
      store: "US",
      groupSkc: "SKC-1",
      supplierNumber: "SUP-1",
      sku: "abc",
      attribute: "Black",
      qty: 3,
      revenue: 15.3,
      penalty: 0.2,
      sourceRowCount: 2,
      realOrderCount: 2,
      unitCost: 1.5,
      costSource: "erp",
      status: "Matched",
    })]);
  });

  it("uses the last direct penalty and direct legacy cost without marking it as formal ERP cost", () => {
    const groups = aggregateLedgerRows([
      { store: "US", supplierNumber: "SUP-1", platformSku: "SKU-1", quantity: 1, amount: 10, isDeduction: false, hasDirectPenalty: true, directPenalty: 1, hasDirectUnitCost: true, directUnitCost: 3, sourceRow: 2 },
      { store: "US", supplierNumber: "SUP-1", platformSku: "SKU-1", quantity: 0, amount: 0, isDeduction: true, deductionAmount: 5, hasDirectPenalty: true, directPenalty: 2, hasDirectUnitCost: true, directUnitCost: 4, sourceRow: 3 },
    ]);

    expect(groups[0].skus[0]).toMatchObject({
      quantity: 1,
      revenue: 10,
      penalty: 2,
      legacyImportedUnitCost: 4,
    });
  });

  it("keeps platform SKU variants under one platform SKC row", () => {
    const grouped = groupProfitRowsBySkc([
      { id: "1", groupKey: "US|SKC-1|SUP-1", store: "US", groupSkc: "SKC-1", platformSkc: "SKC-1", supplierNumber: "SUP-1", platformSku: "SKU-B", attribute: "蓝色", qty: 2, revenue: 20, purchaseCost: 6, warehouseCost: 1.4, penalty: 0, profit: 12.6, finalizable: true },
      { id: "2", groupKey: "US|SKC-1|SUP-1", store: "US", groupSkc: "SKC-1", platformSkc: "SKC-1", supplierNumber: "SUP-1", platformSku: "SKU-A", attribute: "红色", qty: 3, revenue: 33, purchaseCost: null, warehouseCost: 2.1, penalty: 1, profit: null, finalizable: false },
      { id: "3", groupKey: "US|SKC-2|SUP-1", store: "US", groupSkc: "SKC-2", platformSkc: "SKC-2", supplierNumber: "SUP-1", platformSku: "SKU-C", attribute: "黑色", qty: 1, revenue: 9, purchaseCost: 2, warehouseCost: 0.7, penalty: 0, profit: 6.3, finalizable: true },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      groupSkc: "SKC-1",
      skuCount: 2,
      qty: 5,
      revenue: 53,
      warehouseCost: 3.5,
      penalty: 1,
      purchaseCost: null,
      profit: null,
      finalizable: false,
      missingCount: 1,
    });
    expect(grouped[0].variants.map((row) => row.platformSku)).toEqual(["SKU-A", "SKU-B"]);
  });
});
