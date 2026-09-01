import { describe, expect, it } from "vitest";
import { createToastState, dismissToast, enqueueToast, normalizeAppearance, toggleAppearance } from "./uiState";

function toast(id, message, tone = "success") {
  return { id, message, tone };
}

describe("shared UI state", () => {
  it("normalizes the legacy soft appearance and toggles persisted themes", () => {
    expect(normalizeAppearance("soft")).toBe("dark");
    expect(normalizeAppearance("unknown")).toBe("light");
    expect(toggleAppearance("light")).toBe("dark");
    expect(toggleAppearance("dark")).toBe("light");
  });

  it("deduplicates stable toast content and limits visible notices to two", () => {
    let state = createToastState();
    state = enqueueToast(state, toast("1", "已保存"));
    state = enqueueToast(state, toast("2", "已保存"));
    state = enqueueToast(state, toast("3", "已导出"));
    state = enqueueToast(state, toast("4", "稍后处理", "info"));

    expect(state.visible.map((item) => item.message)).toEqual(["已保存", "已导出"]);
    expect(state.pending.map((item) => item.message)).toEqual(["稍后处理"]);
  });

  it("promotes errors and warnings without dropping queued critical feedback", () => {
    let state = createToastState();
    state = enqueueToast(state, toast("1", "保存成功"));
    state = enqueueToast(state, toast("2", "导出成功"));
    state = enqueueToast(state, toast("3", "网络异常", "error"));
    state = enqueueToast(state, toast("4", "成本待确认", "warning"));

    expect(state.visible.some((item) => item.tone === "error")).toBe(true);
    expect([...state.visible, ...state.pending].map((item) => item.message)).toContain("成本待确认");

    state = dismissToast(state, "3");
    expect(state.visible.some((item) => item.tone === "warning")).toBe(true);
    expect(state.visible).toHaveLength(2);
  });
});
