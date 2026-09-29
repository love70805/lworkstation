import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, saveProductCatalogRecord, getProductEditorSnapshot, bulkUpdateProductCatalogSalesStatus, getSelectionStatusDefinitions, saveSelectionStatusDefinitions, createManualCaptureRecord, updateCaptureDraft, listProductCatalogRecords, listPendingCaptureRecords } from "./database";

const makeDraft = (suffix = "A") => ({ name: `商品 ${suffix}`, platformSkc: `SKC-${suffix}`, salesStatus: "pending_review", store: "甲店", sourceUrl: "https://detail.1688.com/offer/1.html", variants: [{ platformSku: `SKU-${suffix}`, attribute: "红色", salePrice: 30, purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }] });
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { db.close(); await db.delete(); });

const snapshotAllTables = () => Promise.all(db.tables.map(table => table.toArray()));

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

  it("permits optional gaps but atomically blocks a listed record missing name, SKC, or SKU", async () => {
    const draft = { ...makeDraft(), store: "", imageUrl: "", sourceUrl: "", variants: [{ platformSku: "SKU-A" }] };
    const { product } = await saveProductCatalogRecord({ draft, status: "active" });
    const listed = { ...draft, productStatus: "on_sale" };
    await expect(saveProductCatalogRecord({ productId: product.id, draft: listed, status: "draft" })).resolves.toMatchObject({ product: { status: "active", productStatus: "on_sale", salesStatus: "pending_review" } });
    for (const [change, reason] of [
      [{ name: "" }, "商品名称不能为空"],
      [{ platformSkc: "" }, "缺少平台 SKC"],
      [{ variants: [{ platformSku: "" }] }, "至少填写一个平台 SKU"],
    ]) {
      const before = await snapshotAllTables();
      await expect(saveProductCatalogRecord({ productId: product.id, draft: { ...listed, ...change }, status: "draft" })).rejects.toThrow(reason);
      expect(await snapshotAllTables()).toEqual(before);
    }
    await expect(saveProductCatalogRecord({ draft: { name: "待补草稿", salesStatus: "pending_review" }, status: "draft" })).resolves.toMatchObject({ product: { status: "draft" } });
  });

  it("validates every minimum identity before a custom readiness batch writes anything", async () => {
    const [{ product: good }, { product: bad }] = await Promise.all([
      saveProductCatalogRecord({ draft: makeDraft("GOOD") }),
      saveProductCatalogRecord({ draft: { ...makeDraft("BAD"), platformSkc: "", store: "" } }),
    ]);
    await saveSelectionStatusDefinitions({ definitions: [...await getSelectionStatusDefinitions(), { id: "custom-ready", label: "待发布", requiresReadiness: true }] });
    const before = await snapshotAllTables();
    await expect(bulkUpdateProductCatalogSalesStatus({ productIds: [good.id, bad.id], salesStatus: "custom-ready" })).rejects.toThrow("商品 BAD：缺少平台 SKC");
    expect(await snapshotAllTables()).toEqual(before);
    expect((await db.products.bulkGet([good.id, bad.id])).map(product => product.productStatus)).toEqual(["pending_review", "pending_review"]);
    expect((await db.auditEvents.toArray()).filter(event => event.action === "product_sales_status_bulk_updated")).toHaveLength(0);
    await saveProductCatalogRecord({ productId: bad.id, draft: { ...makeDraft("BAD"), store: "" } });
    await expect(bulkUpdateProductCatalogSalesStatus({ productIds: [good.id, bad.id], salesStatus: "custom-ready" })).resolves.toHaveLength(2);
    const saved = await db.products.bulkGet([good.id, bad.id]);
    expect(saved.map(product => product.productStatus)).toEqual(["custom-ready", "custom-ready"]);
    expect(saved.map(product => product.salesStatus)).toEqual(["pending_review", "pending_review"]);
  });

  it("saves listed metadata without an editable quotation while preserving old quote identity", async () => {
    const { product } = await saveProductCatalogRecord({ draft: makeDraft() });
    const oldQuotes = await db.supplierOffers.toArray();
    const { draft } = await getProductEditorSnapshot({ productId: product.id });
    draft.productStatus = "on_sale";
    draft.variants[0].purchaseUnitPrice = "";
    draft.suppliers[0].variants[0].purchaseUnitPrice = "";
    await expect(saveProductCatalogRecord({ productId: product.id, draft })).resolves.toMatchObject({ product: { productStatus: "on_sale" } });
    expect(await db.supplierOffers.toArray()).toEqual(oldQuotes);
  });

  it("keeps a capture pending when its minimum formal identity is absent", async () => {
    const capture = await createManualCaptureRecord({ name: "采集草稿", sourceUrl: "https://detail.1688.com/offer/1.html" });
    const draft = { ...makeDraft(), productStatus: "on_sale", salesStatus: "on_sale", platformSkc: "", store: "" };
    await updateCaptureDraft({ captureId: capture.id, draft });
    const queued = (await listPendingCaptureRecords()).find(item => item.id === capture.id);
    expect(queued.validation.valid).toBe(false);
    expect(queued.readinessMessages).toContain("缺少平台 SKC");
    expect(queued.readinessMessages).not.toContain("未分配店铺");
    const before = await snapshotAllTables();
    await expect(saveProductCatalogRecord({ captureId: capture.id, draft, status: "active" })).rejects.toThrow("缺少平台 SKC");
    expect(await snapshotAllTables()).toEqual(before);
    expect((await db.captures.get(capture.id)).status).not.toBe("confirmed");
    expect(await db.products.count()).toBe(0);
    await expect(saveProductCatalogRecord({ captureId: capture.id, draft: { ...draft, platformSkc: "SKC-A" }, status: "active" })).resolves.toMatchObject({ product: { productStatus: "on_sale", store: "" } });
    expect((await db.captures.get(capture.id)).status).toBe("confirmed");
  });

  it("persists zero and tags while keeping absent price and reference profit missing", async () => {
    const zero = makeDraft("ZERO"); zero.variants[0].salePrice = "0"; zero.tags = "A,B，A";
    const blank = makeDraft("BLANK"); blank.variants[0].salePrice = "";
    await saveProductCatalogRecord({ draft: zero });
    await saveProductCatalogRecord({ draft: blank });
    const products = await listProductCatalogRecords();
    expect(products.find(product => product.name === "商品 ZERO")).toMatchObject({ tags: ["A", "B"], skuReferences: [{ salePrice: 0, referenceUnitProfit: -10.7 }] });
    expect(products.find(product => product.name === "商品 BLANK").skuReferences[0]).toMatchObject({ salePrice: null, referenceUnitProfit: null });
  });
});
