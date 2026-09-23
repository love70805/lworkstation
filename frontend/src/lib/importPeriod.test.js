import { expect, it } from "vitest";
import { collectSalesPeriodEvidence } from "./salesImport";
import { summarizeImportPeriod } from "./importPeriod";

const mapping = { platformSkc: "SKC", platformSku: "SKU", quantity: "数量", amount: "金额", sourceAddedAt: "添加时间", movementType: "变动类型" };
const row = (date, movementType = "客单发货") => ({ SKC: "父商品", SKU: "000123", 数量: "1", 金额: "10", 添加时间: date, 变动类型: movementType });
const options = { defaultStore: "甲店", movementTypes: ["客单发货"] };

it("suggests a month from eligible sales dates and ignores filtered inventory rows", () => {
  const evidence = collectSalesPeriodEvidence([row("2026-08-01"), row("2026-08-31"), row("2026-07-30", "盘亏")], mapping, options);
  expect(evidence).toMatchObject({ sourceField: "sourceAddedAt", sourceColumn: "添加时间", distribution: [{ month: "2026-08", count: 2 }], ignoredCount: 1, suggestedPeriod: "2026-08" });
});

it("requires selection for mixed, missing or invalid dates", () => {
  for (const dates of [["2026-07-30", "2026-08-01"], ["2026-08-01", ""], ["2026-08-01", "2026-02-30"]]) {
    expect(collectSalesPeriodEvidence(dates.map((date) => row(date)), mapping, options).suggestedPeriod).toBeNull();
  }
});

it("does not substitute an order date for an unmapped ledger added date", () => {
  const evidence = collectSalesPeriodEvidence([{ ...row(""), 订单日期: "2026-08-01" }], { ...mapping, sourceAddedAt: "", orderDate: "订单日期" }, options);
  expect(evidence).toMatchObject({ distribution: [], missingCount: 1, suggestedPeriod: null });
});

it("only auto-selects when every file has complete evidence for the same month", () => {
  const evidence = (month) => ({ distribution: [{ month, count: 2 }], suggestedPeriod: month, missingCount: 0, invalidCount: 0, errorCount: 0 });
  expect(summarizeImportPeriod([{ status: "parsed", periodEvidence: evidence("2026-08") }, { status: "parsed", periodEvidence: evidence("2026-08") }]).suggestedPeriod).toBe("2026-08");
  expect(summarizeImportPeriod([{ status: "parsed", periodEvidence: evidence("2026-08") }, { status: "parsed", periodEvidence: evidence("2026-07") }]).suggestedPeriod).toBeNull();
  expect(summarizeImportPeriod([{ status: "parsed", periodEvidence: evidence("2026-08") }], "2026-07").conflictsExisting).toBe(true);
});
