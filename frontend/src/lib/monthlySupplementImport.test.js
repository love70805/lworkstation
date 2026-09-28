import { expect,it } from "vitest";
import * as XLSX from "xlsx";
import { readSupplementWorkbook } from "./monthlySupplementImport";
import { inspectSupplementSource } from "../domain/monthlySupplements";
it('preserves actual source coordinates for a non-A1 XLSX range',async()=>{
 const sheet={B5:{t:'s',v:'姓名'},C5:{t:'s',v:'数量'},B6:{t:'s',v:'测试人员'},C6:{t:'n',v:3},'!ref':'B5:C6'};
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'来源');
 const buffer=XLSX.write(book,{type:'array',bookType:'xlsx'});
 const sources=await readSupplementWorkbook({name:'synthetic.xlsx',arrayBuffer:async()=>buffer},'dispatch');
 expect(sources[0].headerRow).toBe(5);
 const result=inspectSupplementSource(sources[0],{kind:'dispatch',headerRow:5,ownerMarker:'测试人员'});
 expect(result.rows).toMatchObject([{sourceRow:6,quantityExact:'3',sourceSheet:'来源'}]);
});
it('uses physical starting CSV line numbers despite embedded newlines and blank records',async()=>{
 const bytes=new TextEncoder().encode('姓名,数量\n"测试\n人员",3\n\n测试人员,4');
 const [source]=await readSupplementWorkbook({name:'synthetic.csv',arrayBuffer:async()=>bytes.buffer},'dispatch');
 const result=inspectSupplementSource(source,{kind:'dispatch',headerRow:1,includeAll:true});
 expect(result.rows.map(row=>row.sourceRow)).toEqual([2,5]);
});
it('skips empty and 无 sheets and preserves explicit vertical merge origins',async()=>{
 const book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([['日期','登记人','店铺','SKC','订单号','sku数量','1688订单号'],['8/1','人员','甲','S','O1',2,'P'],['','','','','O2',3,'']]);
 sheet['!merges']=[{s:{r:1,c:1},e:{r:2,c:1}},{s:{r:1,c:3},e:{r:2,c:3}},{s:{r:1,c:6},e:{r:2,c:6}}];
 XLSX.utils.book_append_sheet(book,sheet,'甲');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['无']]),'空');
 const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
 const sources=await readSupplementWorkbook({name:'synthetic.xlsx',arrayBuffer:async()=>bytes},'dispatch');
 expect(sources).toHaveLength(1);
 const result=inspectSupplementSource(sources[0],{kind:'dispatch',ownerMarker:'人员'});
 expect(result.rows[1]).toMatchObject({platformSkc:'S',order1688:'P',quantityExact:'3',mergedFrom:{owner:2,platformSkc:2,order1688:2}});
});
