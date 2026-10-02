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

it('keeps nonzero shared-string references following self-closing header and data cells', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[null,'平台SKU','SKC','数量'],[null,'000123','父',1],[null,'000456','父',2]]), '台账');
  const archive = XLSX.CFB.read(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx',bookSST:true})),{type:'array'});
  archive.FullPaths.forEach((path,index) => {
    if (!path.endsWith('/xl/sharedStrings.xml') && !path.endsWith('/xl/worksheets/sheet1.xml')) return;
    const entry = archive.FileIndex[index]; let xml = new TextDecoder().decode(entry.content);
    if(path.endsWith('sharedStrings.xml')) xml = xml.replace(/(<sst\b[^>]*>)/,'$1<si><t>unused</t></si>');
    else xml = xml.replace(/(<c\b[^>]*t="s"[^>]*><v>)(\d+)(<\/v>)/g,(_all,open,value,close)=>`${open}${Number(value)+1}${close}`).replace(/(<row r="([123])"[^>]*>)/g,'$1<c r="A$2"/>');
    entry.content = new TextEncoder().encode(xml); entry.size = entry.content.length;
  });
  const buffer = XLSX.CFB.write(archive,{type:'array',fileType:'zip'}), probe = await workbookHeaderProbe(buffer);
  expect(probe.__importFullWorkbook).toBeUndefined();
  expect(probe.Sheets['台账']['!data'][0][1].v).toBe('平台SKU');
  expect(probe.Sheets['台账']['!data'][2]).toBeUndefined();
  const values = [];
  for await (const chunk of workbookSheetChunks(buffer,'台账',probe,1)) values.push(chunk.workbook.Sheets['台账']['!data'][chunk.start][1].v);
  expect(values).toEqual(['000123','000456']);
});
