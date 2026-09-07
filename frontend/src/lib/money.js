import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_DOWN });

export function decimal(value, fallback = 0) {
  try {
    return new Decimal(value ?? fallback);
  } catch {
    return new Decimal(fallback);
  }
}

export function calculateProfit({ revenue, quantity, unitCost, warehouseRate, penalty = 0 }) {
  const revenueAmount = decimal(revenue).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const warehouseRateAmount = decimal(warehouseRate).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const penaltyAmount = decimal(penalty).toDecimalPlaces(2, Decimal.ROUND_DOWN);

  if (unitCost === null || unitCost === undefined || unitCost === "") {
    return {
      purchaseCost: null,
      warehouseCost: decimal(quantity).times(warehouseRateAmount).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
      profit: null,
    };
  }

  const unitCostAmount = decimal(unitCost).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const purchaseCost = decimal(quantity).times(unitCostAmount).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const warehouseCost = decimal(quantity).times(warehouseRateAmount).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const profit = revenueAmount.minus(purchaseCost).minus(warehouseCost).minus(penaltyAmount).toDecimalPlaces(2, Decimal.ROUND_DOWN);

  return {
    purchaseCost: purchaseCost.toNumber(),
    warehouseCost: warehouseCost.toNumber(),
    profit: profit.toNumber(),
  };
}

export function sumMoney(values) {
  return values.reduce((total, value) => total.plus(value ?? 0), new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();
}
