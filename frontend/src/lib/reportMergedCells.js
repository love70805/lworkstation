import * as XLSX from 'xlsx';

// A merge declaration does not erase the stored contents. Keep formatting but
// remove every covered value/formula so native clipboard exports one identifier.
export function clearReportMergeValues(xml, sheet) {
  const covered = new Set();
  for (const range of sheet['!merges'] ?? []) {
    const anchor = sheet[XLSX.utils.encode_cell(range.s)];
    for (let row = range.s.r; row <= range.e.r; row++) for (let col = range.s.c; col <= range.e.c; col++) {
      if (row === range.s.r && col === range.s.c) continue;
      const address = XLSX.utils.encode_cell({ r: row, c: col }), cell = sheet[address];
      if (cell?.v != null && cell.v !== '' && String(cell.v) !== String(anchor?.v ?? '')) throw new Error('报告合并范围内存在不同内容，原始存档保持不变，请核对完整报告备份。');
      covered.add(address);
    }
  }
  return xml.replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g, (cell, attributes) => {
    if (!covered.has(attributes.match(/\br="([A-Z]+\d+)"/)?.[1])) return cell;
    return `<c${attributes.replace(/\s+t="[^"]*"/g, '')}/>`;
  });
}
