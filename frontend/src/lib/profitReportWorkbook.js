import { displayMoney, exactSum, REPORT_TEMPLATE_VERSION } from "../domain/profitReports";

// A small, deterministic OOXML writer for the approved fixed report template.
// Numbers are computed by the report domain before export; identifier cells are text.
const encode = value => new TextEncoder().encode(value);
const xml = value => String(value ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
const crcTable = Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function crc32(bytes) { let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0; }
function zip(files) {
  const chunks=[],central=[]; let offset=0,centralLength=0;
  for(const [name,text] of files){
    const filename=encode(name),data=encode(text),crc=crc32(data);
    const local=new Uint8Array(30+filename.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,filename.length,true);local.set(filename,30);
    const entry=new Uint8Array(46+filename.length),e=new DataView(entry.buffer);
    e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(8,0x800,true);e.setUint32(16,crc,true);e.setUint32(20,data.length,true);e.setUint32(24,data.length,true);e.setUint16(28,filename.length,true);e.setUint32(42,offset,true);entry.set(filename,46);
    chunks.push(local,data);central.push(entry);offset+=local.length+data.length;centralLength+=entry.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralLength,true);e.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralLength+22);let cursor=0;for(const part of [...chunks,...central,end]){result.set(part,cursor);cursor+=part.length;}return result;
}
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const formats=[0,49,3,168,165,166,164];
function createStyles() {
  // Style zero also applies to unspecified/blank cells throughout the worksheet.
  const definitions = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], keys = new Map();
  return {
    id(cell, row, align) {
      const font = cell.header ? 2 : cell.red ? (cell.bold ? 4 : 3) : cell.bold ? 1 : 0;
      const fill = cell.header ? 2 : cell.band ? 4 : cell.detail && row % 2 === 0 ? 3 : 0;
      const horizontal = cell.align ?? align;
      const format = cell.format === 2 && /\.\d*[1-9]/.test(String(cell.value)) ? 6 : cell.format ?? 0;
      const key = JSON.stringify([font, fill, format, horizontal]);
      if (!keys.has(key)) {
        keys.set(key, definitions.length);
        definitions.push(`<xf numFmtId="${formats[format]}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment ${horizontal ? `horizontal="${horizontal}" ` : ''}vertical="center" wrapText="1"/></xf>`);
      }
      return keys.get(key);
    },
    xml() {
      const fonts = [0,1,2,3,4].map(i=>`<font>${[1,2,4].includes(i)?'<b/>':''}${i===2?'<color rgb="FFFFFFFF"/>':i>=3?'<color rgb="FFC62828"/>':'<color rgb="FF20344A"/>'}<sz val="10"/><name val="Microsoft YaHei"/></font>`).join('');
      return `${declaration}<styleSheet xmlns="${ns}"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.####################"/><numFmt numFmtId="168" formatCode="#,##0.00;[Red]\\-#,##0.00;0.00"/><numFmt numFmtId="165" formatCode="0.000000"/><numFmt numFmtId="166" formatCode="0.0000"/></numFmts><fonts count="5">${fonts}</fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['FF284B6B','FFF5F8FA','FFEEF3F7'].map(color=>`<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${definitions.length}">${definitions.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    }
  };
}
function column(index){let text="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;}
const text = (value,format=0) => ({value,format});
const number = (value,format=5) => ({value,format,number:true});
const headers = values => values.map(value=>({value,header:true,format:0}));
function sheetXml(rows,widths,registry,alignment=[],rowHeight=36){
  if(rows.length>1048576)throw new Error("报告明细超过 Excel 单页上限，请按账本范围核对来源。");
  return `${declaration}<worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${column(widths.length-1)}${Math.max(rows.length,1)}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((cells,i)=>`<row r="${i+1}" ht="${i?rowHeight:30}" customHeight="1">${cells.map((cell,j)=>{
    if(cell==null)return "";const c=typeof cell==="object"?cell:text(cell);const style=registry.id(c,i,alignment[j]);
    return c.number?`<c r="${column(j)}${i+1}" s="${style}" t="n"><v>${xml(c.value)}</v></c>`:`<c r="${column(j)}${i+1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(c.value)}</t></is></c>`;
  }).join("")}</row>`).join("")}</sheetData>${rows.some(cells=>cells.some(cell=>cell?.mergeAcross))?`<mergeCells>${rows.flatMap((cells,i)=>cells.flatMap((cell,j)=>cell?.mergeAcross?[`<mergeCell ref="${column(j)}${i+1}:${column(j+cell.mergeAcross-1)}${i+1}"/>`]:[])).join('')}</mergeCells>`:''}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
const detailRow = cells => cells.map(cell=>cell?{...cell,detail:true}:null);
const bandRow = cells => cells.map(cell=>({...cell,value:cell?.value??'',bold:true,band:true}));
const productHeaders=["SKC","SKU","属性","件数","销售额","关联单号","单件成本","采购成本","利润"];
const productWidths=[25,16.8833333333333,23.75,7.5,11.8833333333333,21.25,11.25,12.5,13.1333333333333];
function productRows(products) {return [headers(productHeaders),...products.map(row=>detailRow([text(row.groupSkc??row.platformSkc),text(row.platformSku),text(row.attribute),number(row.quantityExact,2),number(row.revenueExact,3),text(row.orderNumber,1),number(row.unitCostExact,4),number(row.purchaseCostExact),number(row.profitExact)])),bandRow([text("合计"),null,null,number(exactSum(products,"quantityExact"),2),number(displayMoney(exactSum(products,"revenueExact")),3),null,null,number(displayMoney(exactSum(products,"purchaseCostExact")),3),number(displayMoney(exactSum(products,"profitExact")),3)])];}
function groupedProductRows(products, stores) {
  const rows=[headers(productHeaders)];
  for(const store of stores){
    rows.push([{...text(store.store),bold:true,band:true,mergeAcross:9},...Array(8).fill(null)]);
    rows.push(...productRows(products.filter(row=>row.store===store.store)).slice(1));
  }
  rows.push(productRows(products).at(-1));return rows;
}
function combine(left,right,start){return Array.from({length:Math.max(left.length,right.length)},(_,i)=>{const row=[...(left[i]??[])];if(right[i]){while(row.length<start)row.push(null);row.push(...right[i]);}return row;});}
function safeSheet(name,used){const base=String(name).replace(/[\[\]:*?/\\\x00-\x1f]/g,"-").replace(/^'+|'+$/g,"").slice(0,31)||"店铺";let result=base,n=2;while(used.has(result.toLowerCase())){const suffix=`-${n++}`;result=base.slice(0,31-suffix.length)+suffix;}used.add(result.toLowerCase());return result;}

export function buildProfitReportWorkbook({report,products,dispatchRows=[],deductionRows=[]}) {
  const financial=report.kind==="financial",totals=report.totalsExact;
  const right=[headers(financial?["店铺","销量","利润","扣款","扣后利润"]:["店铺","销量","利润"]),...totals.stores.map(store=>[text(store.store),number(store.quantityExact,2),number(store.profitExact),...(financial?[{...number(store.deductionExact),red:true},number(displayMoney(store.financialProfitExact),3)]:[])]),[text("代发金额"),number(totals.dispatchQuantityExact,2),number(displayMoney(totals.dispatchAmountExact),3)], [text("合计"),number(totals.quantityExact,2),number(displayMoney(totals.preDeductionExact),3),...(financial?[{...number(displayMoney(totals.deductionExact),3),red:true},number(displayMoney(totals.profitExact),3)]:[])]];
  const sheets=[{name:"汇总表",rows:combine(groupedProductRows(products,totals.stores),right.map((row,i)=>i>=right.length-2?bandRow(row):row),10),widths:[...productWidths,3,7.75,8,13.1333333333333,...(financial?[12.5,14.75]:[])],alignment:[null,null,null,"center","center",null,"center","center","center",null,null,"left","left","left","left"]}];
  // Reserve template names before sanitizing dynamic store tabs.
  const used=new Set(["汇总表","代发表","扣款","核算采购"]);
  for(const store of totals.stores){
    const rows=productRows(products.filter(row=>row.store===store.store));
    if(financial)rows.push(bandRow([text('扣款'),null,null,null,null,null,null,null,{...number(displayMoney(store.deductionExact),3),red:true}]),bandRow([text('扣后利润'),null,null,null,null,null,null,null,number(displayMoney(store.financialProfitExact),3)]));
    sheets.push({name:safeSheet(store.store,used),rows,widths:productWidths,alignment:[null,null,null,'center','center','center','center','center','center']});
  }
  sheets.push({name:"代发表",rows:combine([headers(["SKC","订单号","件数","1688单号"]),...dispatchRows.filter(row=>!row.manual).map(row=>detailRow([text(row.platformSkc),text(row.businessId),number(row.quantityExact,2),text(row.order1688,1)]))],[headers(["项目","合计"]),[text("代发件数"),number(totals.dispatchQuantityExact,2)],[text("代发金额"),number(displayMoney(totals.dispatchAmountExact),3)]],5),widths:[27.5,26.25,10.6333333333333,26.25,3,16.25,13],rowHeight:34,alignment:[null,null,"left","center",null,"center","center"]});
  if(financial)sheets.push({name:"扣款",rows:combine([headers(["店铺","扣款单号","SKC","供方货号","金额"]),...deductionRows.map(row=>[text(row.store),text(row.businessId??""),text(row.platformSkc??""),text(row.supplierNumber??""),{...number(row.signedAmountExact),red:true}].map(cell=>({...cell,detail:true})))],[headers(["店铺","明细合计"]),...totals.stores.map(store=>[text(store.store),{...number(store.deductionExact),red:true}]),bandRow([text("合计"),{...number(displayMoney(totals.deductionExact),3),red:true}])],6),widths:[8.75,23.75,26.25,27.5,15,3,9.38333333333333,17.5],rowHeight:34,alignment:[null,null,"left","left","center",null,"center","right"]});
  const purchaseRows=products.flatMap(row=>(row.costPurchaseRecords??[]).map((record,index)=>detailRow([
    text(row.store),text(row.platformSku,1),number(index+1,2),text(record.purchaseDate),
    text(record.order1688?"1688":"采购单"),text(record.order1688||record.purchaseOrderNo||record.purchaseOrderId||"",1),
    text(record.purchaseOrderNo??"",1),number(record.quantity,2),number(record.effectiveUnitPrice??record.unitPrice,4),
    text(row.costResolutionVersion??""),
  ])));
  if(purchaseRows.length)sheets.push({name:"核算采购",rows:[headers(["店铺","SKU","次序","采购日期","单号类型","关联单号","采购单号","采购数量","核算单价","成本算法"]),...purchaseRows],widths:[16,25,8,24,12,30,30,12,14,55],rowHeight:36});
  const registry=createStyles();
  const sheetFiles=sheets.map((sheet,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(sheet.rows,sheet.widths,registry,sheet.alignment,sheet.rowHeight)]);
  const files=[['[Content_Types].xml',`${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],['_rels/.rels',`${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],['xl/workbook.xml',`${declaration}<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet,i)=>`<sheet name="${xml(sheet.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`],['xl/_rels/workbook.xml.rels',`${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],['xl/styles.xml',registry.xml()],...sheetFiles];
  return {bytes:zip(files),fileName:`${report.period.replace("-","年")}月利润表-${financial?"财务对账":"未扣款"}${report.revision>1?`-r${report.revision}`:""}.xlsx`,templateVersion:REPORT_TEMPLATE_VERSION};
}

export function bytesToBase64(bytes){let text="";for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
export function base64ToBytes(value){return Uint8Array.from(atob(value),char=>char.charCodeAt(0));}
export function downloadReportFile(report){const blob=new Blob([base64ToBytes(report.fileBase64)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=report.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
