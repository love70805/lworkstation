import Decimal from "decimal.js";
import { canonicalPlatformSku } from "../domain/identifiers";
import { createLedgerGroupKey } from "../domain/ledgerImport";
import { PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { storeSkuKey } from "../domain/manualCostOverride";

const sum = (rows, key) => rows.reduce((total, row) => total.plus(row[key] ?? 0), new Decimal(0));
const money = (value) => value.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber() || 0;

// Only presentation/ledger exits truncate. Never accumulate these summaries.
export function summarizeProfitRows(rows, costBySku = new Map()) {
  const formal = rows.filter((row) => row.finalizable);
  const revenue = sum(rows, "revenue");
  const profit = sum(formal, "profit");
  return {
    revenue: money(revenue),
    totalUnits: sum(rows, "qty").toNumber(),
    purchaseCosts: money(sum(formal, "purchaseCost")),
    warehouseFees: money(sum(rows, "warehouseCost")),
    penalties: money(sum(rows, "penalty")),
    matchedProfit: money(profit),
    profitRate: revenue.isZero() ? null : money(profit.div(revenue).times(100)),
    missing: new Set(rows.filter((row) => !row.finalizable).map((row) => storeSkuKey(row.store, row.canonicalPlatformSku))).size,
    missingErp: new Set(rows.filter((row) => !row.finalizable && !costBySku.has(row.canonicalPlatformSku)).map((row) => row.canonicalPlatformSku)).size,
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

export const formatErpUnitCost = (value) => `¥${new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_DOWN).toFixed(4)}`;
export const formatManualUnitCost = (value) => `¥${new Decimal(value).toFixed()}`;

export function buildProfitExportRows(rows, ledger, summary) {
  const version = isProfitSnapshot(ledger) ? ledger.formulaVersion : PROFIT_FORMULA_VERSION;
  const rule = version === PROFIT_FORMULA_VERSION
    ? "明细保留原始精度；Decimal累计后汇总向零截断两位，利润按精确成本计算"
    : "历史定稿快照：保留已存金额和公式版本，不重新计算";
  return [...rows.map((row) => ({
    SKC: row.groupSkc, SKU: row.platformSku, 属性: row.attribute,
    数量: row.qty, 金额: row.revenue, "1688单号": row.orderNumber ?? "",
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
