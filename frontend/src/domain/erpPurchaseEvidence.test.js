import { expect, it } from "vitest";
import { normalizeErpCatalogPurchaseEvidence } from "./erpCatalogRequest";
import { buildErpCostBatchEnvelope } from "./erpCostBatchEnvelope";
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

it.each([4, '4', '４'])("excludes observed numeric 1688 cancellation %s before latest-three selection and keeps explicit status through contracts", status => {
  const purchase = { recordId: 'CANCEL', warehouseSku: 'WH', purchaseDate: '2026-08-31 23:59:59', quantity: 100, unitPrice: 99, statusFields: { purchaseStatus: 2, purchaseOrderStatus1688: status } };
  const records = [purchase, ...['2026-08-30', '2026-08-01', '2026-07-01'].map((purchaseDate,index) => ({ recordId: 'R'+index, warehouseSku: 'WH', purchaseDate, quantity: 1, unitPrice: 5, statusFields: { purchaseStatus: 4, paymentStatus: '4', purchaseOrderStatus1688: '2' } })), { ...purchase, recordId: 'FUTURE', purchaseDate: '2026-09-01', statusFields: { purchaseStatus: 4 } }];
  const catalog = normalizeErpCatalogPurchaseEvidence([{ warehouseSku: 'WH', evidenceComplete: true, purchaseRecords: records }]);
  expect(catalog[0].purchaseRecords[0].statusFields).toEqual(purchase.statusFields);
  const batch = buildErpCostBatchEnvelope({ batchId: 'B', workspaceId: 'W', ledgerId: 'L', requestId: 'REQ', platformSkcs: ['SKC'], results: [{ warehouseSku: 'WH', mappings: [{ platformSku: 'SKU', platformSkc: 'SKC' }] }], warehouseEvidence: { warehouses: catalog } });
  expect(batch.warehouseEvidence[0].purchaseRecords[0].statusFields).toEqual(purchase.statusFields);
  const result = calculateWarehouseCostDecision({ warehouseSku: 'WH', period: '2026-08', purchaseRecords: batch.warehouseEvidence[0].purchaseRecords });
  expect(result.formalUnitCost).toBe(5);
  expect(result.selectedRecordIds).toEqual(['R0', 'R1', 'R2']);
  expect(result.purchaseRecords[0]).toMatchObject({ eligible: false, exclusionReasons: ['cancelled_or_closed'] });
  expect(result.purchaseRecords.find(row => row.recordId === 'FUTURE').exclusionReasons).toEqual(['after_ledger_period']);
});

it.each([{ status: '已取消' }, { paymentStatus: '状态：已取消' }, { purchaseStatus: 11 }, { purchaseStatus: '11' }, { orderStatus1688: 4 }, { order1688Status: '4' }])('excludes cancellation evidence %j without inventing missing legacy status', statusFields => {
  const record = { recordId: 'R', warehouseSku: 'WH', purchaseDate: '2026-08-01', quantity: 1, unitPrice: 5 };
  expect(normalizePurchaseEvidenceRecord({ ...record, statusFields }).exclusionReasons).toEqual(['cancelled_or_closed']);
  expect(normalizePurchaseEvidenceRecord(record)).toMatchObject({ eligible: true, statusFields: {}, exclusionReasons: [] });
});
