import {captureCostDrafts,validateCostDraftBackup} from './costMatchingDraft.js';
// Only these business preferences may cross a backup boundary. Never enumerate
// or export arbitrary localStorage values (authentication and device state live there).
export const BUSINESS_PREFERENCE_FIELDS = Object.freeze({
  supplierGroups: 'lworkstation:import-supplier-groups:v1:',
  importSuppliersV1: 'lworkstation:import-suppliers:v1:',
  importSuppliersV2: 'lworkstation:import-suppliers:v2:',
});
export const PREFERENCE_RESTORE_JOURNAL = 'lworkstation:backup-preferences-transaction:v1';
export const PREFERENCE_RESTORE_COMMIT = 'businessPreferenceRestoreCommit';
export function clearBusinessPreferences(storage = globalThis.localStorage, session = globalThis.sessionStorage) {
  const prefixes=[...Object.values(BUSINESS_PREFERENCE_FIELDS),'shopeers:profit-filter:','shopeers-product-library-filters-v1'];
  for (const target of [storage,session]) {
    if (!target) continue;
    const keys = Array.from({length:target.length}, (_, index) => target.key(index));
    for (const key of keys) {
      if (prefixes.some(prefix => key?.startsWith(prefix))) target.removeItem(key);
    }
  }
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new Error('备份业务筛选配置校验失败。'); };
function keys(value, allowed) {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();
}
function text(value, { empty = false, max = 1000 } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) fail();
  return value;
}
function strings(value) { if (!Array.isArray(value)) fail(); value.forEach(item => text(item)); }
function validateValue(field, value) {
  if (value === null) return;
  if (!isObject(value)) fail();
  if (field === 'supplierGroups') {
    keys(value, ['schemaVersion', 'groups', 'lastAppliedId', 'overrides']);
    if (value.schemaVersion !== 1 || !Array.isArray(value.groups) || !isObject(value.overrides)) fail();
    const ids = new Set();
    for (const group of value.groups) {
      keys(group, ['id', 'name', 'aliases', 'mode']);
      text(group.id, { max: 100 }); text(group.name, { max: 80 }); strings(group.aliases);
      if (!group.aliases.length || group.aliases.length > 64 || !['suffix', 'contains', 'exact'].includes(group.mode) || ids.has(group.id)) fail();
      ids.add(group.id);
    }
    text(value.lastAppliedId, { empty: true, max: 100 });
    if (value.lastAppliedId && !ids.has(value.lastAppliedId)) fail();
    for (const [store, override] of Object.entries(value.overrides)) {
      text(store); keys(override, ['groupId', 'include', 'exclude']);
      if (!ids.has(override.groupId)) fail();
      strings(override.include); strings(override.exclude);
    }
  } else {
    for (const [store, preference] of Object.entries(value)) {
      text(store);
      if (field === 'importSuppliersV1') strings(preference);
      else {
        keys(preference, ['selected', 'keywords', 'matched']);
        strings(preference.selected); strings(preference.keywords); strings(preference.matched);
      }
    }
  }
}

export function validateBusinessPreferences(payload, workspaceIds) {
  if (payload === undefined) return; // Older backups never included these preferences.
  keys(payload, ['formatVersion', 'workspaces']);
  if (payload.formatVersion !== 1 || !Array.isArray(payload.workspaces)) fail();
  const allowed = new Set(workspaceIds), seen = new Set();
  for (const workspace of payload.workspaces) {
    keys(workspace, ['workspaceId', ...Object.keys(BUSINESS_PREFERENCE_FIELDS)]);
    text(workspace.workspaceId);
    if (!allowed.has(workspace.workspaceId) || seen.has(workspace.workspaceId)) fail();
    seen.add(workspace.workspaceId);
    for (const field of Object.keys(BUSINESS_PREFERENCE_FIELDS)) validateValue(field, workspace[field]);
  }
  if (seen.size !== allowed.size) fail();
}

export function captureBusinessPreferences(workspaceIds, storage = globalThis.localStorage) {
  if (!storage) return undefined; // Non-browser tooling has no device preference store.
  const workspaces = [...new Set(workspaceIds)].sort().map(workspaceId => ({ workspaceId,
    ...Object.fromEntries(Object.entries(BUSINESS_PREFERENCE_FIELDS).map(([field, prefix]) => {
      const raw = storage.getItem(`${prefix}${workspaceId}`);
      return [field, raw === null ? null : JSON.parse(raw)];
    })),
  }));
  const payload = { formatVersion: 1, workspaces };
  validateBusinessPreferences(payload, workspaceIds);
  return payload;
}

function writeEntries(entries, storage) {
  for (const { key, value } of entries) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    if (storage.getItem(key) !== value) throw new Error('业务筛选配置未完整写入。');
  }
}
export function preparePreferenceRestore(payload, storage = globalThis.localStorage, {costDrafts}={}) {
  if (payload === undefined && costDrafts===undefined) return null;
  if (!storage) throw new Error('本机业务筛选配置存储不可用，未恢复数据。');
  if (storage.getItem(PREFERENCE_RESTORE_JOURNAL) !== null) throw new Error('上次恢复尚未完成，请先重试恢复检查。');
  const after = (payload?.workspaces??[]).flatMap(workspace => Object.entries(BUSINESS_PREFERENCE_FIELDS).map(([field, prefix]) => ({
    key: `${prefix}${workspace.workspaceId}`, value: workspace[field] === null ? null : JSON.stringify(workspace[field]),
  })));
  if(costDrafts!==undefined) {
    validateCostDraftBackup(costDrafts);
    const next=new Map(costDrafts.entries.map(entry=>[entry.key,entry.value]));
    const keys=new Set([...captureCostDrafts(storage).entries.map(entry=>entry.key),...next.keys()]);
    for(const key of keys)after.push({key,value:next.get(key)??null});
  }
  const journal = { version: 1, id: crypto.randomUUID(), after,
    before: after.map(({ key }) => ({ key, value: storage.getItem(key) })),
  };
  // Reserving the journal is also a storage-writability preflight. It survives a
  // crash until IndexedDB tells startup which side of the transaction committed.
  const serialized = JSON.stringify(journal);
  storage.setItem(PREFERENCE_RESTORE_JOURNAL, serialized);
  if (storage.getItem(PREFERENCE_RESTORE_JOURNAL) !== serialized) throw new Error('无法保存恢复保护记录，未恢复数据。');
  return journal;
}
export function applyPreferenceRestore(journal, committed, storage = globalThis.localStorage) {
  if (journal) writeEntries(committed ? journal.after : journal.before, storage);
}
export function finishPreferenceRestore(storage = globalThis.localStorage) {
  storage?.removeItem(PREFERENCE_RESTORE_JOURNAL);
  if (storage?.getItem(PREFERENCE_RESTORE_JOURNAL) != null) throw new Error('恢复保护记录尚未清理，请重试恢复检查。');
}
export function readPreferenceRestoreJournal(storage = globalThis.localStorage) {
  const raw = storage?.getItem(PREFERENCE_RESTORE_JOURNAL);
  if (raw == null) return null;
  const journal = JSON.parse(raw);
  keys(journal, ['version', 'id', 'before', 'after']);
  if (journal.version !== 1 || !Array.isArray(journal.before) || !Array.isArray(journal.after)) fail();
  text(journal.id);
  const valid = entries => {
    const seen = new Set();
    for (const entry of entries) {
      keys(entry, ['key', 'value']); text(entry.key);
      if (!(entry.key.startsWith('shopeers:erp-cost-draft:')||Object.values(BUSINESS_PREFERENCE_FIELDS).some(prefix => entry.key.startsWith(prefix) && entry.key.length > prefix.length))
        || seen.has(entry.key) || !(entry.value === null || typeof entry.value === 'string')) fail();
      seen.add(entry.key);
    }
    return [...seen].sort();
  };
  if (JSON.stringify(valid(journal.before)) !== JSON.stringify(valid(journal.after))) fail();
  for (const entry of journal.after) {
    if(entry.key.startsWith('shopeers:erp-cost-draft:'))continue;
    const [field] = Object.entries(BUSINESS_PREFERENCE_FIELDS).find(([, prefix]) => entry.key.startsWith(prefix));
    validateValue(field, entry.value === null ? null : JSON.parse(entry.value));
  }
  return journal;
}
