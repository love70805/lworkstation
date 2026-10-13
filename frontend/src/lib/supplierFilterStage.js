import { appendImportStage, createImportStage, readImportStageChunk, sealImportStage, IMPORT_CHUNK_SIZE } from './salesImportStage';
import { sealSupplierFilterIndex } from '../domain/supplierFilterPreview';

export async function stageSupplierFilterIndex(index, owner) {
  const preview = sealSupplierFilterIndex(index), rows = [];
  for (const entry of preview.entries) {
    const members = [...index.entries.get(entry.supplierNumber).members.values()];
    entry.memberOffset = rows.length; entry.memberCount = members.length;
    for (const member of members) rows.push(member);
  }
  const id = await createImportStage(owner);
  let chunkCount = 0;
  for (let start = 0; start < rows.length; start += IMPORT_CHUNK_SIZE) await appendImportStage(id, chunkCount++, rows.slice(start, start + IMPORT_CHUNK_SIZE));
  preview.memberSource = await sealImportStage(id, rows.length, chunkCount);
  return preview;
}
export async function readSupplierFilterMembers(preview, supplierNumber, { period = '', page = 0, pageSize = 30 } = {}) {
  const entry = preview.entries.find(row => row.supplierNumber === supplierNumber);
  if (!entry) throw new Error('货号明细已失效，请重新查看。');
  const size = Math.max(1, Math.min(100, Math.floor(pageSize) || 30)), offset = Math.max(0, Math.floor(page) || 0) * size;
  const rows = [];
  for (let position = entry.memberOffset; position < entry.memberOffset + entry.memberCount;) {
    const chunkIndex = Math.floor(position / IMPORT_CHUNK_SIZE), chunk = await readImportStageChunk(preview.memberSource, chunkIndex);
    const start = position % IMPORT_CHUNK_SIZE, count = Math.min(chunk.length - start, entry.memberOffset + entry.memberCount - position);
    if (count <= 0) throw new Error('货号临时明细不完整，请重新选择文件。');
    for (const row of chunk.slice(start, start + count)) if (!period || row.month === period) rows.push(row);
    position += count;
  }
  return { rows: rows.slice(offset, offset + size), total: rows.length, page: Math.floor(offset / size), pageSize: size };
}
