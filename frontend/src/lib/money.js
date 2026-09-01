import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export function decimal(value, fallback = 0) {
  try {
    return new Decimal(value ?? fallback);
  } catch {
    return new Decimal(fallback);
  }
}

export function calculateProfit({ revenue, quantity, unitCost, warehouseRate, penalty = 0 }) {
  if (unitCost === null || unitCost === undefined || unitCost === "") {
    return {
      purchaseCost: null,
      warehouseCost: decimal(quantity).times(warehouseRate).toDecimalPlaces(2).toNumber(),
      profit: null,
    };
  }

  const purchaseCost = decimal(quantity).times(unitCost);
  const warehouseCost = decimal(quantity).times(warehouseRate);
  const profit = decimal(revenue).minus(purchaseCost).minus(warehouseCost).minus(penalty);

  return {
    purchaseCost: purchaseCost.toDecimalPlaces(2).toNumber(),
    warehouseCost: warehouseCost.toDecimalPlaces(2).toNumber(),
    profit: profit.toDecimalPlaces(2).toNumber(),
  };
}

export function sumMoney(values) {
  return values.reduce((total, value) => total.plus(value ?? 0), new Decimal(0)).toDecimalPlaces(2).toNumber();
}
