// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductEditor from "./ProductEditor";
import ProductLibrary from "./ProductLibrary";
import { ToastProvider } from "../components/UI";
import { db, saveProductCatalogRecord, createManualCaptureRecord, updateCaptureDraft } from "../data/database";
import { erpProductCatalogFixture } from "../testFixtures/erpProductCatalog";

const delayedWrite = vi.hoisted(() => ({ wait: null, input: null }));
const editorSnapshotOverride = vi.hoisted(() => ({ value: null }));
const catalogRequests = vi.hoisted(() => ({ input: null, registered: false }));
vi.mock("../data/repositories/erpCatalogRepository", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requestErpProductCatalog: async input => { catalogRequests.input = input; return { request: { id: "SYNTHETIC-CATALOG-REQUEST" }, registered: catalogRequests.registered, status: "waiting" }; } };
});
vi.mock("../components/AppShell", () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock("../data/database", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getProductEditorSnapshot: async input => editorSnapshotOverride.value ?? actual.getProductEditorSnapshot(input), saveProductCatalogRecord: async (input) => { delayedWrite.input = input; if (delayedWrite.wait) await delayedWrite.wait; return actual.saveProductCatalogRecord(input); } };
});

let container, root, router;
const draft = { name: "商品 A", platformSkc: "SKC-A", salesStatus: "pending_review", store: "", sourceUrl: "https://detail.1688.com/offer/1.html", variants: [{ platformSku: "SKU-A", attribute: "红色", salePrice: 30, purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }] };
const waitFor = async (predicate) => {
  for (let index = 0; index < 100; index += 1) {
    let result;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); result = await predicate(); });
    if (result) return;
  }
  throw new Error(`Timed out: ${container.textContent}`);
};
const input = (label) => container.querySelector(`[aria-label="${label}"]`);
const button = (name) => [...container.querySelectorAll("button")].find((element) => element.textContent === name);
const change = (element, value) => act(async () => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});
const click = (name) => act(async () => button(name).click());
const mount = async (url, { library = false, initialEntries, initialIndex } = {}) => {
  router = createMemoryRouter([
    { path: "/products/edit", element: <ProductEditor /> },
    { path: "/products", element: library ? <ProductLibrary /> : <p>商品列表</p> },
  ], { initialEntries: initialEntries ?? ["/products", url], initialIndex });
  await act(async () => root.render(<ToastProvider><RouterProvider router={router} /></ToastProvider>));
  await waitFor(() => library && !url.includes("/edit") ? input("搜索待确认采集") : input("商品名称"));
};

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  delayedWrite.wait = null; delayedWrite.input = null; catalogRequests.input = null; catalogRequests.registered = false; editorSnapshotOverride.value = null;
  await db.delete(); await db.open();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  delayedWrite.wait = null;
  await act(async () => root.unmount()); router?.dispose(); container.remove();
  db.close(); await db.delete(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("product editing workflow", () => {
  it("offers newly returned SKUs without overwriting an unsaved manual title", async () => {
    const id = await db.erpCostRows.add(erpProductCatalogFixture());
    await mount("/products/edit?skc=SKC-CATALOG&sku=SKU-RED");
    await change(input("商品名称"), "本次未保存标题");
    const row = await db.erpCostRows.get(id);
    await act(async () => { await db.erpCostRows.update(id, { catalogMappings: [...row.catalogMappings, { ...row.catalogMappings[0], platformSku: "SKU-GREEN", attribute: "绿色" }] }); });
    await waitFor(() => container.querySelectorAll(".variants-table tbody tr").length === 3);
    expect(input("商品名称").value).toBe("本次未保存标题");
    expect(container.querySelectorAll(".variants-table tbody tr")).toHaveLength(3);
    expect(input("商品名称").value).toBe("本次未保存标题");
    await click("保存商品"); await waitFor(async () => await db.platformSkus.count() === 3);
    expect((await db.products.toArray())[0].name).toBe("本次未保存标题");
  });
  it("fills a late image for the same SKU while retaining an unsaved title", async () => {
    const fixture = erpProductCatalogFixture();
    fixture.imageUrl = "";
    fixture.catalogMappings = fixture.catalogMappings.map(mapping => ({ ...mapping, imageUrl: "" }));
    const id = await db.erpCostRows.add(fixture);
    await mount("/products/edit?skc=SKC-CATALOG&sku=SKU-RED");
    await change(input("商品名称"), "手工未保存标题");
    await act(async () => { await db.erpCostRows.update(id, { imageUrl: "https://images.example.invalid/late.png", catalogMappings: fixture.catalogMappings.map(mapping => ({ ...mapping, imageUrl: "https://images.example.invalid/late.png" })) }); });
    await waitFor(() => input("商品图片链接").value === "https://images.example.invalid/late.png");
    expect(input("商品名称").value).toBe("手工未保存标题");
  });
  it("does not request groups whose coverage state is complete", async () => {
    const { product } = await saveProductCatalogRecord({ draft: { name: "已有商品", platformSkc: "SKC-A", variants: [{ platformSku: "SKU-A" }] } });
    editorSnapshotOverride.value = { mode: "product", product, capture: null, draft: { name: "已有商品", platformSkc: "SKC-A", variants: [{ platformSku: "SKU-A" }], suppliers: [], tags: [] }, prefill: { source: "erp", skuCount: 1, warnings: [], sources: [], purchases: [], referencePeriod: "2026-08", catalogCoverage: Object.fromEntries(["directory", "mappings", "images", "suppliers", "purchaseEvidence"].map(group => [group, { state: "complete" }])) } };
    await mount(`/products/edit?product=${product.id}`);
    expect(button("补充 ERP 资料").disabled).toBe(true);
  });

  it("requires a title candidate and explicit identity-branch exclusion, then saves the clear SKU in one step", async () => {
    const conflict = { platformSku: "CONFLICT-SKU", reason: "relationship_conflict" };
    editorSnapshotOverride.value = { mode: "new", product: null, capture: null, draft: { name: "", platformSkc: "SAMPLE-SKC", productStatus: "on_sale", variants: [{ platformSku: "CLEAR-SKU" }], suppliers: [], identityConflicts: [conflict] }, prefill: { source: "erp", skuCount: 1, warnings: [], sources: [], purchases: [], titleCandidates: [{ name: "收腰神器", rawNames: ["1个蓝色收腰神器-HHX sh680"] }, { name: "备用毛巾扣", rawNames: ["备用毛巾扣"] }], needsTitleChoice: true, identityConflicts: [conflict] } };
    await mount("/products/edit?skc=SAMPLE-SKC");
    expect(input("商品名称").value).toBe(""); expect(button("保存商品").disabled).toBe(true);
    await click("收腰神器"); expect(input("商品名称").value).toBe("收腰神器");
    expect(button("保存商品").disabled).toBe(true);
    await click("排除此冲突分支"); expect(button("保存商品").disabled).toBe(false);
    await click("保存商品"); await waitFor(async () => await db.products.count() === 1);
    expect((await db.platformSkus.toArray()).map(row => row.platformSku)).toEqual(["CLEAR-SKU"]);
    expect(delayedWrite.input.draft.excludedIdentitySkus).toEqual(["CONFLICT-SKU"]);
    expect(delayedWrite.input.draft.fieldEdits.name).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("requests optional ERP catalog data for a saved unsold product using an explicit month and keeps registration retryable", async () => {
    const { product } = await saveProductCatalogRecord({ draft: { name: "无销售档案", platformSkc: "UNSOLD-SKC", variants: [{ platformSku: "UNSOLD-SKU" }] } });
    await mount(`/products/edit?product=${product.id}`);
    expect(input("资料采购截止月份").value).toBe("");
    expect(button("补充 ERP 资料").disabled).toBe(true);
    await change(input("资料采购截止月份"), "2026-08"); await click("补充 ERP 资料");
    await waitFor(() => container.textContent.includes("尚未送达 ERP"));
    expect(catalogRequests.input).toMatchObject({ productId: product.id, platformSkcs: ["UNSOLD-SKC"], period: "2026-08" });
    expect(button("重试补充资料").disabled).toBe(false);
    catalogRequests.registered = true; await click("重试补充资料");
    await waitFor(() => container.textContent.includes("资料请求已登记"));
    expect(await db.salesRows.count()).toBe(0);
  });

  it("preserves hidden historical fees and quotations during a metadata-only edit", async () => {
    const { product } = await saveProductCatalogRecord({ draft: { ...draft, imageUrl: "https://images.example.invalid/old.png", shippingAmount: 8, handlingFee: 2, packageWeight: 0.8, englishTitle: "Legacy", supplierCode: "OLD", sourceProductId: "123" } });
    const offers = await db.supplierOffers.toArray();
    await mount(`/products/edit?product=${product.id}`);
    for (const label of ["英文标题", "供应商编号", "1688 商品 ID", "整单运费（CNY）", "单份操作费（CNY）", "包装重量（kg）", "发布平台"]) expect(input(label)).toBeNull();
    expect(container.querySelector(".validation-panel")).toBeNull();
    expect(container.textContent).not.toContain("采购总份数");
    await change(input("商品名称"), "人工标题"); await change(input("商品图片链接"), "");
    await click("保存修改");
    await waitFor(async () => (await db.products.get(product.id)).name === "人工标题");
    expect(await db.supplierOffers.toArray()).toEqual(offers);
    expect(delayedWrite.input.draft.fieldEdits).toMatchObject({ name: true, imageUrl: true });
    expect(delayedWrite.input.draft.quoteEditIntent?.supplierIds ?? []).toEqual([]);
    expect(delayedWrite.input.draft).toMatchObject({ shippingAmount: 8, handlingFee: 2, packageWeight: 0.8, englishTitle: "Legacy" });
  });

  it("asks for one status choice on conflicting historical statuses and retains their raw values", async () => {
    const { product } = await saveProductCatalogRecord({ draft });
    await db.products.update(product.id, { productStatus: null, salesStatus: "on_sale", publicationStatus: "off_shelf" });
    await mount(`/products/edit?product=${product.id}`);
    expect(input("商品状态").value).toBe("");
    expect(button("保存修改").disabled).toBe(true);
    expect((await db.products.get(product.id)).publicationStatus).toBe("off_shelf");
    await change(input("商品状态"), "off_sale");
    expect(button("保存修改").disabled).toBe(false);
    await click("保存修改");
    await waitFor(() => delayedWrite.input?.draft.productStatus === "off_sale");
    expect(delayedWrite.input.draft.statusEdited).toBe(true);
  });

  it("edits a sparse secondary supplier quote by SKU rather than array position", async () => {
    const { product } = await saveProductCatalogRecord({ draft: {
      name: "两仓库商品", platformSkc: "SKC-SPARSE", variants: [{ platformSku: "SKU-A", attribute: "A" }, { platformSku: "SKU-B", attribute: "B" }],
      suppliers: [
        { id: "SUP-A", supplierName: "甲", sourceUrl: "https://shop-a.1688.com/", catalogSource: "erp", variants: [{ platformSku: "SKU-A", purchaseUnitPrice: "", purchasePackCount: 0 }] },
        { id: "SUP-B", supplierName: "乙", sourceUrl: "https://shop-b.1688.com/", catalogSource: "erp", variants: [{ platformSku: "SKU-B", purchaseUnitPrice: "", purchasePackCount: 0 }] },
      ],
    } });
    await mount(`/products/edit?product=${product.id}`);
    await change(input("乙 SKU-B 采购价"), "7");
    await change(input("乙 SKU-B 采购份数"), "2");
    expect(input("乙 SKU-A 采购价").value).toBe("");
    await click("保存修改");
    await waitFor(async () => await db.supplierOffers.count() === 1);
    expect((await db.supplierOffers.toArray())[0]).toMatchObject({ platformSku: "SKU-B", supplierName: "乙", purchaseUnitPrice: 7, landedUnitCost: 7 });
    await act(async () => { await router.navigate("/products"); });
    await act(async () => { await router.navigate(`/products/edit?product=${product.id}`); });
    await waitFor(() => input("乙 SKU-B 采购价")?.value === "7");
    expect(input("第 2 个采购价").value).toBe("");
    const offersBefore = await db.supplierOffers.toArray();
    const savedAt = (await db.products.get(product.id)).updatedAt;
    await click("保存修改");
    await waitFor(async () => (await db.products.get(product.id)).updatedAt !== savedAt);
    expect(await db.supplierOffers.toArray()).toEqual(offersBefore);
  });

  it("clicks establish catalog from ERP references and saves the full multi-SKU draft", async () => {
    await db.erpCostRows.add(erpProductCatalogFixture());
    router = createMemoryRouter([{ path: "/products", element: <ProductLibrary /> }, { path: "/products/edit", element: <ProductEditor /> }], { initialEntries: ["/products?view=reference"] });
    await act(async () => root.render(<ToastProvider><RouterProvider router={router} /></ToastProvider>));
    await waitFor(() => button("建立档案"));
    await click("建立档案");
    await waitFor(() => input("商品名称"));
    expect(input("商品名称").value).toBe("ERP 多规格收纳盒");
    expect(input("商品图片链接").value).toBe("https://images.example.invalid/red.png");
    expect(container.querySelectorAll(".variants-table tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("ERP 档案资料");
    expect(input("第 1 个采购价").value).toBe("");
    expect(input("商品状态").value).toBe("on_sale");
    expect(input("英文标题")).toBeNull(); expect(input("供应商编号")).toBeNull(); expect(input("发布状态")).toBeNull();
    expect(button("确认进入工作台")).toBeUndefined();
    await click("保存商品");
    await waitFor(async () => await db.products.count() === 1);
    expect(await db.platformSkus.count()).toBe(2);
    expect(await db.supplierOffers.count()).toBe(0);
    const product = (await db.products.toArray())[0];
    await act(async () => { await router.navigate(`/products/edit?product=${product.id}`); });
    await waitFor(() => button("保存修改"));
    expect(input("商品名称").value).toBe(product.name);
  });

  it("shows current quote and missing sale price, then persists sequential raw tags", async () => {
    const { product } = await saveProductCatalogRecord({ draft });
    await mount(`/products/edit?product=${product.id}`);
    expect(button("保存修改")).toBeTruthy(); expect(button("保存草稿")).toBeUndefined();
    await change(input("第 1 个采购价"), "20");
    expect(container.querySelector(".variants-table tbody tr").textContent).toContain("¥20.00");
    expect(container.querySelector(".variants-table tbody tr").textContent).toContain("1688 参考");
    expect(container.querySelector(".variants-table tbody tr").textContent).not.toContain("定稿历史");
    await change(input("第 1 个售价"), "");
    expect(container.querySelector(".variants-table tbody tr").textContent).toContain("待填写售价");
    for (const value of ["A", "A,", "A,B"]) await change(input("商品标签"), value);
    expect(input("商品标签").value).toBe("A,B");
    await click("保存修改");
    await waitFor(async () => (await db.products.get(product.id)).tags.length === 2);
    expect((await db.products.get(product.id)).tags).toEqual(["A", "B"]);
    await click("商品管理");
    expect(router.state.location.pathname).toBe("/products");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("protects back/refresh, preserves failed save, and allows continuing or discarding", async () => {
    const { product } = await saveProductCatalogRecord({ draft });
    await mount(`/products/edit?product=${product.id}`);
    await change(input("商品状态"), "on_sale");
    expect(button("保存修改").disabled).toBe(false);
    await change(input("商品名称"), "");
    expect(button("保存修改").disabled).toBe(true);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload); expect(beforeUnload.defaultPrevented).toBe(true);
    await act(async () => { await router.navigate(-1); });
    expect(container.querySelector('[role="dialog"]').textContent).toContain("商品有未保存修改");
    await click("保存后离开");
    await waitFor(() => container.textContent.includes("请先处理商品名称、身份或状态选择"));
    expect(router.state.location.pathname).toBe("/products/edit");
    await click("继续编辑"); expect(input("商品状态").value).toBe("on_sale");
    await click("商品管理"); await click("放弃修改");
    expect(router.state.location.pathname).toBe("/products");
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => input("商品状态"));
    expect(input("商品状态").value).toBe("pending_review");
    await act(async () => { await router.navigate(1); });
    expect(router.state.location.pathname).toBe("/products");
  });

  it("saves before leaving and never marks edits made during a write as saved", async () => {
    const { product } = await saveProductCatalogRecord({ draft });
    await mount(`/products/edit?product=${product.id}`);
    await change(input("商品名称"), "已提交名称");
    let release;
    delayedWrite.wait = new Promise((resolve) => { release = resolve; });
    await click("保存修改");
    await change(input("商品名称"), "写入期间的新名称");
    await act(async () => { release(); }); delayedWrite.wait = null;
    await waitFor(async () => (await db.products.get(product.id)).name === "已提交名称");
    expect(input("商品名称").value).toBe("写入期间的新名称");
    expect(container.querySelector(".editor-titlebar").textContent).toContain("未保存修改");
    await click("商品管理"); await click("保存后离开");
    await waitFor(() => router.state.location.pathname === "/products");
    expect((await db.products.get(product.id)).name).toBe("写入期间的新名称");
  });

  it("returns to the same searched and filtered queue after three capture confirmations", async () => {
    for (let index = 1; index <= 3; index += 1) {
      const capture = await createManualCaptureRecord({ name: `队列商品 ${index}`, sourceUrl: draft.sourceUrl });
      await updateCaptureDraft({ captureId: capture.id, draft: { ...draft, name: `队列商品 ${index}`, variants: [{ ...draft.variants[0], platformSku: `QUEUE-${index}` }] } });
    }
    await mount("/products?view=pending", { library: true, initialEntries: ["/products?view=pending"] });
    await change(input("搜索待确认采集"), "队列商品"); await change(input("队列筛选"), "ready");
    for (let index = 1; index <= 3; index += 1) {
      await waitFor(() => container.querySelectorAll(".queue-item").length === 4 - index);
      await act(async () => container.querySelector('[title="编辑采集记录"]').click());
      await waitFor(() => button("确认进入工作台"));
      await click("确认进入工作台"); await click("确认写入");
      await waitFor(() => input("搜索待确认采集"));
      expect(router.state.location.search).toBe("?view=pending");
      expect(input("搜索待确认采集").value).toBe("队列商品"); expect(input("队列筛选").value).toBe("ready");
    }
    expect(await db.products.count()).toBe(3);
  });

  it("blocks forward navigation to another product and loads its own draft after discard", async () => {
    const { product: first } = await saveProductCatalogRecord({ draft });
    const { product: second } = await saveProductCatalogRecord({ draft: { ...draft, name: "商品 B", variants: [] } });
    const firstUrl = `/products/edit?product=${first.id}`;
    await mount(firstUrl, { initialEntries: [firstUrl, `/products/edit?product=${second.id}`], initialIndex: 0 });
    await change(input("商品名称"), "未保存的 A");
    await act(async () => { await router.navigate(1); });
    expect(input("商品名称").value).toBe("未保存的 A");
    await click("放弃修改"); await waitFor(() => input("商品名称")?.value === "商品 B");
    expect((await db.products.get(first.id)).name).toBe("商品 A");
  });

  it("retains a new product identity if more input arrives during its first draft save", async () => {
    await mount("/products/edit");
    await change(input("商品名称"), "新建草稿");
    let release;
    delayedWrite.wait = new Promise((resolve) => { release = resolve; });
    await click("保存草稿"); await change(input("商品标签"), "保存期间输入");
    await act(async () => release()); delayedWrite.wait = null;
    await waitFor(async () => await db.products.count() === 1);
    expect(input("商品标签").value).toBe("保存期间输入");
    expect(container.querySelector(".editor-titlebar").textContent).toContain("未保存修改");
    await click("保存草稿");
    await waitFor(() => router.state.location.search.includes("product="));
    expect(await db.products.count()).toBe(1);
    expect((await db.products.toArray())[0].tags).toEqual(["保存期间输入"]);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
