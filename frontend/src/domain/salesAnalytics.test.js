import { describe, expect, it } from "vitest";
import { aggregateDailySales, parseSalesAddedDate } from "./salesAnalytics";

const row = (patch = {}) => ({ store: "甲", platformSku: "sku-a", quantity: 1, quantityExact: "1", amount: 0.009, amountExact: "0.009", unitPriceRaw: "0.009", sourceAddedDate: "2026-08-01", ...patch });
describe("sales date evidence", () => {
  it("parses text, 1900/1904 serials and explicit timezone without borrowing dates", () => {
    expect(parseSalesAddedDate("2026/8/2 13:05:20").sourceAddedDate).toBe("2026-08-02");
    expect(parseSalesAddedDate(1).sourceAddedDate).toBe("1900-01-01");
    expect(parseSalesAddedDate(0, { date1904: true }).sourceAddedDate).toBe("1904-01-01");
    expect(parseSalesAddedDate("2026-07-31T18:00:00Z", { period: "2026-08" }).sourceAddedDate).toBe("2026-08-01");
    for (const source of [60, "2026-02-30", "2026-08-01 25:00", "说明日期2026-08-01"]) expect(parseSalesAddedDate(source).dateStatus).toBe("invalid");
    expect(parseSalesAddedDate("").dateStatus).toBe("missing");
    expect(parseSalesAddedDate("2026-09-01", { period: "2026-08" }).dateStatus).toBe("out_of_period");
  });
});
describe("daily and SKU analytics", () => {
  it("reconciles exact days plus all undated amounts without rounding tiny values", () => {
    const result = aggregateDailySales([row(), row(), row({ sourceAddedDate: null }), row({ sourceAddedDate: "2026-09-02" }), row({ movementType: "盘亏" }), row({ isDeduction: true })], { period: "2026-08" });
    expect(result.daily).toEqual([{ date: "2026-08-01", quantityExact: "2", revenueExact: "0.018", sourceRowCount: 2 }]);
    expect(result.undated).toEqual({ count: 2, quantityExact: "2", revenueExact: "0.018" });
    expect(result.monthTotalsExact.revenueExact).toBe("0.036");
    expect(result.outOfPeriod.count).toBe(1);
    expect(result.coverage.status).toBe("partial");
  });
  it("distinguishes complete zero days from unavailable data and never uses import date", () => {
    expect(aggregateDailySales([row()], { period: "2026-08" }).daily).toHaveLength(31);
    expect(aggregateDailySales([], { period: "2026-08" }).coverage.status).toBe("unknown");
    const result = aggregateDailySales([row({ sourceAddedDate: null, orderDate: "2026-08-01", importedAt: "2026-08-01" })], { period: "2026-08" });
    expect(result.daily).toEqual([]);
    expect(result.undated.count).toBe(1);
  });
  it("weights same SKU by units, keeps stores separate and activity evidence partial", () => {
    const result = aggregateDailySales([row({ quantityExact: "0.5", amountExact: "1", unitPriceRaw: "2", activityStatus: "known", activityRaw: "活动A" }), row({ quantityExact: "1.5", amountExact: "6", unitPriceRaw: "4" }), row({ store: "乙" })], { period: "2026-08" });
    expect(result.skuStats).toHaveLength(2);
    expect(result.skuStats[0]).toMatchObject({ averagePriceExact: "3.5", minPriceExact: "2", maxPriceExact: "4", activityStatus: "partial", knownActivityCount: 1, activities: ["活动A"] });
  });
});
