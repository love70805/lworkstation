import {expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {reportTotals,sha256} from '../domain/profitReports';
import {buildProfitReportWorkbook,bytesToBase64,prepareReportDownload,writeReportArchive} from './profitReportWorkbook';
import {formatSavedReportLayout} from './savedReportLayout';

const products=[{store:'20店',platformSku:'0000000000000000000123',groupSkc:'sh9000000000000000007',attribute:'长规格说明',quantityExact:'35',revenueExact:'3774.2863',unitCostExact:'0',purchaseCostExact:'0',warehouseCostExact:'24.5',profitExact:'3749.7863'}];
const dispatchRows=[{platformSkc:products[0].groupSkc,businessId:'PB2099010000001',quantityExact:'35',order1688:'000123456789012345678'}];
const deductionRows=[{store:'20店',businessId:'0001',platformSkc:products[0].groupSkc,supplierNumber:'YW-20-FFFV',signedAmountExact:'-4.152509999'}];
const report={kind:'financial',period:'2026-09',revision:1,totalsExact:reportTotals(products,'35','0.7',deductionRows)};
const read=bytes=>XLSX.read(bytes,{type:'array',bookFiles:true,cellStyles:true});
const source=(book,file)=>new TextDecoder().decode(book.files[file].content);
function expectTableBorders(bytes){
 const book=read(bytes),styles=source(book,'xl/styles.xml');
 const definitions=[...styles.match(/<borders\b[^>]*>([\s\S]*?)<\/borders>/)[1].matchAll(/<border\b[^>]*>[\s\S]*?<\/border>/g)].map(match=>match[0]);
 const formats=[...styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match=>match[0]);
 for(let index=0;index<book.SheetNames.length;index++)for(const cell of source(book,`xl/worksheets/sheet${index+1}.xml`).matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)){
  const id=Number(cell[1].match(/\bs="(\d+)"/)?.[1]??0),border=definitions[Number(formats[id].match(/\bborderId="(\d+)"/)[1])];
  for(const side of ['left','right','top','bottom'])expect(border,`${book.SheetNames[index]} ${cell[1]}`).toContain(`<${side} style="thin">`);
 }
 expect(definitions[0]).not.toContain('style="thin"'); // Outside-table blanks remain unframed.
}
function alignment(book,sheet,address){
 const file='xl/worksheets/sheet'+(book.SheetNames.indexOf(sheet)+1)+'.xml';
 const id=Number(source(book,file).match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*\\bs="(\\d+)"`))?.[1]);
 const styles=source(book,'xl/styles.xml').match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1];
 return [...styles.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)][id][0];
}
it('keeps tables compact while separating counts, identifiers and amounts with padding, alignment and subtle borders',()=>{
 const book=read(buildProfitReportWorkbook({report,products,dispatchRows,deductionRows}).bytes);
 expect(alignment(book,'代发表','D2')).toContain('horizontal="center"');
 expect(alignment(book,'代发表','E2')).toContain('horizontal="center"');
 expect(alignment(book,'20店','E2')).toContain('horizontal="right" indent="1"');
 expect(book.Sheets['代发表']['!cols'].reduce((sum,col)=>sum+col.width,0)).toBeLessThanOrEqual(140);
 expect(book.Sheets['20店']['!cols'].reduce((sum,col)=>sum+col.width,0)).toBeLessThanOrEqual(205*0.85);
 expect(alignment(book,'代发表','D2')).toContain('borderId="1"');
 expect(alignment(book,'20店','E2')).toContain('borderId="1"');
 expect(alignment(book,'代发表','E2')).toContain('fontId="5"');
 expect(alignment(book,'代发表','D2')).toContain('fontId="0"');
 expect(source(book,'xl/styles.xml')).toContain('rgb="FFDCE8F1"');
 expect(source(book,'xl/worksheets/sheet3.xml')).toContain('ht="28"');
 expect(book.Sheets['代发表'].E2).toMatchObject({t:'s',v:dispatchRows[0].order1688});
 expect(book.Sheets['扣款'].D2).toMatchObject({t:'n',v:-4.152509999,z:'General'});
 expect(book.Sheets['扣款'].G3.z).toBe('General');
 expect(book.Sheets['20店'].J4.z).toBe('General');
 const summary=book.Sheets['汇总表'],row=Object.keys(summary).find(key=>/^L\d+$/.test(key)&&summary[key].v==='扣款').slice(1);
 expect(summary['N'+row].z).toBe('General');expect(book.Sheets['20店'].E2.z).toBe('0.00');
});
it.each(['profit-zebra@7-deductions-compact','profit-zebra@8-spaced-general-deductions','profit-zebra@13-summary-layout'])('formats frozen %s without rewriting text, numeric literals, row order, merges or non-style files',async templateVersion=>{
 const built=buildProfitReportWorkbook({report,products,dispatchRows,deductionRows,legacyLayout:true}),files=read(built.bytes);
 const archive=new Map(Object.entries(files.files).filter(([name,row])=>name&&row.type===2&&name!=='\u0001Sh33tJ5').map(([name,row])=>[name,new Uint8Array(row.content)]));
 // Emulate the old quantity/right and identifier/left edge alignment and two-decimal format.
 archive.set('xl/styles.xml',new TextEncoder().encode(source(files,'xl/styles.xml').replace(/numFmtId="0"(?=[^>]*fontId="[34]")/g,'numFmtId="168"').replace(/ indent="1"/g,'').replaceAll('FFCADFF2','FF284B6B').replaceAll('FF344459','FFFFFFFF').replaceAll('fontId="5"','fontId="0"').replace(/borderId="[1-4]"/g,'borderId="0"')));
 const bytes=writeReportArchive(archive),before=read(bytes),saved={...report,templateVersion,fileBase64:bytesToBase64(bytes),fileSha256:await sha256(bytes)},snapshot=structuredClone(saved);
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
 expect(after.Sheets['扣款'].D2.z).toBe('General');expect(alignment(after,'代发表','D2')).toContain('horizontal="center"');expect(alignment(after,'代发表','E2')).toContain('horizontal="center"');expect(saved).toEqual(snapshot);
 expect(source(after,'xl/styles.xml')).toContain('rgb="FFCADFF2"');expect(alignment(after,'代发表','D2')).toContain('borderId="1"');
 expect(after.Sheets['代发表']['!cols']).toEqual(files.Sheets['代发表']['!cols']);
 expect(source(after,'xl/worksheets/sheet3.xml')).toContain('ht="28"');
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
it('frames every table cell in new reports and frozen downloads without changing any figures',async()=>{
 const built=buildProfitReportWorkbook({report,products,dispatchRows,deductionRows});
 expectTableBorders(built.bytes);
 const saved={...report,templateVersion:'profit-zebra@9-compact-neutral',fileBase64:bytesToBase64(built.bytes),fileSha256:await sha256(built.bytes)},before=structuredClone(saved);
 const output=await prepareReportDownload(saved,{dispatchRows});
 expectTableBorders(output);
 expect(saved).toEqual(before);
 for(const name of read(built.bytes).SheetNames)for(const [address,cell] of Object.entries(read(built.bytes).Sheets[name]))if(cell.t==='n')expect(read(output).Sheets[name][address]).toMatchObject({t:'n',v:cell.v});
});

it.each(['pre_deduction','financial'])('colors only numeric losses in new %s exports and their saved downloads', async kind => {
  const items = ['-10.12','2.50','0','-0.001'].map((profitExact, i) => ({
    ...products[0], platformSku: 'SKU-' + i, groupSkc: 'G-' + i, profitExact,
  }));
  const deductions = kind === 'financial' ? deductionRows : [];
  const saved = { ...report, kind, totalsExact: reportTotals(items, '0', '0.7', deductions) };
  const built = buildProfitReportWorkbook({ report: saved, products: items, deductionRows: deductions });
  const archive = { ...saved, templateVersion: built.templateVersion, fileBase64: bytesToBase64(built.bytes), fileSha256: await sha256(built.bytes) };
  const download = await prepareReportDownload(archive, kind === 'financial' ? { deductionRows: deductions } : {});
  for (const bytes of [built.bytes, download]) {
    const book = read(bytes);
    expect(source(book, 'xl/styles.xml')).toContain('rgb="FF9B4B50"');
    expect(book.Sheets['20店'].J2).toMatchObject({ t:'n', v:-10.12 });
    for (const [sheet, address, font] of [
      ['20店','J2',6], ['20店','J3',0], ['20店','J4',0], ['20店','J5',0], ['20店','J6',7],
      ['汇总表','J3',6], ['汇总表','J7',7], ['汇总表','J8',7], ['汇总表','N3',6], ['汇总表','N4',7],
      ['汇总表',kind === 'financial' ? 'N9' : 'N8',7],
      ...(kind === 'financial' ? [['20店','J7',4], ['20店','J8',7], ['扣款','D2',3]] : []),
    ]) expect(alignment(book,sheet,address), sheet + ' ' + address).toContain('fontId="' + font + '"');
  }
});
