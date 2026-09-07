import Decimal from "decimal.js";
import { assertDomain } from "./errors";
import { DEFAULT_CURRENCY } from "./erpCosts";

export const PROFIT_FORMULA_VERSION = "monthly-profit-v8-truncate-2dp@2";
export const DEFAULT_WAREHOUSE_RATE = 0.7;

function finiteDecimal(value, label) {
  let amount;
  try {
    amount = new Decimal(value);
  } catch {
    amount = null;
  }
  assertDomain(amount?.isFinite(), "invalid_profit_input", `${label}必须是有效数字`, { label, value });
  return amount;
}

function calculateValues({ revenue, quantity, unitCost, warehouseRate, penalty }) {
  const revenueValue = finiteDecimal(revenue, "销售金额").toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const quantityValue = finiteDecimal(quantity, "销量");
  const costValue = finiteDecimal(unitCost, "单件成本").toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const warehouseRateValue = finiteDecimal(warehouseRate, "仓储费率").toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const penaltyValue = finiteDecimal(penalty, "扣款").toDecimalPlaces(2, Decimal.ROUND_DOWN);

  assertDomain(warehouseRateValue.gte(0), "negative_warehouse_rate", "仓储费率不能为负数");

  const purchaseCost = quantityValue.times(costValue).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const warehouseCost = quantityValue.times(warehouseRateValue).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const profit = revenueValue.minus(purchaseCost).minus(warehouseCost).minus(penaltyValue).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const profitRate = revenueValue.eq(0) ? null : profit.div(revenueValue).times(100);

  return {
    revenue: revenueValue.toNumber(),
    quantity: quantityValue.toNumber(),
    unitCost: costValue.toNumber(),
    purchaseCost: purchaseCost.toNumber(),
    warehouseCost: warehouseCost.toNumber(),
    penalty: penaltyValue.toNumber(),
    profit: profit.toNumber(),
    profitRate: profitRate?.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber() ?? null,
  };
}

export function calculateExactProfitLine({
  revenue,
  quantity,
  costDecision,
  warehouseRate = DEFAULT_WAREHOUSE_RATE,
  penalty = 0,
}) {
  const warehouseCost = finiteDecimal(quantity, "销量")
    .times(finiteDecimal(warehouseRate, "仓储费率").toDecimalPlaces(2, Decimal.ROUND_DOWN))
    .toDecimalPlaces(2, Decimal.ROUND_DOWN)
    .toNumber();

  if (costDecision?.status !== "final" || costDecision?.calculationMode !== "exact" || !costDecision.eligibleForExactProfit) {
    return {
      calculationMode: "exact",
      status: "blocked",
      finalizable: false,
      currency: DEFAULT_CURRENCY,
      purchaseCost: null,
      warehouseCost,
      profit: null,
      profitRate: null,
      blockingReason: costDecision?.status ?? "missing_cost_decision",
    };
  }

  const values = calculateValues({ revenue, quantity, unitCost: costDecision.unitCost, warehouseRate, penalty });
  return {
    ...values,
    calculationMode: "exact",
    status: "calculated",
    finalizable: true,
    currency: costDecision.currency ?? DEFAULT_CURRENCY,
    costSource: costDecision.source,
    costDecisionId: costDecision.id ?? null,
    formulaVersion: PROFIT_FORMULA_VERSION,
  };
}

export function calculateReferenceProfitLine({
  revenue,
  quantity,
  referenceCost,
  warehouseRate = DEFAULT_WAREHOUSE_RATE,
  penalty = 0,
}) {
  assertDomain(referenceCost, "reference_cost_required", "参考利润需要参考成本");
  const values = calculateValues({
    revenue,
    quantity,
    unitCost: referenceCost.unitCost ?? referenceCost.amount,
    warehouseRate,
    penalty,
  });

  return {
    ...values,
    calculationMode: "reference",
    status: "reference",
    finalizable: false,
    currency: referenceCost.currency ?? DEFAULT_CURRENCY,
    referenceKind: referenceCost.referenceKind ?? referenceCost.kind ?? "unspecified",
    formulaVersion: PROFIT_FORMULA_VERSION,
  };
}
