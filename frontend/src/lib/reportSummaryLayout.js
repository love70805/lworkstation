import { reportRowHeight } from './profitReportTheme';

const fail = () => { throw new Error('报告汇总布局信息不足，原始存档保持不变，请核对完整报告备份。'); };
const columnIndex = address => [...address.match(/^[A-Z]+/)[0]].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0);

// Frozen downloads may still have the old L1:N1 summary. Move only that block,
// retaining every cell's original XML value/type/style and leaving A:K in place.
export function lowerSavedReportSummary(xml, sheet) {
  if (sheet.L1?.v !== '店铺' || sheet.M1?.v !== '销量' || sheet.N1?.v !== '利润') return xml;
  const data = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!data) return fail();
  const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  if (data[1].replace(rowPattern, '').trim()) return fail();
  const rows = new Map(), moved = [];
  for (const match of data[1].matchAll(rowPattern)) {
    const row = Number(match[1].match(/\br="(\d+)"/)?.[1]);
    if (!Number.isInteger(row) || row < 1 || rows.has(row)) return fail();
    const cells = [];
    const remaining = (match[2] ?? '').replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, cell => {
      const address = cell.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!address || Number(address.match(/\d+$/)[0]) !== row) return fail();
      if (/^[LMN]\d+$/.test(address)) {
        if (row >= 1048576) return fail();
        moved.push({ row: row + 1, cell: cell.replace(/\br="[LMN]\d+"/, `r="${address[0]}${row + 1}"`) });
      } else cells.push(cell);
      return '';
    });
    if (remaining.trim()) return fail();
    rows.set(row, { attributes: match[1], cells });
  }
  if (!rows.size) return fail();
  for (const entry of moved) {
    if (!rows.has(entry.row)) rows.set(entry.row, { attributes: ` r="${entry.row}" ht="${reportRowHeight}" customHeight="1"`, cells: [] });
    rows.get(entry.row).cells.push(entry.cell);
  }
  const sorted = [...rows].sort(([a], [b]) => a - b);
  const contents = sorted.map(([, row]) => `<row${row.attributes}>${row.cells.sort((a, b) => columnIndex(a.match(/\br="([A-Z]+\d+)"/)[1]) - columnIndex(b.match(/\br="([A-Z]+\d+)"/)[1])).join('')}</row>`).join('');
  return xml.replace(data[0], `<sheetData>${contents}</sheetData>`)
    .replace(/<mergeCell\b[^>]*\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"[^>]*\/>/g, (tag, start, first, end, last) => {
      const left = columnIndex(start), right = columnIndex(end);
      if (right < 12 || left > 14) return tag;
      if (left < 12 || right > 14 || Number(last) >= 1048576) return fail();
      return tag.replace(/\bref="[^"]*"/, `ref="${start}${Number(first) + 1}:${end}${Number(last) + 1}"`);
    })
    .replace(/(<dimension\b[^>]*\bref="[A-Z]+\d+:[A-Z]+)(\d+)(")/, (_, start, last, end) => start + Math.max(Number(last), sorted.at(-1)[0]) + end);
}

export function unfreezeReportSheet(xml) {
  return xml.replace(/<sheetViews\b[^>]*>[\s\S]*?<\/sheetViews>/g, views => views
    .replace(/<pane\b[^>]*?(?:\/>|>[\s\S]*?<\/pane>)/g, '')
    .replace(/<selection\b(?=[^>]*\bpane=")[^>]*?(?:\/>|>[\s\S]*?<\/selection>)/g, ''));
}
