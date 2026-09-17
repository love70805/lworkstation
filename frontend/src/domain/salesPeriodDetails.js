import Decimal from 'decimal.js';
import { canonicalPlatformSku } from './identifiers';
import { salesStoreKey } from './salesChartModel';
import { parseSalesAddedDate } from './salesAnalytics';

const Exact = Decimal.clone({ precision: 80 });
const empty = () => ({ revenueExact: '0', quantityExact: '0', count: 0 });
const isSale = row => !row.isDeduction && !/盘亏|扣款|罚款|违约/.test(row.movementType ?? '');
function add(target, row) {
  target.revenueExact = new Exact(target.revenueExact).plus(row.amountExact ?? row.amount ?? 0).toFixed();
  target.quantityExact = new Exact(target.quantityExact).plus(row.quantityExact ?? row.quantity ?? 0).toFixed();
  target.count++;
}

// Monthly detail includes unlocated dates; daily detail cannot assign them to a day.
export function aggregatePeriodSalesDetails(rows, { period, date = null }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new Error('分析月份无效。');
  if (date !== null && parseSalesAddedDate(date, { period }).dateStatus !== 'valid') throw new Error('请选择账本月份内的有效日期。');
  const totalsExact = empty(), stores = new Map(), groups = new Map();
  let sourceCount = 0, unlocatedCount = 0;
  for (const row of rows) {
    if (!isSale(row)) continue;
    sourceCount++;
    const parsed = parseSalesAddedDate(row.sourceAddedDate, { period });
    if (parsed.dateStatus !== 'valid') unlocatedCount++;
    if (date && parsed.sourceAddedDate !== date) continue;
    const store = row.store || '店铺待查', storeKey = salesStoreKey(store);
    const platformSkc = String(row.platformSkc ?? '').normalize('NFKC').trim();
    const sku = canonicalPlatformSku(row.platformSku ?? row.sku);
    const key = JSON.stringify([storeKey, platformSkc, platformSkc ? null : sku]);
    if (!stores.has(storeKey)) stores.set(storeKey, { ...empty(), key: storeKey, store });
    if (!groups.has(key)) groups.set(key, { ...empty(), key, store, platformSkc, platformSkus: new Set() });
    const group = groups.get(key);
    if (sku) group.platformSkus.add(sku);
    add(group, row); add(stores.get(storeKey), row); add(totalsExact, row);
  }
  return {
    period, date, unlocatedCount, totalsExact,
    status: totalsExact.count ? 'data' : sourceCount && (!date || !unlocatedCount) ? 'known_zero' : 'unknown',
    stores: [...stores.values()].sort((a, b) => a.key.localeCompare(b.key)),
    rows: [...groups.values()].map(row => ({
      ...row, platformSkus: [...row.platformSkus].sort(),
      averagePriceExact: new Exact(row.quantityExact).isZero() ? null : new Exact(row.revenueExact).div(row.quantityExact).toFixed(),
    })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
