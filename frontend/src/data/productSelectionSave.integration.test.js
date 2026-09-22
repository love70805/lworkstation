import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, saveProductCatalogRecord, getProductEditorSnapshot, bulkUpdateProductCatalogSalesStatus, getSelectionStatusDefinitions, saveSelectionStatusDefinitions, createManualCaptureRecord, updateCaptureDraft, listProductCatalogRecords, listPendingCaptureRecords } from "./database";

const makeDraft = (suffix = "A") => ({ name: `商品 ${suffix}`, platformSkc: `SKC-${suffix}`, salesStatus: "pending_review", store: "甲店", sourceUrl: "https://detail.1688.com/offer/1.html", variants: [{ platformSku: `SKU-${suffix}`, attribute: "红色", salePrice: 30, purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }] });
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { db.close(); await db.delete(); });

describe("selection save authority", () => {
  it("rejects an explicit workspace change without moving any product or capture data", async () => {
    const { product } = await saveProductCatalogRecord({ draft: makeDraft() });
    const before = await db.auditEvents.count();
    await expect(saveProductCatalogRecord({ productId: product.id, workspaceId: "other-workspace", draft: makeDraft() })).rejects.toThrow("当前工作区");
    await expect(saveProductCatalogRecord({ workspaceId: "other-workspace", draft: makeDraft("NEW") })).rejects.toThrow("当前工作区");
    expect((await db.products.get(product.id)).workspaceId).toBe(product.workspaceId);
    expect(await db.products.count()).toBe(1);
    expect((await db.platformSkus.toArray()).every(sku => sku.workspaceId === product.workspaceId)).toBe(true);
    expect(await db.auditEvents.count()).toBe(before);
    await expect(saveProductCatalogRecord({ productId: product.id, workspaceId: product.workspaceId, draft: makeDraft() })).resolves.toMatchObject({ product: { workspaceId: product.workspaceId } });
  });
  it("allows incomplete new drafts but validates any save of an existing active record", async () => {
    const draft = { ...makeDraft(), store: "" };
    const { product } = await saveProductCatalogRecord({ draft, status: "active" });
    const before = await db.auditEvents.count();
    await expect(saveProductCatalogRecord({ productId: product.id, draft: { ...draft, salesStatus: "on_sale" }, status: "draft" })).rejects.toThrow("商品 A：未分配店铺");
    expect(await db.products.get(product.id)).toMatchObject({ status: "active", salesStatus: "pending_review" });
    expect(await db.auditEvents.count()).toBe(before);
    await expect(saveProductCatalogRecord({ draft: { name: "待补草稿", salesStatus: "on_sale" }, status: "draft" })).resolves.toMatchObject({ product: { status: "draft" } });
    await expect(saveProductCatalogRecord({ productId: product.id, draft: { ...makeDraft(), salesStatus: "on_sale" }, status: "draft" })).resolves.toMatchObject({ product: { status: "active", salesStatus: "on_sale" } });
  });
  it("validates all products before a custom readiness batch writes anything", async () => {
    const [{ product: good }, { product: bad }] = await Promise.all([
      saveProductCatalogRecord({ draft: makeDraft("GOOD") }),
      saveProductCatalogRecord({ draft: { ...makeDraft("BAD"), store: "" } }),
    ]);
    await saveSelectionStatusDefinitions({ definitions: [...await getSelectionStatusDefinitions(), { id: "custom-ready", label: "待发布", requiresReadiness: true }] });
    await expect(bulkUpdateProductCatalogSalesStatus({ productIds: [good.id, bad.id], salesStatus: "custom-ready" })).rejects.toThrow("商品 BAD：未分配店铺");
    expect((await db.products.bulkGet([good.id, bad.id])).map((product) => product.salesStatus)).toEqual(["pending_review", "pending_review"]);
    expect((await db.auditEvents.toArray()).filter((event) => event.action === "product_sales_status_bulk_updated")).toHaveLength(0);
    await saveProductCatalogRecord({ productId: bad.id, draft: makeDraft("BAD") });
    await expect(bulkUpdateProductCatalogSalesStatus({ productIds: [good.id, bad.id], salesStatus: "custom-ready" })).resolves.toHaveLength(2);
  });
  it("does not use saved supplier costs to bypass a missing current quotation", async () => {
    const { product } = await saveProductCatalogRecord({ draft: makeDraft() });
    const { draft } = await getProductEditorSnapshot({ productId: product.id });
    draft.salesStatus = "on_sale";
    draft.variants[0].purchaseUnitPrice = "";
    draft.suppliers[0].variants[0].purchaseUnitPrice = "";
    await expect(saveProductCatalogRecord({ productId: product.id, draft })).rejects.toThrow("缺少可用参考成本");
    expect((await db.supplierOffers.toArray()).filter((offer) => offer.status !== "superseded")[0].landedUnitCost).toBe(10);
  });
  it("keeps a capture pending when formal entry fails readiness", async () => {
    const capture = await createManualCaptureRecord({ name: "采集草稿", sourceUrl: "https://detail.1688.com/offer/1.html" });
    const draft = { ...makeDraft(), salesStatus: "on_sale", store: "" };
    await updateCaptureDraft({ captureId: capture.id, draft });
    const queued = (await listPendingCaptureRecords()).find(item => item.id === capture.id);
    expect(queued.validation.valid).toBe(false);
    expect(queued.readinessMessages).toContain('未分配店铺');
    await expect(saveProductCatalogRecord({ captureId: capture.id, draft, status: "active" })).rejects.toThrow("未分配店铺");
    expect((await db.captures.get(capture.id)).status).not.toBe("confirmed");
    expect(await db.products.count()).toBe(0);
  });
  it("persists zero and tags while keeping absent price and reference profit missing", async () => {
    const zero = makeDraft("ZERO"); zero.variants[0].salePrice = "0"; zero.tags = "A,B，A";
    const blank = makeDraft("BLANK"); blank.variants[0].salePrice = "";
    await saveProductCatalogRecord({ draft: zero });
    await saveProductCatalogRecord({ draft: blank });
    const products = await listProductCatalogRecords();
    expect(products.find((product) => product.name === "商品 ZERO")).toMatchObject({ tags: ["A", "B"], skuReferences: [{ salePrice: 0, referenceUnitProfit: -10.7 }] });
    expect(products.find((product) => product.name === "商品 BLANK").skuReferences[0]).toMatchObject({ salePrice: null, referenceUnitProfit: null });
  });
});
