import { CostFraction, Exact } from './profitAmounts';
import { priceReportGroups } from './profitReports';
import { profitCostWithinPeriod } from './profitPageProjection';
import { storeSkuKey } from './manualCostOverride';
import { salesProductKey } from './salesPeriodDetails';
import { salesStoreKey } from './salesChartModel';
import { parseSalesAddedDate } from './salesAnalytics';
import { canonicalPlatformSku } from './identifiers';

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

// Establish identity and price against the whole ledger, even when a day or store is selected.
// Monthly dispatch and deductions have no sale-line identity. The monthly profit report owns them.
export function buildSalesProfitAnalysis({ ledger, identities, costs, approvals, groups, rows, store = 'all' }) {
  const lines = priceReportGroups({ ledger, salesRows: identities, erpCosts: costs, approvals, allowMissing: true }, groups, profitCostWithinPeriod);
  const inScope = name => store === 'all' || salesStoreKey(name) === salesStoreKey(store);
  const month = periodBucket(), days = new Map(), prices = new Map();
  for (const line of lines) {
    if (!inScope(line.store)) continue;
    addLine(month, line);
    if (rows) prices.set(storeSkuKey(line.store, line.platformSku), line);
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
        date, skc: sale.platformSkc, revenue: new Exact(0), quantity: new Exact(0),
        price: prices.get(identity) ?? { store: sale.store, canonicalPlatformSku: canonicalPlatformSku(sku), unitCostExact: null },
      }));
      group.revenue = group.revenue.plus(sale.amountExact ?? sale.amount);
      group.quantity = group.quantity.plus(sale.quantityExact ?? sale.quantity);
    }
    for (const { date, price, skc, revenue, quantity } of byDaySku.values()) {
      const warehouse = quantity.times(ledger.warehouseRate ?? '0.7');
      const purchase = price.unitCostExact == null ? null : CostFraction.from(price.unitCostFraction ?? price.unitCostExact).times(quantity);
      const profit = purchase && CostFraction.from(revenue).minus(warehouse).minus(purchase);
      addLine(get(days, date, periodBucket), {
        store: price.store, platformSkc: skc, canonicalPlatformSku: price.canonicalPlatformSku,
        revenueExact: revenue, quantityExact: quantity, warehouseCostExact: warehouse,
        purchaseCostFraction: purchase?.pair(), profitFraction: profit?.pair(), profitExact: profit?.decimal(),
      });
    }
  }
  return { accountingMode: ledger.accountingMode, month: finishPeriod(month), days: mapValues(days, finishPeriod) };
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
  return { ...month, accountingMode: analysis.accountingMode,
    monthTotalsExact: withAmounts(month.monthTotalsExact, analysis.month.total),
    monthlySegments: (month.monthlySegments ?? []).map(row => withAmounts(row, analysis.month.stores[salesStoreKey(row.store)])),
    daily: month.daily.map(day => {
      if (!['data', 'known_zero'].includes(day.status)) return day;
      const period = analysis.days[day.date];
      return { ...withAmounts(day, period?.total ?? (day.status === 'known_zero' ? zeroAmounts : null)),
        segments: day.segments.map(row => withAmounts(row, period?.stores[salesStoreKey(row.store)])) };
    }),
  };
}
export function withDetailProfit(detail, analysis, date) {
  if (!detail || !analysis?.month || detail.status === 'unknown') return detail;
  const period = date ? analysis.days[date] : analysis.month;
  return { ...detail, accountingMode: analysis.accountingMode, hasProfitAnalysis: true,
    totalsExact: withAmounts(detail.totalsExact, period?.total ?? (detail.status === 'known_zero' ? zeroAmounts : null)),
    stores: detail.stores.map(row => withAmounts(row, period?.stores[salesStoreKey(row.store)])),
    rows: detail.rows.map(row => withAmounts(row, period?.products[row.key])),
  };
}

export function combinedProfit(rows) {
  if (!rows.length || rows.some(row => row?.profitExact == null)) return null;
  return rows.reduce((sum, row) => sum.plus(row.profitFraction ?? row.profitExact), zero()).decimal();
}
