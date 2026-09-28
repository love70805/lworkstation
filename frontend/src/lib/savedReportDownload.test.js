import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildProfitReportWorkbook, bytesToBase64, prepareReportDownload } from './profitReportWorkbook';
import { reportTotals, sha256 } from '../domain/profitReports';

function fixture(kind, template = 'profit-zebra@2-purchase-evidence') {
  const stores = template === 'profit-zebra@1' ? ['核算采购', '乙店'] : ['甲店', '乙店'];
  const products = stores.flatMap(store => ['00001', '00002', '00003'].map((platformSku, i) => ({ store, platformSku, groupSkc: 'SKC', attribute: '白色', quantityExact: '2', revenueExact: '20.009', unitCostExact: '0.009999', purchaseCostExact: '0.019998', profitExact: '18.589002', orderNumber: ['000123456789012345678901 / 9999', 'PO/2026/000002 / OLD', ''][i] })));
  const deductionRows = [{ store: stores[0], businessId: '000123', signedAmountExact: '-0.002' }];
  const report = { kind, period: '2026-08', revision: 1, templateVersion: template, totalsExact: reportTotals(products, '2', '0.7', kind === 'financial' ? deductionRows : []) };
  const built = buildProfitReportWorkbook({ report, products, dispatchRows: [{ businessId: '000012345678901234567890', order1688: '0000123', quantityExact: '2' }], deductionRows });
  const book = XLSX.read(built.bytes, { type: 'array' });
  if (template === 'profit-zebra@1') {
    book.Sheets['核算采购'] = book.Sheets['核算采购-2'];
    delete book.Sheets['核算采购-2'];
    book.SheetNames = book.SheetNames.map(name => name === '核算采购-2' ? '核算采购' : name);
  }
  // Recreate the old joined strings; this test writer is not used by product downloads.
  for (const name of ['汇总表', ...stores]) {
    const sheet = book.Sheets[name];
    if (template === 'profit-zebra@1') sheet.F1.v = '1688单号';
    for (let r = 2; r <= XLSX.utils.decode_range(sheet['!ref']).e.r + 1; r++) {
      const product = products.find(row => row.platformSku === sheet[`B${r}`]?.v);
      if (product) sheet[`F${r}`] = { t: 's', v: product.orderNumber };
    }
  }
  if (template !== 'profit-zebra@1') XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['店铺', 'SKU', '次序', '采购日期', '单号类型', '关联单号', '采购单号'],
    ['甲店', '00001', 1, '2026-08-31', '采购单', '000000000000000000009', '000000000000000000009'],
    ['甲店', '00001', 2, '2026-08-30', '1688', '999999999999999999999', 'OLD'],
    ['甲店', '00002', 1, '2026-08-31', '采购单', '', ''],
    ['甲店', '00002', 2, '2026-08-30', '采购单', 'PO/2026/000002', 'PO/2026/000002'],
    ['甲店', '00003', 1, '2026-08-31', '采购单', '', ''],
  ]), '核算采购');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  return { ...report, fileBase64: bytesToBase64(new Uint8Array(bytes)), fileName: built.fileName };
}

it.each(['pre_deduction', 'financial'])('simplifies saved %s bytes while preserving every non-order cell and storage', async kind => {
  const report = fixture(kind), before = structuredClone(report);
  const old = XLSX.read(report.fileBase64, { type: 'base64', bookFiles: true });
  const bytes = await prepareReportDownload(report);
  const book = XLSX.read(bytes, { type: 'array', bookFiles: true });
  expect(book.SheetNames).toEqual(old.SheetNames.filter(name => name !== '核算采购'));
  expect(book.Sheets['甲店'].F2).toMatchObject({ t: 's', v: '000000000000000000009' });
  expect(book.Sheets['甲店'].F3.v).toBe('PO/2026/000002');
  expect(book.Sheets['甲店'].F4.v).toBe('');
  expect(book.Sheets['乙店'].F2.v).toBe('000123456789012345678901');
  for (const name of book.SheetNames) for (const [address, cell] of Object.entries(old.Sheets[name])) {
    if (/^F\d+$/.test(address) && ['汇总表', '甲店', '乙店'].includes(name)) continue;
    expect(book.Sheets[name][address], `${name}!${address}`).toEqual(cell);
  }
  for (const name of ['xl/styles.xml', ...book.keys.filter(name => /worksheets\/sheet[45]\.xml/.test(name))]) {
    expect([...book.files[name].content]).toEqual([...old.files[name].content]);
  }
  expect(report).toEqual(before);
});

it('supports @1 header and preserves a real store named 核算采购', async () => {
  const report = fixture('financial', 'profit-zebra@1');
  const book = XLSX.read(await prepareReportDownload(report), { type: 'array' });
  expect(book.SheetNames).toContain('核算采购');
  expect(book.Sheets['核算采购'].F2.v).toBe('000123456789012345678901');
  expect(book.Sheets['核算采购'].F3.v).toBe('PO/2026/000002');
});

it('rejects unsupported, missing, corrupted and hash-mismatched archives without fallback', async () => {
  for (const report of [{}, { ...fixture('financial'), templateVersion: 'future' }, { ...fixture('financial'), fileBase64: 'broken' }, { ...fixture('financial'), fileSha256: 'bad' }])
    await expect(prepareReportDownload(report)).rejects.toThrow('原报告信息不足或文件损坏');
  const report = fixture('financial');
  report.fileSha256 = await sha256(Uint8Array.from(atob(report.fileBase64), c => c.charCodeAt(0)));
  await expect(prepareReportDownload(report)).resolves.toBeInstanceOf(Uint8Array);
});

it('does not reinterpret the already single identifier of @3 as a legacy joined string', async () => {
  const products = [{ store: '甲店', platformSku: '0001', groupSkc: 'S', quantityExact: '1', revenueExact: '2', purchaseCostExact: '1', profitExact: '1', unitCostExact: '1', costPurchaseRecords: [{ purchaseOrderNo: 'PO / 2026 / 0001' }] }];
  const report = { kind: 'pre_deduction', period: '2026-08', revision: 1, totalsExact: reportTotals(products, '0', '0', []) };
  const built = buildProfitReportWorkbook({ report, products });
  const book = XLSX.read(await prepareReportDownload({ ...report, templateVersion: built.templateVersion, fileBase64: bytesToBase64(built.bytes) }), { type: 'array' });
  expect(book.Sheets['甲店'].F2.v).toBe('PO / 2026 / 0001');
});
