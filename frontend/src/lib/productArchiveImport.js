import { parseProductArchiveWorkbook } from '../domain/productArchiveWorkbook';
export { productArchiveRows } from '../domain/productArchiveWorkbook';

export async function readProductArchive(file) {
  if (!file || file.size > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MB 的商品档案。');
  const bytes = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const rows = parseProductArchiveWorkbook(bytes, XLSX);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  return { fileName: file.name, hash, rows };
}
