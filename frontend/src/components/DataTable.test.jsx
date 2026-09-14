// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DataTable from "./DataTable";

const data = Array.from({ length: 45 }, (_, index) => ({ id: String(index), name: `商品 ${index + 1}` }));
const columns = [{ accessorKey: "name", header: "商品", cell: (info) => info.getValue() }];

describe("DataTable navigation", () => {
  let container;
  let root;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const render = (paginationResetKey = "all") => act(async () => root.render(<DataTable data={data} columns={columns} paginationResetKey={paginationResetKey} />));

  it("returns only the target list to its beginning after paging and exposes the active page", async () => {
    await render();
    const scrollArea = container.querySelector(".table-wrap");
    const scrollIntoView = vi.fn();
    scrollArea.scrollIntoView = scrollIntoView;
    scrollArea.scrollTop = 240;
    await act(async () => container.querySelector('[aria-label="下一页"]').click());
    expect(container.querySelector("tbody tr").textContent).toBe("商品 21");
    expect(container.querySelector('[aria-current="page"]').textContent).toBe("2");
    expect(scrollArea.scrollTop).toBe(0);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: "auto" });
  });

  it("preserves the page during ordinary rerenders and resets it when the filter scope changes", async () => {
    await render();
    await act(async () => container.querySelector('[aria-label="下一页"]').click());
    await render();
    expect(container.querySelector('[aria-current="page"]').textContent).toBe("2");
    await render("another store");
    expect(container.querySelector('[aria-current="page"]').textContent).toBe("1");
    expect(container.querySelector("tbody tr").textContent).toBe("商品 1");
  });

  it("returns to the first page when sorting and announces its direction", async () => {
    await render();
    await act(async () => container.querySelector('[aria-label="下一页"]').click());
    await act(async () => container.querySelector(".sortable-header").click());
    expect(container.querySelector('[aria-current="page"]').textContent).toBe("1");
    expect(container.querySelector("th").getAttribute("aria-sort")).toBe("ascending");
  });
  it("restores the saved page only after data loads and clamps a changed list without replacing saved scroll", async () => {
    const initialViewState = { pageIndex: 2, sorting: [], scrollTop: 0, scrollLeft: 80, windowScrollY: 420 };
    const tableRef = createRef();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      await act(async () => root.render(<DataTable ref={tableRef} data={[]} dataReady={false} columns={columns} initialViewState={initialViewState} />));
      expect(tableRef.current.getViewState().pageIndex).toBe(2);
      expect(scrollTo).not.toHaveBeenCalled();
      await act(async () => root.render(<DataTable ref={tableRef} data={data.slice(0, 25)} dataReady columns={columns} initialViewState={initialViewState} />));
      expect(container.querySelector('[aria-current="page"]').textContent).toBe("2");
      expect(container.querySelector("tbody tr").textContent).toBe("商品 21");
      expect(container.querySelector(".table-wrap").scrollLeft).toBe(80);
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 420, behavior: "auto" });
      expect(tableRef.current.getViewState().pageIndex).toBe(1);
    } finally { scrollTo.mockRestore(); }
  });

});
