import { CostFraction, Exact } from './profitAmounts';
import { chartWithDispatch, detailWithDispatch } from './salesDispatchContribution';
import { priceReportGroups } from './profitReports';
import { profitCostWithinPeriod } from './profitPageProjection';
import { storeSkuKey } from './manualCostOverride';
import { salesProductKey } from './salesPeriodDetails';
import { salesStoreKey } from './salesChartModel';
import { parseSalesAddedDate } from './salesAnalytics';
import { canonicalPlatformSkc, canonicalPlatformSku } from './identifiers';

const zero = () => new CostFraction(0n);
const bucket = () => ({ revenue: new Exact(0), quantity: new Exact(0), warehouse: new Exact(0), purchase: zero(), profit: zero(), missing: false, priced: false });
const periodBucket = () => ({ total: bucket(), stores: new Map(), products: new Map() });
function get(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}
function addLine(period, line) {
  const skc = String(line.platformSkc ?? '').normalize('NFKC').trim();
  const productKey = salesProductKey(line.store, skc, line.canonicalPlatformSku);
  const targets = [period.total, get(period.stores, salesStoreKey(line.store), bucket), get(period.products, productKey, bucket)];
  for (const target of targets) {
    target.revenue = target.revenue.plus(line.revenueExact);
    target.quantity = target.quantity.plus(line.quantityExact);
    target.warehouse = target.warehouse.plus(line.warehouseCostExact);
    if (line.profitExact == null) target.missing = true;
    else {
      target.priced = true;
      target.purchase = target.purchase.plus(line.purchaseCostFraction ?? line.purchaseCostExact);
      target.profit = target.profit.plus(line.profitFraction ?? line.profitExact);
    }
  }
}
function finish(bucket) {
  const ready = bucket.priced && !bucket.missing;
  return {
    revenueExact: bucket.revenue.toFixed(), quantityExact: bucket.quantity.toFixed(), warehouseCostExact: bucket.warehouse.toFixed(),
    purchaseCostExact: ready ? bucket.purchase.decimal() : null, profitExact: ready ? bucket.profit.decimal() : null,
    profitFraction: ready ? bucket.profit.pair() : null, hasPriced: bucket.priced,
  };
}
const mapValues = (map, fn) => Object.fromEntries([...map].map(([key, value]) => [key, fn(value)]));
const finishPeriod = period => ({ total: finish(period.total), stores: mapValues(period.stores, finish), products: mapValues(period.products, finish) });

function priceSku(revenue, quantity, unitCost, rate) {
  const warehouse = new Exact(quantity).times(rate);
  const purchase = unitCost == null ? null : CostFraction.from(unitCost).times(quantity);
  const profit = purchase && CostFraction.from(revenue).minus(warehouse).minus(purchase);
  return { warehouseCostExact: warehouse.toFixed(), purchaseCostExact: purchase?.decimal() ?? null, purchaseCostFraction: purchase?.pair(),
    profitExact: profit?.decimal() ?? null, profitFraction: profit?.pair() };
}

// Establish identity and price against the whole ledger, even when a day or store is selected.
// Monthly dispatch and deductions have no sale-line identity. The monthly profit report owns them.
export function buildSalesProfitAnalysis({ ledger, identities, costs, approvals, groups, rows, store = 'all' }) {
  const lines = priceReportGroups({ ledger, salesRows: identities, erpCosts: costs, approvals, allowMissing: true }, groups, profitCostWithinPeriod);
  const inScope = name => store === 'all' || salesStoreKey(name) === salesStoreKey(store);
  const month = periodBucket(), days = new Map(), prices = new Map(), costSources = new Map();
  const warehouseRate = ledger.warehouseRate ?? '0.7';
  for (const line of lines) {
    if (!inScope(line.store)) continue;
    addLine(month, line);
    const key = storeSkuKey(line.store, line.platformSku);
    prices.set(key, line.unitCostFraction ?? line.unitCostExact);
    costSources.set(key, line.costSource);
  }
  if (rows) {
    const byDaySku = new Map();
    for (const sale of rows) {
      if (!inScope(sale.store) || /盘亏/.test(sale.movementType ?? '')) continue;
      const { sourceAddedDate: date, dateStatus } = parseSalesAddedDate(sale.sourceAddedDate, { period: ledger.period });
      if (dateStatus !== 'valid') continue;
      const sku = sale.platformSku ?? sale.sku;
      const identity = storeSkuKey(sale.store, sku);
      const key = JSON.stringify([date, identity, sale.platformSkc]);
      const group = get(byDaySku, key, () => ({
        date, skc: sale.platformSkc, store: sale.store, sku: canonicalPlatformSku(sku),
        revenue: new Exact(0), quantity: new Exact(0), unitCost: prices.get(identity),
      }));
      group.revenue = group.revenue.plus(sale.amountExact ?? sale.amount);
      group.quantity = group.quantity.plus(sale.quantityExact ?? sale.quantity);
    }
    for (const { date, store, sku, skc, revenue, quantity, unitCost } of byDaySku.values()) {
      addLine(get(days, date, periodBucket), {
        store, platformSkc: skc, canonicalPlatformSku: sku, revenueExact: revenue, quantityExact: quantity,
        ...priceSku(revenue, quantity, unitCost, warehouseRate),
      });
    }
  }
  return { accountingMode: ledger.accountingMode, warehouseRate, unitCosts: Object.fromEntries(prices), costSources: Object.fromEntries(costSources), month: finishPeriod(month), days: mapValues(days, finishPeriod) };
}

// A legacy aggregate may cover a different set of records. Only join results with matching sales.
function withAmounts(sale, amounts) {
  if (!sale || !amounts || sale.revenueExact == null || sale.quantityExact == null
    || !new Exact(sale.revenueExact).eq(amounts.revenueExact) || !new Exact(sale.quantityExact).eq(amounts.quantityExact)) return sale;
  return { ...sale, ...amounts };
}
const zeroAmounts = { revenueExact: '0', quantityExact: '0', purchaseCostExact: '0', warehouseCostExact: '0', profitExact: '0', profitFraction: ['0','1'] };
export function withChartProfit(month, analysis) {
  if (!analysis?.month) return month;
  return chartWithDispatch({ ...month, accountingMode: analysis.accountingMode,
    monthTotalsExact: withAmounts(month.monthTotalsExact, analysis.month.total),
    monthlySegments: (month.monthlySegments ?? []).map(row => withAmounts(row, analysis.month.stores[salesStoreKey(row.store)])),
    daily: month.daily.map(day => {
      if (!['data', 'known_zero'].includes(day.status)) return day;
      const period = analysis.days[day.date];
      return { ...withAmounts(day, period?.total ?? (day.status === 'known_zero' ? zeroAmounts : null)),
        segments: day.segments.map(row => withAmounts(row, period?.stores[salesStoreKey(row.store)])) };
    }),
  }, analysis.dispatch);
}
export function withDetailProfit(detail, analysis, date) {
  if (!detail || !analysis?.month) return detail;
  if (detail.status === 'unknown') return detailWithDispatch(detail, analysis.dispatch, date);
  const period = date ? analysis.days[date] : analysis.month;
  const byStore = new Map();
  for (const sku of detail.skuRows ?? []) {
    const amounts = priceSku(sku.revenueExact, sku.quantityExact, analysis.unitCosts?.[sku.key], analysis.warehouseRate ?? '0.7');
    get(byStore, salesStoreKey(sku.store), () => []).push({ ...sku, ...amounts });
  }
  return detailWithDispatch({ ...detail, accountingMode: analysis.accountingMode, hasProfitAnalysis: true,
    totalsExact: withAmounts(detail.totalsExact, period?.total ?? (detail.status === 'known_zero' ? zeroAmounts : null)),
    stores: detail.stores.map(row => {
      const key = salesStoreKey(row.store), priced = withAmounts(row, period?.stores[key]);
      const skuRows = byStore.get(key);
      if (priced === row || !skuRows?.length || !analysis.unitCosts) return priced;
      return { ...priced, skuRows, breakdown: skuProfitBreakdown(skuRows) };
    }),
    rows: detail.rows.map(row => withAmounts(row, period?.products[row.key])),
  }, analysis.dispatch, date);
}

// Classify the signed total for each SKU in this store and period, after returns and sales offset.
export function skuProfitBreakdown(rows) {
  let earnings = zero(), losses = zero(), earned = 0, lost = 0, pending = 0;
  for (const row of rows) {
    if (row.profitExact == null) { pending++; continue; }
    const amount = CostFraction.from(row.profitFraction ?? row.profitExact);
    if (amount.n > 0n) { earnings = earnings.plus(amount); earned++; }
    if (amount.n < 0n) { losses = losses.plus(amount); lost++; }
  }
  return { earningExact: pending === rows.length ? null : earnings.decimal(), lossExact: pending === rows.length ? null : losses.decimal(), earned, lost, pending };
}

export function combinedProfit(rows) {
  if (!rows.length || rows.some(row => row?.profitExact == null)) return null;
  return rows.reduce((sum, row) => sum.plus(row.profitFraction ?? row.profitExact), zero()).decimal();
}

// A parent earns its place after all its variants, returns and selected stores net together.
export function profitableSkcs(rows, unitCosts = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.platformSkc?.trim()) continue;
    const key = canonicalPlatformSkc(row.platformSkc);
    const group = get(groups, key, () => ({ key, skc: row.platformSkc, purchase: zero(), profit: zero(), dispatch: zero(), dispatchQuantity: new Exact(0), stores: new Set(), complete: true, min: null, max: null }));
    group.stores.add(row.store);
    group.dispatch = group.dispatch.plus(row.dispatchAmountExact ?? 0);
    group.dispatchQuantity = group.dispatchQuantity.plus(row.dispatchQuantityExact ?? 0);
    if (row.profitExact == null || row.purchaseCostExact == null) { group.complete = false; continue; }
    const profit = CostFraction.from(row.profitFraction ?? row.profitExact);
    group.profit = group.profit.plus(profit);
    // Existing chart snapshots retain the exact profit fraction even when purchase is a recurring decimal.
    group.purchase = group.purchase.plus(CostFraction.from(row.revenueExact).minus(row.warehouseCostExact).minus(row.salesProfitFraction ?? profit));
    for (const sku of row.platformSkus ?? []) {
      const unit = unitCosts[storeSkuKey(row.store, sku)];
      if (unit == null) continue;
      const value = new Exact(CostFraction.from(unit).decimal());
      if (group.min == null || value.lt(group.min)) group.min = value;
      if (group.max == null || value.gt(group.max)) group.max = value;
    }
  }
  return [...groups.values()].filter(group => group.complete && group.profit.n > 0n)
    .sort((a, b) => {
      const diff = b.profit.n * a.profit.d - a.profit.n * b.profit.d;
      return diff > 0n ? 1 : diff < 0n ? -1 : a.key.localeCompare(b.key);
    })
    .map(({ key, skc, profit, dispatch, dispatchQuantity, stores, purchase, min, max }) => ({
      key, skc, stores: [...stores].sort(), dispatch: dispatch.decimal(), dispatchQuantity: dispatchQuantity.toFixed(), salesProfit: profit.minus(dispatch).decimal(), profit: profit.decimal(), purchase: purchase.decimal(), minUnit: min?.toFixed(), maxUnit: max?.toFixed(),
    }));
}
