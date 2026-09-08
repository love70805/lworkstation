import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
let messages;
async function worker() {
  vi.resetModules(); messages = [];
  vi.stubGlobal('self', { postMessage: (data) => messages.push(data) });
  await import('./import.worker');
  return (data) => { messages.length = 0; self.onmessage({ data: { requestId: 'request', ...data } }); return messages.at(-1); };
}
afterEach(() => vi.unstubAllGlobals());
const headers = ['店铺','供方货号','SKC','平台SKU','数量','金额'];
const mapping = {store:'店铺',supplierNumber:'供方货号',platformSkc:'SKC',platformSku:'平台SKU',quantity:'数量',amount:'金额'};
describe('batch import Worker jobs', () => {
  it('keeps four formats/jobs isolated, preserves Chinese/leading zero and only reads the first worksheet', async () => {
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
      expect(send({type:'parse',jobId:extension,extension,buffer})).toMatchObject({type:'parsed',rowCount:1});
    }
    for (const jobId of ['csv','tsv','xlsx','xls']) {
      expect(send({type:'validate',jobId,mapping,options:{defaultStore:'甲店',enforceSingleStore:true}})).toMatchObject({type:'validated',rows:[{platformSku:'000123',store:'甲店',amount:10}],summary:{errorCount:0}});
    }
    expect(send({type:'release',jobId:'csv'}).type).toBe('released');
    expect(send({type:'validate',jobId:'csv',mapping}).type).toBe('error');
    expect(send({type:'validate',jobId:'xlsx',mapping}).type).toBe('validated');
  });
  it('blocks malformed CSV without silently dropping excess columns', async () => {
    const send = await worker();
    expect(send({type:'parse',jobId:'bad',extension:'csv',buffer:new TextEncoder().encode('SKU,金额\n123,10,extra').buffer})).toMatchObject({type:'error',message:expect.stringContaining('格式错误')});
  });
  it('reports mixed stores as errors even in filtered rows and separates intentional filters', async () => {
    const send = await worker();
    const buffer = new TextEncoder().encode('店铺,供方货号,SKC,平台SKU,数量,金额\n甲店,供方01,父商品,000123,2,10\n乙店,筛除,父商品,000124,2,10\n甲店,筛除,父商品,000125,2,10').buffer;
    send({type:'parse',jobId:'mixed',extension:'csv',buffer});
    expect(send({type:'validate',jobId:'mixed',mapping,options:{defaultStore:'甲店',enforceSingleStore:true,supplierNumbers:['供方01']}})).toMatchObject({summary:{validRowCount:1,errorCount:1,ignoredCount:1}});
  });
});
