import {expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {reportTotals,sha256} from '../domain/profitReports';
import {buildProfitReportWorkbook,bytesToBase64,prepareReportDownload,writeReportArchive} from './profitReportWorkbook';
import {formatSavedReportLayout} from './savedReportLayout';

const products=[{store:'20店',platformSku:'0000000000000000000123',groupSkc:'sh2606160071544156882',attribute:'长规格说明',quantityExact:'35',revenueExact:'3774.2863',unitCostExact:'0',purchaseCostExact:'0',warehouseCostExact:'24.5',profitExact:'3749.7863'}];
const dispatchRows=[{platformSkc:products[0].groupSkc,businessId:'PB2609010247776',quantityExact:'35',order1688:'000331637621116011698'}];
const deductionRows=[{store:'20店',businessId:'0001',platformSkc:products[0].groupSkc,supplierNumber:'YW-20-HHHX',signedAmountExact:'-4.152509999'}];
const report={kind:'financial',period:'2026-09',revision:1,totalsExact:reportTotals(products,'35','0.7',deductionRows)};
const read=bytes=>XLSX.read(bytes,{type:'array',bookFiles:true,cellStyles:true});
const source=(book,file)=>new TextDecoder().decode(book.files[file].content);
function alignment(book,sheet,address){
 const file='xl/worksheets/sheet'+(book.SheetNames.indexOf(sheet)+1)+'.xml';
 const id=Number(source(book,file).match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*\\bs="(\\d+)"`))?.[1]);
 const styles=source(book,'xl/styles.xml').match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1];
 return [...styles.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)][id][0];
}
it('separates quantities and long text IDs with centered counts, padding and fitted widths across the report',()=>{
 const book=read(buildProfitReportWorkbook({report,products,dispatchRows,deductionRows}).bytes);
 expect(alignment(book,'代发表','C2')).toContain('horizontal="center"');
 expect(alignment(book,'代发表','D2')).toContain('horizontal="left" indent="1"');
 expect(alignment(book,'20店','E2')).toContain('horizontal="right" indent="1"');
 expect(book.Sheets['代发表']['!cols'][3].wch).toBeGreaterThanOrEqual(30);
 expect(book.Sheets['代发表'].D2).toMatchObject({t:'s',v:dispatchRows[0].order1688});
 expect(book.Sheets['扣款'].D2).toMatchObject({t:'n',v:-4.152509999,z:'General'});
 expect(book.Sheets['扣款'].G3.z).toBe('General');
 expect(book.Sheets['20店'].J4.z).toBe('General');
 const summary=book.Sheets['汇总表'],row=Object.keys(summary).find(key=>/^L\d+$/.test(key)&&summary[key].v==='扣款').slice(1);
 expect(summary['N'+row].z).toBe('General');expect(book.Sheets['20店'].E2.z).toBe('0.00');
});
it('formats a frozen prior-template @7 archive without rewriting any text, numeric literals, row order, merges or non-style files',async()=>{
 const built=buildProfitReportWorkbook({report,products,dispatchRows,deductionRows}),files=read(built.bytes);
 const archive=new Map(Object.entries(files.files).filter(([name,row])=>name&&row.type===2&&name!=='\u0001Sh33tJ5').map(([name,row])=>[name,new Uint8Array(row.content)]));
 // Emulate the old quantity/right and identifier/left edge alignment and two-decimal format.
 archive.set('xl/styles.xml',new TextEncoder().encode(source(files,'xl/styles.xml').replace(/numFmtId="0"(?=[^>]*fontId="[34]")/g,'numFmtId="168"').replace(/ indent="1"/g,'')));
 const bytes=writeReportArchive(archive),before=read(bytes),saved={...report,templateVersion:'profit-zebra@7-deductions-compact',fileBase64:bytesToBase64(bytes),fileSha256:await sha256(bytes)},snapshot=structuredClone(saved);
 const after=read(await prepareReportDownload(saved));
 for(const name of before.SheetNames){
  expect(after.Sheets[name]['!merges']).toEqual(before.Sheets[name]['!merges']);
  for(const [address,cell] of Object.entries(before.Sheets[name]))if(!address.startsWith('!'))expect(after.Sheets[name][address]).toMatchObject({t:cell.t,v:cell.v});
 }
 for(const [file,row] of archive){
  if(file==='xl/styles.xml')continue;
  if(file.startsWith('xl/worksheets/'))expect(source(after,file).match(/<v>[^<]*<\/v>/g)).toEqual(source(before,file).match(/<v>[^<]*<\/v>/g));
  else expect(new Uint8Array(after.files[file].content)).toEqual(row);
 }
 expect(after.Sheets['扣款'].D2.z).toBe('General');expect(alignment(after,'代发表','C2')).toContain('horizontal="center"');expect(alignment(after,'代发表','D2')).toContain('indent="1"');expect(saved).toEqual(snapshot);
});
it('keeps zero and tiny signed deductions numeric and rejects missing styles instead of rewriting data',()=>{
 for(const amount of ['0','0.000000001','-0.000000001']){
  const deductions=[{...deductionRows[0],signedAmountExact:amount}],totals=reportTotals(products,'35','0.7',deductions);
  const output=buildProfitReportWorkbook({report:{...report,totalsExact:totals},products,dispatchRows,deductionRows:deductions});
  const sheet=read(formatSavedReportLayout(output.bytes)).Sheets['扣款'];expect(sheet.D2).toMatchObject({t:'n',v:Number(amount),z:'General'});
 }
 const book=read(buildProfitReportWorkbook({report,products,dispatchRows,deductionRows}).bytes),files=new Map(Object.entries(book.files).filter(([name,row])=>name&&row.type===2&&name!=='\u0001Sh33tJ5'&&name!=='xl/styles.xml').map(([name,row])=>[name,new Uint8Array(row.content)]));
 expect(()=>formatSavedReportLayout(writeReportArchive(files))).toThrow('样式信息不足');
});
