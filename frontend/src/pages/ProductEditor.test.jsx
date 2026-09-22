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

const delayedWrite = vi.hoisted(() => ({ wait: null }));
vi.mock("../components/AppShell", () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock("../data/database", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, saveProductCatalogRecord: async (input) => { if (delayedWrite.wait) await delayedWrite.wait; return actual.saveProductCatalogRecord(input); } };
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
  delayedWrite.wait = null;
  await db.delete(); await db.open();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  delayedWrite.wait = null;
  await act(async () => root.unmount()); router?.dispose(); container.remove();
  db.close(); await db.delete(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("product editing workflow", () => {
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
    await change(input("选品状态"), "on_sale");
    expect(button("保存修改").disabled).toBe(true);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload); expect(beforeUnload.defaultPrevented).toBe(true);
    await act(async () => { await router.navigate(-1); });
    expect(container.querySelector('[role="dialog"]').textContent).toContain("商品有未保存修改");
    await click("保存后离开");
    await waitFor(() => container.textContent.includes("保存失败：商品 A：未分配店铺"));
    expect(router.state.location.pathname).toBe("/products/edit");
    await click("继续编辑"); expect(input("选品状态").value).toBe("on_sale");
    await click("商品管理"); await click("放弃修改");
    expect(router.state.location.pathname).toBe("/products");
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => input("选品状态"));
    expect(input("选品状态").value).toBe("pending_review");
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
