import Decimal from 'decimal.js';

export const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });
export const accountingUnitCost = value => new Exact(value).toDecimalPlaces(2, Decimal.ROUND_DOWN);

// Decimal amounts and quantities are finite. Keep their quotient as integers
// until the final display so that, for example, three thirds always sum to one.
export class CostFraction {
  constructor(numerator, denominator = 1n) {
    if (denominator <= 0n) throw new RangeError('成本分母必须大于零');
    let a = numerator < 0n ? -numerator : numerator, b = denominator;
    while (b) [a, b] = [b, a % b];
    this.n = numerator / a;
    this.d = denominator / a;
  }

  static from(value) {
    if (value instanceof CostFraction) return value;
    if (Array.isArray(value)) return new CostFraction(BigInt(value[0]), BigInt(value[1]));
    const [whole, decimal = ''] = new Exact(value).toFixed().split('.');
    return new CostFraction(BigInt(whole + decimal), 10n ** BigInt(decimal.length));
  }

  plus(value) {
    const other = CostFraction.from(value);
    return new CostFraction(this.n * other.d + other.n * this.d, this.d * other.d);
  }
  minus(value) {
    const other = CostFraction.from(value);
    return new CostFraction(this.n * other.d - other.n * this.d, this.d * other.d);
  }
  times(value) {
    const other = CostFraction.from(value);
    return new CostFraction(this.n * other.n, this.d * other.d);
  }
  dividedBy(value) {
    const other = CostFraction.from(value);
    return new CostFraction(this.n * other.d, this.d * other.n);
  }
  pair() { return [String(this.n), String(this.d)]; }
  decimal() {
    if (this.d === 1n) return String(this.n);
    let rest = this.d, twos = 0, fives = 0;
    while (rest % 2n === 0n) { rest /= 2n; twos++; }
    while (rest % 5n === 0n) { rest /= 5n; fives++; }
    if (rest !== 1n) return new Exact(String(this.n)).div(String(this.d)).toFixed();
    const places = Math.max(twos, fives);
    const value = this.n * (10n ** BigInt(places) / this.d);
    const digits = String(value < 0n ? -value : value).padStart(places + 1, '0');
    return (value < 0n ? '-' : '') + digits.slice(0, -places) + '.' + digits.slice(-places);
  }
}

export function purchaseAmounts(decision, quantity, revenue, warehouse, penalty = 0) {
  const value = decision.unitCostFraction ?? decision.unitCostExact ?? decision.unitCost;
  const unit = CostFraction.from(decision.accountingMode === 'historical_lowest' ? accountingUnitCost(decision.unitCost) : value);
  const cost = unit.times(quantity);
  const profit = CostFraction.from(revenue).minus(warehouse).minus(penalty).minus(cost);
  return {
    unitCostExact: unit.decimal(), purchaseCostExact: cost.decimal(), profitExact: profit.decimal(),
    ...(decision.unitCostFraction ? { unitCostFraction: unit.pair(), purchaseCostFraction: cost.pair(), profitFraction: profit.pair() } : {}),
  };
}

export function sumCostAmounts(rows, field) {
  const fractionField = field === 'profitExact' ? 'profitFraction' : 'purchaseCostFraction';
  return rows.reduce((sum, row) => sum.plus(row[fractionField] ?? row[field] ?? 0), new CostFraction(0n));
}
