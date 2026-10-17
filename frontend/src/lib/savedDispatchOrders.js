import * as XLSX from 'xlsx';
import { exact } from '../domain/profitReports';
import { dispatchOrderNumberForExport } from '../domain/dispatchOrderNumber';
import { writeReportArchive } from './profitReportWorkbook';

const fail = () => { throw new Error('代发表与冻结来源记录不一致，无法补齐单号。原始报告保持不变，请检查完整报告备份。'); };
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

export function restoreSavedDispatchOrders(bytes, frozenRows) {
  const book = XLSX.read(bytes, { type: 'array', bookFiles: true }), sheet = book.Sheets['代发表'];
  if (sheet?.A1?.v !== 'SKC' || sheet.B1?.v !== '订单号' || sheet.D1?.v !== '1688订单号') return fail();
  const files = new Map(Object.entries(book.files ?? {}).filter(([name, entry]) => name && entry.type === 2 && name !== '\u0001Sh33tJ5').map(([name, entry]) => [name, new Uint8Array(entry.content)]));
  const read = name => files.has(name) ? new TextDecoder().decode(files.get(name)) : fail();
  const sheetTag = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/>/g)].map(match => match[0]).find(tag => attribute(tag, 'name') === '代发表');
  const relationId = sheetTag && attribute(sheetTag, 'r:id');
  const relation = [...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*\/>/g)].map(match => match[0]).find(tag => attribute(tag, 'Id') === relationId);
  const target = relation && attribute(relation, 'Target');
  if (!target || !/^worksheets\/sheet\d+\.xml$/.test(target)) return fail();
  const file = `xl/${target}`, records = frozenRows.filter(row => !row.manual), rows = [];
  for (let r = 2; r <= XLSX.utils.decode_range(sheet['!ref']).e.r + 1; r++) if (sheet[`C${r}`]) rows.push(r);
  if (rows.length !== records.length) return fail();
  let xml = read(file), changed = false;
  const quantities = new Map([...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(match => [attribute(match[1], 'r'),match[2].match(/<v>([^<]+)<\/v>/)?.[1]]));
  rows.forEach((r, i) => {
    const source = records[i];
    if (String(sheet[`A${r}`]?.v ?? '') !== String(source.platformSkc ?? '') || String(sheet[`B${r}`]?.v ?? '') !== String(source.businessId ?? '') || exact(quantities.get(`C${r}`)) !== exact(source.quantityExact)) return fail();
    if (String(sheet[`D${r}`]?.v ?? '').trim()) return;
    const order = dispatchOrderNumberForExport(source);
    if (!order) return;
    const address = `D${r}`, replacement = `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(order)}</t></is></c>`;
    const cell = new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    if (cell.test(xml)) xml = xml.replace(cell, old => {
      if (/t="inlineStr"/.test(old) && /<t\b[^>]*>[\s\S]*?<\/t>/.test(old)) return old.replace(/(<t\b[^>]*>)[\s\S]*?(<\/t>)/,(_,start,end)=>start+escapeXml(order)+end);
      const style = attribute(old.slice(0, old.indexOf('>') + 1), 's');
      return style ? replacement.replace(' t=', ` s="${style}" t=`) : replacement;
    });
    else {
      const row = new RegExp(`(<row\\b(?=[^>]*\\br="${r}")[^>]*>)([\\s\\S]*?)(<\\/row>)`);
      if (!row.test(xml)) return fail();
      xml = xml.replace(row, (_, start, contents, end) => {
        const next = contents.search(new RegExp(`<c\\b[^>]*\\br="[E-Z]+${r}"`));
        return start + (next < 0 ? contents + replacement : contents.slice(0, next) + replacement + contents.slice(next)) + end;
      });
    }
    changed = true;
  });
  if (!changed) return bytes;
  files.set(file, new TextEncoder().encode(xml));
  return writeReportArchive(files);
}
