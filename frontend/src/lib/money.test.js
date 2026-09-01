import { describe, expect, it } from "vitest";
import { calculateProfit, sumMoney } from "./money";

describe("money calculations", () => {
  it("calculates costs and profit without binary floating-point drift", () => {
    expect(calculateProfit({ revenue: 10.03, quantity: 3, unitCost: 0.1, warehouseRate: 0.2, penalty: 0.03 })).toEqual({
      purchaseCost: 0.3,
      warehouseCost: 0.6,
      profit: 9.1,
    });
  });

  it("does not finalize profit when purchasing cost is missing", () => {
    expect(calculateProfit({ revenue: 10, quantity: 2, unitCost: null, warehouseRate: 0.7 })).toEqual({
      purchaseCost: null,
      warehouseCost: 1.4,
      profit: null,
    });
  });

  it("sums decimal money values deterministically", () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
  });
});
