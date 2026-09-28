import { expect, it } from "vitest";
import { normalizePurchaseEvidenceRecord } from "./erpPurchaseEvidence";
import { calculateWarehouseCostDecision } from "./erpCostResolution";

it("retains optional per-purchase catalog evidence through repeated cost reconstruction", () => {
  const purchaseCatalog = { picturesLinking: "https://cbu01.alicdn.com/img/purchase.jpg", pictureLink1688: "https://cbu01.alicdn.com/img/1688.jpg", purchaseSpecificationAndModel1688: "1688白色大号", purchaseProportion1688: "1-1", purchaseOrderDetailId: "DETAIL-1", lineNumber: 0, raw: { token: "discard" } };
  const purchase = { recordId: "R-1", warehouseSku: "WH-1", purchaseDate: "2026-07-01", quantity: 10, unitPrice: 4.59, productName: "采购名称", imageUrl: "https://cbu01.alicdn.com/img/one.jpg", attribute: "红色", purchaseCatalog, supplierName: "甲供应商", supplier1688Url: "https://detail.1688.com/offer/730242606884.html", supplier1688Links: [{ type: "product", url: "https://detail.1688.com/offer/730242606884.html", supplierName: "甲供应商", token: "discard" }], catalogMappings: [{ platformSku: "UNTRUSTED" }], raw: { token: "discard" } };
  const normalized = normalizePurchaseEvidenceRecord(purchase, 0, "WH-1", { period: "2026-08" });
  const decision = calculateWarehouseCostDecision({ warehouseSku: "WH-1", purchaseRecords: [normalized], period: "2026-08" });
  const rebuilt = calculateWarehouseCostDecision({ warehouseSku: "WH-1", purchaseRecords: decision.purchaseRecords, period: "2026-08" });
  expect(rebuilt.formalUnitCost).toBe(4.59);
  expect(rebuilt.purchaseRecords[0]).toMatchObject({ quantity: 10, unitPrice: 4.59, productName: "采购名称", imageUrl: purchase.imageUrl, attribute: "红色", purchaseCatalog: { picturesLinking: purchaseCatalog.picturesLinking, pictureLink1688: purchaseCatalog.pictureLink1688, purchaseSpecificationAndModel1688: "1688白色大号", purchaseProportion1688: "1-1", purchaseOrderDetailId: "DETAIL-1", lineNumber: "0" }, supplierName: "甲供应商", supplier1688Links: [{ type: "product", url: purchase.supplier1688Url, supplierName: "甲供应商" }] });
  expect(rebuilt.purchaseRecords[0]).not.toHaveProperty("catalogMappings");
  expect(JSON.stringify(rebuilt.purchaseRecords)).not.toContain("discard");
  const legacy = normalizePurchaseEvidenceRecord({ recordId: "OLD", warehouseSku: "WH-1", purchaseDate: "2026-07-01", quantity: 1, unitPrice: 4.59 });
  expect(legacy).not.toHaveProperty("imageUrl");
  expect(legacy).not.toHaveProperty("supplier1688Links");
  expect(legacy).not.toHaveProperty("purchaseCatalog");
});
