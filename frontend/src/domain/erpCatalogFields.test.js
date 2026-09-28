import { describe, expect, it } from "vitest";
import { normalizeErpCatalogFields, normalizeErpCatalogMappings, normalizeErpCatalogUrl, normalizeErpPurchaseCatalog, normalizeErpSupplierLinks } from "./erpCatalogFields";

describe("optional ERP catalog carriers", () => {
  it("keeps purchase specifications and ratios separate from platform attributes in a fixed whitelist", () => {
    const catalog = normalizeErpPurchaseCatalog({
      picturesLinking: "https://cbu01.alicdn.com/img/warehouse.jpg#preview", pictureLink1688: "https://user:secret@cbu01.alicdn.com/img/purchase.jpg",
      purchaseSpecificationAndModel1688: " 1688 大号 ", model1688: " 白色 ", specificationAndModel: "", productColor: null,
      purchaseProportion1688: " 1-1 ", purchaseOrderDetailId: " DETAIL-1 ", purchaseOrderId: 123, purchaseOrderNo: " PUR-1 ",
      lineNumber: 0, supplierId: " SUP-1 ", barcodeSkuid: " ＳＫＵ-1 ", barcodeSkcid: "", raw: { token: "discard" }, cookie: "discard",
    });
    expect(catalog).toEqual({
      picturesLinking: "https://cbu01.alicdn.com/img/warehouse.jpg", pictureLink1688: null,
      purchaseSpecificationAndModel1688: "1688 大号", model1688: "白色", specificationAndModel: null, productColor: null,
      purchaseProportion1688: "1-1", purchaseOrderDetailId: "DETAIL-1", purchaseOrderId: "123", purchaseOrderNo: "PUR-1",
      lineNumber: "0", supplierId: "SUP-1", barcodeSkuid: "SKU-1", barcodeSkcid: null,
    });
    expect(normalizeErpCatalogFields({ attribute: "平台蓝色", purchaseCatalog: catalog }, { includeMappings: false })).toEqual({ attribute: "平台蓝色", purchaseCatalog: catalog });
    expect(normalizeErpPurchaseCatalog([catalog])).toBeNull();
  });

  it("whitelists mapping data without inventing missing identifiers or resolving conflicts", () => {
    const mapping = { platformSku: " ＳＫＵ-1 ", platformSkc: "SKC-1", warehouseSku: "WH-1", productName: "款式一", imageUrl: "https://cbu01.alicdn.com/img/one.jpg", attribute: "红色", storeName: "680店", platform: "TEMU", articleNumber: "A1", raw: { token: "discard" }, cookie: "discard" };
    const mappings = normalizeErpCatalogMappings([mapping, mapping, { ...mapping, attribute: "蓝色" }, { platformSku: "SKU-2", productName: "未确认映射" }]);
    expect(mappings).toHaveLength(3);
    expect(mappings[0]).toEqual({ platformSku: "SKU-1", platformSkc: "SKC-1", warehouseSku: "WH-1", productName: "款式一", imageUrl: mapping.imageUrl, attribute: "红色", storeName: "680店", platform: "TEMU", articleNumber: "A1" });
    expect(mappings[1].attribute).toBe("蓝色");
    expect(mappings[2]).toMatchObject({ platformSku: "SKU-2", platformSkc: null, warehouseSku: null });
    expect(JSON.stringify(mappings)).not.toContain("discard");
    expect(normalizeErpCatalogFields({})).toEqual({});
  });

  it("keeps supplier URLs typed and paired with their own supplier", () => {
    expect(normalizeErpSupplierLinks([
      { type: "product", url: "https://detail.1688.com/offer/730242606884.html?spm=1", supplierName: "甲供应商", token: "discard" },
      { type: "store", url: "https://shop123456789.1688.com/?spm=2", supplierName: "乙供应商" },
      { type: "store", url: "https://detail.1688.com/offer/730242606884.html" },
      { type: "product", url: "https://shop123456789.1688.com" },
      { type: "store", url: "https://www.1688.com" },
      { type: "product", url: "https://detail.1688.com.evil.test/offer/730242606884.html" },
    ])).toEqual([
      { type: "product", url: "https://detail.1688.com/offer/730242606884.html", supplierName: "甲供应商" },
      { type: "store", url: "https://shop123456789.1688.com/", supplierName: "乙供应商" },
    ]);
  });

  it.each(["javascript:alert(1)", "file:///C:/private/a.png", "data:image/png;base64,private", "https://user:secret@cbu01.alicdn.com/a.jpg", "https://cbu01.alicdn.com/a.jpg?access_token=private", "https://cbu01.alicdn.com/a.jpg?capability=private"])("omits unsafe catalog URL %s", (url) => {
    expect(normalizeErpCatalogUrl(url)).toBeNull();
  });
});
