// Synthetic optional catalog carriers for legacy rows without a registered
// batch. Native purchase-details fields use the transport/end-to-end fixtures.
export function erpProductCatalogFixture(workspaceId = "workspace-default") {
  return {
    workspaceId, platformSku: "SKU-RED", platformSkc: "SKC-CATALOG", warehouseSku: "WH-RED",
    productName: "ERP 多规格收纳盒", imageUrl: "https://images.example.invalid/red.png", attribute: "红色 · 大号",
    unitCost: 4.59, currency: "CNY", publishedAt: "2026-09-01T00:00:00.000Z", evidenceRef: "warehouse:WH-RED",
    catalogQuerySkcs: ["SKC-CATALOG"],
    catalogMappings: [
      { platformSku: "SKU-RED", platformSkc: "SKC-CATALOG", warehouseSku: "WH-RED", productName: "ERP 多规格收纳盒", imageUrl: "https://images.example.invalid/red.png", attribute: "红色 · 大号" },
      { platformSku: "SKU-BLUE", platformSkc: "SKC-CATALOG", warehouseSku: "WH-RED", productName: "ERP 多规格收纳盒", imageUrl: "https://images.example.invalid/red.png", attribute: "蓝色 · 小号" },
    ],
    purchaseRecords: [
      { recordId: "REC-A", warehouseSku: "WH-RED", supplierName: "供应商甲", purchaseOrderNo: "PUR-A", supplier1688Url: "https://detail.1688.com/offer/730242606884.html" },
      { recordId: "REC-B", warehouseSku: "WH-RED", supplierName: "供应商乙", purchaseOrderNo: "PUR-B", supplier1688Url: "https://shop-b.1688.com/" },
      { recordId: "REC-C", warehouseSku: "WH-RED", supplierName: "供应商丙", purchaseOrderNo: "PUR-C" },
    ],
  };
}
