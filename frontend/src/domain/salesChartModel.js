import Decimal from 'decimal.js';
import { canonicalStore } from './batchSalesImport';
import { parseSalesAddedDate } from './salesAnalytics';
const Exact = Decimal.clone({ precision: 80 });
const total = () => ({ revenueExact: '0', quantityExact: '0' });
export const salesStoreKey = name => canonicalStore(name || '店铺待查');
export function salesStoreColor(name) {
  let hash = 2166136261;
  for (const char of salesStoreKey(name)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 52% 35%)`;
}
export function buildSalesMonth(data, { store = 'all', today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) } = {}) {
  const period = data.period, byDay = new Map(), stores = new Map(), byStore = new Map();
  let sourceCount = 0, unlocated = 0, lastDate = null, storePresent = false;
  const monthTotalsExact = total();
  for (const row of data.sourceRows ?? []) {
    const key = salesStoreKey(row.store);
    if (store !== 'all' && key !== salesStoreKey(store)) continue;
    storePresent = true;
    if (row.isDeduction || /盘亏|扣款|罚款|违约/.test(row.movementType ?? '')) continue;
    stores.set(key, row.store || '店铺待查'); sourceCount++;
    const revenue = new Exact(row.amountExact ?? row.amount ?? 0), quantity = new Exact(row.quantityExact ?? row.quantity ?? 0);
    monthTotalsExact.revenueExact = new Exact(monthTotalsExact.revenueExact).plus(revenue).toFixed();
    monthTotalsExact.quantityExact = new Exact(monthTotalsExact.quantityExact).plus(quantity).toFixed();
    // Monthly bars belong to the ledger month, including rows without a usable day.
    if (!byStore.has(key)) byStore.set(key, { ...total(), store: stores.get(key), key });
    const monthly = byStore.get(key);
    monthly.revenueExact = new Exact(monthly.revenueExact).plus(revenue).toFixed();
    monthly.quantityExact = new Exact(monthly.quantityExact).plus(quantity).toFixed();
    const parsed = parseSalesAddedDate(row.sourceAddedDate, { period });
    if (parsed.dateStatus !== 'valid') { unlocated++; continue; }
    const date = parsed.sourceAddedDate;
    if (date <= today && (!lastDate || date > lastDate)) lastDate = date;
    if (!byDay.has(date)) byDay.set(date, new Map());
    const day = byDay.get(date);
    if (!day.has(key)) day.set(key, { ...total(), store: stores.get(key), key });
    const segment = day.get(key);
    segment.revenueExact = new Exact(segment.revenueExact).plus(revenue).toFixed();
    segment.quantityExact = new Exact(segment.quantityExact).plus(quantity).toFixed();
  }
  const fallback = data.sourceRows == null;
  const coverage = fallback ? data.coverage.status : !sourceCount ? 'unknown' : unlocated ? 'partial' : 'complete';
  const [year, month] = period.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const current = period >= today.slice(0, 7);
  const cutoff = current ? (lastDate && lastDate < today ? lastDate : today) : null;
  const daily = Array.from({ length: count }, (_, index) => {
    const date = `${period}-${String(index + 1).padStart(2, '0')}`;
    const segments = [...(byDay.get(date)?.values() ?? [])].sort((a,b) => a.key.localeCompare(b.key));
    const legacy = fallback ? data.daily.find(day => day.date === date) : null;
    if (legacy?.sourceRowCount) segments.push({ store: store === 'all' ? '店铺合计' : store, key: 'legacy-total', revenueExact: legacy.revenueExact, quantityExact: legacy.quantityExact });
    const status = date > today ? 'future' : segments.length || legacy?.sourceRowCount ? 'data' : current && (!cutoff || date > cutoff) ? 'unobserved' : coverage === 'complete' ? 'known_zero' : 'unknown';
    const sums = segments.reduce((sum, segment) => ({ revenueExact: new Exact(sum.revenueExact).plus(segment.revenueExact).toFixed(), quantityExact: new Exact(sum.quantityExact).plus(segment.quantityExact).toFixed() }), total());
    const known = status === 'data' || status === 'known_zero';
    return { date, status, segments, revenueExact: known ? legacy?.revenueExact ?? sums.revenueExact : null, quantityExact: known ? legacy?.quantityExact ?? sums.quantityExact : null };
  });
  const monthlySegments = [...byStore.values()].sort((a, b) => a.key.localeCompare(b.key));
  // Older aggregate-only callers cannot supply an invented per-store breakdown.
  if (fallback && data.monthTotalsExact?.count > 0) monthlySegments.push({ store: store === 'all' ? '店铺合计' : store, key: 'legacy-total', revenueExact: data.monthTotalsExact.revenueExact, quantityExact: data.monthTotalsExact.quantityExact });
  return { period, daily, monthlySegments, stores: [...stores.values()], coverage, unlocated, cutoff: current ? lastDate : null, isCurrent: current, missingStore: store !== 'all' && !storePresent && !fallback, monthTotalsExact: fallback ? data.monthTotalsExact : monthTotalsExact };
}
function nice(value) {
  if (!value) return 0;
  const power = 10 ** Math.floor(Math.log10(value)), fraction = value / power;
  return ([1, 2, 5, 10].find(step => step >= fraction) ?? 10) * power;
}
export function salesScale(months, metric) {
  let high = 0, low = 0;
  for (const month of months) for (const day of month.daily) {
    if (day[metric] == null) continue;
    let positive = 0, negative = 0;
    for (const segment of day.segments) { const value = Number(segment[metric]); if (value >= 0) positive += value; else negative += value; }
    high = Math.max(high, positive); low = Math.min(low, negative);
  }
  const max = nice(high) || (low ? 0 : 1), min = -nice(-low), range = max - min;
  return { max, min, range, zero: max / range * 100 };
}
export function salesSegments(day, metric, scale) {
  let positive = 0, negative = 0;
  const validPercent = day[metric] != null && new Exact(day[metric]).gt(0) && day.segments.every(segment => new Exact(segment[metric]).gte(0));
  return day.segments.map(segment => {
    const value = Number(segment[metric]), height = Math.abs(value) / scale.range * 100;
    const top = value >= 0 ? scale.zero - positive - height : scale.zero + negative;
    if (value >= 0) positive += height; else negative += height;
    return { ...segment, height, top, percent: validPercent ? new Exact(segment[metric]).div(day[metric]).times(100).toDecimalPlaces(1).toFixed() : null };
  });
}
export function salesGroupedScale(months, metric, { monthly = false, hiddenStores = [] } = {}) {
  const hidden = new Set([...hiddenStores].map(salesStoreKey));
  let high = 0, low = 0;
  for (const month of months) {
    if (month.missingStore) continue;
    const groups = monthly ? [{ segments: month.monthlySegments ?? [] }] : month.daily;
    for (const group of groups) {
      if (!monthly && group[metric] == null) continue;
      for (const segment of group.segments) {
        if (hidden.has(salesStoreKey(segment.key)) || hidden.has(salesStoreKey(segment.store)) || segment[metric] == null) continue;
        const value = Number(segment[metric]);
        if (!Number.isFinite(value)) continue;
        high = Math.max(high, value); low = Math.min(low, value);
      }
    }
  }
  const max = nice(high) || (low ? 0 : 1), min = -nice(-low), range = max - min;
  return { max, min, range, zero: max / range * 100 };
}
export function salesGroupedSegments(day, metric, scale) {
  if (day[metric] == null) return [];
  const segments = day.segments.filter(segment => segment[metric] != null && Number.isFinite(Number(segment[metric])));
  const validPercent = new Exact(day[metric]).gt(0) && segments.every(segment => new Exact(segment[metric]).gte(0));
  return segments.map(segment => {
    const value = Number(segment[metric]), height = Math.abs(value) / scale.range * 100;
    return { ...segment, height, top: value >= 0 ? scale.zero - height : scale.zero, percent: validPercent ? new Exact(segment[metric]).div(day[metric]).times(100).toDecimalPlaces(1).toFixed() : null };
  });
}
export function salesDayDifference(a, b, metric) {
  return a?.[metric] == null || b?.[metric] == null ? null : new Exact(a[metric]).minus(b[metric]).toFixed();
}
