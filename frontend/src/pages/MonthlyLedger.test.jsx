// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MonthlyLedger from "./MonthlyLedger";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), remove: vi.fn(), notify: vi.fn(),
  ledgers: [{ id: "L", period: "2026-08", status: "locked", summary: {} }],
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => ({ items: mocks.ledgers }) }));
vi.mock("../components/AppShell", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../components/UI", async original => ({ ...await original(), useToast: () => ({ notify: mocks.notify }) }));
vi.mock("../data/database", () => ({
  deleteMonthlyLedger: mocks.remove,
  listLedgerSummaries: vi.fn(),
  formatLedgerPeriod: () => "2026 年 8 月",
}));

let container, root;
const button = text => [...container.querySelectorAll("button")].find(item => item.textContent === text);
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MonthlyLedger />));
  await act(async () => container.querySelector('[title="删除账本"]').click());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it("closes confirmation before navigating to backup, even if the route has not loaded", async () => {
  await act(async () => button("先去备份中心").click());
  expect(mocks.navigate).toHaveBeenCalledWith("/data-security");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("allows confirmed locked-ledger deletion and prevents duplicate submission or dismissal while saving", async () => {
  let finish;
  mocks.remove.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => button("确认删除2026 年 8 月").click());
  expect(button("取消").disabled).toBe(true);
  expect(button("先去备份中心").disabled).toBe(true);
  await act(async () => {
    button("确认删除2026 年 8 月").click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("L", "local-user");
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => finish());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
