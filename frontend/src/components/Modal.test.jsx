// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./UI";

function Editor({ busy = false, onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return <>
    <button onClick={() => setOpen(true)}>录入来源</button>
    <Modal open={open} title="代发来源" onClose={() => {
      if (busy) return;
      onClose({ amount, note });
      setOpen(false);
    }}>
      <input aria-label="金额" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <textarea aria-label="说明" value={note} onChange={(event) => setNote(event.target.value)} />
    </Modal>
  </>;
}

describe("Modal focus lifecycle", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  async function renderEditor(props = {}) {
    await act(async () => root.render(<Editor {...props} />));
  }

  async function openEditor() {
    const trigger = container.querySelector("button");
    trigger.focus();
    await act(async () => trigger.click());
    await act(async () => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(container.querySelector('[aria-label="关闭对话框"]'));
    return trigger;
  }

  async function typeCharacters(input, text) {
    input.focus();
    for (const character of text) {
      // Target the focused element and flush between keystrokes, so a focus
      // reset after the first character fails instead of hiding the regression.
      expect(document.activeElement).toBe(input);
      await act(async () => {
        const target = document.activeElement;
        target.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true }));
        const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(target, target.value + character);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new KeyboardEvent("keyup", { key: character, bubbles: true }));
      });
      await act(async () => vi.runOnlyPendingTimers());
      expect(document.activeElement).toBe(input);
    }
  }

  it("keeps focus while typing consecutive amounts and notes and restores the original opener on close", async () => {
    const onClose = vi.fn();
    await renderEditor({ onClose });
    const trigger = await openEditor();
    const amount = container.querySelector("input");
    await typeCharacters(amount, "123");
    expect(amount.value).toBe("123");
    await typeCharacters(container.querySelector("textarea"), "来源补录");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ amount: "123", note: "来源补录" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await openEditor();
  });

  it("uses the latest Escape callback when busy changes without refocusing the editor", async () => {
    const initialClose = vi.fn();
    const latestClose = vi.fn();
    await renderEditor({ onClose: initialClose });
    const trigger = await openEditor();
    const input = container.querySelector("input");
    await typeCharacters(input, "45");
    await renderEditor({ busy: true, onClose: latestClose });
    await act(async () => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(input);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(initialClose).not.toHaveBeenCalled();
    expect(latestClose).not.toHaveBeenCalled();
    await renderEditor({ busy: false, onClose: latestClose });
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(latestClose).toHaveBeenCalledExactlyOnceWith({ amount: "45", note: "" });
    expect(initialClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(latestClose).toHaveBeenCalledTimes(1);
  });

  it("preserves close-button and backdrop behavior with current callbacks", async () => {
    const onClose = vi.fn();
    await renderEditor({ onClose });
    const trigger = await openEditor();
    await typeCharacters(container.querySelector("input"), "67");
    await act(async () => container.querySelector('[aria-label="关闭对话框"]').click());
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ amount: "67", note: "" });
    expect(document.activeElement).toBe(trigger);
    await openEditor();
    await act(async () => container.querySelector('[role="dialog"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector(".modal-backdrop").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(trigger);
  });

  it("restores external focus and removes Escape handling when unmounted before initial focus", async () => {
    const trigger = document.createElement("button");
    container.before(trigger);
    trigger.focus();
    const onClose = vi.fn();
    try {
      await act(async () => root.render(<Modal open title="来源" onClose={onClose} />));
      await act(async () => root.unmount());
      root = null;
      await act(async () => vi.runOnlyPendingTimers());
      expect(document.activeElement).toBe(trigger);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      trigger.remove();
    }
  });
  it("cycles Tab within the dialog and blocks focus behind it", async () => {
    await renderEditor();
    const trigger = await openEditor();
    const close = container.querySelector('[aria-label="关闭对话框"]');
    const last = container.querySelector("textarea");
    last.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(document.activeElement).toBe(close);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    trigger.focus();
    expect(document.activeElement).toBe(close);
  });

  it("closes only the top dialog and keeps the background scroll locked until both close", async () => {
    function Stacked() {
      const [parentOpen, setParentOpen] = useState(true);
      const [childOpen, setChildOpen] = useState(false);
      return <>
        <Modal open={parentOpen} title="整理档案" onClose={() => setParentOpen(false)}>
          <button onClick={() => setChildOpen(true)}>确认合并</button>
        </Modal>
        <Modal open={childOpen} title="再次确认" onClose={() => setChildOpen(false)} />
      </>;
    }
    document.body.style.overflow = "auto";
    await act(async () => root.render(<Stacked />));
    await act(async () => vi.runOnlyPendingTimers());
    const trigger = [...container.querySelectorAll("button")].find((item) => item.textContent === "确认合并");
    trigger.focus();
    await act(async () => trigger.click());
    await act(async () => vi.runOnlyPendingTimers());
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

});
