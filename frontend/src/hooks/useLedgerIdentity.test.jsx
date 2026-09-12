// @vitest-environment happy-dom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useLedgerIdentity } from "./useLedgerIdentity";

it("permits current async completion after initial load and StrictMode replay, rejects stale and unmounted completion", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  let canComplete;
  function Probe({ ledgerId }) {
    const identity = useLedgerIdentity(ledgerId);
    canComplete = () => identity.current === ledgerId && Boolean(ledgerId);
    return null;
  }
  await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  await act(async () => root.render(<StrictMode><Probe ledgerId="A" /></StrictMode>));
  expect(canComplete()).toBe(true);
  const oldCompletion = canComplete;
  await act(async () => root.render(<StrictMode><Probe ledgerId="B" /></StrictMode>));
  expect(oldCompletion()).toBe(false);
  expect(canComplete()).toBe(true);
  await act(async () => root.unmount());
  expect(canComplete()).toBe(false);
});
