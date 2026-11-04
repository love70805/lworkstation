import * as XLSX from 'xlsx';
import { exact } from '../domain/profitReports';
import { dispatchOrderNumberForExport } from '../domain/dispatchOrderNumber';
import { dispatchColumns, dispatchFields, dispatchHeaders, dispatchSourceMerges, visibleDispatchRows } from './dispatchReportLayout';
import { writeReportArchive } from './profitReportWorkbook';

const fail = () => { throw new Error('代发表与冻结来源记录不一致，无法调整下载。原始报告保持不变，请检查完整报告备份。'); };
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const address = (col, row) => XLSX.utils.encode_col(col) + row;
const cellsPattern = /<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
const rowsPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
const style = cell => { const value = cell && attribute(cell.slice(0, cell.indexOf('>') + 1), 's'); return ` s="${value ?? 0}"`; };
const textCell = (col, row, value, original) => `<c r="${address(col,row)}"${style(original)} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;

// Project verified OOXML only. Numeric XML literals and the right-hand totals
// stay intact; frozen rows supply provenance, never a live workspace lookup.
export function restoreSavedDispatchOrders(bytes, frozenRows, { allowMissingStore = false } = {}) {
  const book = XLSX.read(bytes, { type: 'array', bookFiles: true }), sheet = book.Sheets['代发表'];
  const columns = dispatchColumns(sheet);
  if (!columns || sheet.G1?.v !== '汇总数量' || sheet.H1?.v !== '总价') return fail();
  const files = new Map(Object.entries(book.files ?? {}).filter(([name, entry]) => name && entry.type === 2 && name !== '\u0001Sh33tJ5').map(([name, entry]) => [name, new Uint8Array(entry.content)]));
  const read = name => files.has(name) ? new TextDecoder().decode(files.get(name)) : fail();
  const sheetTag = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/>/g)].map(match => match[0]).find(tag => attribute(tag, 'name') === '代发表');
  const relationId = sheetTag && attribute(sheetTag, 'r:id');
  const relation = [...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*\/>/g)].map(match => match[0]).find(tag => attribute(tag, 'Id') === relationId);
  const target = relation && attribute(relation, 'Target');
  if (!target || !/^worksheets\/sheet\d+\.xml$/.test(target)) return fail();
  const file = `xl/${target}`, original = read(file);
  const xmlRows = new Map([...original.matchAll(rowsPattern)].map(match => [Number(attribute(match[1], 'r')), {
    attributes: match[1], cells: new Map([...match[2].matchAll(cellsPattern)].map(cell => [XLSX.utils.decode_cell(attribute(cell[1], 'r')).c, cell[0]])),
  }]));
  const effective = (col, row) => {
    if (col == null) return '';
    const own = sheet[address(col,row)];
    const merge = sheet['!merges']?.find(range => range.s.c === col && range.e.c === col && range.s.r < row - 1 && range.e.r >= row - 1);
    const cell = merge ? sheet[address(col,merge.s.r + 1)] : own;
    if (merge && own?.v != null && own.v !== '' && String(own.v) !== String(cell?.v ?? '')) return fail();
    if (!cell || cell.v == null || cell.v === '') return '';
    if (cell.t !== 's' || typeof cell.v !== 'string') return fail();
    return cell.v;
  };
  const dataRows = [];
  for (let row = 2; row <= XLSX.utils.decode_range(sheet['!ref']).e.r + 1; row++) if (sheet[address(columns.quantityExact,row)]?.t === 'n') dataRows.push(row);
  const records = Array.isArray(frozenRows) ? visibleDispatchRows(frozenRows) : null;
  if (records && records.length !== dataRows.length) return fail();
  const values = new Map(dataRows.map((row,index) => {
    const quantityAddress = address(columns.quantityExact,row), quantityCell = xmlRows.get(row)?.cells.get(columns.quantityExact);
    if (!quantityCell || sheet[quantityAddress].f) return fail();
    const quantity = quantityCell.match(/<v>([^<]+)<\/v>/)?.[1];
    const value = Object.fromEntries(dispatchFields.filter(field => field !== 'quantityExact').map(field => [field, effective(columns[field],row)]));
    const source = records?.[index];
    if (source) {
      if (value.platformSkc !== String(source.platformSkc ?? '') || value.businessId !== String(source.businessId ?? '') || exact(quantity) !== exact(source.quantityExact)) return fail();
      const sourceStore = String(source.store ?? '');
      if (columns.store != null && value.store !== sourceStore && !(allowMissingStore && value.store === '')) return fail();
      value.store = sourceStore;
      const order = dispatchOrderNumberForExport(source);
      if (value.order1688 && value.order1688 !== order) return fail();
      if (!value.order1688) value.order1688 = order;
    }
    return [row,value];
  }));
  for (const [row,entry] of xmlRows) {
    const cells = entry.cells, result = new Map([...cells].filter(([col]) => col >= 5));
    if (row > 1 && !values.has(row) && Object.values(columns).some(col => sheet[address(col,row)]?.f || (sheet[address(col,row)]?.v != null && sheet[address(col,row)].v !== ''))) return fail();
    if (row === 1 || values.has(row)) dispatchFields.forEach((field,col) => {
      const from = columns[field], source = from == null ? cells.get(columns.platformSkc) : cells.get(from);
      if (field === 'quantityExact' && row > 1) {
        if (!source) return fail();
        result.set(col,source.replace(/\br="[A-Z]+\d+"/,`r="${address(col,row)}"`));
      } else result.set(col,textCell(col,row,row === 1 ? dispatchHeaders[col] : values.get(row)[field],source));
    });
    entry.cells = result;
  }
  const merges = (sheet['!merges'] ?? []).filter(range => range.s.c >= 5);
  const planned = records ? dispatchSourceMerges(records).map(range => ({ s: { c: range.column, r: dataRows[range.start] - 1 }, e: { c: range.column, r: dataRows[range.end] - 1 }, start: range.start, end: range.end }))
    : (sheet['!merges'] ?? []).filter(range => range.s.c === range.e.c && range.s.r >= 1 && ['store','platformSkc','order1688'].some(field => columns[field] === range.s.c)).map(range => ({ s: { c: dispatchFields.findIndex(field => columns[field] === range.s.c), r: range.s.r }, e: { c: dispatchFields.findIndex(field => columns[field] === range.s.c), r: range.e.r } }));
  for (const range of planned) {
    if (range.start != null && dataRows.slice(range.start,range.end + 1).some((row,index,rows) => index && row !== rows[index-1] + 1)) continue;
    const anchor = xmlRows.get(range.s.r + 1)?.cells.get(range.s.c);
    if (!anchor) return fail();
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      const entry = xmlRows.get(row + 1);
      if (!entry?.cells.has(range.s.c)) return fail();
      entry.cells.set(range.s.c,`<c r="${address(range.s.c,row + 1)}"${style(anchor)}/>`);
    }
    merges.push({ s: range.s, e: range.e });
  }
  let output = original.replace(rowsPattern,(_,attributes) => {
    const entry = xmlRows.get(Number(attribute(attributes,'r')));
    return `<row${attributes}>${[...entry.cells].sort((a,b) => a[0] - b[0]).map(([,cell]) => cell).join('')}</row>`;
  }).replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/g,'');
  merges.sort((a,b) => a.s.r - b.s.r || a.s.c - b.s.c);
  if (merges.length) output = output.replace('</sheetData>',`</sheetData><mergeCells count="${merges.length}">${merges.map(range => `<mergeCell ref="${XLSX.utils.encode_range(range)}"/>`).join('')}</mergeCells>`);
  output = output.replace(/<dimension\b[^>]*\/>/,`<dimension ref="A1:H${XLSX.utils.decode_range(sheet['!ref']).e.r + 1}"/>`);
  files.set(file,new TextEncoder().encode(output));
  return writeReportArchive(files);
}
