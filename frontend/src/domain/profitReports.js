import Decimal from "decimal.js";
import { canonicalPlatformSku } from "./identifiers";
import { createLedgerGroupKey, createLedgerSkuKey } from "./ledgerImport";
import { resolveFormalCostDecision } from "./costPolicy";
import { selectManualOverride } from "./manualCostOverride";

export const REPORT_FORMULA_VERSION = "monthly-report@1-exact-supplements";
export const REPORT_TEMPLATE_VERSION = "profit-zebra@1";
export const REPORT_TABLES = ["monthlySupplementBatches", "monthlySupplementRows", "profitReports", "profitReportLines"];
export const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });
export function exact(value, { nonnegative = false } = {}) {
  if (value == null || String(value).trim() === "") throw new Error("金额或数量尚未填写。");
  let number;
  try { number = new Exact(value); } catch { throw new Error("数量或金额格式无效，请核对源数据中的十进制数值。"); }
  if (!number.isFinite() || (nonnegative && number.isNegative())) throw new Error("金额或数量必须为有效的非负十进制数。");
  return number.toFixed();
}
export const displayMoney = value => new Exact(value).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2);
export const exactSum = (rows, key) => rows.reduce((sum, row) => sum.plus(row[key] ?? 0), new Exact(0)).toFixed();
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function buildReportProducts({ ledger, salesRows, erpCosts, approvals, allowMissing = false }) {
  const costs = new Map(erpCosts.map(row => [canonicalPlatformSku(row.platformSku), row]));
  const groups = new Map();
  for (const source of salesRows) {
    if (/盘亏/.test(source.movementType ?? "")) continue;
    if (source.isDeduction || Number(source.penalty ?? 0) !== 0 || /扣款|罚款|违约/.test(source.movementType ?? "")) throw new Error("台账含旧罚款记录，请重新导入纯销售台账，并将扣款登记到独立扣款来源，避免重复扣款。");
    const key = JSON.stringify([createLedgerGroupKey(source), createLedgerSkuKey(source)]);
    if (!groups.has(key)) groups.set(key, { lineKind: "product", store: source.store, platformSkc: source.platformSkc ?? "", groupSkc: source.platformSkc || source.supplierNumber, platformSku: source.platformSku, canonicalPlatformSku: canonicalPlatformSku(source.platformSku), supplierNumber: source.supplierNumber ?? "", attribute: source.attribute ?? "", quantityExact: "0", revenueExact: "0", sourceRows: [] });
    const row = groups.get(key);
    row.quantityExact = new Exact(row.quantityExact).plus(exact(source.quantityExact ?? source.quantity)).toFixed();
    row.revenueExact = new Exact(row.revenueExact).plus(exact(source.amountExact ?? source.amount)).toFixed();
    row.sourceRows.push({ id: source.id, batchId: source.batchId, sourceSheet: source.sourceSheet, sourceRow: source.sourceRow });
  }
  if (!groups.size) throw new Error("账本没有可生成报告的销售明细。");
  const rate = exact(ledger.warehouseRate ?? "0.7", { nonnegative: true });
  return [...groups.values()].map(row => {
    const scope = { workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: row.store, platformSku: row.platformSku };
    const cost = costs.get(row.canonicalPlatformSku);
    const decision = resolveFormalCostDecision({ ...scope, erpCost: cost, manualOverride: selectManualOverride(approvals, scope) });
    if (!decision.eligibleForExactProfit) {
      if (allowMissing) return { ...row, unitCostExact:null, purchaseCostExact:null, profitExact:null, warehouseCostExact:new Exact(row.quantityExact).times(rate).toFixed(), costSource:decision.source, costSourceRecordId:decision.sourceRecordId };
      throw new Error(`${row.store} / ${row.platformSku} 尚缺正式成本，不能生成报告。`);
    }
    const unitCostExact = exact(decision.unitCost, { nonnegative: true });
    const purchaseCostExact = new Exact(row.quantityExact).times(unitCostExact).toFixed();
    const warehouseCostExact = new Exact(row.quantityExact).times(rate).toFixed();
    return { ...row, unitCostExact, purchaseCostExact, warehouseCostExact, profitExact: new Exact(row.revenueExact).minus(purchaseCostExact).minus(warehouseCostExact).toFixed(), costSource: decision.source, costSourceRecordId: decision.sourceRecordId, costApprovalId: decision.approvalId, orderNumber: cost?.orderNumber ?? "" };
  }).sort((a,b) => a.store.localeCompare(b.store,"zh-CN") || a.groupSkc.localeCompare(b.groupSkc) || a.platformSku.localeCompare(b.platformSku));
}

export function reportTotals(products, dispatchQuantityExact, warehouseRateExact, deductions = []) {
  const stores = [...new Set(products.map(row => row.store))];
  if (deductions.some(row => !stores.includes(row.store))) throw new Error("扣款店铺不在未扣款报告基础中。");
  const dispatchAmountExact = new Exact(dispatchQuantityExact).times(warehouseRateExact).toFixed();
  const productProfitExact = exactSum(products, "profitExact");
  const preDeductionExact = new Exact(productProfitExact).plus(dispatchAmountExact).toFixed();
  const deductionExact = exactSum(deductions, "signedAmountExact");
  return { quantityExact: exactSum(products,"quantityExact"), revenueExact: exactSum(products,"revenueExact"), purchaseCostExact: exactSum(products,"purchaseCostExact"), warehouseCostExact: exactSum(products,"warehouseCostExact"), productProfitExact, dispatchQuantityExact, dispatchAmountExact, preDeductionExact, deductionExact, profitExact: new Exact(preDeductionExact).minus(deductionExact).toFixed(), stores: stores.map(store => {
    const lines = products.filter(row => row.store === store);
    const deductionExact = exactSum(deductions.filter(row => row.store === store), "signedAmountExact");
    const profitExact = exactSum(lines,"profitExact");
    return { store, quantityExact: exactSum(lines,"quantityExact"), revenueExact: exactSum(lines,"revenueExact"), profitExact, deductionExact, financialProfitExact: new Exact(profitExact).minus(deductionExact).toFixed() };
  }) };
}

export function legacyReportLine(line) {
  const amount = value => value == null ? null : Number(value);
  return { ...line, quantity: Number(line.quantityExact), qty: Number(line.quantityExact), revenue: Number(line.revenueExact), unitCost: amount(line.unitCostExact), purchaseCost: amount(line.purchaseCostExact), warehouseCost: amount(line.warehouseCostExact), profit: amount(line.profitExact), penalty: 0, finalizable: line.unitCostExact != null };
}
