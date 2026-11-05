import { normalizeErpCatalogUrl } from './erpCatalogFields';
import { erpSupplierLink } from './erpProductCatalog';

const text = value => String(value ?? '').trim();
export function productArchiveRows(sheet, XLSX) {
  // Some ERP exports incorrectly declare A1:A1. Read actual cell addresses;
  // never truncate the file to that declared dimension.
  const cells = Object.keys(sheet).filter(key => /^[A-Z]+[1-9][0-9]*$/.test(key));
  const positions = cells.map(key => XLSX.utils.decode_cell(key));
  const end = positions.reduce((max, cell) => ({ r: Math.max(max.r, cell.r), c: Math.max(max.c, cell.c) }), { r: 0, c: 0 });
  if (end.r > 100000 || end.c > 255) throw new Error('商品档案超过可处理范围。');
  const headers = Array.from({ length: end.c + 1 }, (_, c) => text(sheet[XLSX.utils.encode_cell({ r: 0, c })]?.v));
  if (!headers.includes('商品ID') || !headers.includes('商品名称')) throw new Error('未找到商品ID、商品名称列，请选择 ERP 商品档案导出文件。');
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error('商品档案包含重复表头，请核对。');
  const columns = Object.fromEntries(headers.map((name, c) => [name, c]));
  const rows = [], seen = new Map();
  for (let r = 1; r <= end.r; r++) {
    const cell = name => columns[name] == null ? null : sheet[XLSX.utils.encode_cell({ r, c: columns[name] })];
    const value = name => cell(name)?.f ? '' : text(cell(name)?.v);
    const warehouseSku = value('商品ID');
    if (!warehouseSku) continue;
    if (cell('商品ID')?.t === 'n') throw new Error(`第 ${r + 1} 行商品ID被保存为数值，无法保证标识完整。`);
    const image = cell('图片链接');
    const imageLiteral = image?.f ? /^(?:_xlfn\.)?IMAGE\s*\(\s*"([^"]+)"\s*(?:[,;)]|$)/i.exec(image.f.replace(/^=/, ''))?.[1] : image?.v;
    const imageUrl = normalizeErpCatalogUrl(imageLiteral) || '';
    const supplier1688Links = [...new Map((value('1688链接片段').match(/https?:\/\/[^\s，,;；|<>"']+/g) ?? [])
      .map(url => erpSupplierLink(url)).filter(Boolean).map(link => [link.url, link])).values()];
    const row = { warehouseSku, productName: value('商品名称'), imageUrl, color: value('商品颜色'),
      attribute: [value('商品颜色'), value('规格型号')].filter(Boolean).join(' · '), supplier1688Links };
    const identity = warehouseSku.normalize('NFKC').toUpperCase();
    if (seen.has(identity) && JSON.stringify(seen.get(identity)) !== JSON.stringify(row)) throw new Error(`第 ${r + 1} 行商品ID存在冲突，未导入。`);
    if (!seen.has(identity)) { seen.set(identity, row); rows.push(row); }
  }
  if (!rows.length) throw new Error('商品档案没有可读取的数据行。');
  return rows;
}

export function parseProductArchiveWorkbook(bytes, XLSX) {
  if (!bytes || bytes.byteLength > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MB 的商品档案。');
  const workbook = XLSX.read(new Uint8Array(bytes), { type: 'array', cellFormula: true, cellHTML: false, cellStyles: false });
  const sheets = workbook.SheetNames.filter(name => Object.values(workbook.Sheets[name]).some(cell => cell?.v === '商品ID'));
  if (sheets.length !== 1) throw new Error('需要一个包含商品ID列的商品档案明细页。');
  return productArchiveRows(workbook.Sheets[sheets[0]], XLSX);
}
