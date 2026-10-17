import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildProfitReportWorkbook, bytesToBase64, prepareReportDownload } from './profitReportWorkbook';
import { reportTotals, REPORT_TEMPLATE_VERSION, sha256 } from '../domain/profitReports';

const products = [{store:'甲',platformSku:'SKU',groupSkc:'S',quantityExact:'2',revenueExact:'20.0009',purchaseCostExact:'1.00009',unitCostExact:'0.500045',warehouseCostExact:'1.4',profitExact:'17.60081'}];
const rows = [
  {platformSkc:'A',businessId:'000001',quantityExact:'2',order1688:'',remarks:[{header:'1688',value:'0003316999476150011698'}]},
  {platformSkc:'B',businessId:'000002',quantityExact:'3',order1688:'CURRENT',remarks:[{header:'1688',value:'999'}]},
];
async function fixture() {
  const report = {kind:'pre_deduction',period:'2026-09',revision:1,templateVersion:REPORT_TEMPLATE_VERSION,warehouseRateExact:'0.7',totalsExact:reportTotals(products,'5','0.7')};
  // The historical writer did not use remarks. Produce the same missing D2.
  const built = buildProfitReportWorkbook({report,products,dispatchRows:rows.map(({remarks,...row})=>row)});
  return { ...report, fileBase64:bytesToBase64(built.bytes), fileSha256:await sha256(built.bytes) };
}
it('fills blank download cells from matched frozen rows while preserving every other XML literal and the saved archive', async () => {
  const report = await fixture(), before=structuredClone(report);
  const original = XLSX.read(report.fileBase64,{type:'base64',bookFiles:true});
  const output = await prepareReportDownload(report,{dispatchRows:rows});
  const book = XLSX.read(output,{type:'array',bookFiles:true});
  expect(book.Sheets['代发表'].D2).toMatchObject({t:'s',v:'0003316999476150011698'});
  expect(book.Sheets['代发表'].D3.v).toBe('CURRENT');
  for (const [name,entry] of Object.entries(original.files).filter(([name,entry])=>entry.type===2&&name!=='\u0001Sh33tJ5')) {
    const left=new TextDecoder().decode(entry.content),right=new TextDecoder().decode(book.files[name].content);
    if (name==='xl/worksheets/sheet3.xml') expect(right.replace('0003316999476150011698','')).toBe(left);
    else expect(right).toBe(left);
  }
  expect(report).toEqual(before);
  expect(await sha256(Uint8Array.from(atob(report.fileBase64),c=>c.charCodeAt(0)))).toBe(report.fileSha256);
});
it('refuses stale, missing or reordered frozen rows and never uses another business order', async () => {
  const report=await fixture();
  for (const dispatchRows of [rows.slice(0,1),rows.toReversed(),[{...rows[0],quantityExact:'9'},rows[1]],[{...rows[0],platformSkc:'OTHER'},rows[1]]]) await expect(prepareReportDownload(report,{dispatchRows})).rejects.toThrow('冻结来源记录不一致');
  expect(await sha256(await prepareReportDownload(report))).toBe(report.fileSha256);
});
it('uses the same-row remark in newly generated reports without changing source rows', () => {
  const before=structuredClone(rows),report={kind:'pre_deduction',period:'2026-09',revision:1,totalsExact:reportTotals(products,'5','0.7')};
  const book=XLSX.read(buildProfitReportWorkbook({report,products,dispatchRows:rows}).bytes,{type:'array'});
  expect(book.Sheets['代发表'].D2).toMatchObject({t:'s',v:'0003316999476150011698'});expect(rows).toEqual(before);
});
