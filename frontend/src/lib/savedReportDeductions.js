import * as XLSX from 'xlsx';
import { exact, exactSum } from '../domain/profitReports';
import { buildProfitDeductionSheet, writeReportArchive } from './profitReportWorkbook';

const fail=()=>{throw new Error('扣款表与冻结来源或合计不一致，无法生成下载。原始报告保持不变，请检查完整报告备份。');};
const attribute=(tag,name)=>tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

// Replace only the deduction presentation and its linked deduction cells.
// Product amounts, final profits, identifiers and the saved archive stay intact.
export function restoreSavedDeductions(bytes,report,rows) {
  const totals=report.totalsExact,stores=totals?.stores??[];
  if(!stores.length||exactSum(rows,'signedAmountExact')!==exact(totals.deductionExact)||rows.some(row=>!stores.some(store=>store.store===row.store)))return fail();
  for(const store of stores)if(exactSum(rows.filter(row=>row.store===store.store),'signedAmountExact')!==exact(store.deductionExact))return fail();
  const book=XLSX.read(bytes,{type:'array',bookFiles:true}),sheet=book.Sheets['扣款'];
  if(sheet?.A1?.v!=='补扣款单号'||sheet.D1?.v!=='扣款金额'||sheet.D2?.t!=='n')return fail();
  const files=new Map(Object.entries(book.files??{}).filter(([name,entry])=>name&&entry.type===2&&name!=='\u0001Sh33tJ5').map(([name,entry])=>[name,new Uint8Array(entry.content)]));
  const read=name=>files.has(name)?new TextDecoder().decode(files.get(name)):fail();
  const relations=[...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*\/>/g)].map(match=>match[0]);
  const entries=[...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/>/g)].map(match=>{
    const tag=match[0],name=attribute(tag,'name')?.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const relation=relations.find(row=>attribute(row,'Id')===attribute(tag,'r:id')),target=relation&&attribute(relation,'Target');
    if(!target||!/^worksheets\/sheet\d+\.xml$/.test(target))return fail();
    return {name,path:'xl/'+target,sheet:book.Sheets[name]};
  });
  const deduction=entries.find(entry=>entry.name==='扣款');if(!deduction)return fail();
  const xml=read(deduction.path);
  const style=address=>{const tag=xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*>`))?.[0];return tag?Number(attribute(tag,'s')??0):fail();};
  const totalRow=stores.length+2,wide=sheet.E1?.v==='实际店铺';
  const styles={header:style('A1'),text:style('A2'),money:style('D2'),totalText:style(`${wide?'G':'F'}${totalRow}`),totalMoney:style(`${wide?'H':'G'}${totalRow}`)};
  const stripe=sheet.D3?.t==='n'?{text:style('A3'),money:style('D3')}:styles;
  const registry={id:(cell,row)=>{
    if(cell.header)return styles.header;
    if(cell.bold)return cell.number?styles.totalMoney:styles.totalText;
    const body=cell.detail&&row%2===0?stripe:styles;
    return cell.number?body.money:body.text;
  }};
  files.set(deduction.path,new TextEncoder().encode(buildProfitDeductionSheet(report,rows,registry)));
  function patch(entry,address,value){
    if(entry.sheet?.[address]?.t!=='n')return fail();
    const original=read(entry.path),cell=new RegExp(`(<c\\b(?=[^>]*\\br="${address}")[^>]*>[\\s\\S]*?<v>)[^<]*(<\\/v>)`);
    if(!cell.test(original))return fail();
    files.set(entry.path,new TextEncoder().encode(original.replace(cell,(_,start,end)=>start+exact(value)+end)));
  }
  const lastLabel=(entry,column,label)=>{
    let found=null;for(let r=2;r<=XLSX.utils.decode_range(entry.sheet['!ref']).e.r+1;r++)if(entry.sheet[`${column}${r}`]?.v===label)found=r;
    return found??fail();
  };
  const summary=entries.find(entry=>entry.name==='汇总表');if(!summary)return fail();
  patch(summary,'N'+lastLabel(summary,'L','扣款'),totals.deductionExact);
  const productSheets=entries.filter(entry=>entry.name!=='汇总表'&&entry.sheet?.A1?.v==='SKC'&&entry.sheet.B1?.v==='SKU'&&entry.sheet.J1?.v==='利润');
  if(productSheets.length!==stores.length)return fail();
  productSheets.forEach((entry,i)=>patch(entry,'J'+lastLabel(entry,'A','扣款'),stores[i].deductionExact));
  return writeReportArchive(files);
}
