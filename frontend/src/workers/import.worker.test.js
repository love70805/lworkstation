import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { readImportStage, readImportStageChunk, clearImportStages } from '../lib/salesImportStage';
import { validateSalesRows } from '../lib/salesImport';

afterEach(async () => { await clearImportStages('worker-test'); vi.unstubAllGlobals(); vi.doUnmock('../lib/workbookSheetChunks'); });
it('keeps multiple-sheet choice and every source row after blank leading records', async () => {
  vi.resetModules();
  const messages = [];
  vi.stubGlobal('self', { postMessage: message => messages.push(message) });
  await import('./import.worker');
  const workbook = XLSX.utils.book_new();
  for (const name of ['第一明细', '第二明细']) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['平台SKU', 'SKC', '数量', '金额'], [], ['00001', name, 1, 2], ['00002', name, 3, 4],
  ]), name);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['人员', '收入'], ['某人', 6]]), '人员汇总');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true });
  await self.onmessage({ data: { type: 'parse', requestId: 'choose', jobId: 'test', extension: 'xlsx', buffer } });
  expect(messages.at(-1)).toMatchObject({ type: 'sheet-selection-required', sheetCandidates: ['第一明细', '第二明细'] });
  await self.onmessage({ data: { type: 'parse', requestId: 'parse', jobId: 'test', extension: 'xlsx', buffer, selectedSheet: '第二明细' } });
  expect(messages.at(-1)).toMatchObject({ type: 'parsed', rowCount: 2, selectedSheet: '第二明细' });
});
it('stages every validated source row with identical original numeric values, timestamp and formatted long identifiers', async () => {
  vi.resetModules();
  const messages = [];
  vi.stubGlobal('self', { postMessage: message => messages.push(message) });
  await import('./import.worker');
  const sheet = XLSX.utils.aoa_to_sheet([
    ['平台SKU', 'SKC', '数量', '金额', '添加时间', '订单号', '100', '2'],
    [123, 'SKC-1', 3, 12.345678, 46265.99998842592, '000987654321098765432109876', 1.234, 9.876],
    [],
    ['00022345678901234567890123', 'SKC-2', 1, 0.000019, 46265.5, '000123456789012345678901234', 7.654, 2.345],
  ]);
  sheet.A2.z = '000000'; sheet.C2.f = '1+2';
  sheet.D2.z = '0.00'; sheet.D4.z = '0.00'; sheet.E2.z = 'yyyy-mm-dd'; sheet.E4.z = 'yyyy-mm-dd';
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, '台账变动明细');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, bookSST: true });
  await self.onmessage({ data: { type: 'parse', requestId: 'parse', jobId: 'test', extension: 'xlsx', buffer } });
  const parsed = messages.find(m => m.type === 'parsed'); expect(parsed.rowCount).toBe(2);
  // Explicitly map a numeric header: Object.keys order must never be mistaken
  // for spreadsheet column order when selecting original numeric values.
  const mapping = { ...parsed.suggestedMapping, amount: '100' };
  await self.onmessage({ data: { type: 'inspect-period', requestId: 'inspect', jobId: 'test', mapping, options: { defaultStore: '测试店' }, stageOwner: 'worker-test' } });
  const inspected = messages.find(m => m.type === 'period-inspected');
  const actual = await readImportStage(inspected.rowSource);
  const decoded = XLSX.read(buffer, { type: 'array', cellDates: false, dense: true }).Sheets['台账变动明细'];
  const formatted = XLSX.utils.sheet_to_json(decoded, { defval: '', raw: false });
  const originals = XLSX.utils.sheet_to_json(decoded, { defval: '', raw: true });
  formatted.forEach((row, index) => Object.defineProperty(row, '__salesSource', { value: { sourceRow: row.__rowNum__ + 1, sourceSheet: '台账变动明细', rawValues: originals[index], date1904: false } }));
  expect(actual).toEqual(validateSalesRows(formatted, mapping, { defaultStore: '测试店' }).rows);
  expect(actual.map(row => row.sourceRow)).toEqual([2, 4]);
  expect(actual[0].platformSku).toBe('000123');
  expect(inspected.evidence.validationSummary).toMatchObject({ sourceRowCount: 2, validRowCount: 2, errorCount: 0 });
});

let messages;
async function worker() {
  vi.resetModules(); messages = [];
  vi.stubGlobal('self', { postMessage: (data) => messages.push(data) });
  await import('./import.worker');
  return async (data) => { messages.length = 0; await self.onmessage({ data: { requestId: 'request', stageOwner: 'worker-test', ...data } }); return messages.at(-1); };
}

const headers = ['店铺','供方货号','SKC','平台SKU','数量','金额'];
const mapping = {store:'店铺',supplierNumber:'供方货号',platformSkc:'SKC',platformSku:'平台SKU',quantity:'数量',amount:'金额'};
describe('batch import Worker jobs', () => {
  it('retains underlying decimals, real source rows, added date and activity without changing legacy amounts', async () => {
    const send = await worker();
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['店铺','供方货号','SKC','平台SKU','数量','单价','添加时间','活动'], ['甲','供方','父','001',0.5,0.009,46235,'促销'], [], ['甲','供方','父','002',1,2,'2026-09-01','']]);
    sheet.F2.z = '0.00';
    XLSX.utils.book_append_sheet(book, sheet, '台账');
    const parsed = await send({type:'parse',jobId:'exact',extension:'xlsx',buffer:XLSX.write(book,{type:'array',bookType:'xlsx'})});
    expect(parsed.headers).not.toContain('__salesSource');
    const result = await send({type:'validate',jobId:'exact',mapping:parsed.suggestedMapping,options:{deriveAmountFromUnitPrice:true,period:'2026-08'}});
    expect(result.rows[0]).toMatchObject({sourceSheet:'台账',sourceRow:2,quantityExact:'0.5',unitPriceRaw:'0.009',amountExact:'0.0045',activityStatus:'known',activityRaw:'促销'});
    expect(result.rows[1]).toMatchObject({sourceRow:4,dateStatus:'out_of_period',activityStatus:'missing'});
  });
  it('keeps four formats/jobs isolated, preserves Chinese/leading zero and requires explicit selection of ambiguous detail sheets', async () => {
    const send = await worker();
    for (const extension of ['csv','tsv','xlsx','xls']) {
      const cells = [headers, ['甲店','供方01','父商品','000123','2','10']];
      let buffer;
      if (extension === 'csv' || extension === 'tsv') buffer = new TextEncoder().encode(cells.map(row=>row.join(extension === 'csv' ? ',' : '\t')).join('\n')).buffer;
      else {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(cells), '首表');
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers,['乙店','错误','错误','999','999','999']]), '忽略');
        buffer = XLSX.write(book, {type:'array',bookType:extension === 'xls' ? 'biff8' : 'xlsx'});
      }
      if (extension === 'xls' || extension === 'xlsx') {
        expect(await send({type:'parse',jobId:extension,extension,buffer})).toMatchObject({type:'sheet-selection-required',sheetCandidates:['首表','忽略']});
      }
      expect(await send({type:'parse',jobId:extension,extension,buffer,selectedSheet:'首表'})).toMatchObject({type:'parsed',rowCount:1});
    }
    for (const jobId of ['csv','tsv','xlsx','xls']) {
      expect(await send({type:'validate',jobId,mapping,options:{defaultStore:'甲店',enforceSingleStore:true}})).toMatchObject({type:'validated',rows:[{platformSku:'000123',store:'甲店',amount:10}],summary:{errorCount:0}});
    }
    expect((await send({type:'release',jobId:'csv'})).type).toBe('released');
    expect((await send({type:'validate',jobId:'csv',mapping})).type).toBe('error');
    expect((await send({type:'validate',jobId:'xlsx',mapping})).type).toBe('validated');
  });
  it('blocks malformed CSV without silently dropping excess columns', async () => {
    const send = await worker();
    expect(await send({type:'parse',jobId:'bad',extension:'csv',buffer:new TextEncoder().encode('SKU,金额\n123,10,extra').buffer})).toMatchObject({type:'error',message:expect.stringContaining('格式错误')});
  });
  it('reports mixed stores as errors even in filtered rows and separates intentional filters', async () => {
    const send = await worker();
    const buffer = new TextEncoder().encode('店铺,供方货号,SKC,平台SKU,数量,金额\n甲店,供方01,父商品,000123,2,10\n乙店,筛除,父商品,000124,2,10\n甲店,筛除,父商品,000125,2,10').buffer;
    await send({type:'parse',jobId:'mixed',extension:'csv',buffer});
    expect(await send({type:'validate',jobId:'mixed',mapping,options:{defaultStore:'甲店',enforceSingleStore:true,supplierNumbers:['供方01']}})).toMatchObject({summary:{validRowCount:1,errorCount:1,ignoredCount:1}});
  });
});

it('finds the actual detail sheet after a personnel summary and ignores an empty anomaly sheet', async () => {
  const send = await worker();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['人员','SKC','计数'], ['某人','父',9]]), '人员汇总');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ['甲店','供方','父','001',2,10]]), '台账变动明细');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers]), '异常');
  expect(await send({ type:'parse',jobId:'actual',extension:'xlsx',buffer:XLSX.write(book,{type:'array',bookType:'xlsx'}) })).toMatchObject({type:'parsed',selectedSheet:'台账变动明细',rowCount:1});
  expect(await send({type:'validate',jobId:'actual',mapping})).toMatchObject({rows:[{sourceSheet:'台账变动明细',sourceRow:2,platformSku:'001'}]});
});
it('streams validated rows in bounded chunks with real progress', async () => {
  const send = await worker();
  const buffer = new TextEncoder().encode(headers.join(',')+'\n'+Array.from({length:4101},(_,i)=>`甲店,货号${i},父${i},${i},1,2`).join('\n')).buffer;
  await send({type:'parse',jobId:'large',extension:'csv',buffer});
  const result = await send({type:'validate',jobId:'large',mapping,chunked:true});
  expect(result.rows).toBeUndefined();
  expect(result.summary.validRowCount).toBe(4101);
  expect(messages.filter(item=>item.type==='validated-chunk')).toHaveLength(0);
  expect((await Promise.all([0,1,2].map(index => readImportStageChunk(result.rowSource, index)))).map(rows=>rows.length)).toEqual([2000,2000,101]);
  expect(messages.filter(item=>item.type==='progress').at(-1)).toMatchObject({completed:4101,total:4101,value:100});
});

it('discards both streamed blocks before falling back on reordered source rows', async () => {
  vi.doMock('../lib/workbookSheetChunks', async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, workbookSheetChunks: (...args) => actual.workbookSheetChunks(...args, 2) };
  });
  const send = await worker(), book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...Array.from({length:7}, (_, i) => ['甲店','货号','父',String(i),1,2])]), '台账');
  const archive = XLSX.CFB.read(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx',bookSST:true})),{type:'array'});
  const entry = archive.FileIndex[archive.FullPaths.findIndex(path => path.endsWith('/xl/worksheets/sheet1.xml'))];
  const xml = new TextDecoder().decode(entry.content).replace(/(<row r="6"[\s\S]*?<\/row>)(<row r="7"[\s\S]*?<\/row>)/, '$2$1');
  entry.content = new TextEncoder().encode(xml); entry.size = entry.content.length;
  const buffer = XLSX.CFB.write(archive,{type:'array',fileType:'zip'});
  expect(await send({type:'parse',jobId:'fallback',extension:'xlsx',buffer})).toMatchObject({type:'parsed',rowCount:7});
  const result = await send({type:'validate',jobId:'fallback',mapping});
  expect(result.rows).toHaveLength(7);
  expect(new Set(result.rows.map(row => row.sourceRow)).size).toBe(7);
  expect(result.rows[4]).toMatchObject({sourceRow:6,platformSku:'4'});
});

it('preserves sparse C7 headers and 1904 date-system formatting', async () => {
  const send = await worker(), book = XLSX.utils.book_new(), sheet = {};
  XLSX.utils.sheet_add_aoa(sheet,[['平台SKU','SKC','数量','金额','添加时间'],['0001','父',1,0.0019,44774.5]],{origin:'C7'});
  sheet['!ref'] = 'C7:G8';
  sheet.G8.z = 'yyyy-mm-dd hh:mm:ss'; book.Workbook = {WBProps:{date1904:true}};
  XLSX.utils.book_append_sheet(book,sheet,'台账');
  const buffer = XLSX.write(book,{type:'array',bookType:'xlsx',bookSST:true,compression:true});
  const parsed = await send({type:'parse',jobId:'sparse',extension:'xlsx',buffer});
  expect(parsed).toMatchObject({type:'parsed',rowCount:1});
  const result = await send({type:'validate',jobId:'sparse',mapping:parsed.suggestedMapping,options:{defaultStore:'甲店'}});
  expect(result.rows[0]).toMatchObject({sourceRow:8,platformSku:'0001',amountExact:'0.0019'});
  expect(result.rows[0]).toMatchObject({rawAddedAt:'44774.5',sourceAddedDate:'2026-08-02'});
  expect(parsed.previewRows[0]['添加时间']).toBe(XLSX.SSF.format(sheet.G8.z,sheet.G8.v,{date1904:true}));
});

it('does not merge a self-closing shared string or source row into its following element', async () => {
  const send = await worker(), book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, [], ['甲店','货号','父','000123',1,0.0019]]), '台账');
  const archive = XLSX.CFB.read(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx',bookSST:true})),{type:'array'});
  archive.FullPaths.forEach((path, index) => {
    if (!path.endsWith('/xl/sharedStrings.xml') && !path.endsWith('/xl/worksheets/sheet1.xml')) return;
    const entry = archive.FileIndex[index];
    let xml = new TextDecoder().decode(entry.content);
    if (path.endsWith('sharedStrings.xml')) xml = xml.replace(/(<sst\b[^>]*>)/, '$1<si/>');
    else xml = xml.replace(/(<c\b[^>]*t="s"[^>]*><v>)(\d+)(<\/v>)/g, (_all, open, value, close) => `${open}${Number(value)+1}${close}`).replace('<row r="3"', '<row r="2"/><row r="3"');
    entry.content = new TextEncoder().encode(xml); entry.size = entry.content.length;
  });
  const buffer = XLSX.CFB.write(archive,{type:'array',fileType:'zip'});
  expect(await send({type:'parse',jobId:'empty-element',extension:'xlsx',buffer})).toMatchObject({type:'parsed',rowCount:1});
  const result = await send({type:'validate',jobId:'empty-element',mapping});
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({sourceRow:3,platformSku:'000123',amountExact:'0.0019'});
});
