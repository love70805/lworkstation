export const normalizeImportNumbers = values => [...new Set((values ?? []).map(value => String(value ?? '').normalize('NFKC').trim()).filter(Boolean))].sort();
export const parseImportNumbers = value => normalizeImportNumbers(String(value ?? '').split(/[\s,，;；]+/));
const storeKey = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
const storageKey = workspaceId => `lworkstation:import-suppliers:v1:${workspaceId}`;
export function readImportNumbers(workspaceId, store, storage = globalThis.localStorage) {
  if (!workspaceId) return [];
  try { return normalizeImportNumbers(JSON.parse(storage.getItem(storageKey(workspaceId)) ?? '{}')[storeKey(store)]); }
  catch { return []; }
}
export function saveImportNumbers(workspaceId, items, storage = globalThis.localStorage) {
  if (!workspaceId) throw new Error('工作区尚未就绪');
  let saved = {};
  try { saved = JSON.parse(storage.getItem(storageKey(workspaceId)) ?? '{}') ?? {}; } catch { /* replace invalid preferences only */ }
  for (const item of items) saved[storeKey(item.storeName)] = normalizeImportNumbers(item.filterOptions?.supplierNumbers);
  storage.setItem(storageKey(workspaceId), JSON.stringify(saved));
}
