import { parseSalesAddedDate } from './salesAnalytics';

export const UNKNOWN_DISPATCH_MONTH = '未识别月份';
const text = value => String(value ?? '').normalize('NFKC').trim();

function namedMonth(name, year) {
  const value = text(name);
  if (/(?<!\d)(?:1[0-2]|0?[1-9])\s*(?:月)?\s*[-~至到—]\s*(?:1[0-2]|0?[1-9])\s*月/.test(value)) return UNKNOWN_DISPATCH_MONTH;
  const months = new Set();
  // A bare number often identifies a store. Require a year or a 月 marker.
  for (const match of value.matchAll(/(?<!\d)(19\d\d|20\d\d)(0[1-9]|1[0-2])(?!\d)/g)) months.add(match[1] + '-' + match[2]);
  for (const match of value.matchAll(/(?<!\d)(?:(\d{4})\s*[-./年]\s*(1[0-2]|0?[1-9])(?!\d)|(1[0-2]|0?[1-9])\s*月)/g)) {
    months.add(`${match[1] ?? year}-${(match[2] ?? match[3]).padStart(2,'0')}`);
  }
  return months.size === 1 ? [...months][0] : months.size ? UNKNOWN_DISPATCH_MONTH : null;
}

function rowMonth(value, year, date1904, monthColumn) {
  let raw = text(value);
  const monthOnly = /^(?:(\d{4})[-/.年])?(1[0-2]|0?[1-9])月?$/.exec(raw);
  if (monthOnly && (monthOnly[1] || raw.endsWith('月') || monthColumn)) return (monthOnly[1] || year) + '-' + monthOnly[2].padStart(2,'0');
  const compactMonth = /^(19\d\d|20\d\d)(0[1-9]|1[0-2])$/.exec(raw);
  if (compactMonth && monthColumn) return compactMonth[1] + '-' + compactMonth[2];
  if (/^\d{1,2}[-/.月]\d{1,2}日?$/.test(raw)) raw = year + '-' + raw;
  raw = raw.replace(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/, '$1-$2-$3').replace(/^(\d{4})-(\d{1,2})\./, '$1-$2-');
  return parseSalesAddedDate(raw, { date1904 }).sourceAddedDate?.slice(0, 7) ?? UNKNOWN_DISPATCH_MONTH;
}

export function dispatchSourcePeriods(source, ledgerPeriod) {
  const year = ledgerPeriod.slice(0, 4);
  const fileMonth = namedMonth(source.fileName, year);
  const fileYear = fileMonth?.match(/^\d{4}/)?.[0] ?? text(source.fileName).match(/(?<!\d)(\d{4})年/)?.[1] ?? year;
  const sheetMonth = namedMonth(source.sheetName, fileYear);
  const fallback = sheetMonth ?? fileMonth ?? UNKNOWN_DISPATCH_MONTH;
  const dateYear = fallback.match(/^\d{4}/)?.[0] ?? fileYear;
  const start = source.sourceRows ? source.sourceRows.indexOf(Number(source.headerRow)) : source.headerRow - 1;
  if (start < 0 || start >= source.cells.length) return { rows: [], periods: [] };
  const { date, owner, quantity, businessId } = source.mapping;
  const monthColumn = /月份|年月/.test(text(source.cells[start]?.[Number(date)]));
  const mergedDates = new Map();
  for (const range of source.merges ?? []) {
    if (range.s.c !== Number(date) || range.e.c !== Number(date)) continue;
    const value = source.cells[range.s.r]?.[Number(date)];
    for (let index = range.s.r + 1; index <= Math.min(range.e.r, source.cells.length - 1); index++) mergedDates.set(index, value);
  }
  let previous = null, previousOwner = '';
  const rows = [], periods = new Set();
  for (let index = start + 1; index < source.cells.length; index++) {
    const cells = source.cells[index];
    const repeatedHeader = Number(quantity) >= 0 && text(source.cells[start]?.[Number(quantity)]) && text(cells[Number(quantity)]) === text(source.cells[start][Number(quantity)]);
    const total = !text(cells[Number(businessId)]) && cells.some(value => /^(合计|总计|小计|总合计|汇总)([:：\s]|$)/.test(text(value)));
    if (!cells.some(value => text(value)) || repeatedHeader || total) {
      previous = null; previousOwner = ''; continue;
    }
    const first = text(cells[0]);
    const dateValue = text(cells[Number(date)]) || text(mergedDates.get(index))
      || (Number(date) < 0 && /^(?:\d{4}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?$/.test(first) ? first : '');
    const ownerValue = text(cells[Number(owner)]);
    const continuation = !ownerValue || ownerValue === previousOwner;
    const period = dateValue ? rowMonth(dateValue, dateYear, source.date1904, monthColumn) : (continuation ? previous : null) ?? fallback;
    rows[index] = period;
    periods.add(period);
    previous = period;
    if (ownerValue) previousOwner = ownerValue;
  }
  return { rows, periods: [...periods] };
}
