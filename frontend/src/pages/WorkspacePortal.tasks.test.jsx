// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkspacePortal from "./WorkspacePortal";
import { ToastProvider } from "../components/UI";
import { buildWorkspaceOperationalSummary } from "../domain/workspaceSummary";

const mocks = vi.hoisted(() => ({ portal: null }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => mocks.portal }));
vi.mock("../components/AppShell", () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock("../components/WorkspaceLedgerControls", () => ({ default: () => null }));
vi.mock("./SalesAnalytics", () => ({ default: () => null }));
vi.mock("../lib/useWorkspaceLedgerScope", () => ({ useWorkspaceLedgerScope: () => ({ ready: true, context: { selected: null, query: "" }, retry: vi.fn() }) }));
vi.mock("../data/database", () => ({ db: {}, getActiveMemberContext: vi.fn(), getSelectionReferenceSnapshot: vi.fn(), getWorkspaceOperationalSummary: vi.fn() }));
vi.mock("../data/repositories/ledgerOverviewRepository", () => ({ withCurrentLedgerResults: vi.fn() }));

let container, root;
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
async function render(ledgers, captures = []) {
  mocks.portal = { refresh: 0, summary: buildWorkspaceOperationalSummary({ ledgers, captures }), auditEvents: [], referenceRows: [] };
  await act(async () => root.render(<MemoryRouter initialEntries={["/workspace"]}><ToastProvider><WorkspacePortal /><Location /></ToastProvider></MemoryRouter>));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.portal = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it("shows and opens an older ready month even when the latest month is a draft", async () => {
  await render([
    { id: "old/ready", period: "2026-06", status: "ready", updatedAt: "2026-07-01", costSummary: { missingCount: 0 } },
    { id: "new-draft", period: "2026-09", status: "draft", updatedAt: "2026-10-12" },
  ]);
  expect(container.querySelector(".tasks-panel .widget-count").textContent).toBe("2 项");
  expect(container.querySelector(".workspace-status-strip").textContent).toContain("2026-06 利润待确认");
  expect(container.querySelector(".task-empty")).toBeNull();
  await act(async () => container.querySelector('button[aria-label="2026-06 利润待确认：核对利润"]').click());
  expect(container.querySelector("output").textContent).toBe("/profit?ledger=old%2Fready");
});

it("counts and exposes all remaining months with their own routes while closed months stay out", async () => {
  await render([
    { id: "aug", period: "2026-08", status: "ready", costSummary: { missingCount: 0 } },
    { id: "june", period: "2026-06", status: "ready", costSummary: { missingCount: 0 } },
    { id: "july", period: "2026-07", status: "cost_pending", costSummary: { missingCount: 2 } },
    { id: "sep", period: "2026-09", status: "draft" },
    { id: "closed", period: "2026-05", status: "finalized" },
    { id: "locked", period: "2026-04", status: "locked" },
  ], [{ id: "C", status: "pending" }]);
  expect(container.querySelector(".tasks-panel .widget-count").textContent).toBe("5 项");
  expect([...container.querySelectorAll(".tasks-panel > .task-list .task-item strong")].map(item => item.textContent)).toEqual(["待确认采集", "2026-06 利润待确认", "2026-07 成本待补"]);
  const remaining = container.querySelector(".task-more");
  expect(remaining.open).toBe(false);
  expect(remaining.querySelector("summary").textContent).toBe("查看其余 2 项待办");
  expect([...remaining.querySelectorAll(".task-item strong")].map(item => item.textContent)).toEqual(["2026-08 利润待确认", "2026-09 账本待完善"]);
  remaining.open = true;
  await act(async () => remaining.querySelector('button[aria-label="2026-09 账本待完善：查看台账"]').click());
  expect(container.querySelector("output").textContent).toBe("/ledger?ledger=sep");
});

it("a cost alert targets the month that needs costs rather than the latest draft", async () => {
  await render([
    { id: "old-cost", period: "2026-06", status: "cost_pending", costSummary: { missingCount: 3 } },
    { id: "new-draft", period: "2026-09", status: "draft", updatedAt: "2026-10-12" },
  ]);
  expect(container.querySelector(".workspace-status-strip").textContent).toContain("2026-06 成本待补");
  await act(async () => container.querySelector(".workspace-status-strip button").click());
  expect(container.querySelector("output").textContent).toBe("/cost-matching?ledger=old-cost");
});
