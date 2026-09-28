import { describe, expect, it } from "vitest";
import { buildErpProductCatalogIndex, erpCatalogField, erpProductCatalogRowsFromEnvelope } from "./erpProductCatalog";
import { erpProductCatalogFixture } from "../testFixtures/erpProductCatalog";

describe("ERP catalog evidence projection", () => {
  it("retains verified auxiliary warehouse metadata without financial fields", () => {
    const envelope = {
      workspaceId: "workspace-default", ledgerId: "L-1", query: { platformSkcs: [{ platformSkc: "SKC-1" }] },
      rows: [{ platformSku: "EXPECTED", platformSkc: "SKC-1", warehouseSku: "WH-1", productName: "同款", unitCost: 5 }, { platformSku: "AUXILIARY", platformSkc: "SKC-1", warehouseSku: "WH-2", ledgerScopeRole: "auxiliary", unitCost: 99, quantity: 100, raw: "discard" }],
      warehouseEvidence: [{ warehouseSku: "WH-2", purchaseRecords: [{ recordId: "R-2", warehouseSku: "WH-2", supplierName: "辅助供货方", unitPrice: 99, quantity: 100, purchaseCatalog: { purchaseOrderDetailId: "R-2", pictureLink1688: "https://images.example.invalid/aux.jpg", purchaseProportion1688: "1-1", token: "discard" } }] }],
    };
    const rows = erpProductCatalogRowsFromEnvelope(envelope, { batchId: "B-1", publishedAt: "2026-09-28" });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ platformSku: "AUXILIARY", warehouseSku: "WH-2", purchaseRecords: [{ recordId: "R-2", purchaseCatalog: { purchaseProportion1688: "1-1" } }] });
    expect(rows[1]).not.toHaveProperty("unitCost");
    expect(rows[1]).not.toHaveProperty("quantity");
    expect(rows[1].purchaseRecords[0]).not.toHaveProperty("unitPrice");
    expect(rows[1].purchaseRecords[0]).not.toHaveProperty("quantity");
    expect(JSON.stringify(rows)).not.toContain("discard");
    expect(buildErpProductCatalogIndex(rows).has("AUXILIARY")).toBe(true);
  });
  it("rejects mappings with no parent warehouse without failing other product rows", () => {
    const incomplete = erpProductCatalogFixture();
    incomplete.warehouseSku = "";
    const healthy = { ...erpProductCatalogFixture(), platformSku: "HEALTHY", warehouseSku: "WH-HEALTHY", catalogMappings: [], purchaseRecords: [] };
    const index = buildErpProductCatalogIndex([incomplete, healthy]);
    expect(index.has("SKU-BLUE")).toBe(false);
    expect(index.get("SKU-RED").relationshipConflict).toBe(true);
    expect(erpCatalogField(index.get("HEALTHY"), "productName").value).toBe(healthy.productName);
  });

  it("keeps explicit purchase barcodes scoped and procurement specifications separate from platform attributes", () => {
    const fixture = erpProductCatalogFixture();
    fixture.purchaseRecords = [
      { recordId: "PURCHASE-RED", warehouseSku: fixture.warehouseSku, supplierName: "同名供货方", supplier1688Url: "https://detail.1688.com/offer/111111111111.html", purchaseCatalog: { purchaseOrderDetailId: "PURCHASE-RED", lineNumber: 0, barcodeSkuid: "SKU-RED", barcodeSkcid: "SKC-CATALOG", purchaseSpecificationAndModel1688: "采购红色包装", purchaseProportion1688: "1-1" } },
      { recordId: "PURCHASE-BLUE", warehouseSku: fixture.warehouseSku, supplierName: "同名供货方", supplier1688Url: "https://detail.1688.com/offer/222222222222.html", purchaseCatalog: { purchaseOrderDetailId: "PURCHASE-BLUE", lineNumber: 2, barcodeSkuid: "SKU-BLUE", barcodeSkcid: "SKC-CATALOG", purchaseSpecificationAndModel1688: "采购蓝色包装", purchaseProportion1688: "2-3" } },
    ];
    const index = buildErpProductCatalogIndex([fixture]);
    expect(index.get("SKU-RED").suppliers.map(supplier => supplier.sourceUrl)).toEqual([fixture.purchaseRecords[0].supplier1688Url]);
    expect(index.get("SKU-BLUE").suppliers.map(supplier => supplier.sourceUrl)).toEqual([fixture.purchaseRecords[1].supplier1688Url]);
    expect(index.get("SKU-RED").purchases).toMatchObject([{ purchaseCatalog: { purchaseSpecificationAndModel1688: "采购红色包装", purchaseProportion1688: "1-1", lineNumber: "0" } }]);
    expect(index.get("SKU-BLUE").purchases).toMatchObject([{ purchaseCatalog: { purchaseSpecificationAndModel1688: "采购蓝色包装", purchaseProportion1688: "2-3" } }]);
    expect(erpCatalogField(index.get("SKU-RED"), "attribute").value).toBe("红色 · 大号");
    expect(erpCatalogField(index.get("SKU-BLUE"), "attribute").value).toBe("蓝色 · 小号");
  });

  it("keeps a large complete warehouse mapping and its purchase sources unique", () => {
    const source = erpProductCatalogFixture();
    const mappings = Array.from({ length: 200 }, (_, n) => ({ ...source.catalogMappings[0], platformSku: `SKU-${n}` }));
    const rows = mappings.map(mapping => ({ ...source, ...mapping, catalogMappings: mappings }));
    const index = buildErpProductCatalogIndex(rows);
    expect(index.size).toBe(200);
    for (const catalog of index.values()) {
      expect(catalog.entries).toHaveLength(1);
      expect(erpCatalogField(catalog, "productName").candidates[0].sources).toHaveLength(1);
      expect(catalog.suppliers).toHaveLength(3);
      expect(catalog.suppliers.every(supplier => supplier.sourceRecords.length === 1)).toBe(true);
    }
    const distinctBatch = { ...rows[0], batchId: "ERP-ANOTHER-BATCH", catalogMappings: [], purchaseRecords: [{ ...source.purchaseRecords[0], recordId: "REC-DISTINCT" }] };
    const merged = buildErpProductCatalogIndex([...rows, distinctBatch]).get("SKU-0");
    expect(erpCatalogField(merged, "productName").candidates[0].sources).toHaveLength(2);
    expect(merged.suppliers[0].sourceRecords.map(record => record.recordId)).toEqual(["REC-A", "REC-DISTINCT"]);
  });
});
