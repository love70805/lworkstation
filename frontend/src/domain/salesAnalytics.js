import Decimal from "decimal.js";
import { canonicalPlatformSku } from "./identifiers";

const Exact = Decimal.clone({ precision: 80 });
export const SALES_TIMEZONE = "Asia/Shanghai";
export function decimalSource(value, fallback = "0") {
  if (value == null || String(value).trim() === "") return fallback;
  const text = String(value).trim();
  const cleaned = text.replace(/[,$¥￥%\s()]/g, "");
  try {
    const number = new Exact(/^\(.*\)$/.test(text) ? `-${cleaned}` : cleaned);
    return number.isFinite() ? number.toFixed() : null;
  } catch { return null; }
}

export function parseSalesAddedDate(value, { period, date1904 = false } = {}) {
  const rawAddedAt = String(value ?? "").trim();
  const result = { rawAddedAt, sourceAddedDate: null, dateStatus: rawAddedAt ? "invalid" : "missing", timezone: SALES_TIMEZONE };
  if (!rawAddedAt) return result;
  let date;
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(rawAddedAt)) {
    const serial = Number(value);
    // Excel's fictitious 1900-02-29 is not a valid calendar date.
    if (!Number.isFinite(serial) || serial < 0 || (!date1904 && Math.floor(serial) === 60)) return result;
    const origin = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const days = Math.floor(serial) - (!date1904 && serial >= 60 ? 1 : 0);
    const instant = new Date(origin + days * 86400000);
    if (!Number.isFinite(instant.getTime())) return result;
    date = instant.toISOString().slice(0, 10);
  } else {
    const match = rawAddedAt.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
    if (!match) return result;
    const [, y, m, d, h = "0", min = "0", sec = "0", zone] = match;
    const instant = new Date(Date.UTC(+y, +m - 1, +d));
    if (instant.getUTCFullYear() !== +y || instant.getUTCMonth() !== +m - 1 || instant.getUTCDate() !== +d || +h > 23 || +min > 59 || +sec > 59) return result;
    date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (zone) {
      const timestamp = Date.parse(`${date}T${h.padStart(2, "0")}:${min}:${sec}${zone}`);
      if (!Number.isFinite(timestamp)) return result;
      date = new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return result;
  return { ...result, sourceAddedDate: date, dateStatus: period && !date.startsWith(`${period}-`) ? "out_of_period" : "valid" };
}

const emptyTotal = () => ({ quantityExact: "0", revenueExact: "0", count: 0 });
const isSale = row => !row.isDeduction && !/盘亏|扣款|罚款|违约/.test(row.movementType ?? "");
function add(total, row) {
  total.quantityExact = new Exact(total.quantityExact).plus(row.quantityExact ?? row.quantity ?? 0).toFixed();
  total.revenueExact = new Exact(total.revenueExact).plus(row.amountExact ?? row.amount ?? 0).toFixed();
  total.count += 1;
}
export function aggregateDailySales(rows = [], { period } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "")) throw new Error("分析月份无效。");
  const dailyMap = new Map();
  const monthTotalsExact = emptyTotal();
  const undated = emptyTotal();
  const outOfPeriod = { ...emptyTotal(), rows: [] };
  const skus = new Map();
  for (const row of rows) {
    // Standard imports already select the two shipment types. Generic imports
    // retain their established sale semantics, excluding losses and deductions.
    if (!isSale(row)) continue;
    add(monthTotalsExact, row);
    const parsed = parseSalesAddedDate(row.sourceAddedDate, { period });
    if (parsed.dateStatus === "valid") {
      if (!dailyMap.has(parsed.sourceAddedDate)) dailyMap.set(parsed.sourceAddedDate, emptyTotal());
      add(dailyMap.get(parsed.sourceAddedDate), row);
    } else {
      add(undated, row);
      if (parsed.dateStatus === "out_of_period") {
        add(outOfPeriod, row);
        outOfPeriod.rows.push({ sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, date: parsed.sourceAddedDate });
      }
    }
    const sku = canonicalPlatformSku(row.platformSku ?? row.sku);
    const key = JSON.stringify([String(row.store ?? "").normalize("NFKC").trim().toUpperCase(), sku]);
    if (!skus.has(key)) skus.set(key, { ...emptyTotal(), store: row.store, platformSku: sku, attributes: new Set(), prices: [], activities: new Set(), knownActivityCount: 0 });
    const stat = skus.get(key);
    add(stat, row);
    stat.attributes.add(row.attribute ?? "");
    const price = decimalSource(row.unitPriceRaw ?? row.unitPrice, null);
    if (price !== null && new Exact(price).gte(0)) stat.prices.push(new Exact(price));
    if (row.activityStatus === "known" && String(row.activityRaw ?? "").trim()) {
      stat.knownActivityCount += 1;
      stat.activities.add(row.activityRaw);
    }
  }
  const coverage = { status: monthTotalsExact.count === 0 ? "unknown" : undated.count ? "partial" : "complete", sourceRowCount: monthTotalsExact.count, datedRowCount: monthTotalsExact.count - undated.count };
  if (coverage.status === "complete") {
    const [year, month] = period.split("-").map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const date = `${period}-${String(day).padStart(2, "0")}`;
      if (!dailyMap.has(date)) dailyMap.set(date, emptyTotal());
    }
  }
  return { period, timezone: SALES_TIMEZONE, coverage, daily: [...dailyMap].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, quantityExact: total.quantityExact, revenueExact: total.revenueExact, sourceRowCount: total.count })), undated, outOfPeriod, monthTotalsExact,
    skuStats: [...skus.values()].map(({ prices, attributes, activities, ...stat }) => ({ ...stat, attributes: [...attributes], activities: [...activities], averagePriceExact: new Exact(stat.quantityExact).isZero() ? null : new Exact(stat.revenueExact).div(stat.quantityExact).toFixed(), minPriceExact: prices.length ? Exact.min(...prices).toFixed() : null, maxPriceExact: prices.length ? Exact.max(...prices).toFixed() : null, priceRowCount: prices.length, activityStatus: stat.knownActivityCount === stat.count ? "complete" : stat.knownActivityCount ? "partial" : "missing" })) };
}

// Only selected-day rows enter SKU/attribute/activity aggregation. A source with
// unlocated dates cannot establish that an otherwise empty day was zero.
export function aggregateDailySalesDetails(rows = [], { period, date } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || parseSalesAddedDate(date, { period }).dateStatus !== "valid") throw new Error("请选择账本月份内的有效日期。");
  const totals = emptyTotal(), groups = new Map();
  let sourceCount = 0, unlocatedCount = 0;
  for (const row of rows) {
    if (!isSale(row)) continue;
    sourceCount++;
    const parsed = parseSalesAddedDate(row.sourceAddedDate, { period });
    if (parsed.dateStatus !== "valid") { unlocatedCount++; continue; }
    if (parsed.sourceAddedDate !== date) continue;
    add(totals, row);
    const sku = canonicalPlatformSku(row.platformSku ?? row.sku);
    const key = JSON.stringify([String(row.store ?? "").normalize("NFKC").trim().toUpperCase(), sku]);
    if (!groups.has(key)) groups.set(key, { ...emptyTotal(), key, store: row.store, platformSku: sku, attributes: new Set(), activities: [] });
    const group = groups.get(key);
    add(group, row);
    if (row.attribute) group.attributes.add(row.attribute);
    if (row.activityStatus === "known" && String(row.activityRaw ?? "").trim()) group.activities.push({ raw: row.activityRaw, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow });
  }
  const status = totals.count ? "data" : sourceCount && !unlocatedCount ? "known_zero" : "unknown";
  return { date, period, status, unlocatedCount, totalsExact: status === "unknown" ? { quantityExact: null, revenueExact: null, count: 0 } : totals,
    rows: [...groups.values()].map(({ attributes, ...group }) => ({ ...group, attributes: [...attributes], averagePriceExact: new Exact(group.quantityExact).isZero() ? null : new Exact(group.revenueExact).div(group.quantityExact).toFixed(), activityStatus: group.activities.length === group.count ? "complete" : group.activities.length ? "partial" : "missing" })) };
}
