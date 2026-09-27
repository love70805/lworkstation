import { expect,it } from "vitest";
import * as XLSX from "xlsx";
import { writeFileSync,mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildProfitReportWorkbook } from "./profitReportWorkbook";
import { REPORT_FORMULA_VERSION, REPORT_TEMPLATE_VERSION, reportTotals } from "../domain/profitReports";

const products=Array.from({length:6},(_,i)=>({lineKind:'product',store:i<3?'合成甲店':'合成乙店',platformSkc:`SKC-${i}`,groupSkc:`SKC-${i}`,platformSku:`000000000000000000${i}`,attribute:'合成属性',quantityExact:'2',revenueExact:'20.009',orderNumber:'12345678901234567890',unitCostExact:'0.009999',purchaseCostExact:'0.019998',warehouseCostExact:'1.4',profitExact:'18.589002'}));
const dispatchRows=[{lineKind:'dispatch',platformSkc:'SKC-0',businessId:'00001234567890123456',quantityExact:'200',order1688:'12345678901234567890'}];
const deductionRows=[{lineKind:'deduction',store:'合成甲店',businessId:'0000000000000001',platformSkc:'SKC-0',supplierNumber:'TEST',signedAmountExact:'0.0099'},{lineKind:'deduction',store:'合成乙店',businessId:'0000000000000002',platformSkc:'SKC-1',supplierNumber:'TEST',signedAmountExact:'-0.002'}];
it.each(['pre_deduction','financial'])('writes readable %s workbook with textual IDs, dynamic sheets and approved report layout',kind=>{
 const report={kind,period:'2026-08',revision:1,totalsExact:reportTotals(products,'200','0.7',kind==='financial'?deductionRows:[])};
 const result=buildProfitReportWorkbook({report,products,dispatchRows,deductionRows});
 const book=XLSX.read(result.bytes,{type:'array',cellStyles:true});
 const packageXml=new TextDecoder().decode(result.bytes);
 const styles=packageXml.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)[1];
 expect(styles.split('/>')[0]).toContain('fillId="0"');
 expect(styles.split('/>')[0]).toContain('fontId="0"');
 expect(book.Sheets['合成甲店'].B5.s.fgColor.rgb).toBe('EEF3F7');
 expect(book.Sheets['汇总表'].J6).toBeUndefined();
 expect(book.SheetNames).toEqual(['汇总表','合成甲店','合成乙店','代发表',...(kind==='financial'?['扣款']:[])]);
 expect(book.Sheets['合成甲店'].B2).toMatchObject({t:'s',v:products[0].platformSku});
 expect(book.Sheets['合成甲店'].F2).toMatchObject({t:'s',v:products[0].orderNumber,z:'@'});
 expect(book.Sheets['汇总表']['!merges']).toHaveLength(2);
 const rows=XLSX.utils.sheet_to_json(book.Sheets['合成甲店'],{header:1});
 if(kind==='financial'){expect(rows.at(-2)[0]).toBe('扣款');expect(rows.at(-1)[0]).toBe('扣后利润');expect(book.Sheets['扣款'].E3.v).toBe(-0.002);}else expect(rows.flat()).not.toContain('扣款');
 if(process.env.REPORT_QA_DIR){mkdirSync(process.env.REPORT_QA_DIR,{recursive:true});writeFileSync(join(process.env.REPORT_QA_DIR,result.fileName),result.bytes);}
});
it('handles colliding, reserved and long store names without losing any store',()=>{
 const rows=['汇总表','a/b','a:b','A:B','很长'.repeat(20)].map((store,i)=>({...products[0],store,platformSku:`S${i}`}));
 const workbook=buildProfitReportWorkbook({report:{kind:'pre_deduction',period:'2026-08',revision:1,totalsExact:reportTotals(rows,'0','0')},products:rows});
 const book=XLSX.read(workbook.bytes,{type:'array'});expect(new Set(book.SheetNames.map(name=>name.toLowerCase())).size).toBe(7);expect(book.SheetNames.every(name=>name.length<=31&&!/[\[\]:*?/\\]/.test(name))).toBe(true);
});
it.each(['pre_deduction','financial'])("exports one text order per SKU without a purchase worksheet in %s", kind => {
 const rows=products.map(row=>({...row,costResolutionVersion:"latest-three-mixed-evidence"}));
 rows[0].costPurchaseRecords=[
  {recordId:"B1",purchaseDate:"2026-08-31",purchaseOrderNo:"00000000000000000123",quantity:2,unitPrice:4},
  {recordId:"A2",purchaseDate:"2026-08-30",order1688:"12345678901234567890",purchaseOrderNo:"00002",quantity:3,unitPrice:5},
  {recordId:"B3",purchaseDate:"2026-08-29",purchaseOrderNo:"00003",quantity:4,unitPrice:6},
 ];
 rows[1].costPurchaseRecords=[{recordId:"NO-ID",order1688:" "},{recordId:"BOTH",order1688:"000123456789012345678901234",purchaseOrderNo:"00002"}];
 rows[2].orderNumber="0000123 / 9999999999999999999999";
 rows[3].orderNumber="PO/2026/000004";
 rows[4].costSource="manual_override";rows[4].costPurchaseRecords=[];
 rows[5].costPurchaseRecords=[{recordId:"BLANK",order1688:" ",purchaseOrderNo:"",purchaseOrderId:null}];
 const expected=["00000000000000000123","000123456789012345678901234","0000123","PO/2026/000004","",""];
 const report={kind,period:"2026-08",revision:1,formulaVersion:REPORT_FORMULA_VERSION,totalsExact:reportTotals(rows,"200","0.7",kind==='financial'?deductionRows:[])};
 const before=structuredClone({rows,report,dispatchRows,deductionRows});
 const result=buildProfitReportWorkbook({report,products:rows,dispatchRows,deductionRows});
 const book=XLSX.read(result.bytes,{type:"array",cellStyles:true});
 expect(book.SheetNames).toEqual(['汇总表','合成甲店','合成乙店','代发表',...(kind==='financial'?['扣款']:[])]);
 expect(new TextDecoder().decode(result.bytes)).not.toContain('name="核算采购"');
 expect(result.templateVersion).toBe(REPORT_TEMPLATE_VERSION);
 expect(result.templateVersion).toBe("profit-zebra@3-single-order");
 const summaryRows=XLSX.utils.sheet_to_json(book.Sheets["汇总表"],{header:1});
 rows.forEach((row,index)=>{
  const summary=summaryRows.find(cells=>cells[1]===row.platformSku);
  expect(summary[5]).toBe(expected[index]);
  const storeSheet=book.Sheets[row.store];
  const storeRows=XLSX.utils.sheet_to_json(storeSheet,{header:1});
  const storeRowIndex=storeRows.findIndex(cells=>cells[1]===row.platformSku)+1;
  expect(storeSheet[`F${storeRowIndex}`]).toMatchObject({t:'s',v:expected[index],z:'@'});
  expect(storeSheet[`E${storeRowIndex}`].v).toBe(Number(row.revenueExact));
  expect(storeSheet[`G${storeRowIndex}`].v).toBe(Number(row.unitCostExact));
  expect(storeSheet[`H${storeRowIndex}`].v).toBe(Number(row.purchaseCostExact));
  expect(storeSheet[`I${storeRowIndex}`].v).toBe(Number(row.profitExact));
 });
 expect({rows,report,dispatchRows,deductionRows}).toEqual(before);
 if(process.env.REPORT_QA_DIR){mkdirSync(process.env.REPORT_QA_DIR,{recursive:true});writeFileSync(join(process.env.REPORT_QA_DIR,result.fileName),result.bytes);}
});
