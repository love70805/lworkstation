import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';
import { reportTotals, sha256, REPORT_TEMPLATE_VERSION } from '../domain/profitReports';
import { buildProfitReportWorkbook, bytesToBase64, prepareReportDownload, writeReportArchive } from './profitReportWorkbook';
import { formatSavedReportLayout } from './savedReportLayout';
import { lowerSavedReportSummary, unfreezeReportSheet } from './reportSummaryLayout';

const legacyHeader = { L1: { v: '店铺' }, M1: { v: '销量' }, N1: { v: '利润' } };
const oldXml = '<worksheet><dimension ref="A1:N7"/><sheetData>'
  + '<row r="1"><c r="A1" t="inlineStr"><is><t>SKC</t></is></c><c r="L1" t="inlineStr"><is><t>店铺</t></is></c><c r="M1" t="inlineStr"><is><t>销量</t></is></c><c r="N1" t="inlineStr"><is><t>利润</t></is></c></row>'
  + '<row r="2"><c r="A2" t="inlineStr"><is><t>000012345678901234567890</t></is></c><c r="J2" t="n"><v>12.3456789</v></c><c r="L2" t="inlineStr"><is><t>00027</t></is></c><c r="M2" t="n"><v>35</v></c><c r="N2" t="n"><v>-0.0000000001</v></c></row>'
  + '<row r="3"><c r="A3"/><c r="L3"/></row>'
  + '<row r="7"><c r="L7" t="inlineStr"><is><t>利润合计</t></is></c><c r="N7" t="n"><v>31083.89</v></c></row>'
  + '</sheetData><mergeCells><mergeCell ref="A2:A3"/><mergeCell ref="L2:L3"/></mergeCells></worksheet>';
const read = bytes => XLSX.read(bytes, { type: 'array', bookFiles: true, cellStyles: true });
const xmlFile = (book, file) => new TextDecoder().decode(book.files[file].content);
const archive = book => new Map(Object.entries(book.files).filter(([name, entry]) => name && entry.type === 2 && name !== '\u0001Sh33tJ5').map(([name, entry]) => [name, new Uint8Array(entry.content)]));
const products = [{ store: '00027', groupSkc: '000012345678901234567890', platformSku: 'SKU-00001', attribute: '蓝色', quantityExact: '35', revenueExact: '40', unitCostExact: '0.2', purchaseCostExact: '7', warehouseCostExact: '24.5', profitExact: '8.5' }];
const dispatchRows = [{ store: '00027', platformSkc: products[0].groupSkc, businessId: 'PB000123', quantityExact: '35', order1688: '000012345678901234567890' }];
const deductions = [{ store: '00027', businessId: '0001', signedAmountExact: '-0.000000001' }];
const reportFor = kind => ({ kind, period: '2026-10', revision: 1, totalsExact: reportTotals(products, '35', '0.7', kind === 'financial' ? deductions : []) });

it('moves the entire old right summary down one row while preserving left values, raw numeric precision and independent merges', () => {
  const output = lowerSavedReportSummary(oldXml, legacyHeader);
  expect(output).toContain('<dimension ref="A1:N8"/>');
  expect(output).not.toContain('r="L1"');
  for (const expected of ['<c r="L2" t="inlineStr"><is><t>店铺</t></is></c>', '<c r="L3" t="inlineStr"><is><t>00027</t></is></c>', '<c r="N3" t="n"><v>-0.0000000001</v></c>', '<c r="N8" t="n"><v>31083.89</v></c>', '<c r="A2" t="inlineStr"><is><t>000012345678901234567890</t></is></c>', '<c r="J2" t="n"><v>12.3456789</v></c>', 'ref="A2:A3"', 'ref="L3:L4"']) expect(output).toContain(expected);
  expect(lowerSavedReportSummary(output, { L2: { v: '店铺' } })).toBe(output);
});

it('rejects an overflowing or cross-block legacy layout rather than silently dropping its contents', () => {
  expect(() => lowerSavedReportSummary(oldXml.replaceAll('r="N7"', 'r="N1048576"').replace('r="7"', 'r="1048576"'), legacyHeader)).toThrow('汇总布局信息不足');
  expect(() => lowerSavedReportSummary(oldXml.replace('ref="L2:L3"', 'ref="J2:L3"'), legacyHeader)).toThrow('汇总布局信息不足');
  expect(() => lowerSavedReportSummary(oldXml.replace('ref="L2:L3"', 'ref="L2:L1048576"'), legacyHeader)).toThrow('汇总布局信息不足');
  expect(() => lowerSavedReportSummary(oldXml.replace('<sheetData>', '<sheetData><unexpected/>'), legacyHeader)).toThrow('汇总布局信息不足');
});

it('removes frozen/split panes and their selections while preserving zoom and normal cell selection', () => {
  const xml = '<worksheet><sheetViews><sheetView zoomScale="85"><pane ySplit="1" state="frozen"/><selection pane="bottomLeft" activeCell="L2"/><selection activeCell="A1"/></sheetView></sheetViews><sheetData/></worksheet>';
  const output = unfreezeReportSheet(xml);
  expect(output).not.toMatch(/<pane\b|pane="/);
  expect(output).toContain('zoomScale="85"');expect(output).toContain('<selection activeCell="A1"/>');
  expect(unfreezeReportSheet(output)).toBe(output);
});

it.each(['pre_deduction', 'financial'])('exports %s with distinct blue headers, both summary tables lowered and no frozen panes', async kind => {
  const report = reportFor(kind), snapshot = structuredClone({ report, products, dispatchRows, deductions });
  const built = buildProfitReportWorkbook({ report, products, dispatchRows, deductionRows: deductions }), book = read(built.bytes), summary = book.Sheets['汇总表'];
  expect(REPORT_TEMPLATE_VERSION).toBe('profit-zebra@13-summary-layout');expect(built.templateVersion).toBe(REPORT_TEMPLATE_VERSION);
  expect(summary.L1).toBeUndefined();expect(summary.L2.v).toBe('店铺');expect(summary.M2.v).toBe('销量');expect(summary.N2.v).toBe('利润');
  expect(summary.L3).toMatchObject({ t: 's', v: '00027' });expect(summary.M3).toMatchObject({ t: 'n', v: 35 });expect(summary.N3).toMatchObject({ t: 'n', v: 8.5 });
  expect(summary.L6.v).toBe('项目');expect(summary.L7.v).toBe('代发');
  expect(xmlFile(book, 'xl/styles.xml')).toContain('rgb="FFCADFF2"');expect(xmlFile(book, 'xl/styles.xml')).toContain('rgb="FFF0F6F6"');
  for (let index = 0; index < book.SheetNames.length; index++) expect(xmlFile(book, `xl/worksheets/sheet${index + 1}.xml`)).not.toMatch(/<pane\b|state="frozen/);
  const stored = { ...report, templateVersion: built.templateVersion, fileBase64: bytesToBase64(built.bytes), fileSha256: await sha256(built.bytes) }, original = structuredClone(stored);
  const output = await prepareReportDownload(stored, { dispatchRows, ...(kind === 'financial' ? { deductionRows: deductions } : {}) });
  const repeated = formatSavedReportLayout(output), after = read(repeated);
  for (const name of book.SheetNames) {
    expect(after.Sheets[name]['!merges']).toEqual(book.Sheets[name]['!merges']);
    for (const [address, cell] of Object.entries(book.Sheets[name])) if (cell.v != null) expect(after.Sheets[name][address]).toMatchObject({ t: cell.t, v: cell.v });
  }
  expect(stored).toEqual(original);expect({ report, products, dispatchRows, deductions }).toEqual(snapshot);
});

it('supports a frozen @12 report, moves its old L1 header once and preserves the original archive', async () => {
  const report = reportFor('pre_deduction'), built = buildProfitReportWorkbook({ report, products, dispatchRows }), files = archive(read(built.bytes));
  const originalXml = xmlFile(read(built.bytes), 'xl/worksheets/sheet1.xml');
  let legacy = originalXml.replace(/<c\b(?=[^>]*\br="[LMN]\d+")[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, '');
  const cell = (address, value, numeric = false) => numeric ? `<c r="${address}" t="n"><v>${value}</v></c>` : `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
  for (const [row, cells] of [[1, cell('L1', '店铺') + cell('M1', '销量') + cell('N1', '利润')], [2, cell('L2', '00027') + cell('M2', '35', true) + cell('N2', '-0.0000000001', true)], [3, cell('L3', '商品合计') + cell('N3', '8.5', true)]]) legacy = legacy.replace(new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*>)`), '$1' + cells);
  legacy = legacy.replace('<sheetView workbookViewId="0" showGridLines="0">', '<sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" state="frozen"/>');
  files.set('xl/worksheets/sheet1.xml', new TextEncoder().encode(legacy));
  const bytes = writeReportArchive(files), stored = { ...report, templateVersion: 'profit-zebra@12-source-row-order', fileBase64: bytesToBase64(bytes), fileSha256: await sha256(bytes) }, snapshot = structuredClone(stored);
  const output = await prepareReportDownload(stored), second = formatSavedReportLayout(output), book = read(second);
  expect(book.Sheets['汇总表'].L1).toBeUndefined();expect(book.Sheets['汇总表'].L2.v).toBe('店铺');expect(book.Sheets['汇总表'].L3.v).toBe('00027');expect(book.Sheets['汇总表'].N3.v).toBe(-0.0000000001);
  expect(xmlFile(book, 'xl/worksheets/sheet1.xml')).not.toContain('<pane');
  expect(stored).toEqual(snapshot);expect(await sha256(bytes)).toBe(stored.fileSha256);
});

if (process.env.EXPORT_SUMMARY_QA_SOURCE) it('checks a read-only real report, preserves every value and writes only a private preview', async () => {
  const input = new Uint8Array(readFileSync(process.env.EXPORT_SUMMARY_QA_SOURCE)), beforeHash = await sha256(input), before = read(input);
  const output = formatSavedReportLayout(input), after = read(output);
  const shift = before.Sheets['汇总表'].L1?.v === '店铺';
  for (const name of before.SheetNames) {
    for (const [address, cell] of Object.entries(before.Sheets[name])) if (cell.v != null) {
      const target = name === '汇总表' && shift && /^[LMN]\d+$/.test(address) ? address[0] + (Number(address.slice(1)) + 1) : address;
      expect(after.Sheets[name][target], `${name}!${address}`).toMatchObject({ t: cell.t, v: cell.v });
    }
    expect(after.Sheets[name]['!merges']).toEqual(before.Sheets[name]['!merges']);
  }
  expect(after.Sheets['汇总表'].L2.v).toBe('店铺');
  expect(await sha256(new Uint8Array(readFileSync(process.env.EXPORT_SUMMARY_QA_SOURCE)))).toBe(beforeHash);
  expect(await sha256(formatSavedReportLayout(output))).toBe(await sha256(output));
  writeFileSync(process.env.EXPORT_SUMMARY_QA_OUTPUT, output);
});
