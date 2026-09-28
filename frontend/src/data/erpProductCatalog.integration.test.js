import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getProductEditorSnapshot, getSelectionReferenceSnapshot, listProductCatalogRecords, saveProductCatalogRecord, setActiveMemberContext, createWorkspaceBackupPayload, restoreWorkspaceBackupPayload } from "./database";
import { buildSelectionReferenceRows, groupSelectionReferenceRows } from "../lib/selectionReferences";
import { erpProductCatalogFixture } from "../testFixtures/erpProductCatalog";

beforeEach(async () => { await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId: "workspace-default" }); });
afterEach(async () => { db.close(); await db.delete(); });

describe("ERP catalog draft projection", () => {
  it("prefills all SKC SKUs from ERP without ledger data, persists and reopens without quoting aggregate cost", async () => {
    const source = erpProductCatalogFixture();
    await db.erpCostRows.add(source);
    const references = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(groupSelectionReferenceRows(references)).toMatchObject([{ platformSkc: "SKC-CATALOG", skuCount: 2, productName: source.productName }]);
    expect(references.find(row => row.platformSku === "SKU-BLUE").referenceUnitCost).toBeNull();
    const editor = await getProductEditorSnapshot({ platformSku: "SKU-RED", platformSkc: "SKC-CATALOG", productName: "未建立商品档案" });
    expect(editor.draft).toMatchObject({ name: source.productName, imageUrl: source.imageUrl, platformSkc: "SKC-CATALOG" });
    expect(editor.draft.variants.map(item => [item.platformSku, item.attribute]).sort()).toEqual([["SKU-BLUE", "蓝色 · 小号"], ["SKU-RED", "红色 · 大号"]]);
    expect(editor.draft.suppliers.map(item => [item.supplierName, item.sourceUrlKind, item.sourceUrl])).toEqual([
      ["供应商甲", "product", "https://detail.1688.com/offer/730242606884.html"], ["供应商乙", "store", "https://shop-b.1688.com/"], ["供应商丙", null, ""],
    ]);
    expect(editor.draft.suppliers.every(item => item.variants.every(variant => variant.purchaseUnitPrice === ""))).toBe(true);
    expect(await db.products.count()).toBe(0);
    const { product } = await saveProductCatalogRecord({ draft: editor.draft });
    const erpBefore = await db.erpCostRows.toArray();
    db.close(); await db.open();
    const reopened = await getProductEditorSnapshot({ productId: product.id });
    expect(reopened.draft.variants).toHaveLength(2);
    expect(reopened.draft.suppliers.map(item => [item.supplierName, item.sourceUrlKind, item.catalogSource])).toEqual([["供应商甲", "product", "erp"], ["供应商乙", "store", "erp"], ["供应商丙", null, "erp"]]);
    expect(await db.supplierOffers.count()).toBe(0);
    expect(await db.erpCostRows.toArray()).toEqual(erpBefore);
    expect(await db.salesRows.count()).toBe(0);
    expect(await db.profitLines.count()).toBe(0);
    const catalog = await listProductCatalogRecords();
    expect(catalog).toMatchObject([{ name: source.productName, skuCount: 2 }]);
    expect(catalog[0].skuReferences.find(item => item.platformSku === "SKU-RED").unitCost).toBe(4.59);
    const linked = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(linked.every(item => item.productId === product.id)).toBe(true);
  });

  it("deduplicates repeated mappings, rejects foreign warehouse/query relationships and workspace evidence", async () => {
    const fixture = erpProductCatalogFixture();
    fixture.catalogMappings.push({ ...fixture.catalogMappings[0] }, { ...fixture.catalogMappings[1], platformSku: "OTHER-WH", warehouseSku: "OTHER" }, { ...fixture.catalogMappings[1], platformSku: "OUTSIDE", platformSkc: "OUTSIDE" });
    await db.erpCostRows.bulkAdd([fixture, { ...erpProductCatalogFixture("workspace-other"), platformSku: "PRIVATE", platformSkc: "SKC-CATALOG", productName: "外部资料" }]);
    const snapshot = await getProductEditorSnapshot({ platformSku: "SKU-RED" });
    expect(snapshot.draft.variants).toHaveLength(2);
    expect(snapshot.draft.name).toBe(fixture.productName);
    await setActiveMemberContext({ workspaceId: "workspace-empty" });
    const other = await getProductEditorSnapshot({ platformSku: "SKU-RED" });
    expect(other.draft.name).toBe("");
    expect(other.prefill.source).toBeNull();
  });

  it("retains conflicting evidence and leaves disputed SKC/name/image/attribute empty instead of choosing a purchase", async () => {
    const fixture = erpProductCatalogFixture();
    fixture.catalogQuerySkcs.push("SKC-CONFLICT");
    fixture.catalogMappings.push({ ...fixture.catalogMappings[0], platformSkc: "SKC-CONFLICT", productName: "另一商品", imageUrl: "https://images.example.invalid/other.png", attribute: "另一属性" });
    await db.erpCostRows.add(fixture);
    const snapshot = await getProductEditorSnapshot({ platformSku: "SKU-RED", platformSkc: "SKC-CATALOG", productName: "未建立商品档案" });
    expect(snapshot.draft).toMatchObject({ name: "", imageUrl: "", platformSkc: "" });
    expect(snapshot.draft.variants).toMatchObject([{ platformSku: "SKU-RED", attribute: "" }]);
    expect(snapshot.prefill.warnings.join(" ")).toContain("SKC 来源有冲突");
    expect(snapshot.prefill.conflicts.find(item => item.field === "platformSkc").candidates).toHaveLength(2);
  });

  it("keeps same-SKU mappings outside the query as blocking relationship evidence", async () => {
    const fixture = erpProductCatalogFixture();
    fixture.catalogMappings.push({ ...fixture.catalogMappings[0], platformSkc: "SKC-OUTSIDE" });
    await db.erpCostRows.add(fixture);
    const snapshot = await getProductEditorSnapshot({ platformSku: "SKU-RED", platformSkc: "SKC-CATALOG" });
    expect(snapshot.draft.platformSkc).toBe("");
    expect(snapshot.draft.variants).toHaveLength(1);
    expect(snapshot.prefill.warnings.join(" ")).toContain("超出查询范围");
    expect(snapshot.prefill.sources.some(item => item.trusted === false && item.platformSkc === "SKC-OUTSIDE")).toBe(true);
  });

  it("opens the existing catalog, retains manual values and adds only unowned same-SKC branches", async () => {
    const { product } = await saveProductCatalogRecord({ draft: { name: "人工商品名", platformSkc: "SKC-CATALOG", imageUrl: "https://images.example.invalid/manual.png", sourceUrl: "https://detail.1688.com/offer/730242606884.html", supplierName: "人工供应商名称", variants: [{ platformSku: "SKU-RED", attribute: "人工属性", salePrice: 30 }] } });
    await db.erpCostRows.add(erpProductCatalogFixture());
    const snapshot = await getProductEditorSnapshot({ platformSku: "SKU-BLUE", platformSkc: "SKC-CATALOG" });
    expect(snapshot.product.id).toBe(product.id);
    expect(snapshot.draft).toMatchObject({ name: "人工商品名", imageUrl: "https://images.example.invalid/manual.png", supplierName: "人工供应商名称" });
    expect(snapshot.draft.variants.find(item => item.platformSku === "SKU-RED")).toMatchObject({ attribute: "人工属性", salePrice: 30 });
    expect(snapshot.draft.variants.find(item => item.platformSku === "SKU-BLUE")).toMatchObject({ attribute: "蓝色 · 小号" });
    expect(await db.products.count()).toBe(1);
    await saveProductCatalogRecord({ productId: product.id, draft: snapshot.draft });
    expect(await db.products.count()).toBe(1);
    expect(await db.platformSkus.count()).toBe(2);
  });

  it("excludes branches owned elsewhere and never saves placeholder product names", async () => {
    await saveProductCatalogRecord({ draft: { name: "另一个档案", platformSkc: "OTHER-SKC", variants: [{ platformSku: "SKU-BLUE", attribute: "已有属性" }] } });
    await db.erpCostRows.add(erpProductCatalogFixture());
    const snapshot = await getProductEditorSnapshot({ platformSku: "SKU-RED" });
    expect(snapshot.draft.variants.map(item => item.platformSku)).toEqual(["SKU-RED"]);
    expect(snapshot.prefill.warnings.join(" ")).toContain("已属于其他商品");
    await expect(saveProductCatalogRecord({ draft: { name: "未建立商品档案" } })).rejects.toThrow("占位文字");
  });

  it("does not fill a different product ID into an explicit manual supplier URL with the same name", async () => {
    const { product } = await saveProductCatalogRecord({ draft: { name: "人工档案", platformSkc: "SKC-CATALOG", supplierName: "供应商甲", sourceUrl: "https://detail.1688.com/offer/999999999999.html", variants: [{ platformSku: "SKU-RED" }] } });
    await db.erpCostRows.add(erpProductCatalogFixture());
    const snapshot = await getProductEditorSnapshot({ productId: product.id });
    expect(snapshot.draft.sourceUrl).toBe("https://detail.1688.com/offer/999999999999.html");
    expect(snapshot.draft.sourceProductId).toBe("");
    expect(snapshot.draft.suppliers[0].sourceProductId).toBe("");
  });

  it("does not turn unpaired legacy supplier summaries into paired catalog links", async () => {
    const fixture = erpProductCatalogFixture();
    delete fixture.purchaseRecords;
    fixture.supplierName = "最新笔无链接的甲";
    fixture.supplier1688Url = "https://older-b.1688.com/";
    await db.erpCostRows.add(fixture);
    const snapshot = await getProductEditorSnapshot({ platformSku: "SKU-RED" });
    expect(snapshot.draft.suppliers).toMatchObject([{ supplierName: fixture.supplierName, sourceUrl: "" }]);
    expect(snapshot.prefill.sources[0].supplierSummary).toMatchObject({ samePurchaseVerified: false, link: { url: fixture.supplier1688Url } });
  });

  it("keeps missing fields blank, does not pair suppliers across purchases, and survives a backup round trip", async () => {
    const fixture = erpProductCatalogFixture();
    delete fixture.imageUrl; delete fixture.attribute;
    fixture.catalogMappings.forEach(item => { delete item.imageUrl; delete item.attribute; });
    fixture.supplierName = "错误汇总名称"; fixture.supplier1688Url = "https://wrong.1688.com/";
    await db.erpCostRows.add(fixture);
    const snapshot = await getProductEditorSnapshot({ platformSku: "SKU-RED" });
    expect(snapshot.draft.imageUrl).toBe("");
    expect(snapshot.draft.variants.every(item => !item.attribute && !item.imageUrl)).toBe(true);
    expect(snapshot.draft.suppliers.some(item => item.supplierName === "错误汇总名称" || item.sourceUrl === fixture.supplier1688Url)).toBe(false);
    const { product } = await saveProductCatalogRecord({ draft: snapshot.draft });
    const backup = await createWorkspaceBackupPayload();
    await db.delete(); await db.open();
    await restoreWorkspaceBackupPayload(backup);
    const reopened = await getProductEditorSnapshot({ productId: product.id });
    expect(reopened.draft.suppliers.map(item => item.sourceRecords.map(source => source.recordId))).toEqual([["REC-A", "REC-A"], ["REC-B", "REC-B"], ["REC-C", "REC-C"]]);
    expect(reopened.draft.variants).toHaveLength(2);
    expect(await db.supplierOffers.count()).toBe(0);
  });
});
