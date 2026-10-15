import { expect, it } from "vitest";
import { erpSupplierSourceChoices, groupErpCatalogPurchases, groupErpCatalogSources } from "./erpCatalogPresentation";

const source = { batchId: "B-1", capturedAt: "2026-09-01", recordId: "DETAIL-1", purchaseOrderNo: "ORDER-1", lineNumber: "0" };
const row = { platformSku: "Sku-A", platformSkc: "SKC", warehouseSku: "WH-A", attribute: "红色", productName: "商品", source };

it("combines repeated SKU content across deliveries while keeping distinct attributes, warehouses and trust", () => {
  const rows = [row, { ...row, platformSku: "SKU-A", source: { ...source, batchId: "B-2" } },
    { ...row, attribute: "蓝色" }, { ...row, warehouseSku: "WH-B" }, { ...row, trusted: false }, { ...row, platformSku: "SKU-B" }];
  const original = structuredClone(rows), groups = groupErpCatalogSources(rows);
  expect(groups).toHaveLength(2);
  expect(groups[0].versions).toHaveLength(4);
  expect(groups[0].versions[0].sources.map(item => item.batchId)).toEqual(["B-1", "B-2"]);
  expect(rows).toEqual(original);
});

it("counts distinct purchase lines once across batches and keeps specification, ratio and SKU boundaries", () => {
  const purchase = { ...row, platformSkus: ["SKU-A"], supplierName: "甲", purchaseCatalog: { purchaseOrderDetailId: "DETAIL-1", lineNumber: "0", purchaseSpecificationAndModel1688: "颜色:红色", purchaseProportion1688: "1-1" } };
  const rows = [purchase, { ...purchase, source: { ...source, batchId: "B-2" } },
    { ...purchase, source: { ...source, recordId: "DETAIL-2", lineNumber: "1" }, purchaseCatalog: { ...purchase.purchaseCatalog, purchaseOrderDetailId: "DETAIL-2", lineNumber: "1" } },
    { ...purchase, purchaseCatalog: { ...purchase.purchaseCatalog, purchaseProportion1688: "1-2" } },
    { ...purchase, platformSkus: ["SKU-B"] }, { ...purchase, warehouseSku: "WH-B" }];
  const original = structuredClone(rows), groups = groupErpCatalogPurchases(rows);
  expect(groups).toHaveLength(4);
  expect(groups[0].records).toHaveLength(2);
  expect(groups[0].records[0].sources).toHaveLength(2);
  expect(rows).toEqual(original);
});

it("only offers validated links for the matching supplier identity and preserves product/store types", () => {
  const candidates = [{ stableSupplierId: "A", supplierName: "同名", sourceUrl: "https://detail.1688.com/offer/1234567890.html", sourceLinks: [{ url: "https://shop-a.1688.com/" }, { url: "javascript:alert(1)" }], sourceRecords: [source] },
    { stableSupplierId: "B", supplierName: "同名", sourceUrl: "https://detail.1688.com/offer/4567890123.html" }];
  const links = erpSupplierSourceChoices({ stableSupplierId: "A", supplierName: "同名" }, candidates);
  expect(links.map(item => [item.type, item.sourceProductId])).toEqual([["product", "1234567890"], ["store", ""]]);
  expect(erpSupplierSourceChoices({ supplierName: "其他" }, candidates)).toEqual([]);
  expect(erpSupplierSourceChoices({}, candidates)).toEqual([]);
});

it("renders partial metadata and does not merge purchases whose record identity is missing", () => {
  expect(groupErpCatalogSources([{ platformSku: "SKU-A" }])[0].versions).toHaveLength(1);
  expect(groupErpCatalogPurchases([{}, {}])[0].records).toHaveLength(2);
});
