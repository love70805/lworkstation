import {expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {reportTotals,exactSum,displayMoney,sha256} from '../domain/profitReports';
import {buildProfitReportWorkbook,bytesToBase64,prepareReportDownload,writeReportArchive} from './profitReportWorkbook';

function fixture(){
 const products=['3店','20店','627店'].map((store,i)=>({store,platformSku:'SKU-'+i,groupSkc:'SKC',quantityExact:'1',revenueExact:'20.009',unitCostExact:'0',purchaseCostExact:'0',warehouseCostExact:'0.7',profitExact:'19.309'}));
 const deductionRows=[{store:'627店',businessId:'0001',platformSkc:'S1',supplierNumber:'YW-20-FFFV',signedAmountExact:'1.0099'},
 {store:'20店',businessId:'0002',platformSkc:'S2',supplierNumber:'YW-sh20-FFFV',signedAmountExact:'-0.002'},
 {store:'3店',businessId:'0003',platformSkc:'S3',supplierNumber:'YW-3-FFFV',signedAmountExact:'0'},
 {store:'627店',businessId:'0001',platformSkc:'S1',supplierNumber:'YW-20-FFFV',signedAmountExact:'2.0001'},
 {store:'20店',businessId:'0004',platformSkc:'S4',supplierNumber:'YW-sh20-FFFV',signedAmountExact:'0.0088'}];
 const report={kind:'financial',period:'2026-09',revision:1,totalsExact:reportTotals(products,'0','0.7',deductionRows)};
 return {report,products,deductionRows};
}
it('sorts by actual store naturally, retains source order inside a store and makes detail/store/overall amounts agree',()=>{
 const data=fixture(),before=structuredClone(data),book=XLSX.read(buildProfitReportWorkbook(data).bytes,{type:'array',cellStyles:true});
 const sheet=book.Sheets['扣款'];
 expect(sheet.E1).toBeUndefined();expect(sheet.E2).toBeUndefined();
 expect(sheet.F1.v).toBe('店铺');expect(sheet.G1.v).toBe('明细合计');
 expect([2,3,4].map(r=>sheet['F'+r].v)).toEqual(['3店','20店','627店']);
 expect([2,3,4,5,6].map(r=>sheet['A'+r].v)).toEqual(['0003','0002','0004','0001','0001']);
 expect([2,3,4,5,6].map(r=>sheet['C'+r].v)).toEqual(['YW-3-FFFV','YW-sh20-FFFV','YW-sh20-FFFV','YW-20-FFFV','YW-20-FFFV']);
 expect(sheet.D3).toMatchObject({t:'n',v:-0.002,z:'General'});
 expect([2,3,4,5,6].reduce((sum,r)=>sum+sheet['D'+r].v,0)).toBeCloseTo(sheet.G5.v,12);
 expect(sheet.G5.v).toBe(Number(data.report.totalsExact.deductionExact));
 for(const [i,store] of data.report.totalsExact.stores.entries())expect(book.Sheets[store.store].J4.v).toBe(Number(store.deductionExact));
 expect(data).toEqual(before);
});
it('restores a saved @5 truncated deduction sheet from frozen exact rows and changes no other numeric literals',async()=>{
 const data=fixture(),built=buildProfitReportWorkbook(data),original=XLSX.read(built.bytes,{type:'array',bookFiles:true});
 const files=new Map(Object.entries(original.files).filter(([name,item])=>name&&item.type===2&&name!=='\u0001Sh33tJ5').map(([name,item])=>[name,new Uint8Array(item.content)]));
 const deductionPath='xl/worksheets/sheet6.xml';
 const oldXml=new TextDecoder().decode(files.get(deductionPath)).replace(/(<c\b[^>]*r="[DG]\d+"[^>]*>[\s\S]*?<v>)([^<]+)(<\/v>)/g,(_,a,value,b)=>a+displayMoney(value)+b);
 files.set(deductionPath,new TextEncoder().encode(oldXml));const oldBytes=writeReportArchive(files);
 const report={...data.report,templateVersion:'profit-zebra@5-merged-skc',fileBase64:bytesToBase64(oldBytes),fileSha256:await sha256(oldBytes)},before=structuredClone(report);
 const output=await prepareReportDownload(report,{deductionRows:data.deductionRows});
 const after=XLSX.read(output,{type:'array',bookFiles:true}),sheet=after.Sheets['扣款'];
 expect([2,3,4,5,6].reduce((sum,r)=>sum+sheet['D'+r].v,0)).toBeCloseTo(sheet.G5.v,12);
 expect(sheet.D5.v).toBe(1.0099);expect(sheet.D6.v).toBe(2.0001);expect(sheet.G5.v).toBe(Number(exactSum(data.deductionRows,'signedAmountExact')));
 for(const name of original.SheetNames.filter(name=>name!=='扣款')){
  const sheet=after.Sheets[name];
  for(const [address,cell] of Object.entries(original.Sheets[name]).filter(([address,cell])=>!address.startsWith('!')&&cell.t==='n'))expect(sheet[address].v).toBe(cell.v);
 }
 for(const [name,entry] of files)if(!/^xl\/worksheets\//.test(name)&&name!=='xl/styles.xml')expect(new Uint8Array(after.files[name].content)).toEqual(entry);
 expect(report).toEqual(before);
});
it('removes the actual-store column from a verified saved @6 download, retaining sorting, exact numbers and the original archive',async()=>{
 const data=fixture(),built=buildProfitReportWorkbook(data),book=XLSX.read(built.bytes,{type:'array',bookFiles:true});
 const files=new Map(Object.entries(book.files).filter(([name,item])=>name&&item.type===2&&name!=='\u0001Sh33tJ5').map(([name,item])=>[name,new Uint8Array(item.content)]));
 const location='xl/worksheets/sheet6.xml',stores=['3店','20店','20店','627店','627店'];
 let xml=new TextDecoder().decode(files.get(location)).replace(/r="([FG])(\d+)"/g,(_,column,row)=>`r="${column==='F'?'G':'H'}${row}"`).replace('ref="A1:G','ref="A1:H');
 xml=xml.replace(/(<row\b[^>]*r="(\d+)"[^>]*>)([\s\S]*?)(<\/row>)/g,(_,start,row,body,end)=>{
  const text=row==='1'?'实际店铺':stores[Number(row)-2];
  return start+body+(text?`<c r="E${row}" t="inlineStr"><is><t>${text}</t></is></c>`:'')+end;
 });
 files.set(location,new TextEncoder().encode(xml));const bytes=writeReportArchive(files);
 expect(XLSX.read(bytes,{type:'array'}).Sheets['扣款'].E1.v).toBe('实际店铺');
 const report={...data.report,templateVersion:'profit-zebra@6-exact-deductions-by-store',fileBase64:bytesToBase64(bytes),fileSha256:await sha256(bytes)},before=structuredClone(report);
 const output=await prepareReportDownload(report,{deductionRows:data.deductionRows}),sheet=XLSX.read(output,{type:'array'}).Sheets['扣款'];
 expect(sheet.E1).toBeUndefined();expect(sheet.E2).toBeUndefined();expect(sheet.F1.v).toBe('店铺');expect(sheet.G1.v).toBe('明细合计');
 expect([2,3,4,5,6].map(r=>sheet['A'+r].v)).toEqual(['0003','0002','0004','0001','0001']);
 expect([2,3,4,5,6].reduce((sum,r)=>sum+sheet['D'+r].v,0)).toBeCloseTo(sheet.G5.v,12);
 expect(sheet.D5.v).toBe(1.0099);expect(sheet.D6.v).toBe(2.0001);expect(report).toEqual(before);
});
it('refuses changed rows, totals or a missing deduction sheet instead of guessing precision',async()=>{
 const data=fixture(),built=buildProfitReportWorkbook(data),report={...data.report,templateVersion:built.templateVersion,fileBase64:bytesToBase64(built.bytes)};
 await expect(prepareReportDownload(report,{deductionRows:data.deductionRows.slice(1)})).rejects.toThrow('冻结来源');
 await expect(prepareReportDownload(report,{deductionRows:data.deductionRows.map(row=>({...row,store:'外店'}))})).rejects.toThrow('冻结来源');
});
