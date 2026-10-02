import Dexie from 'dexie';

// Disposable local scratch space, deliberately separate from business data and
// backups. Only sealed, immutable stages may cross the preview/write boundary.
const stageDb = new Dexie('LworkstationSalesImportScratch');
stageDb.version(1).stores({ stages: 'id,owner,createdAt', chunks: '[stageId+index],stageId' });
export const IMPORT_CHUNK_SIZE = 2000;
export async function createImportStage(owner) {
  const id = crypto.randomUUID();
  await stageDb.stages.add({ id, owner, createdAt: Date.now(), sealed: false });
  return id;
}
export async function appendImportStage(id, index, rows) {
  await stageDb.transaction('rw', stageDb.stages, stageDb.chunks, async () => {
    const stage = await stageDb.stages.get(id);
    if (!stage || stage.sealed) throw new Error('导入临时分块已封存，不能修改。');
    await stageDb.chunks.add({ stageId: id, index, rows });
  });
}
export async function sealImportStage(id, rowCount, chunkCount) {
  await stageDb.transaction('rw', stageDb.stages, async () => {
    const stage = await stageDb.stages.get(id);
    if (!stage || stage.sealed) throw new Error('导入临时分块已封存，不能修改。');
    await stageDb.stages.update(id, { sealed: true, rowCount, chunkCount });
  });
  return { id, rowCount, chunkCount };
}
export async function removeImportStage(id) {
  if (!id) return;
  await stageDb.transaction('rw', stageDb.stages, stageDb.chunks, async () => {
    await stageDb.chunks.where('stageId').equals(id).delete(); await stageDb.stages.delete(id);
  });
}
export async function readImportStageChunk(source, index) {
  const stage = await stageDb.stages.get(source.id);
  if (!stage?.sealed || stage.rowCount !== source.rowCount || stage.chunkCount !== source.chunkCount) throw new Error('导入临时数据已失效，请重新选择文件。');
  const chunk = await stageDb.chunks.get([source.id, index]);
  if (!chunk) throw new Error('导入临时分块缺失，请重新选择文件。');
  return chunk.rows;
}
export async function readImportStage(source) {
  const rows = [];
  for (let index = 0; index < source.chunkCount; index += 1) rows.push(...await readImportStageChunk(source, index));
  if (rows.length !== source.rowCount) throw new Error('导入临时数据行数不完整，请重新选择文件。');
  return rows;
}
export async function clearImportStages(owner, { expiredOnly = false } = {}) {
  const stages = expiredOnly ? await stageDb.stages.where('createdAt').below(Date.now() - 24 * 3600000).toArray() : await stageDb.stages.where('owner').equals(owner).toArray();
  await stageDb.transaction('rw', stageDb.stages, stageDb.chunks, async () => {
    for (const stage of stages) { await stageDb.chunks.where('stageId').equals(stage.id).delete(); await stageDb.stages.delete(stage.id); }
  });
}
