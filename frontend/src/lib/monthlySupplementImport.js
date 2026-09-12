import * as XLSX from "xlsx";
import Papa from "papaparse";
import { sha256 } from "../domain/profitReports";
import { suggestSupplementMapping } from "../domain/monthlySupplements";

function headerRow(cells,sourceRows){let best=0,score=-1;cells.slice(0,30).forEach((row,index)=>{const count=Object.values(suggestSupplementMapping(row)).filter(value=>Number(value)>=0).length;if(count>score){score=count;best=index;}});return sourceRows?.[best]??best+1;}

export async function readSupplementWorkbook(file, kind) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!(kind === "dispatch" ? ["xlsx","csv"] : ["xlsx"]).includes(extension)) throw new Error(kind === "dispatch" ? "代发请选择 XLSX 或 CSV。" : "扣款请选择 XLSX。");
  const buffer = await file.arrayBuffer();
  const fileHash = await sha256(buffer);
  if (extension === "csv") {
    const text = new TextDecoder().decode(buffer);
    const parsed = Papa.parse(text,{skipEmptyLines:false});
    if (parsed.errors.some(error=>error.type!=="Delimiter")) throw new Error("CSV格式无效。");
    const sourceRows = [];
    let cursor = 0, line = 1;
    Papa.parse(text,{step:({meta})=>{sourceRows.push(line);line+=(text.slice(cursor,meta.cursor).match(/\r\n|\n|\r/g)??[]).length;cursor=meta.cursor;}});
    return [{fileHash,fileName:file.name,sheetName:"CSV",cells:parsed.data,sourceRows,headerRow:headerRow(parsed.data,sourceRows)}];
  }
  const workbook = XLSX.read(buffer,{type:"array",cellDates:false});
  return workbook.SheetNames.map(sheetName=>{
    const sheet=workbook.Sheets[sheetName];
    const range=sheet['!ref']?{s:{r:0,c:0},e:XLSX.utils.decode_range(sheet['!ref']).e}:undefined;
    const cells=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:"",blankrows:true,range});
    const sourceRows=cells.map((_,index)=>index+1);
    return {fileHash,fileName:file.name,sheetName,cells,sourceRows,headerRow:headerRow(cells,sourceRows)};
  });
}
