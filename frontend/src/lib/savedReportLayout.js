import * as XLSX from 'xlsx';
import { profitReportSheetWidths, writeReportArchive } from './profitReportWorkbook';
import { reportThemeXml, reportBorder, reportRowHeight, reportHeaderHeight } from './profitReportTheme';

const attribute=(tag,name)=>tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const fail=()=>{throw new Error('报告样式信息不足，无法调整下载布局。原始存档保持不变。');};

// Change presentation only. Preserve numeric XML literals, text, merges and files.
export function formatSavedReportLayout(bytes){
  let book;try{book=XLSX.read(bytes,{type:'array',bookFiles:true});}catch{return fail();}
  const files=new Map(Object.entries(book.files??{}).filter(([name,entry])=>name&&entry.type===2&&name!=='\u0001Sh33tJ5').map(([name,entry])=>[name,new Uint8Array(entry.content)]));
  const read=name=>files.has(name)?new TextDecoder().decode(files.get(name)):fail();
  const styles=read('xl/styles.xml'),block=styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if(!block)return fail();
  const originals=[...block[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match=>match[0]),variants=[],cache=new Map();
  function style(index,horizontal,general,numeric,identifier){
    const original=originals[index];if(!original)return fail();
    const opening=original.match(/^<xf\b[^>]*>/)?.[0];
    const header=attribute(opening,'fontId')==='2'&&attribute(opening,'fillId')==='2',band=attribute(opening,'fillId')==='4';
    if(header)horizontal='center';
    const key=JSON.stringify([index,horizontal,general,numeric,identifier]);if(cache.has(key))return cache.get(key);
    const alignment=`<alignment horizontal="${horizontal}" ${horizontal==='center'?'':'indent="1" '}vertical="center" wrapText="1"/>`;
    let changed=original.replace(/<alignment\b[^>]*?(?:\/>|>[\s\S]*?<\/alignment>)/g,'');
    changed=changed.replace(/^<xf\b[^>]*>/,tag=>{
      let next=tag.replace(/\sapplyAlignment="[^"]*"/,'');
      next=next.replace(/\sborderId="[^"]*"/,'').replace(/\sapplyBorder="[^"]*"/,'');
      if(identifier&&!header&&!band)next=next.replace(/\sfontId="[^"]*"/,' fontId="5"');
      if(general)next=next.replace(/\snumFmtId="[^"]*"/,'').replace(/\sapplyNumberFormat="[^"]*"/,'');
      return next.replace(/\/?>(?=$)/,`${general?' numFmtId="0" applyNumberFormat="1"':''} borderId="${reportBorder({header,band,number:numeric})}" applyBorder="1" applyAlignment="1">`);
    });
    if(!changed.endsWith('</xf>'))changed+='</xf>';
    changed=changed.replace('</xf>',alignment+'</xf>');
    const next=originals.length+variants.length;variants.push(changed);cache.set(key,next);return next;
  }
  const tags=[...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/>/g)].map(match=>match[0]);
  const relations=[...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*\/>/g)].map(match=>match[0]);
  for(const name of book.SheetNames){
    const sheet=book.Sheets[name],widths=profitReportSheetWidths(sheet,name);if(!widths)continue;
    const tag=tags[book.SheetNames.indexOf(name)],relation=relations.find(row=>attribute(row,'Id')===attribute(tag,'r:id')),target=relation&&attribute(relation,'Target');
    if(!target||!/^worksheets\/sheet\d+\.xml$/.test(target))return fail();
    const file='xl/'+target,product=sheet.B1?.v==='SKU',dispatch=sheet.C1?.v==='数量'&&sheet.D1?.v==='1688订单号';
    const lastRow=XLSX.utils.decode_range(sheet['!ref']).e.r+1;
    const lastLabel=(column,label)=>{let last=0;for(let row=2;row<=lastRow;row++)if(sheet[column+row]?.v===label)last=row;return last;};
    const deductionRow=product?lastLabel('A','扣款'):0,summaryRow=name==='汇总表'?lastLabel('L','扣款'):0;
    const columns=`<cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols>`;
    let xml=read(file);if(!/<cols\b[^>]*>[\s\S]*?<\/cols>/.test(xml))return fail();
    xml=xml.replace(/<cols\b[^>]*>[\s\S]*?<\/cols>/,columns).replace(/<row\b[^>]*>/g,tag=>tag.replace(/\sht="[^"]*"/,'').replace(/\scustomHeight="[^"]*"/,'').replace(/>$/,` ht="${attribute(tag,'r')==='1'?reportHeaderHeight:reportRowHeight}" customHeight="1">`)).replace(/<c\b[^>]*>/g,cell=>{
      const address=attribute(cell,'r'),matched=address?.match(/^([A-Z]+)(\d+)$/);if(!matched)return fail();
      const [,column,rowText]=matched,row=Number(rowText),numeric=sheet[address]?.t==='n';
      const quantity=numeric&&(dispatch?['C','G'].includes(column):product&&(column==='D'||name==='汇总表'&&column==='M'));
      const general=numeric&&(name==='扣款'&&['D',sheet.E1?.v==='实际店铺'?'H':'G'].includes(column)||product&&column==='J'&&row===deductionRow||name==='汇总表'&&column==='N'&&row===summaryRow);
      const horizontal=row===1||quantity?'center':numeric?'right':'left';
      const identifier=product?['A','B','F'].includes(column):dispatch?['A','B','D'].includes(column):name==='扣款'&&['A','B','C'].includes(column);
      const id=style(Number(attribute(cell,'s')??0),horizontal,general,numeric,identifier);
      return /\bs="[^"]*"/.test(cell)?cell.replace(/\bs="[^"]*"/,`s="${id}"`):cell.replace(/\/?>(?=$)/,end=>` s="${id}"${end}`);
    });
    files.set(file,new TextEncoder().encode(xml));
  }
  let themed=styles.replace(block[0],`<cellXfs count="${originals.length+variants.length}">${block[1]}${variants.join('')}</cellXfs>`);
  for(const [tag,xml] of Object.entries(reportThemeXml)){
    const pattern=new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`);if(!pattern.test(themed))return fail();
    themed=themed.replace(pattern,xml);
  }
  files.set('xl/styles.xml',new TextEncoder().encode(themed));
  return writeReportArchive(files);
}
