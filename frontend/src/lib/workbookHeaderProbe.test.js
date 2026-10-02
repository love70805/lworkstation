import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { workbookHeaderProbe } from './workbookHeaderProbe';

it('preserves sparse first rows, shared strings and empty sheets while omitting later data only from the header probe', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['平台SKU', 'SKC', '数量', '金额'], ['001', '父1', 1, 2], ['002', '父2', 3, 4]], { origin: 'A7' });
  XLSX.utils.book_append_sheet(workbook, sheet, '稀疏明细');
  XLSX.utils.book_append_sheet(workbook, {}, '空页');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true });
  const result = await workbookHeaderProbe(bytes);
  expect(result.SheetNames).toEqual(['稀疏明细', '空页']);
  const data = result.Sheets['稀疏明细']['!data'];
  expect(data[6][0].v).toBe('平台SKU');
  expect(data[7][0].v).toBe('001');
  expect(data[8]).toBeUndefined();
  // The authoritative source is unchanged and still contains the later row.
  expect(XLSX.read(bytes, { type: 'array', dense: true }).Sheets['稀疏明细']['!data'][8][0].v).toBe('002');
});

it('accepts namespace-prefixed rows and self-closing sheetData without inventing records', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['平台SKU', 'SKC', '数量'], ['001', '父1', 1], ['002', '父2', 2]]), '前缀');
  XLSX.utils.book_append_sheet(workbook, {}, '空页');
  const archive = XLSX.CFB.read(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })), { type: 'buffer' });
  archive.FullPaths.forEach((path, index) => {
    if (!/worksheets\/sheet\d+\.xml$/.test(path)) return;
    const file = archive.FileIndex[index];
    let xml = new TextDecoder().decode(file.content);
    if (path.endsWith('sheet1.xml')) xml = xml.replace('<worksheet ', '<worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ').replace(/<(\/?)(row|c|v|sheetData)(?=[\s/>])/g, '<$1x:$2');
    else xml = xml.replace(/<sheetData[^>]*>[\s\S]*?<\/sheetData>/, '<sheetData/>');
    file.content = new TextEncoder().encode(xml); file.size = file.content.length;
  });
  const result = await workbookHeaderProbe(XLSX.CFB.write(archive, { type: 'array', fileType: 'zip', compression: true }));
  expect(result.Sheets['前缀']['!data'][1][0].v).toBe('001');
  expect(result.Sheets['前缀']['!data'][2]).toBeUndefined();
  expect(result.Sheets['空页']['!data']).toEqual([]);
});
