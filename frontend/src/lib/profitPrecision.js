import Decimal from "decimal.js";
import { CostFraction } from "../domain/profitAmounts";
import { canonicalPlatformSku } from "../domain/identifiers";
import { createLedgerGroupKey } from "../domain/ledgerImport";
import { PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { storeSkuKey } from "../domain/manualCostOverride";
import { profitOrderNumberForExport } from "./profitOrderDisplay";

const ExactSummary = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });
const money = (value) => value.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber() || 0;

// Only presentation/ledger exits truncate. Never accumulate these summaries.
export function summarizeProfitRows(rows, costBySku = new Map()) {
  let revenue = new ExactSummary(0), quantity = new ExactSummary(0), purchaseTotal = new CostFraction(0n);
  let warehouseCost = new ExactSummary(0), penalty = new ExactSummary(0), profitTotal = new CostFraction(0n);
  const missing = new Set(), missingErp = new Set();
  for (const row of rows) {
    revenue = revenue.plus(row.revenueExact ?? row.revenue ?? 0);
    quantity = quantity.plus(row.quantityExact ?? row.qty ?? 0);
    warehouseCost = warehouseCost.plus(row.warehouseCostExact ?? row.warehouseCost ?? 0);
    penalty = penalty.plus(row.penaltyExact ?? row.penalty ?? 0);
    if (row.finalizable) {
      purchaseTotal = purchaseTotal.plus(row.purchaseCostFraction ?? row.purchaseCostExact ?? row.purchaseCost ?? 0);
      profitTotal = profitTotal.plus(row.profitFraction ?? row.profitExact ?? row.profit ?? 0);
    } else {
      missing.add(storeSkuKey(row.store, row.canonicalPlatformSku));
      if (!costBySku.has(row.canonicalPlatformSku)) missingErp.add(row.canonicalPlatformSku);
    }
  }
  const purchaseCost = new ExactSummary(purchaseTotal.decimal()), profit = new ExactSummary(profitTotal.decimal());
  return {
    profitFraction: profitTotal.pair(),
    exactTotals: { revenue: revenue.toFixed(), quantity: quantity.toFixed(), purchaseCost: purchaseCost.toFixed(), warehouseCost: warehouseCost.toFixed(), penalty: penalty.toFixed(), profit: profit.toFixed() },
    revenue: money(revenue),
    totalUnits: quantity.toNumber(),
    purchaseCosts: money(purchaseCost),
    warehouseFees: money(warehouseCost),
    penalties: money(penalty),
    matchedProfit: money(profit),
    profitRate: revenue.isZero() ? null : money(profit.div(revenue).times(100)),
    missing: missing.size,
    missingErp: missingErp.size,
  };
}

export const isProfitSnapshot = (ledger) => ["finalized", "locked"].includes(ledger?.status);

export function savedProfitRows(lines = []) {
  return lines.map((line) => ({
    ...line,
    unitCost: line.unitCost ?? line.formalUnitCost,
    costSource: line.costSource ?? line.formalCostSource,
    qty: line.quantity,
    groupSkc: line.groupSkc ?? line.platformSkc ?? line.platformSku,
    groupKey: createLedgerGroupKey({ ...line, store: line.store || "未记录店铺", legacyFallbackSku: line.platformSku }),
    canonicalPlatformSku: line.canonicalPlatformSku ?? canonicalPlatformSku(line.platformSku),
    finalizable: true,
  }));
}

export function savedProfitSummary(summary) {
  if (!summary) return null;
  return {
    revenue: summary.revenue, totalUnits: summary.quantity,
    purchaseCosts: summary.purchaseCost, warehouseFees: summary.warehouseCost,
    penalties: summary.penalty, matchedProfit: summary.profit,
    profitRate: summary.profitRate, missing: summary.missingSkuCount ?? 0, missingErp: 0,
  };
}

export function formatProfitAmount(value) {
  const amount = new Decimal(value);
  if (!amount.isZero() && amount.abs().lt(0.01)) return `${amount.isNegative() ? "-" : ""}<0.01元`;
  return `¥${amount.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2)}`;
}

export function formatAccountingUnitCost(value, mode = 'weighted') {
  const unit = new ExactSummary(value);
  if (mode === 'historical_lowest') return '¥' + unit.toFixed(2, Decimal.ROUND_DOWN);
  const shown = unit.toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
  return '¥' + shown.toFixed(Math.max(2, shown.decimalPlaces()));
}
export const formatErpUnitCost = (value) => `¥${new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_DOWN).toFixed(4)}`;
export const formatManualUnitCost = (value) => `¥${new Decimal(value).toFixed()}`;

export function formatPurchaseAmountBasis(record) {
  if (record.amountBasis !== "purchase_total" || record.totalPrice == null) return `${record.quantity} 件 × ${formatErpUnitCost(record.effectiveUnitPrice ?? record.unitPrice)}`;
  const corrected = record.resolution?.action === "correct_price";
  return `${corrected ? "原" : ""}采购总价 ${formatManualUnitCost(record.totalPrice)} ÷ ${record.quantity} 件${corrected ? `；更正后单价 ${formatManualUnitCost(record.effectiveUnitPrice)}` : ""}`;
}

export function formatCostPurchaseEvidence(row) {
  return (row.costPurchaseRecords ?? []).map(record => `${record.purchaseDate} | ${record.order1688 ? "1688" : "采购单"} ${record.order1688 || record.purchaseOrderNo || record.purchaseOrderId || "未提供单号"} | ${record.amountBasis === "purchase_total" ? formatPurchaseAmountBasis(record) : `${record.quantity}件 × ${record.effectiveUnitPrice ?? record.unitPrice}`}`).join("\n");
}

export function buildProfitExportRows(rows, ledger, summary) {
  const version = isProfitSnapshot(ledger) ? ledger.formulaVersion : PROFIT_FORMULA_VERSION;
  const rule = version === PROFIT_FORMULA_VERSION
    ? (ledger.accountingMode === 'historical_lowest' ? "最低模式取低后单价截到两位再乘销量" : "常规模式按完整单件成本核算，ERP 采购总价乘销量后除以采购件数")
    : "历史定稿快照：保留已存金额和公式版本，不重新计算";
  return [...rows.map((row) => ({
    SKC: row.groupSkc, SKU: row.platformSku, 属性: row.attribute,
    数量: row.qty, 金额: row.revenue, "关联单号": profitOrderNumberForExport(row),
    核算采购明细: formatCostPurchaseEvidence(row),
    成本算法: row.costResolutionVersion ?? "",
    店铺: row.store,
    成本口径: row.costSource === "manual_override" ? "人工更正" : row.costSource === "erp" ? "ERP 正式成本" : row.costSource === "approved_1688" ? "人工参考，未计正式利润" : "待 ERP 成本",
    单件平均成本: row.unitCost ?? row.reference1688Cost?.unitCost ?? "缺失",
    "总件数*成本": row.purchaseCost ?? "缺失", 仓储成本: row.warehouseCost,
    客退罚款: row.penalty, 利润: row.profit ?? "未完成",
    公式版本: version ?? "未记录", 汇总规则: rule,
  })), {
    SKC: "当前范围汇总", 数量: summary.totalUnits, 金额: summary.revenue,
    "总件数*成本": summary.purchaseCosts, 仓储成本: summary.warehouseFees,
    客退罚款: summary.penalties, 利润: summary.matchedProfit,
    公式版本: version ?? "未记录", 汇总规则: rule,
  }];
}
