import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  listPendingCaptureRecords,
  listProductCatalogRecords,
  receiveSelectionCaptureEnvelope,
  saveProductCatalogRecord,
  setActiveMemberContext,
} from "./database";

const envelope = {
  schemaVersion: 1,
  requestId: "selection-capture-test-001",
  source: "1688",
  sourceUrl: "https://detail.1688.com/offer/123456.html",
  capturedAt: Date.parse("2026-08-10T10:00:00.000Z"),
  extractorVersion: "1.2.0",
  product: {
    name: "多规格收纳盒",
    sourceProductId: "123456",
    imageUrl: "https://cbu01.alicdn.com/img/main.jpg",
    purchasePrice: 8,
    shippingFee: 4,
    purchaseQty: 3,
    platformSkc: "",
    skus: [
      { spec: "红色", sourceSkuId: "1688-RED", purchasePrice: 8, imageUrl: "https://cbu01.alicdn.com/img/red.jpg", purchaseQty: 2, lineSubtotal: 16 },
      { spec: "蓝色", sourceSkuId: "1688-BLUE", purchasePrice: 9, imageUrl: "https://cbu01.alicdn.com/img/blue.jpg", purchaseQty: 1, lineSubtotal: 9 },
    ],
  },
  warnings: [{ code: "checkout_total_adjustment", field: "product.skus", message: "存在活动调整" }],
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setActiveMemberContext({ memberId: "sales-a", role: "selection", workspaceId: "workspace-default" });
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("1688 浏览器采集闭环", () => {
  it("maps multiple source SKUs and images into a private pending capture and preserves them on confirmation", async () => {
    const received = await receiveSelectionCaptureEnvelope({
      envelope,
      inboxRecord: { captureId: "SEL-CAP-TEST", deliveryId: "SEL-DELIVERY-TEST" },
    });
    expect(received.status).toBe("accepted");

    let captures = await listPendingCaptureRecords();
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      id: "SEL-CAP-TEST",
      captureMethod: "browser-extension",
      ownerId: "sales-a",
      visibility: "private",
      status: "pending",
      imageUrl: "https://cbu01.alicdn.com/img/main.jpg",
    });
    expect(captures[0].draft.variants).toMatchObject([
      { attribute: "红色", sourceSku: "1688-RED", imageUrl: "https://cbu01.alicdn.com/img/red.jpg", purchaseUnitPrice: 8, purchasePackCount: 2 },
      { attribute: "蓝色", sourceSku: "1688-BLUE", imageUrl: "https://cbu01.alicdn.com/img/blue.jpg", purchaseUnitPrice: 9, purchasePackCount: 1 },
    ]);
    expect(captures[0].warnings[0].code).toBe("checkout_total_adjustment");

    const duplicate = await receiveSelectionCaptureEnvelope({ envelope });
    expect(duplicate.status).toBe("duplicate");
    expect(await listPendingCaptureRecords()).toHaveLength(1);

    const draft = {
      ...captures[0].draft,
      platformSkc: "SKC-BOX-001",
      packageWeight: 0.2,
      variants: captures[0].draft.variants.map((variant, index) => ({
        ...variant,
        platformSku: index === 0 ? "SKU-BOX-RED" : "SKU-BOX-BLUE",
      })),
      suppliers: captures[0].draft.suppliers.map((supplier) => ({
        ...supplier,
        supplierCode: "SUP-1688-001",
        variants: supplier.variants.map((variant, index) => ({
          ...variant,
          platformSku: index === 0 ? "SKU-BOX-RED" : "SKU-BOX-BLUE",
        })),
      })),
    };
    await saveProductCatalogRecord({ captureId: captures[0].id, draft, status: "active", savedBy: "sales-a" });

    const products = await listProductCatalogRecords();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: "多规格收纳盒", platformSkc: "SKC-BOX-001", skuCount: 2, supplierCount: 1 });
    expect(products[0].skus.map((sku) => sku.platformSku).toSorted()).toEqual(["SKU-BOX-BLUE", "SKU-BOX-RED"]);
    expect(products[0].offers.map((offer) => offer.sourceSku).toSorted()).toEqual(["1688-BLUE", "1688-RED"]);
    expect(products[0].offers.map((offer) => offer.purchaseUnitPrice).toSorted()).toEqual([8, 9]);
  });
});
