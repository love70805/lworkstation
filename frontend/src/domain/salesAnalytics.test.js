import { describe, expect, it } from "vitest";
import { aggregateDailySales, aggregateDailySalesDetails, parseSalesAddedDate } from "./salesAnalytics";

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

describe("selected day sales", () => {
  const scope = { period: "2026-08", date: "2026-08-01" };
  it("carries source SKCs without merging attribute SKUs or borrowing another day's SKC", () => {
    const source = [row({platformSkc:"skc-a"}), row({platformSku:"sku-b",platformSkc:"skc-a"}), row({platformSkc:"skc-a"}), row({platformSku:"sku-c"}), row({platformSkc:"other-day",sourceAddedDate:"2026-08-02"})];
    const details = aggregateDailySalesDetails(source, scope);
    expect(details.rows).toHaveLength(3);
    expect(details.rows.map(item => item.platformSkcs)).toEqual([["skc-a"], ["skc-a"], []]);
    expect(details.totalsExact).toMatchObject({quantityExact:"4",revenueExact:"0.036"});
  });
  it("aggregates only that day by store and SKU with exact fractions, negative values and activity evidence", () => {
    const source = [row({ quantityExact:"0.5",amountExact:"0.0099999999999999999",activityStatus:'known',activityRaw:'当日活动',attribute:'红' }),row({quantityExact:'1.5',amountExact:'-0.001',attribute:'蓝'}),row({store:'乙',quantityExact:'0',amountExact:'0'}),row({sourceAddedDate:'2026-08-02',activityStatus:'known',activityRaw:'其他日活动'}),row({sourceAddedDate:null}),row({sourceAddedDate:'2026-09-01'}),row({movementType:'盘亏'})];
    const daily = aggregateDailySalesDetails(source,scope);
    expect(daily.status).toBe('data');expect(daily.rows).toHaveLength(2);
    expect(daily.totalsExact).toEqual({quantityExact:'2',revenueExact:'0.0089999999999999999',count:3});
    expect(daily.rows[0]).toMatchObject({attributes:['红','蓝'],averagePriceExact:'0.00449999999999999995',activityStatus:'partial'});
    expect(daily.rows[0].activities.map(item=>item.raw)).toEqual(['当日活动']);
    expect(daily.rows[1].averagePriceExact).toBeNull();expect(daily.unlocatedCount).toBe(2);
    expect(aggregateDailySales(source,{period:scope.period}).daily[0].revenueExact).toBe(daily.totalsExact.revenueExact);
  });
  it('distinguishes known empty days and zero rows from unavailable dates',()=>{
    expect(aggregateDailySalesDetails([row({sourceAddedDate:'2026-08-02'})],scope)).toMatchObject({status:'known_zero',totalsExact:{quantityExact:'0',revenueExact:'0'},rows:[]});
    for(const rows of [[],[row({sourceAddedDate:null})],[row({sourceAddedDate:'2026-09-01'})]])expect(aggregateDailySalesDetails(rows,scope)).toMatchObject({status:'unknown',totalsExact:{quantityExact:null,revenueExact:null},rows:[]});
    expect(aggregateDailySalesDetails([row({quantityExact:'0',amountExact:'0'})],scope)).toMatchObject({status:'data',totalsExact:{quantityExact:'0',revenueExact:'0',count:1}});
  });
  it.each(['2026-09-01','2026-08-32','2026-8-1','2026-02-30',''])('rejects invalid or foreign-month date %s',date=>expect(()=>aggregateDailySalesDetails([],{...scope,date})).toThrow('有效日期'));
});
describe("daily and SKU analytics", () => {
  it("can omit unused monthly SKU/price/activity aggregation without changing exact daily totals", () => {
    const rows = [row(), row({quantityExact:'0.5',amountExact:'-0.001'}),row({sourceAddedDate:null})];
    const full=aggregateDailySales(rows,{period:'2026-08'});
    const quick=aggregateDailySales(rows,{period:'2026-08',includeSkuStats:false});
    expect(quick).toEqual({...full,skuStats:[]});
  });
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
