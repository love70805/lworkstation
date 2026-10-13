import { normalizeImportKeywords, normalizeImportNumbers } from '../lib/importSupplierPreferences';
import { matchImportNumberRule, restoreSupplierGroupSelection } from '../lib/importSupplierGroups';

const text = value => String(value ?? '').trim();
const canonical = value => text(value).normalize('NFKC').toUpperCase();
export const supplierEntryKey = (workspaceId, period, store, supplierNumber) => JSON.stringify([workspaceId ?? '', period ?? '', canonical(store), text(supplierNumber)]);
export const supplierRuleKey = rule => JSON.stringify([rule?.id ?? '', rule?.mode ?? 'suffix', [...(rule?.aliases ?? [])].map(canonical).sort()]);

// Built in the import Worker. Source counts include excluded/error rows; only
// validated evidence contributes identifiers. No amount or cost leaves here.
export function createSupplierFilterIndex(mapping = {}, scope = {}) {
  const columns = Object.values(mapping).filter(Boolean);
  return { scope, mappingState: { supplier: Boolean(mapping.supplierNumber), skc: Boolean(mapping.platformSkc), sku: Boolean(mapping.platformSku), date: Boolean(mapping.sourceAddedAt),
    complete: Boolean(mapping.platformSku && (mapping.platformSkc || mapping.supplierNumber) && (mapping.store || scope.store) && new Set(columns).size === columns.length) }, entries: new Map() };
}
function indexEntry(index, supplierNumber) {
  if (!index.entries.has(supplierNumber)) index.entries.set(supplierNumber, { supplierNumber, sourceRowCount: 0, missingSkc: false, missingSku: false, months: new Map(), members: new Map() });
  return index.entries.get(supplierNumber);
}
export function addSupplierSourceRows(index, rows, mapping) {
  for (const row of rows) {
    const supplier = text(row[mapping.supplierNumber]);
    if (supplier) {
      const entry = indexEntry(index, supplier); entry.sourceRowCount += 1;
      entry.missingSkc ||= !text(row[mapping.platformSkc]); entry.missingSku ||= !text(row[mapping.platformSku]);
    }
  }
}
export function addSupplierEvidence(index, rows) {
  if (!index.mappingState.complete) return;
  for (const row of rows) {
    if (!row.supplierNumber) continue;
    const entry = indexEntry(index, row.supplierNumber);
    const month = row.dateStatus === 'valid' ? row.sourceAddedDate?.slice(0, 7) ?? '' : '';
    if (!entry.months.has(month)) entry.months.set(month, { month, skcs: new Set(), skus: new Set(), missingSkc: false, missingSku: false, rowCount: 0 });
    const evidence = entry.months.get(month);
    if (row.platformSkc) evidence.skcs.add(canonical(row.platformSkc)); else evidence.missingSkc = true;
    if (row.platformSku) evidence.skus.add(canonical(row.platformSku)); else evidence.missingSku = true;
    evidence.rowCount += 1;
    const key = JSON.stringify([month, row.platformSkc, row.platformSku, row.attribute]);
    const member = entry.members.get(key) ?? { month, platformSkc: row.platformSkc, platformSku: row.platformSku, attribute: row.attribute, sourceRowCount: 0 };
    member.sourceRowCount += 1; entry.members.set(key, member);
  }
}
export function sealSupplierFilterIndex(index) {
  return { version: 1, scope: index.scope, mappingState: index.mappingState, entries: [...index.entries.values()].map(entry => ({
    supplierNumber: entry.supplierNumber, sourceRowCount: entry.sourceRowCount, missingSkc: entry.missingSkc, missingSku: entry.missingSku,
    months: [...entry.months.values()].map(month => ({ ...month, skcs: [...month.skcs], skus: [...month.skus] })),
  })) };
}

// Reuses each file's compact index as selections/search/pages change. Duplicate
// source files still count as source evidence; the import contract blocks them.
export function supplierFilterCandidates(files, { workspaceId = '', period = '' } = {}) {
  const entries = new Map();
  for (const file of files.filter(item => item.status === 'parsed')) {
    const index = file.supplierPreview;
    const source = index?.entries ?? (file.facets?.supplierNumbers ?? []).map(supplierNumber => ({ supplierNumber, sourceRowCount: file.facets?.supplierCounts?.[supplierNumber] ?? 0, months: [] }));
    for (const item of source) {
      const key = supplierEntryKey(workspaceId, period, file.storeName, item.supplierNumber);
      if (!entries.has(key)) entries.set(key, { key, workspaceId, period, store: file.storeName, supplierNumber: item.supplierNumber, itemIds: [], sourceRowCount: 0, skcs: new Set(), skus: new Set(), skcIncomplete: false, skuIncomplete: false, skcMapped: Boolean(index?.mappingState?.skc), skuMapped: Boolean(index?.mappingState?.sku), mappingPending: !index || !index.mappingState.complete });
      const row = entries.get(key);
      row.itemIds.push(file.itemId); row.sourceRowCount += item.sourceRowCount;
      row.skcIncomplete ||= !index?.mappingState?.skc || item.missingSkc; row.skuIncomplete ||= !index?.mappingState?.sku || item.missingSku;
      for (const evidence of item.months) {
        // Unknown dates are never silently assigned to the chosen month.
        if (period && evidence.month !== period) {
          if (!evidence.month) { row.skcIncomplete = true; row.skuIncomplete = true; }
          continue;
        }
        evidence.skcs.forEach(value => row.skcs.add(value)); evidence.skus.forEach(value => row.skus.add(value));
        row.skcIncomplete ||= evidence.missingSkc || !evidence.month; row.skuIncomplete ||= evidence.missingSku || !evidence.month;
      }
    }
  }
  return [...entries.values()].map(row => ({ ...row, skcs: [...row.skcs], skus: [...row.skus], skcCount: row.skcs.size, skuCount: row.skus.size,
    searchText: canonical([row.supplierNumber, row.store, ...row.skcs, ...row.skus].join(' ')) }));
}
export function supplierFilterPreview(candidates, { selected = {}, applied = {}, rule = null, store = 'all' } = {}) {
  const sets = Object.fromEntries(Object.entries(selected).map(([key, values]) => [key, new Set(values)]));
  const appliedSets = Object.fromEntries(Object.entries(applied).map(([key, values]) => [key, new Set(values)]));
  const aliases = normalizeImportKeywords(rule?.aliases), matchCache = new Map();
  const rows = candidates.map(row => {
    const chosen = row.itemIds.every(id => sets[id]?.has(row.supplierNumber)), wasChosen = row.itemIds.every(id => appliedSets[id]?.has(row.supplierNumber));
    if (!matchCache.has(row.supplierNumber)) {
      const number = canonical(row.supplierNumber);
      matchCache.set(row.supplierNumber, aliases.filter(alias => rule?.mode === 'exact' ? number === alias : rule?.mode === 'contains' ? number.includes(alias) : number.endsWith(alias)));
    }
    const hits = matchCache.get(row.supplierNumber), matched = hits.length > 0;
    return { ...row, selected: chosen, applied: wasChosen, matched, aliases: hits, change: chosen === wasChosen ? 'unchanged' : chosen ? 'added' : 'removed',
      reason: matched ? chosen ? `规则匹配 ${hits.join(' / ')}` : '手动排除' : chosen ? rule?.aliases?.length ? '手动加入' : '手动选择' : '未选择' };
  });
  const summarize = values => {
    const skcs = new Set(), skus = new Set();
    values.filter(row => row.selected).forEach(row => { row.skcs.forEach(value => skcs.add(value)); row.skus.forEach(value => skus.add(value)); });
    return { total: values.length, selected: values.filter(row => row.selected).length, matched: values.filter(row => row.matched).length,
      added: values.filter(row => row.change === 'added').length, removed: values.filter(row => row.change === 'removed').length,
      applied: values.filter(row => row.applied).length, sourceRowCount: values.reduce((sum, row) => sum + row.sourceRowCount, 0), skcCount: skcs.size, skuCount: skus.size,
      skcIncomplete: values.some(row => row.selected && row.skcIncomplete), skuIncomplete: values.some(row => row.selected && row.skuIncomplete) };
  };
  const stores = new Map();
  for (const row of rows) { const values = stores.get(row.store) ?? []; values.push(row); stores.set(row.store, values); }
  return { rows, scope: summarize(store === 'all' ? rows : rows.filter(row => row.store === store)), batch: summarize(rows),
    stores: [...stores].map(([store, values]) => ({ store, ...summarize(values) })),
    aliases: aliases.map(alias => ({ alias, count: rows.filter(row => (store === 'all' || row.store === store) && row.aliases.includes(alias)).length })) };
}
export function filterSupplierCandidates(rows, { query = '', store = 'all', view = 'all' } = {}) {
  const search = canonical(query);
  return rows.filter(row => (store === 'all' || row.store === store) && (!search || (row.searchText ?? canonical(`${row.supplierNumber} ${row.store ?? ''}`)).includes(search))
    && (view === 'all' || view === 'selected' && row.selected || view === 'unselected' && !row.selected || view === 'matched' && row.matched || view === 'added' && row.change === 'added'));
}
export function changeSupplierSelection(selected, rows, checked) {
  const sets = Object.fromEntries(Object.entries(selected).map(([key, values]) => [key, new Set(values)]));
  for (const row of rows) for (const id of row.itemIds) {
    sets[id] ??= new Set();
    if (checked) sets[id].add(row.supplierNumber); else sets[id].delete(row.supplierNumber);
  }
  return Object.fromEntries(Object.entries(sets).map(([id, values]) => [id, normalizeImportNumbers([...values])]));
}
export function supplierRuleSelection(files, rule, { previousRule, selected = {}, savedState, preserve = true } = {}) {
  const same = supplierRuleKey(rule) === supplierRuleKey(previousRule);
  return Object.fromEntries(files.filter(file => file.status === 'parsed').map(file => {
    const choices = file.facets?.supplierNumbers ?? [], matching = new Set(matchImportNumberRule(choices, rule));
    if (preserve && same && Array.isArray(selected[file.itemId])) {
      const previousMatches = new Set(matchImportNumberRule(choices, previousRule)), current = new Set(selected[file.itemId] ?? []);
      for (const choice of choices) {
        if (current.has(choice) && !previousMatches.has(choice)) matching.add(choice);
        if (!current.has(choice) && previousMatches.has(choice)) matching.delete(choice);
      }
    } else if (preserve && rule.id && savedState?.groups?.some(group => supplierRuleKey(group) === supplierRuleKey(rule))) return [file.itemId, restoreSupplierGroupSelection(choices, rule, savedState, file.storeName)];
    return [file.itemId, choices.filter(value => matching.has(value))];
  }));
}
export function expandSupplierScopeGroup(rows, rule, savedState, store = 'all') {
  const stores = new Map();
  for (const row of rows) if (row.supplierNumber && (store === 'all' || row.store === store)) {
    const choices = stores.get(row.store) ?? new Set(); choices.add(row.supplierNumber); stores.set(row.store, choices);
  }
  return normalizeImportNumbers([...stores].flatMap(([storeName, choices]) => savedState?.groups?.some(group => supplierRuleKey(group) === supplierRuleKey(rule))
    ? restoreSupplierGroupSelection([...choices], rule, savedState, storeName) : matchImportNumberRule([...choices], rule)));
}
export function supplierSelectionCsv(rows) {
  const cell = value => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`;
  return '\uFEFF' + [['工作区', '月份', '店铺', '完整货号'], ...rows.filter(row => row.selected).map(row => [row.workspaceId, row.period, row.store, row.supplierNumber])].map(row => row.map(cell).join(',')).join('\r\n');
}
