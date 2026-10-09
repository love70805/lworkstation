import { normalizeImportKeywords, normalizeImportNumbers } from './importSupplierPreferences';

const modes = new Set(['suffix', 'contains', 'exact']);
const key = workspaceId => `lworkstation:import-supplier-groups:v1:${workspaceId}`;
const canonical = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
const empty = () => ({ groups: [], lastAppliedId: '', overrides: {} });
function normalizeGroup(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id ?? '').trim().slice(0, 100), name = String(value.name ?? '').trim().slice(0, 80);
  const aliases = normalizeImportKeywords(value.aliases).slice(0, 64);
  return id && name && aliases.length ? { id, name, aliases, mode: modes.has(value.mode) ? value.mode : 'suffix' } : null;
}
export function matchImportNumberRule(choices, rule = {}) {
  const aliases = normalizeImportKeywords(rule.aliases), mode = modes.has(rule.mode) ? rule.mode : 'suffix';
  return (choices ?? []).filter(value => aliases.some(alias => {
    const number = canonical(value);
    return mode === 'exact' ? number === alias : mode === 'contains' ? number.includes(alias) : number.endsWith(alias);
  }));
}
export function readSupplierGroups(workspaceId, storage = globalThis.localStorage) {
  if (!workspaceId) return empty();
  try {
    const value = JSON.parse(storage.getItem(key(workspaceId)) ?? '{}');
    const groups = (Array.isArray(value?.groups) ? value.groups : []).map(normalizeGroup).filter(Boolean);
    const unique = groups.filter((group, index) => groups.findIndex(item => item.id === group.id) === index);
    return { groups: unique, lastAppliedId: unique.some(group => group.id === value.lastAppliedId) ? value.lastAppliedId : '',
      overrides: value?.overrides && typeof value.overrides === 'object' && !Array.isArray(value.overrides) ? value.overrides : {} };
  } catch { return empty(); }
}
function write(workspaceId, value, storage) {
  if (!workspaceId) throw new Error('工作区尚未就绪');
  storage.setItem(key(workspaceId), JSON.stringify({ schemaVersion: 1, ...value }));
}
export function saveSupplierGroup(workspaceId, input, storage = globalThis.localStorage) {
  if (normalizeImportKeywords(input.aliases).length > 64) throw new Error('每组最多保存 64 个别名，请拆分为多组');
  const group = normalizeGroup({ ...input, id: input.id || crypto.randomUUID() });
  if (!group) throw new Error('请填写组名称和至少一个货号别名');
  const state = readSupplierGroups(workspaceId, storage);
  if (state.groups.some(item => item.id !== group.id && canonical(item.name) === canonical(group.name))) throw new Error('已有同名货号组，请选择该组后更新');
  const previous = state.groups.find(item => item.id === group.id);
  state.groups = [...state.groups.filter(item => item.id !== group.id), group];
  if (previous && !sameRule(previous, group)) {
    state.overrides = Object.fromEntries(Object.entries(state.overrides).filter(([, value]) => value?.groupId !== group.id));
    if (state.lastAppliedId === group.id) state.lastAppliedId = '';
  }
  write(workspaceId, state, storage); return group;
}
export function deleteSupplierGroup(workspaceId, id, storage = globalThis.localStorage) {
  const state = readSupplierGroups(workspaceId, storage);
  state.groups = state.groups.filter(group => group.id !== id);
  if (state.lastAppliedId === id) state.lastAppliedId = '';
  state.overrides = Object.fromEntries(Object.entries(state.overrides).filter(([, value]) => value?.groupId !== id));
  write(workspaceId, state, storage);
}
const sameRule = (left, right) => left?.mode === right?.mode && JSON.stringify(normalizeImportKeywords(left?.aliases)) === JSON.stringify(normalizeImportKeywords(right?.aliases));
export function restoreSupplierGroupSelection(choices, group, state, store) {
  const override = state.overrides[canonical(store)], useOverride = override?.groupId === group.id;
  const selected = new Set(matchImportNumberRule(choices, group));
  if (useOverride) {
    normalizeImportNumbers(override.exclude).forEach(value => selected.delete(value));
    normalizeImportNumbers(override.include).forEach(value => selected.add(value));
  }
  return choices.filter(value => selected.has(value));
}
// Called only after an atomic import succeeds. V1/V2 preferences stay independent.
export function rememberSupplierGroupSelection(workspaceId, items, storage = globalThis.localStorage) {
  const state = readSupplierGroups(workspaceId, storage), ids = new Set(items.map(item => item.supplierGroupRule?.id || ''));
  const id = ids.size === 1 ? [...ids][0] : '', group = state.groups.find(item => item.id === id);
  state.lastAppliedId = group && items.every(item => sameRule(item.supplierGroupRule, group)) ? id : '';
  if (state.lastAppliedId) {
    const stores = new Map();
    for (const item of items) {
      const store = canonical(item.storeName), entry = stores.get(store) ?? { choices: [], selected: [] };
      entry.choices.push(...(item.facets?.supplierNumbers ?? [])); entry.selected.push(...(item.filterOptions?.supplierNumbers ?? [])); stores.set(store, entry);
    }
    for (const [store, entry] of stores) {
      const matching = new Set(matchImportNumberRule(normalizeImportNumbers(entry.choices), group)), selected = new Set(entry.selected);
      state.overrides[store] = { groupId: id, exclude: [...matching].filter(value => !selected.has(value)), include: normalizeImportNumbers(entry.selected).filter(value => !matching.has(value)) };
    }
  }
  if (state.groups.length || storage.getItem(key(workspaceId))) write(workspaceId, state, storage);
}
