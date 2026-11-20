import Decimal from 'decimal.js';

export const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });
export const accountingUnitCost = value => new Exact(value).toDecimalPlaces(2, Decimal.ROUND_DOWN);
