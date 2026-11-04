import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProfitReportWorkbook, bytesToBase64, prepareReportDownload, writeReportArchive } from './profitReportWorkbook';
import { buildProfitReportWorkbook as buildOld } from '../testFixtures/twoDecimalProfitReportWorkbook';
import { exactSum, reportTotals, sha256 } from '../domain/profitReports';
import { dispatchHeaders, dispatchSourceMerges } from './dispatchReportLayout';
import { formatSavedReportLayout } from './savedReportLayout';

const skc = 'SH900000000000000000001', order = '9000000000000000001';
const products = ['合成甲店', '合成乙店'].map((store, i) => ({ store, platformSku: `SKU-${i}`, platformSkc: 'PRODUCT', quantityExact: '2', revenueExact: '20.009', unitCostExact: '0.009999', purchaseCostExact: '0.019998', warehouseCostExact: '1.4', profitExact: '18.589002' }));
const rows = Array.from({ length: 5 }, (_, i) => ({ store: i < 3 ? '合成甲店' : '合成乙店', platformSkc: i < 2 ? skc : i === 2 ? 'SH900000000000000000002' : 'SH900000000000000000003', businessId: `00000000000000000000${i}`, quantityExact: String(i + 2), order1688: i < 4 ? order : '9000000000000000002', sourceFormat: 'xlsx', fileHash: 'SYNTHETIC-FILE', sourceSheet: '来源 ', sourceRow: i + 10,
  mergedFrom: i === 1 ? { store: 10, platformSkc: 10, order1688: 10 } : i === 2 ? { store: 10, order1688: 10 } : i === 3 ? { order1688: 10 } : {},
}));
const report = records => ({ kind: 'pre_deduction', period: '2026-10', revision: 1, warehouseRateExact: '0.7', totalsExact: reportTotals(products, exactSum(records, 'quantityExact'), '0.7') });
const build = records => buildProfitReportWorkbook({ report: report(records), products, dispatchRows: records });
const read = bytes => XLSX.read(bytes, { type: 'array', cellStyles: true, bookFiles: true });
const mergeRefs = sheet => (sheet['!merges'] ?? []).map(range => XLSX.utils.encode_range(range));
const xml = (book, name) => new TextDecoder().decode(book.files[name].content);
const archiveFiles = book => new Map(Object.entries(book.files).filter(([name, entry]) => name && entry.type === 2 && name !== '\u0001Sh33tJ5').map(([name, entry]) => [name, new Uint8Array(entry.content)]));
const effective = (sheet, col, row) => {
  const range = sheet['!merges']?.find(range => range.s.c === col && range.e.c === col && range.s.r <= row && range.e.r >= row);
  return sheet[XLSX.utils.encode_cell(range ? range.s : { c: col, r: row })]?.v ?? '';
};
function verify(bytes, records) {
  const book = read(bytes), sheet = book.Sheets['代发表'];
  expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })[0].slice(0, 5)).toEqual(dispatchHeaders);
  records.forEach((record, index) => {
    expect([0, 1, 2, 4].map(col => effective(sheet, col, index + 1))).toEqual([record.store, record.platformSkc, record.businessId, record.order1688]);
    expect(sheet[`D${index + 2}`]).toMatchObject({ t: 'n', v: Number(record.quantityExact) });
    expect(sheet[`C${index + 2}`]).toMatchObject({ t: 's', v: record.businessId });
  });
  expect(sheet.G2.v).toBe(Number(exactSum(records, 'quantityExact')));
  for (let index = 0; index < book.SheetNames.length; index++) {
    const tab = book.Sheets[book.SheetNames[index]], nativeXml = xml(book, `xl/worksheets/sheet${index + 1}.xml`);
    const nativeCells = new Map([...nativeXml.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(match => [match[1].match(/\br="([A-Z]+\d+)"/)?.[1], match[0]]));
    for (const range of tab['!merges'] ?? []) for (let row = range.s.r; row <= range.e.r; row++) for (let col = range.s.c; col <= range.e.c; col++) {
      if (row === range.s.r && col === range.s.c) continue;
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const nativeCell = nativeCells.get(address);
      expect(nativeCell ?? '').not.toMatch(/<(v|f|is)\b/);
    }
  }
  expect([...xml(book, 'xl/styles.xml').match(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/)[0].matchAll(/<color\b[^>]*\/>/g)].map(match => match[0])).toEqual(Array(6).fill('<color rgb="FF000000"/>'));
  return sheet;
}
async function saved(bytes, templateVersion = build(rows).templateVersion) {
  return { ...report(rows), templateVersion, fileBase64: bytesToBase64(bytes), fileSha256: await sha256(bytes) };
}

it('projects independent source merges including a cross-store 1688 order, preserving every quantity and ID', () => {
  const before = structuredClone(rows), built = build(rows), sheet = verify(built.bytes, rows);
  expect(mergeRefs(sheet)).toEqual(['A2:A4', 'B2:B3', 'E2:E5']);
  expect(sheet.B5.v).toBe(sheet.B6.v); // Equal adjacent values do not prove a merge.
  expect(sheet.B2).toMatchObject({ t: 's', v: skc, z: '@' });
  expect(sheet.E2).toMatchObject({ t: 's', v: order, z: '@' });
  expect(rows).toEqual(before);
});

it('projects only selected rows, even when the original merge anchor was not adopted', () => {
  const selected = rows.slice(1, 4), sheet = verify(build(selected).bytes, selected);
  expect(mergeRefs(sheet)).toEqual(['A2:A3', 'E2:E4']);
  expect(sheet.G2.v).toBe(12);
});

it('keeps file and exact sheet identities separate and never infers merges from fill-down, CSV or manual rows', () => {
  const pair = rows.slice(0, 2);
  for (const patch of [{ fileHash: 'SECOND' }, { sourceSheet: '来源' }]) {
    const records = [...pair, ...pair.map(row => ({ ...row, ...patch }))];
    expect(mergeRefs(verify(build(records).bytes, records))).toEqual(['A2:A3', 'B2:B3', 'E2:E3', 'A4:A5', 'B4:B5', 'E4:E5']);
  }
  for (const patch of [{ sourceFormat: 'csv' }, { manual: true }, { fileHash: '' }, { mergedFrom: {}, inheritedIdentifiers: ['store', 'platformSkc', 'order1688'] }]) {
    const records = pair.map(row => ({ ...row, ...patch }));
    expect(dispatchSourceMerges(records)).toEqual([]);
    expect(mergeRefs(verify(build(records).bytes, records))).toEqual([]);
  }
});

it('keeps conflicting source values visible rather than hiding them in a merge', () => {
  const records = rows.map((row, index) => index === 1 ? { ...row, store: '冲突店铺' } : row);
  expect(mergeRefs(verify(build(records).bytes, records))).not.toContain('A2:A4');
});

it.each(['profit-zebra@9-compact-neutral', 'profit-zebra@10-optional-dispatch-store'])('upgrades the old %s direct-return path, preserving the archive and repeated projection', async template => {
  let bytes = buildOld({ report: report(rows), products, dispatchRows: rows }).bytes;
  if (template.includes('@10')) {
    const files = archiveFiles(read(bytes)), path = 'xl/worksheets/sheet4.xml';
    files.set(path, new TextEncoder().encode(new TextDecoder().decode(files.get(path)).replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (_, attributes, cells) => {
      const row = Number(attributes.match(/\br="(\d+)"/)[1]);
      return `<row${attributes}>${cells}<c r="E${row}" t="inlineStr"><is><t>${row === 1 ? '店铺号' : rows[row - 2]?.store ?? ''}</t></is></c></row>`;
    })));
    bytes = writeReportArchive(files);
  }
  const archive = await saved(bytes, template), before = structuredClone(archive);
  const first = await prepareReportDownload(archive, { dispatchRows: rows });
  verify(first, rows);
  expect(mergeRefs(read(first).Sheets['代发表'])).toEqual(['A2:A4', 'B2:B3', 'E2:E5']);
  const second = await prepareReportDownload(await saved(first), { dispatchRows: rows });
  const firstFiles = archiveFiles(read(first));
  for (const [name, content] of archiveFiles(read(second))) expect(new TextDecoder().decode(content), name).toBe(new TextDecoder().decode(firstFiles.get(name)));
  expect(await sha256(second)).toBe(await sha256(first));
  expect(await sha256(formatSavedReportLayout(first))).toBe(await sha256(first));
  expect(archive).toEqual(before);
});

it('clears native covered inline values and formulas rather than relying on a merged reader view', async () => {
  const files = archiveFiles(read(build(rows).bytes)), path = 'xl/worksheets/sheet4.xml';
  files.set(path, new TextEncoder().encode(new TextDecoder().decode(files.get(path)).replace(/<c r="B3"[^>]*\/>/, `<c r="B3" t="str"><f>"${skc}"</f><v>${skc}</v></c>`)));
  verify(await prepareReportDownload(await saved(writeReportArchive(files)), { dispatchRows: rows }), rows);
});

it('rejects mismatched frozen scope, store, purchase ID or quantity without changing saved bytes', async () => {
  const archive = await saved(build(rows).bytes), before = structuredClone(archive);
  for (const records of [rows.slice(1), rows.map((row, index) => index ? row : { ...row, quantityExact: '99' }), rows.map((row, index) => index ? row : { ...row, order1688: 'OTHER' }), rows.map((row, index) => index ? row : { ...row, store: 'OTHER' })]) {
    await expect(prepareReportDownload(archive, { dispatchRows: records })).rejects.toThrow('冻结来源记录不一致');
  }
  expect(archive).toEqual(before);
});

it('restores a storage-shuffled 1.2.0 archive and its original merge groups without changing the saved file',async()=>{
 const shuffled=[rows[0],rows[1],rows[4],rows[2],rows[3]],before=structuredClone(shuffled);
 // Old output used the storage order. Remove position metadata only from the
 // builder input to reproduce that output with the current writer.
 const legacy=build(shuffled.map(({sourceRow,fileHash,sourceSheet,mergedFrom,...row})=>row));
 const archive=await saved(legacy.bytes,'profit-zebra@11-black-source-merges'),original=structuredClone(archive);
 const output=await prepareReportDownload(archive,{dispatchRows:shuffled});
 expect(mergeRefs(verify(output,rows))).toEqual(['A2:A4','B2:B3','E2:E5']);
 expect(archive).toEqual(original);expect(shuffled).toEqual(before);
 const again=await prepareReportDownload(await saved(output),{dispatchRows:shuffled});
 expect(await sha256(again)).toBe(await sha256(output));
});

it('writes the application-generated independent native-copy QA fixture when requested', () => {
  const records = rows.map((row, index) => index === 2 ? { ...row, platformSkc: skc, mergedFrom: { ...row.mergedFrom, platformSkc: 10 } } : row);
  const built = build(records);
  expect(mergeRefs(verify(built.bytes, records))).toContain('B2:B4');
  if (process.env.EXPORT_LAYOUT_QA_DIR) {
    mkdirSync(process.env.EXPORT_LAYOUT_QA_DIR, { recursive: true });
    writeFileSync(join(process.env.EXPORT_LAYOUT_QA_DIR, '报告布局验证.xlsx'), built.bytes);
  }
});
