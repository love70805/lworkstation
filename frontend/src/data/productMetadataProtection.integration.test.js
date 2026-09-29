import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { db, saveProductCatalogRecord, getProductEditorSnapshot, bulkUpdateProductCatalogSalesStatus } from "./database";
import { erpProductCatalogFixture } from "../testFixtures/erpProductCatalog";

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { db.close(); await db.delete(); });
const pricedDraft = () => ({ name: "旧报价商品", platformSkc: "SKC-CATALOG", salesStatus: "pending_review", supplierName: "供应商甲", sourceUrl: "https://detail.1688.com/offer/730242606884.html", shippingAmount: 36, handlingFee: 0.7, packageWeight: 120, englishTitle: "Legacy", salesPlatform: "legacy-platform", variants: [{ platformSku: "SKU-RED", purchaseUnitPrice: 10, purchasePackCount: 6, unitsPerPack: 2 }] });

describe("catalog metadata and quote boundaries", () => {
  it("preserves every old quote byte and hidden fee when editing metadata or adding a SKU", async () => {
    const { product } = await saveProductCatalogRecord({ draft: pricedDraft() });
    const quotes = await db.supplierOffers.toArray();
    expect(quotes[0].landedUnitCost).toBe(8.35);
    await db.erpCostRows.add(erpProductCatalogFixture());
    const { draft } = await getProductEditorSnapshot({ productId: product.id });
    draft.name = "修订后的中文标题";
    draft.productStatus = "on_sale";
    draft.statusEdited = true;
    delete draft.shippingAmount; delete draft.handlingFee; delete draft.packageWeight; delete draft.englishTitle; delete draft.salesPlatform;
    draft.suppliers.forEach(supplier => { delete supplier.shippingAmount; delete supplier.handlingFee; });
    draft.quoteEditIntent = { supplierIds: [] };
    await saveProductCatalogRecord({ productId: product.id, draft });
    expect(await db.supplierOffers.toArray()).toEqual(quotes);
    expect(await db.products.get(product.id)).toMatchObject({ name: draft.name, productStatus: "on_sale", packageWeight: 120, englishTitle: "Legacy", salesPlatform: "legacy-platform" });
    expect((await db.products.get(product.id)).attributes.supplierProfiles[0]).toMatchObject({ shippingAmount: 36, handlingFee: 0.7 });
    expect(await db.platformSkus.count()).toBe(2);
    expect(await db.profitLines.count()).toBe(0);
  });

  it("only explicit quote intent updates that supplier using its retained fees", async () => {
    const { product } = await saveProductCatalogRecord({ draft: pricedDraft() });
    const before = (await db.supplierOffers.toArray())[0];
    const { draft } = await getProductEditorSnapshot({ productId: product.id });
    draft.variants[0].purchaseUnitPrice = 12;
    draft.suppliers[0].variants[0].purchaseUnitPrice = 12;
    draft.quoteEditIntent = { supplierIds: [draft.suppliers[0].supplierId] };
    await saveProductCatalogRecord({ productId: product.id, draft });
    const offers = await db.supplierOffers.toArray();
    expect(offers.find(offer => offer.id === before.id).status).toBe("superseded");
    expect(offers.find(offer => offer.status === "active")).toMatchObject({ shippingAmount: 36, handlingFee: 0.7, landedUnitCost: 9.35 });
  });

  it("keeps user-cleared cover, SKU attribute, and source URL empty after fresh ERP evidence", async () => {
    await db.erpCostRows.add(erpProductCatalogFixture());
    const first = await getProductEditorSnapshot({ platformSku: "SKU-RED" });
    const { product } = await saveProductCatalogRecord({ draft: first.draft });
    const editor = await getProductEditorSnapshot({ productId: product.id });
    editor.draft.imageUrl = "";
    editor.draft.sourceUrl = "";
    editor.draft.suppliers[0].sourceUrl = "";
    editor.draft.fieldEdits = { imageUrl: true, sourceUrl: true, suppliers: { [editor.draft.suppliers[0].supplierId]: { sourceUrl: true } } };
    editor.draft.variants[0].attribute = "";
    await saveProductCatalogRecord({ productId: product.id, draft: editor.draft });
    db.close(); await db.open();
    const reopened = await getProductEditorSnapshot({ productId: product.id });
    expect(reopened.draft.imageUrl).toBe("");
    expect(reopened.draft.sourceUrl).toBe("");
    expect(reopened.draft.variants[0].attribute).toBe("");
    expect(reopened.draft.suppliers[0].sourceUrl).toBe("");
  });

  it("requires explicit conflict exclusion and rejects a concurrent duplicate save", async () => {
    const draft = { name: "正常主体", platformSkc: "SKC-CATALOG", productStatus: "on_sale", variants: [{ platformSku: "SKU-RED" }], identityConflicts: [{ platformSku: "SKU-BLUE", reason: "owned_elsewhere" }] };
    await expect(saveProductCatalogRecord({ draft })).rejects.toThrow("SKU-BLUE");
    draft.excludedIdentitySkus = ["SKU-BLUE"];
    const results = await Promise.allSettled([saveProductCatalogRecord({ draft }), saveProductCatalogRecord({ draft })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.products.count()).toBe(1);
    expect(await db.platformSkus.count()).toBe(1);
  });

  it("relaxes listed bulk updates consistently and keeps old dual states unchanged", async () => {
    const { product } = await saveProductCatalogRecord({ draft: { name: "缺可选资料", platformSkc: "SKC-CATALOG", variants: [{ platformSku: "SKU-RED" }] } });
    const before = await db.products.get(product.id);
    await bulkUpdateProductCatalogSalesStatus({ productIds: [product.id], salesStatus: "on_sale" });
    expect(await db.products.get(product.id)).toMatchObject({ productStatus: "on_sale", salesStatus: before.salesStatus, publicationStatus: before.publicationStatus });
  });
});
