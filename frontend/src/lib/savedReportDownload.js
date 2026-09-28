import * as XLSX from 'xlsx';
import { sha256 } from '../domain/profitReports';
import { base64ToBytes } from './profitReportWorkbook';
import { profitOrderNumberForExport } from './profitOrderDisplay';

const templates = new Set(['profit-zebra@1', 'profit-zebra@2-purchase-evidence', 'profit-zebra@3-single-order']);
const fail = () => { throw new Error('原报告信息不足或文件损坏，无法生成简化下载。原始审计存档未改变，请恢复完整报告备份后重试。'); };
const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
const key = (store, sku) => JSON.stringify([store, sku]);
const textCell = cell => {
  if (!cell || cell.v === '') return '';
  if (cell.t !== 's' || typeof cell.v !== 'string') return fail();
  return cell.v;
};

// Read only the immutable saved OOXML. Never round-trip worksheet numbers or
// styles through the spreadsheet writer, or consult current business records.
export async function simplifySavedReport(report, zip) {
  if (!templates.has(report?.templateVersion) || !report.fileBase64) return fail();
  let bytes, book;
  try {
    bytes = base64ToBytes(report.fileBase64);
    if (report.fileSha256 && (await sha256(bytes)).toLowerCase() !== report.fileSha256.toLowerCase()) return fail();
    book = XLSX.read(bytes, { type: 'array', bookFiles: true });
  } catch { return fail(); }
  const files = new Map(Object.entries(book.files ?? {}).filter(([name, entry]) => name && entry.type === 2 && name !== '\u0001Sh33tJ5').map(([name, entry]) => [name, new Uint8Array(entry.content)]));
  const read = name => files.has(name) ? new TextDecoder().decode(files.get(name)) : fail();
  const workbookPath = 'xl/workbook.xml', relsPath = 'xl/_rels/workbook.xml.rels', typesPath = '[Content_Types].xml';
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
  const groups = new Map();
  function patchSheet(entry, fixedStore) {
    if (!productSheet(entry.sheet)) return fail();
    let source = read(entry.path), store = fixedStore;
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
      const record = [sku, order];
      if (!fixedStore) groups.get(store).push(record);
      seen.push(record);
      const pattern = new RegExp(`<c\\b(?=[^>]*\\br="F${r}")[^>]*>([\\s\\S]*?)<\\/c>`);
      const cell = source.match(pattern);
      if (!cell) return fail();
      const style = attrs(cell[0].slice(0, cell[0].indexOf('>') + 1)).s;
      source = source.replace(pattern, () => `<c r="F${r}"${style === undefined ? '' : ` s="${style}"`} t="inlineStr"><is><t xml:space="preserve">${escape(order)}</t></is></c>`);
    }
    if (fixedStore && JSON.stringify(seen) !== JSON.stringify(groups.get(fixedStore))) return fail();
    files.set(entry.path, source);
  }
  patchSheet(sheets[0]);
  const storeSheets = sheets.slice(1).filter(row => productSheet(row.sheet));
  if (!groups.size || storeSheets.length !== groups.size) return fail();
  [...groups.keys()].forEach((store, i) => patchSheet(storeSheets[i], store));
  if (purchases) {
    files.delete(purchases.path);
    files.set(workbookPath, workbook.replace(purchases.tag, ''));
    files.set(relsPath, rels.replace(purchases.relation.tag, ''));
    files.set(typesPath, read(typesPath).replace(/<Override\b[^>]*\/>/g, tag => attrs(tag).PartName === `/${purchases.path}` ? '' : tag));
  }
  return zip([...files]);
}
