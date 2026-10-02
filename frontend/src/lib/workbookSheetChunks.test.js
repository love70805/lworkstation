import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { workbookHeaderProbe } from './workbookHeaderProbe';
import { workbookSheetChunks } from './workbookSheetChunks';

it('parses every compressed worksheet cell through bounded SheetJS chunks, with shared rich strings and source positions intact', async () => {
  const book = XLSX.utils.book_new();
  const cells = [['平台SKU', 'SKC', '数量', '金额', '订单号'], ...Array.from({ length: 16001 }, (_, index) => [index, '中文<&>父商品', 0.5, 0.00019, `00012345678901234567890123-${index}`])];
  const sheet = XLSX.utils.aoa_to_sheet(cells);
  sheet.A2.z = '000000'; sheet.D2.z = '0.00';
  XLSX.utils.book_append_sheet(book, sheet, '真实明细');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true });
  const probe = await workbookHeaderProbe(bytes), chunks = [], values = [];
  for await (const chunk of workbookSheetChunks(bytes, '真实明细', probe)) {
    chunks.push([chunk.start, chunk.end]);
    const data = chunk.workbook.Sheets['真实明细']['!data'];
    expect(data.filter(Boolean).length).toBeLessThanOrEqual(8001);
    for (let row = chunk.start; row <= chunk.end; row++) values.push(data[row].map(cell => cell.v));
  }
  expect(chunks).toEqual([[1, 8000], [8001, 16000], [16001, 16001]]);
  expect(values).toEqual(cells.slice(1));
});
