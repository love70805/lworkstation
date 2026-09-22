// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductLibrary from "./ProductLibrary";
import AppRouteError from "../components/AppRouteError";
import { ToastProvider } from "../components/UI";
import { db, saveProductCatalogRecord, createManualCaptureRecord } from "../data/database";

const faults = vi.hoisted(() => ({ catalog: false, reference: false, capture: false, context: false, wait: null }));
vi.mock("../components/AppShell", () => ({ default: ({ children }) => <main data-testid="shell">{children}</main> }));
vi.mock("../data/database", async (importOriginal) => {
  const actual = await importOriginal();
  const read = (key, fn) => async (...args) => {
    if (key === "catalog" && faults.wait) await faults.wait;
    if (faults[key]) throw Error(`合成 ${key} 读取失败`);
    return fn(...args);
  };
  return { ...actual, listProductCatalogRecords: read("catalog", actual.listProductCatalogRecords), getSelectionReferenceSnapshot: read("reference", actual.getSelectionReferenceSnapshot), listPendingCaptureRecords: read("capture", actual.listPendingCaptureRecords), getActiveMemberContext: read("context", actual.getActiveMemberContext) };
});

let container, root, router;
const draft = { name: "恢复验收商品", platformSkc: "RECOVERY-SKC", store: "甲店", salesStatus: "pending_review", sourceUrl: "https://detail.1688.com/offer/1.html", variants: [{ platformSku: "RECOVERY-SKU", attribute: "红", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1, salePrice: 30 }] };
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    let ok; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); ok = await predicate(); });
    if (ok) return;
  }
  throw Error(`Timed out: ${container.textContent}`);
};
const field = label => container.querySelector(`[aria-label="${label}"]`);
const button = name => [...container.querySelectorAll("button")].find(item => item.textContent === name);
const change = async (label, value) => act(async () => {
  const el = field(label), prototype = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});
const mount = async (url = "/products") => {
  router = createMemoryRouter([{ path: "/products", element: <ProductLibrary />, errorElement: <AppRouteError /> }], { initialEntries: [url] });
  await act(async () => root.render(<ToastProvider><RouterProvider router={router} /></ToastProvider>));
};
const retry = async () => act(async () => button("重试读取").click());

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(faults, { catalog: false, reference: false, capture: false, context: false, wait: null });
  localStorage.clear(); await db.delete(); await db.open();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); router?.dispose(); container.remove();
  db.close(); await db.delete(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("selection read recovery", () => {
  it("keeps catalog filters during loading, failed read and successful retry", async () => {
    await saveProductCatalogRecord({ draft });
    let release; faults.wait = new Promise(resolve => { release = resolve; }); faults.catalog = true;
    await mount(); await waitFor(() => container.textContent.includes("正在读取商品档案"));
    await waitFor(() => field("按选品状态筛选").querySelector('option[value="pending_review"]'));
    expect(container.textContent).not.toContain("没有符合当前筛选条件的商品");
    await change("搜索商品档案", "恢复验收"); await change("按选品状态筛选", "pending_review");
    await act(async () => release()); faults.wait = null;
    await waitFor(() => container.textContent.includes("商品档案读取失败"));
    expect(container.querySelector('[data-testid="shell"]')).not.toBeNull();
    expect(container.textContent).not.toContain("页面暂时无法读取");
    expect(container.textContent).not.toContain("没有符合当前筛选条件的商品");
    expect(field("搜索商品档案").value).toBe("恢复验收"); expect(field("按选品状态筛选").value).toBe("pending_review");
    faults.catalog = false; await retry(); await waitFor(() => container.querySelector(".product-table")?.textContent.includes(draft.name));
    expect(field("搜索商品档案").value).toBe("恢复验收"); expect(field("按选品状态筛选").value).toBe("pending_review");
  });

  it("keeps the queue search and filter after a live read fails, and recovers its tab count together", async () => {
    const capture = await createManualCaptureRecord({ name: "恢复采集", sourceUrl: draft.sourceUrl });
    await mount("/products?view=pending"); await waitFor(() => container.querySelectorAll(".queue-item").length === 1);
    await change("搜索待确认采集", "恢复采集"); await change("队列筛选", "ready");
    faults.capture = true;
    await act(async () => { await db.captures.update(capture.id, { updatedAt: new Date().toISOString() }); });
    await waitFor(() => container.textContent.includes("待确认采集读取失败"));
    expect(container.textContent).not.toContain("待确认队列为空");
    expect(button("确认全部有效项").disabled).toBe(true);
    expect(field("搜索待确认采集").value).toBe("恢复采集"); expect(field("队列筛选").value).toBe("ready");
    faults.capture = false; await retry(); await waitFor(() => container.querySelectorAll(".queue-item").length === 1);
    expect(field("队列筛选").value).toBe("ready");
    expect(container.querySelector('[role="tab"][aria-selected="true"] small').textContent).toBe("1");
  });

  it("does not render an empty reference view when reference loading fails", async () => {
    await saveProductCatalogRecord({ draft }); faults.reference = true;
    await mount("/products?view=reference"); await waitFor(() => container.textContent.includes("成本与利润参考读取失败"));
    expect(container.textContent).not.toContain("还没有选品经营参考");
    await change("搜索选品参考", "RECOVERY-SKU");
    faults.reference = false; await retry(); await waitFor(() => container.querySelector(".selection-reference-table"));
    expect(field("搜索选品参考").value).toBe("RECOVERY-SKU");
  });

  it("retries member context before opening the product page", async () => {
    faults.context = true; await mount(); await waitFor(() => container.textContent.includes("选品工作区读取失败"));
    faults.context = false; await retry(); await waitFor(() => field("搜索商品档案"));
  });

  it("provides Chinese reload and home actions for unexpected route errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const Broken = () => { throw Error("合成页面异常"); };
    router = createMemoryRouter([{ path: "*", element: <Broken />, errorElement: <AppRouteError /> }]);
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(container.textContent).toContain("页面暂时无法读取");
    expect(container.textContent).not.toContain("Unexpected Application Error");
    expect(container.querySelector('a[href="/workspace"]').textContent).toBe("返回经营概览");
    await act(async () => button("重新加载页面").click()); expect(reload).toHaveBeenCalledOnce();
  });
});
