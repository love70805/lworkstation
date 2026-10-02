import { readImportStage } from "./salesImportStage";
import { compactSalesImportPlan, prepareSalesImportItems } from "../domain/batchSalesImport";

export async function materializeImportPlan(input) {
  // Check batch-wide duplicate identities/stores/files with no extra row clone.
  const stores = new Set(), hashes = new Set(), ids = new Set();
  for (const item of input.items) {
    const store = item.storeName.normalize('NFKC').trim().toUpperCase();
    if (stores.has(store)) throw new Error('整批不能有两个文件属于同一店铺。');
    if (hashes.has(item.fileHash)) throw new Error('整批存在相同文件内容，请移除重复文件并核对店铺。');
    if (ids.has(item.itemId)) throw new Error('文件标识缺失或重复，请重新选择文件。');
    stores.add(store); hashes.add(item.fileHash); ids.add(item.itemId);
  }
  return compactSalesImportPlan(input, async item => {
    if (!item.rowSource) return item;
    const { rowSource, ...metadata } = item;
    const rows = await readImportStage(rowSource);
    return prepareSalesImportItems([{ ...metadata, rows }], { period: input.period, ownedRows: true })[0];
  });
}
