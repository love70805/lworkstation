import { describe, expect, it } from "vitest";
import { filterMonthlyLedgers } from "./ledgerFilter";

const labels = {
  draft: "草稿",
  cost_pending: "待补 ERP 成本",
  finalized: "已定稿",
};

describe("月度账本领域搜索", () => {
  const ledgers = [
    { period: "2026-08", status: "draft" },
    { period: "2026-07", status: "cost_pending" },
    { period: "2025-12", status: "finalized" },
  ];

  it("searches raw and formatted month values", () => {
    expect(filterMonthlyLedgers(ledgers, "2026-08", labels)).toEqual([ledgers[0]]);
    expect(filterMonthlyLedgers(ledgers, "2026年7月", labels)).toEqual([ledgers[1]]);
  });

  it("searches localized ledger states", () => {
    expect(filterMonthlyLedgers(ledgers, "待补 ERP", labels)).toEqual([ledgers[1]]);
    expect(filterMonthlyLedgers(ledgers, "已定稿", labels)).toEqual([ledgers[2]]);
  });
});
