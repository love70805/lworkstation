import * as XLSX from 'xlsx';
import { sha256, Exact, exact, REPORT_TEMPLATE_VERSION } from '../domain/profitReports';
import { base64ToBytes, buildProfitReportWorkbook } from './profitReportWorkbook';
import { profitOrderNumberForExport } from './profitOrderDisplay';

const templates = new Set(['profit-zebra@1', 'profit-zebra@2-purchase-evidence', 'profit-zebra@3-single-order', REPORT_TEMPLATE_VERSION]);
const fail = () => { throw new Error('原报告信息不足或文件损坏，无法生成简化下载。原始审计存档未改变，请恢复完整报告备份后重试。'); };
const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
const key = (store, sku) => JSON.stringify([store, sku]);
const textCell = cell => {
  if (!cell || cell.v === '') return '';
  if (cell.t !== 's' || typeof cell.v !== 'string') return fail();
  return cell.v;
};

// Project only the immutable saved OOXML and its frozen report metadata.
// Read numeric XML literals directly, preserving precision until final export.
export async function simplifySavedReport(report) {
  if (!templates.has(report?.templateVersion) || !report.fileBase64) return fail();
  let bytes, book;
  try {
    bytes = base64ToBytes(report.fileBase64);
    if (report.fileSha256 && (await sha256(bytes)).toLowerCase() !== report.fileSha256.toLowerCase()) return fail();
    book = XLSX.read(bytes, { type: 'array', bookFiles: true });
  } catch { return fail(); }
  if (report.templateVersion === REPORT_TEMPLATE_VERSION) {
    if (book.Sheets['汇总表']?.J1?.v !== '利润' || book.Sheets['汇总表']?.I1?.v !== '仓储成本') return fail();
    return bytes;
  }
  if (report.warehouseRateExact == null || !report.totalsExact?.stores?.length) return fail();
  try { exact(report.warehouseRateExact, { nonnegative: true }); } catch { return fail(); }
  const files = new Map(Object.entries(book.files ?? {}).filter(([name, entry]) => name && entry.type === 2 && name !== '\u0001Sh33tJ5').map(([name, entry]) => [name, new Uint8Array(entry.content)]));
  const decoded=new Map();
  const read = name => {if(!files.has(name))return fail();if(!decoded.has(name))decoded.set(name,new TextDecoder().decode(files.get(name)));return decoded.get(name);};
  const workbookPath = 'xl/workbook.xml', relsPath = 'xl/_rels/workbook.xml.rels';
  const workbook = read(workbookPath), rels = read(relsPath);
  const relationships = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(match => ({ tag: match[0], ...attrs(match[0]) }));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map(match => {
    const attributes = attrs(match[0]);
    const relation = relationships.find(row => row.Id === attributes['r:id']);
    if (!relation || !/^worksheets\/sheet\d+\.xml$/.test(relation.Target)) return fail();
    return { name: attributes.name, tag: match[0], relation, path: `xl/${relation.Target}`, sheet: book.Sheets[attributes.name] };
  });
  if (sheets.length !== book.SheetNames.length || sheets[0]?.name !== '汇总表' || !sheets.some(row => row.name === '代发表')) return fail();
  const productSheet = sheet => sheet?.A1?.v === 'SKC' && sheet?.B1?.v === 'SKU' && ['关联单号', '1688单号'].includes(sheet?.F1?.v) && sheet?.I1?.v === '利润';
  const purchases = sheets.find(row => row.name === '核算采购' && row.sheet?.A1?.v === '店铺' && row.sheet?.B1?.v === 'SKU' && row.sheet?.C1?.v === '次序' && row.sheet?.F1?.v === '关联单号');
  if (sheets.some(row => row.name === '核算采购' && row !== purchases && !productSheet(row.sheet))) return fail();
  const orders = new Map();
  if (purchases) {
    const sheet = purchases.sheet;
    for (let r = 2; r <= XLSX.utils.decode_range(sheet['!ref']).e.r + 1; r++) {
      const store = textCell(sheet[`A${r}`]), sku = textCell(sheet[`B${r}`]);
      if (!store || !sku) return fail();
      const id = key(store, sku), order = textCell(sheet[`F${r}`]).trim() || textCell(sheet[`G${r}`]).trim();
      if (!orders.has(id) || !orders.get(id)) orders.set(id, order);
    }
  }
  const groups = new Map(), products = [], numericCells=new Map();
  function numeric(entry, address) {
    if(!numericCells.has(entry.path))numericCells.set(entry.path,new Map([...read(entry.path).matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(match=>[attrs(match[1]).r,match[2].match(/<v>([^<]+)<\/v>/)?.[1]])));
    if (entry.sheet[address]?.t !== 'n') return fail();
    const literal = numericCells.get(entry.path).get(address);
    try { return exact(literal); } catch { return fail(); }
  }
  function readProductSheet(entry, fixedStore) {
    if (!productSheet(entry.sheet)) return fail();
    let store = fixedStore;
    const seen = [];
    for (let r = 2; r <= XLSX.utils.decode_range(entry.sheet['!ref']).e.r + 1; r++) {
      const sheet = entry.sheet, sku = textCell(sheet[`B${r}`]);
      if (!sku) {
        if (!fixedStore && sheet['!merges']?.some(range => range.s.r === r - 1 && range.s.c === 0 && range.e.c === 8)) {
          store = textCell(sheet[`A${r}`]);
          if (!store || groups.has(store)) return fail();
          groups.set(store, []);
        }
        continue;
      }
      if (!store || !groups.has(store)) return fail();
      const id = key(store, sku), original = textCell(sheet[`F${r}`]);
      const order = orders.has(id) ? orders.get(id) : report.templateVersion === 'profit-zebra@3-single-order' ? original : profitOrderNumberForExport({ orderNumber: original });
      const product = {store, platformSku:sku, groupSkc:textCell(sheet[`A${r}`]), attribute:textCell(sheet[`C${r}`]), exportOrderNumber:order,
        quantityExact:numeric(entry,`D${r}`), revenueExact:numeric(entry,`E${r}`), unitCostExact:numeric(entry,`G${r}`), purchaseCostExact:numeric(entry,`H${r}`), profitExact:numeric(entry,`I${r}`)};
      product.warehouseCostExact = new Exact(product.quantityExact).times(report.warehouseRateExact).toFixed();
      const record = product;
      if (!fixedStore) products.push(product);
      if (!fixedStore) groups.get(store).push(record);
      seen.push(record);

    }
    if (fixedStore && JSON.stringify(seen) !== JSON.stringify(groups.get(fixedStore))) return fail();
  }
  readProductSheet(sheets[0]);
  const storeSheets = sheets.slice(1).filter(row => productSheet(row.sheet));
  if (!groups.size || storeSheets.length !== groups.size) return fail();
  [...groups.keys()].forEach((store, i) => readProductSheet(storeSheets[i], store));
  const frozenStores = report.totalsExact.stores.map(row=>row.store);
  if (JSON.stringify([...groups.keys()]) !== JSON.stringify(frozenStores)) return fail();
  const dispatchEntry=sheets.find(row=>row.name==='代发表'), dispatchRows=[];
  if (dispatchEntry.sheet.A1?.v!=='SKC'||dispatchEntry.sheet.B1?.v!=='订单号') return fail();
  for(let r=2;r<=XLSX.utils.decode_range(dispatchEntry.sheet['!ref']).e.r+1;r++){
    if (!dispatchEntry.sheet[`C${r}`]) continue;
    dispatchRows.push({platformSkc:textCell(dispatchEntry.sheet[`A${r}`]),businessId:textCell(dispatchEntry.sheet[`B${r}`]),quantityExact:numeric(dispatchEntry,`C${r}`),order1688:textCell(dispatchEntry.sheet[`D${r}`])});
  }
  const deductionRows=[], deductionEntry=sheets.find(row=>row.name==='扣款');
  if(report.kind==='financial'){
    if(deductionEntry?.sheet.A1?.v!=='店铺'||deductionEntry.sheet.E1?.v!=='金额') return fail();
    for(let r=2;r<=XLSX.utils.decode_range(deductionEntry.sheet['!ref']).e.r+1;r++){
      if(!deductionEntry.sheet[`E${r}`])continue;
      deductionRows.push({store:textCell(deductionEntry.sheet[`A${r}`]),businessId:textCell(deductionEntry.sheet[`B${r}`]),platformSkc:textCell(deductionEntry.sheet[`C${r}`]),supplierNumber:textCell(deductionEntry.sheet[`D${r}`]),signedAmountExact:numeric(deductionEntry,`E${r}`)});
    }
  }
  return buildProfitReportWorkbook({report,products,dispatchRows,deductionRows}).bytes;
}
