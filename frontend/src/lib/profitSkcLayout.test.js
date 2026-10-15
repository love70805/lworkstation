import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildProfitReportWorkbook, bytesToBase64, prepareReportDownload } from './profitReportWorkbook';
import { buildProfitReportWorkbook as buildV4 } from '../testFixtures/twoDecimalProfitReportWorkbook';
import { reportTotals, sha256 } from '../domain/profitReports';

const product = (sku, skc, store = '甲店', overrides = {}) => ({
  store, platformSku: sku, platformSkc: skc, groupSkc: skc, attribute: '白色 $1 & <细款>',
  quantityExact: '2', revenueExact: '20.009', unitCostExact: '0.009999',
  purchaseCostExact: '0.019998', warehouseCostExact: '1.4', profitExact: '18.589002',
  orderNumber: '000123456789012345678901', ...overrides,
});
const report = (products, kind) => ({ kind, period: '2026-09', revision: 1, warehouseRateExact: '0.7', totalsExact: reportTotals(products, '0', '0.7') });
const read = bytes => XLSX.read(bytes, { type: 'array', cellStyles: true, bookFiles: true });
const merges = sheet => (sheet['!merges'] ?? []).map(range => XLSX.utils.encode_range(range));
const detail = sheet => XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }).slice(1).filter(row => row[1]);
const valuesBySku = sheet => Object.fromEntries(detail(sheet).map(row => [row[1], row.slice(1, 10)]));
const literalNumbers = book => Object.fromEntries(Object.entries(book.files).filter(([name]) => /^xl\/worksheets\//.test(name)).map(([name, entry]) => [name, [...new TextDecoder().decode(entry.content).matchAll(/<c\b([^>]*)t="n"[^>]*><v>([^<]+)<\/v><\/c>/g)].map(match => match[2]).sort()]));

it.each(['pre_deduction', 'financial'])('groups and merges SKC in summary/store sheets of %s without losing any SKU', kind => {
  const products = [product('A1', 'SKC-A'), product('B1', 'SKC-B'), product('A2', 'ＳＫＣ-Ａ'), product('A3', 'skc-a'), product('E1', 'SKC-A', '乙店'), product('E2', 'SKC-A', '乙店')];
  const before = structuredClone(products), built = buildProfitReportWorkbook({ report: report(products, kind), products });
  const book = read(built.bytes), first = book.Sheets['甲店'], second = book.Sheets['乙店'];
  expect(merges(first)).toEqual(['A2:A4']); expect(merges(second)).toEqual(['A2:A3']);
  expect(merges(book.Sheets['汇总表'])).toEqual(['A2:J2', 'A3:A5', 'A8:J8', 'A9:A10']);
  expect(detail(first).map(row => row[1])).toEqual(['A1', 'A2', 'A3', 'B1']);
  expect(first.A2).toMatchObject({ t: 's', v: 'SKC-A' }); expect(first.A3.v).toBe('');
  expect(first.F2).toMatchObject({ t: 's', v: '000123456789012345678901' });
  expect(first.C3.v).toBe('白色 $1 & <细款>'); expect(first.J6.v).toBe(74.35);
  expect(first.A2.s).toEqual(first.A3.s); expect(first.B2.s).not.toEqual(first.B3.s);
  expect(book.Sheets['代发表']['!merges']).toBeUndefined();
  if (kind === 'financial') expect(book.Sheets['扣款']['!merges']).toBeUndefined();
  expect(new TextDecoder().decode(built.bytes)).toContain('vertical="center"');
  expect(products).toEqual(before);
});

it('does not merge blank SKCs, fallback supplier labels, singleton groups or totals', () => {
  const products = [product('EMPTY1', ''), product('EMPTY2', ''), product('F1', '', '甲店', { groupSkc: '同一供方' }), product('F2', '', '甲店', { groupSkc: '同一供方' }), product('ONE', 'SINGLE')];
  const book = read(buildProfitReportWorkbook({ report: report(products, 'pre_deduction'), products }).bytes);
  expect(merges(book.Sheets['甲店'])).toEqual([]); expect(merges(book.Sheets['汇总表'])).toEqual(['A2:J2']);
  expect(detail(book.Sheets['甲店'])).toHaveLength(5);
});

it.each(['pre_deduction', 'financial'])('adds merges when re-downloading frozen v4 %s without recalculating stored amounts', async kind => {
  const products = [product('A1', 'SKC-A'), product('B1', 'SKC-B'), product('A2', 'SKC-A'), product('A3', 'SKC-A'), product('E1', 'SKC-A', '乙店'), product('E2', 'SKC-A', '乙店')];
  const header = report(products, kind), built = buildV4({ report: header, products });
  const archive = { ...header, templateVersion: built.templateVersion, fileName: built.fileName, fileBase64: bytesToBase64(built.bytes), fileSha256: await sha256(built.bytes) };
  const before = structuredClone(archive), original = read(built.bytes), bytes = await prepareReportDownload(archive), result = read(bytes);
  expect(merges(result.Sheets['甲店'])).toEqual(['A2:A4']); expect(merges(result.Sheets['乙店'])).toEqual(['A2:A3']);
  expect(result.SheetNames).toEqual(original.SheetNames);
  for (const store of ['甲店', '乙店']) expect(valuesBySku(result.Sheets[store])).toEqual(valuesBySku(original.Sheets[store]));
  expect(result.Sheets['甲店'].H6.v).toBe(0.07); // NOT 0.01 × 4 after row truncation.
  expect(result.Sheets['甲店'].J6.v).toBe(74.35);
  expect(result.Sheets['甲店'].C2.v).toBe('白色 $1 & <细款>');
  for (const name of original.SheetNames) {
    const a = original.Sheets[name], b = result.Sheets[name];
    for (const address of Object.keys(a).filter(address => /^[L-Z]+\d+$/.test(address))) expect(b[address]?.v).toBe(a[address]?.v);
  }
  expect(literalNumbers(result)).toEqual(literalNumbers(original));
  expect(new TextDecoder().decode(result.files['xl/styles.xml'].content)).toBe(new TextDecoder().decode(original.files['xl/styles.xml'].content));
  expect(archive).toEqual(before);
});

it('keeps current merged archives byte-identical on repeated downloads', async () => {
  const products = [product('ONE', 'A'), product('TWO', 'A')], header = report(products, 'pre_deduction');
  const built = buildProfitReportWorkbook({ report: header, products });
  const archive = { ...header, templateVersion: built.templateVersion, fileBase64: bytesToBase64(built.bytes), fileSha256: await sha256(built.bytes) };
  expect(await sha256(await prepareReportDownload(archive))).toBe(await sha256(built.bytes));
});
