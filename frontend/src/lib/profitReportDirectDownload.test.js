import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { REPORT_DOWNLOAD_FORMAT, reportTotals, sha256 } from '../domain/profitReports';
import { base64ToBytes, buildProfitReportWorkbook, bytesToBase64, prepareReportDownload } from './profitReportWorkbook';

const attrs = text => Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
function presentation(bytes) {
  const book = XLSX.read(bytes, { type: 'array', bookFiles: true, cellStyles: true });
  const xml = name => new TextDecoder().decode(book.files[name].content);
  const styles = xml('xl/styles.xml');
  const formats = [...styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match => {
    const opening = attrs(match[0].split('>')[0]), alignment = attrs(match[0].match(/<alignment\b[^>]*\/>/)?.[0] ?? '');
    return { fontId: opening.fontId, fillId: opening.fillId, borderId: opening.borderId, numFmtId: opening.numFmtId, alignment };
  });
  return { theme: ['fonts','fills','borders'].map(tag => styles.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`))[0]),
    sheets: book.SheetNames.map((name, index) => {
      const sheet = book.Sheets[name], source = xml(`xl/worksheets/sheet${index + 1}.xml`);
      const cells = [...source.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(match => {
        const meta = attrs(match[1]), cell = sheet[meta.r];
        return cell?.v == null || cell.v === '' ? null : { address: meta.r, type: cell.t, value: cell.v, format: cell.z, style: formats[Number(meta.s ?? 0)] };
      }).filter(Boolean);
      return { name, cells, widths: sheet['!cols'].map(col => col.width),
        merges: (sheet['!merges'] ?? []).map(XLSX.utils.encode_range).sort(),
        rows: [...source.matchAll(/<row\b([^>]*)>/g)].map(match => { const a = attrs(match[1]); return [a.r, a.ht]; }),
        frozen: source.includes('<pane') };
    }) };
}
function fixture(kind) {
  const products = Array.from({ length: 6 }, (_, i) => ({ store: i < 4 ? '甲店' : '乙店', platformSkc: `SKC${i < 4 ? 0 : 1}`,
    groupSkc: `SKC${i < 4 ? 0 : 1}`, platformSku: `00000000000000000000${i}`, attribute: '中文与😀',
    quantityExact: '1.5', revenueExact: '20.009', unitCostExact: i ? '15.001' : '0', purchaseCostExact: i ? '22.5015' : '0',
    warehouseCostExact: '1.05', profitExact: i ? '-3.5425' : '18.959', orderNumber: '00012345678901234567890' }));
  const dispatchRows = [2,3].map((sourceRow, index) => ({ kind: 'dispatch', store: '甲店', platformSkc: 'SKC0',
    businessId: `000000000000000${index}`, quantityExact: index ? '0.5' : '2', order1688: '00001234567890123456789',
    sourceFormat: 'xlsx', fileHash: 'SYNTHETIC', sourceSheet: '原表', sourceRow, mergedFrom: { store: 2, platformSkc: 2, order1688: 2 } }));
  const deductionRows = kind === 'financial' ? [{ store: '甲店', businessId: '00009', platformSkc: 'SKC0', supplierNumber: '合成货号', signedAmountExact: '-0.00001' }] : [];
  const report = { kind, period: '2026-09', revision: 1, totalsExact: reportTotals(products, '2.5', '0.7', deductionRows) };
  return { report, products, dispatchRows, deductionRows };
}

it.each(['financial','pre_deduction'])('already generates the final %s presentation without archived-file conversion', async kind => {
  const input = fixture(kind), built = buildProfitReportWorkbook(input);
  const saved = { ...input.report, templateVersion: built.templateVersion, fileBase64: bytesToBase64(built.bytes), fileSha256: await sha256(built.bytes) };
  const converted = await prepareReportDownload(saved, { dispatchRows: input.dispatchRows, deductionRows: input.deductionRows });
  expect(presentation(built.bytes)).toEqual(presentation(converted));
  const ready = { ...saved, downloadFormat: REPORT_DOWNLOAD_FORMAT };
  expect(await prepareReportDownload(ready)).toEqual(new Uint8Array(built.bytes));
  expect(await prepareReportDownload(ready,{dispatchRows:input.dispatchRows,deductionRows:input.deductionRows,useStoredFile:true})).toEqual(new Uint8Array(built.bytes));
  const changed = built.bytes.slice(); changed[changed.length-1] ^= 1;
  await expect(prepareReportDownload({...ready,fileBase64:bytesToBase64(changed)})).rejects.toThrow('校验失败');
  await expect(prepareReportDownload({...ready,fileSha256:null})).rejects.toThrow('校验失败');
});

it('decodes large, unpadded and whitespace base64 without a per-character element list',()=>{
  const bytes=Uint8Array.from({length:150001},(_,index)=>index%256),encoded=bytesToBase64(bytes);
  expect(base64ToBytes(encoded)).toEqual(bytes);
  expect(base64ToBytes(encoded.replace(/=/g,''))).toEqual(bytes);
  expect(base64ToBytes(encoded.replace(/.{100}/g,'$&\n'))).toEqual(bytes);
  for(const invalid of ['a','YQ===','YQ==YQ==','a%ab','YQ='])expect(()=>base64ToBytes(invalid)).toThrow();
});
