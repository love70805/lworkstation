// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProfitWorkspaceContent } from "./ProfitPanel";
import { ToastProvider } from "../components/UI";

const mocks = vi.hoisted(() => ({ updateRate: vi.fn(), reopen: vi.fn(), status: "cost_pending" }));
vi.mock("../data/database", () => ({ updateLedgerWarehouseRate: mocks.updateRate, reopenLedgerForCostCorrection: mocks.reopen }));
vi.mock("../hooks/useLatestSalesImport", () => ({ useLatestSalesImport: () => ({
  ledger: { id: "L", workspaceId: "W", period: "2026-08", status: mocks.status, warehouseRate: 0.7, profitSummary: { revenue: 10, quantity: 2, purchaseCost: 0, warehouseCost: 1.4, penalty: 0, profit: 8.6 } },
  rows: [{ store: "甲", platformSkc: "SKC", platformSku: "SKU", quantity: 2, amount: 10, penalty: 0 }],
  costs: [], approvals: [], profitLines: [{ id: 1, store: "甲", platformSku: "SKU", platformSkc: "SKC", quantity: 2, revenue: 10, unitCost: 0, purchaseCost: 0, warehouseCost: 1.4, penalty: 0, profit: 8.6, costSource: "manual_override", finalizable: true }],
}) }));
let container, root;
const findButton = (text) => [...container.querySelectorAll("button")].find((button) => button.textContent === text);
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); mocks.status = "cost_pending"; mocks.updateRate.mockReset().mockResolvedValue({}); mocks.reopen.mockReset().mockResolvedValue({});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><ToastProvider><ProfitWorkspaceContent /></ToastProvider></MemoryRouter>));
});
it("requires an explicit reopen confirmation and reason while details stay collapsed", async () => {
  mocks.status = "finalized";
  await act(async () => root.render(<MemoryRouter><ToastProvider><ProfitWorkspaceContent /></ToastProvider></MemoryRouter>));
  await act(async () => findButton("重开本月全部店铺核算").click());
  expect(container.querySelector('[role="dialog"]').closest("details:not([open])")).toBeNull();
  expect(findButton("确认重开").disabled).toBe(true);
  await act(async () => findButton("取消").click());
  expect(mocks.reopen).not.toHaveBeenCalled();
  await act(async () => findButton("重开本月全部店铺核算").click());
  await act(async () => Simulate.change(container.querySelector("#profit-reopen-reason"), { target: { value: "人工成本复核" } }));
  await act(async () => findButton("确认重开").click());
  expect(mocks.reopen).toHaveBeenCalledWith({ ledgerId: "L", reason: "人工成本复核" });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("opens the warehouse dialog outside collapsed details, cancels, and applies through the visible action", async () => {
  expect(container.querySelector("details").open).toBe(false);
  await act(async () => container.querySelector(".profit-summary-action").click());
  let dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("修改仓储费率");
  expect(dialog.closest("details:not([open])")).toBeNull();
  await act(async () => findButton("取消").click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.updateRate).not.toHaveBeenCalled();
  await act(async () => container.querySelector(".profit-summary-action").click());
  dialog = container.querySelector('[role="dialog"]');
  expect(dialog.closest("details:not([open])")).toBeNull();
  await act(async () => Simulate.change(dialog.querySelector('input[type="number"]'), { target: { value: "1.2" } }));
  await act(async () => findButton("应用费率").click());
  expect(mocks.updateRate).toHaveBeenCalledTimes(1);
  expect(mocks.updateRate).toHaveBeenCalledWith("L", 1.2);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector("details").open).toBe(false);
});
