import Decimal from 'decimal.js';
import { canonicalPlatformSku } from './identifiers';
import { salesStoreKey } from './salesChartModel';
import { parseSalesAddedDate } from './salesAnalytics';
import { storeSkuKey } from './manualCostOverride';
import { canonicalStore } from './batchSalesImport';

const Exact = Decimal.clone({ precision: 80 });
const empty = () => ({ revenueExact: '0', quantityExact: '0', count: 0 });
const excludedMovement = /盘亏|扣款|罚款|违约/;
export const salesProductKey = (store, skc, sku) => JSON.stringify([salesStoreKey(store), skc, skc ? null : sku]);
function add(target, row) {
  target.revenueExact = new Exact(target.revenueExact).plus(row.amountExact ?? row.amount ?? 0).toFixed();
  target.quantityExact = new Exact(target.quantityExact).plus(row.quantityExact ?? row.quantity ?? 0).toFixed();
  target.count++;
}
function average(row) {
  return new Exact(row.quantityExact).isZero() ? null : new Exact(row.revenueExact).div(row.quantityExact).toFixed();
}

// Decode the date and store dictionaries before walking each chunk. Read product and amount
// fields only for matching rows, while still counting unlocated sales in the selected stores.
function* packedPeriodRows(chunks, { period, date, store }, coverage) {
  const selected = store === 'all' ? null : canonicalStore(store);
  for (const { count, columns } of chunks) {
    const cells = Object.fromEntries(columns.map(([field, values, codes]) => [field, { values, codes }]));
    const accessor = (field, transform) => {
      const column = cells[field];
      if (!column) return () => undefined;
      const values = transform ? column.values.map(transform) : column.values;
      return index => values[(column.codes ? column.codes[index] : 1) - 1];
    };
    const dateAt = accessor('sourceAddedDate', value => {
      const parsed = parseSalesAddedDate(value, { period });
      return parsed.dateStatus === 'valid' ? parsed.sourceAddedDate : null;
    });
    const storeAt = accessor('store'), storeKeyAt = accessor('store', canonicalStore);
    const deduction = accessor('isDeduction'), excluded = accessor('movementType', type => excludedMovement.test(type ?? ''));
    const skc = accessor('platformSkc'), sku = accessor('platformSku'), legacySku = accessor('sku');
    const amount = accessor('amountExact'), legacyAmount = accessor('amount');
    const quantity = accessor('quantityExact'), legacyQuantity = accessor('quantity');
    for (let i = 0; i < count; i++) {
      if (deduction(i) || excluded(i) || (selected !== null && (storeKeyAt(i) ?? '') !== selected)) continue;
      const store = storeAt(i), day = dateAt(i);
      if (!inPeriod(coverage, day, date, store)) continue;
      yield { store, platformSkc: skc(i), platformSku: sku(i) ?? legacySku(i),
        amountExact: amount(i) ?? legacyAmount(i), quantityExact: quantity(i) ?? legacyQuantity(i) };
    }
  }
}

function inPeriod(coverage, day, selectedDay, store) {
  coverage.sourceCount++;
  if (!day) {
    coverage.unlocatedCount++;
    const key = salesStoreKey(store || '店铺待查');
    coverage.byStore.set(key, (coverage.byStore.get(key) ?? 0) + 1);
  }
  return !selectedDay || day === selectedDay;
}

function* rawPeriodRows(rows, { period, date }, coverage) {
  for (const row of rows) {
    if (row.isDeduction || excludedMovement.test(row.movementType ?? '')) continue;
    const parsed = parseSalesAddedDate(row.sourceAddedDate, { period });
    if (inPeriod(coverage, parsed.dateStatus === 'valid' ? parsed.sourceAddedDate : null, date, row.store)) yield row;
  }
}

// Monthly detail includes unlocated dates; daily detail cannot assign them to a day.
export function aggregatePeriodSalesDetails(rows, { period, date = null, store = 'all', detailChunks }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new Error('分析月份无效。');
  if (date !== null && parseSalesAddedDate(date, { period }).dateStatus !== 'valid') throw new Error('请选择账本月份内的有效日期。');
  const totalsExact = empty(), stores = new Map(), groups = new Map(), skus = new Map();
  const coverage = { sourceCount: 0, unlocatedCount: 0, byStore: new Map() };
  const selected = detailChunks ? packedPeriodRows(detailChunks, { period, date, store }, coverage) : rawPeriodRows(rows, { period, date }, coverage);
  for (const row of selected) {
    const store = row.store || '店铺待查', storeKey = salesStoreKey(store);
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
  const { sourceCount, unlocatedCount, byStore } = coverage;
  return {
    period, date, unlocatedCount, unlocatedByStore: Object.fromEntries(byStore), totalsExact,
    status: totalsExact.count ? 'data' : sourceCount && (!date || !unlocatedCount) ? 'known_zero' : 'unknown',
    stores: [...stores.values()].sort((a, b) => a.key.localeCompare(b.key)),
    rows: [...groups.values()].map(row => ({
      ...row, platformSkus: [...row.platformSkus].sort(),
      averagePriceExact: average(row),
    })).sort((a, b) => a.key.localeCompare(b.key)),
    skuRows: [...skus.values()].map(({ parents, ...row }) => ({ ...row, platformSkc: [...parents].sort().join('、'), averagePriceExact: average(row) })),
  };
}
