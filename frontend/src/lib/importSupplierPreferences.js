// Goods identities remain unchanged; normalization is only for matching keywords.
export const normalizeImportNumbers = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value ?? '').trim()).filter(Boolean))].sort();
export const parseImportNumbers = value => normalizeImportNumbers(String(value ?? '').split(/[\s,，;；、]+/));
const matchKey = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
export const normalizeImportKeywords = values => normalizeImportNumbers(values).map(matchKey).filter((value, index, all) => all.indexOf(value) === index).sort();
export const parseImportKeywords = value => normalizeImportKeywords(String(value ?? '').split(/[\r\n,，;；、]+/));
export function matchImportNumbers(choices, keywords) {
  const keys = normalizeImportKeywords(keywords);
  return keys.length ? choices.filter(value => keys.some(key => matchKey(value).includes(key))) : [];
}
export function matchImportNumberSuffixes(choices, suffixes) {
  const keys = normalizeImportKeywords(suffixes);
  return keys.length ? choices.filter(value => keys.some(key => matchKey(value).endsWith(key))) : [];
}
const storageKey = (workspaceId, version = 2) => `lworkstation:import-suppliers:v${version}:${workspaceId}`;
const empty = () => ({ selected: [], keywords: [], matched: [], hasSaved: false });
function readObject(storage, key) {
  try { const value = JSON.parse(storage.getItem(key) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
export function readImportPreference(workspaceId, store, storage = globalThis.localStorage) {
  if (!workspaceId) return empty();
  const saved = readObject(storage, storageKey(workspaceId))[matchKey(store)];
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) return {
    selected: normalizeImportNumbers(saved.selected), keywords: normalizeImportKeywords(saved.keywords),
    matched: normalizeImportNumbers(saved.matched), hasSaved: true,
  };
  const legacy = readObject(storage, storageKey(workspaceId, 1))[matchKey(store)];
  return Array.isArray(legacy) ? { ...empty(), selected: normalizeImportNumbers(legacy), hasSaved: true } : empty();
}
export function readImportNumbers(workspaceId, store, storage = globalThis.localStorage) {
  return readImportPreference(workspaceId, store, storage).selected;
}
export function restoreImportPreference(preference, choices) {
  const available = new Set(choices), previous = new Set(preference.matched);
  return {
    selected: preference.selected.filter(value => available.has(value)),
    missing: preference.selected.filter(value => !available.has(value)),
    newMatches: preference.hasSaved ? matchImportNumbers(choices, preference.keywords).filter(value => !previous.has(value)) : [],
  };
}
export function saveImportNumbers(workspaceId, items, storage = globalThis.localStorage) {
  if (!workspaceId) throw new Error('工作区尚未就绪');
  const saved = readObject(storage, storageKey(workspaceId));
  const groups = new Map();
  for (const item of items) {
    const key = matchKey(item.storeName), group = groups.get(key) ?? { selected: [], keywords: [], matched: [] };
    group.selected.push(...(item.filterOptions?.supplierNumbers ?? []));
    group.keywords.push(...(item.supplierKeywords ?? []));
    group.matched.push(...matchImportNumbers(item.facets?.supplierNumbers ?? [], item.supplierKeywords ?? []));
    groups.set(key, group);
  }
  for (const [key, value] of groups) saved[key] = {
    selected: normalizeImportNumbers(value.selected), keywords: normalizeImportKeywords(value.keywords), matched: normalizeImportNumbers(value.matched),
  };
  storage.setItem(storageKey(workspaceId), JSON.stringify(saved));
}
