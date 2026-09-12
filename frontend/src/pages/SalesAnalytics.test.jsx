import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import SalesAnalytics from "./SalesAnalytics";
const state = vi.hoisted(() => ({ status: "unknown" }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => ({ scope: JSON.stringify(["W","L","all"]), data: { period:"2026-08", coverage:{status:state.status}, daily:[], monthTotalsExact:{revenueExact:"0",quantityExact:"0"}, undated:{count:0}, outOfPeriod:{count:0}, skuStats:[] } }) }));
it("shows unknown month values as pending while confirmed zero remains numeric", () => {
  state.status="unknown";
  const unknown=renderToStaticMarkup(<SalesAnalytics workspaceId="W" ledgerId="L" />);
  expect(unknown).toContain("销售原额待查 · 销量待查");
  expect(unknown).not.toContain("销售原额 ¥0");
  state.status="complete";
  const zero=renderToStaticMarkup(<SalesAnalytics workspaceId="W" ledgerId="L" />);
  expect(zero).toContain("销售原额 ¥0");
  expect(zero).not.toContain("销售原额待查");
});
