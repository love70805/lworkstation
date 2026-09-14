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
  const period = data.period, byDay = new Map(), stores = new Map();
  let sourceCount = 0, unlocated = 0, lastDate = null;
  const monthTotalsExact = total();
  for (const row of data.sourceRows ?? []) {
    if (row.isDeduction || /盘亏|扣款|罚款|违约/.test(row.movementType ?? '')) continue;
    const key = salesStoreKey(row.store);
    if (store !== 'all' && key !== salesStoreKey(store)) continue;
    stores.set(key, row.store || '店铺待查'); sourceCount++;
    const revenue = new Exact(row.amountExact ?? row.amount ?? 0), quantity = new Exact(row.quantityExact ?? row.quantity ?? 0);
    monthTotalsExact.revenueExact = new Exact(monthTotalsExact.revenueExact).plus(revenue).toFixed();
    monthTotalsExact.quantityExact = new Exact(monthTotalsExact.quantityExact).plus(quantity).toFixed();
    const parsed = parseSalesAddedDate(row.sourceAddedDate, { period });
    if (parsed.dateStatus !== 'valid') { unlocated++; continue; }
    const date = parsed.sourceAddedDate;
    if (!lastDate || date > lastDate) lastDate = date;
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
    const status = date > today ? 'future' : segments.length || legacy?.sourceRowCount ? 'data' : current && (!cutoff || date > cutoff) ? 'unobserved' : coverage === 'complete' ? 'known_zero' : 'unknown';
    const sums = segments.reduce((sum, segment) => ({ revenueExact: new Exact(sum.revenueExact).plus(segment.revenueExact).toFixed(), quantityExact: new Exact(sum.quantityExact).plus(segment.quantityExact).toFixed() }), total());
    const known = status === 'data' || status === 'known_zero';
    return { date, status, segments, revenueExact: known ? legacy?.revenueExact ?? sums.revenueExact : null, quantityExact: known ? legacy?.quantityExact ?? sums.quantityExact : null };
  });
  return { period, daily, stores: [...stores.values()], coverage, unlocated, cutoff: current ? lastDate : null, isCurrent: current, missingStore: store !== 'all' && !sourceCount && !fallback, monthTotalsExact: fallback ? data.monthTotalsExact : monthTotalsExact };
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
export function salesDayDifference(a, b, metric) {
  return a?.[metric] == null || b?.[metric] == null ? null : new Exact(a[metric]).minus(b[metric]).toFixed();
}
