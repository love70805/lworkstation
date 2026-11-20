import Decimal from 'decimal.js';
import { canonicalPlatformSku } from './identifiers';
import { salesStoreKey } from './salesChartModel';
import { parseSalesAddedDate } from './salesAnalytics';
import { storeSkuKey } from './manualCostOverride';

const Exact = Decimal.clone({ precision: 80 });
const empty = () => ({ revenueExact: '0', quantityExact: '0', count: 0 });
const isSale = row => !row.isDeduction && !/盘亏|扣款|罚款|违约/.test(row.movementType ?? '');
export const salesProductKey = (store, skc, sku) => JSON.stringify([salesStoreKey(store), skc, skc ? null : sku]);
function add(target, row) {
  target.revenueExact = new Exact(target.revenueExact).plus(row.amountExact ?? row.amount ?? 0).toFixed();
  target.quantityExact = new Exact(target.quantityExact).plus(row.quantityExact ?? row.quantity ?? 0).toFixed();
  target.count++;
}
function average(row) {
  return new Exact(row.quantityExact).isZero() ? null : new Exact(row.revenueExact).div(row.quantityExact).toFixed();
}

// Monthly detail includes unlocated dates; daily detail cannot assign them to a day.
export function aggregatePeriodSalesDetails(rows, { period, date = null }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new Error('分析月份无效。');
  if (date !== null && parseSalesAddedDate(date, { period }).dateStatus !== 'valid') throw new Error('请选择账本月份内的有效日期。');
  const totalsExact = empty(), stores = new Map(), groups = new Map(), skus = new Map(), unlocatedByStore = new Map();
  let sourceCount = 0, unlocatedCount = 0;
  for (const row of rows) {
    if (!isSale(row)) continue;
    sourceCount++;
    const parsed = parseSalesAddedDate(row.sourceAddedDate, { period });
    const store = row.store || '店铺待查', storeKey = salesStoreKey(store);
    if (parsed.dateStatus !== 'valid') {
      unlocatedCount++;
      unlocatedByStore.set(storeKey, (unlocatedByStore.get(storeKey) ?? 0) + 1);
    }
    if (date && parsed.sourceAddedDate !== date) continue;
    const platformSkc = String(row.platformSkc ?? '').normalize('NFKC').trim();
    const sku = canonicalPlatformSku(row.platformSku ?? row.sku);
    const key = salesProductKey(store, platformSkc, sku);
    if (!stores.has(storeKey)) stores.set(storeKey, { ...empty(), key: storeKey, store });
    if (!groups.has(key)) groups.set(key, { ...empty(), key, store, platformSkc, platformSkus: new Set() });
    const group = groups.get(key);
    if (sku) group.platformSkus.add(sku);
    const skuKey = sku ? storeSkuKey(store, sku) : JSON.stringify([storeKey, null, platformSkc]);
    if (!skus.has(skuKey)) skus.set(skuKey, { ...empty(), key: skuKey, store, platformSku: sku, parents: new Set() });
    const skuRow = skus.get(skuKey);
    if (platformSkc) skuRow.parents.add(platformSkc);
    add(skuRow, row); add(group, row); add(stores.get(storeKey), row); add(totalsExact, row);
  }
  return {
    period, date, unlocatedCount, unlocatedByStore: Object.fromEntries(unlocatedByStore), totalsExact,
    status: totalsExact.count ? 'data' : sourceCount && (!date || !unlocatedCount) ? 'known_zero' : 'unknown',
    stores: [...stores.values()].sort((a, b) => a.key.localeCompare(b.key)),
    rows: [...groups.values()].map(row => ({
      ...row, platformSkus: [...row.platformSkus].sort(),
      averagePriceExact: average(row),
    })).sort((a, b) => a.key.localeCompare(b.key)),
    skuRows: [...skus.values()].map(({ parents, ...row }) => ({ ...row, platformSkc: [...parents].sort().join('、'), averagePriceExact: average(row) })),
  };
}
