import { canonicalPlatformSku } from './identifiers';

const text = value => typeof value === 'string' ? value.normalize('NFKC').trim() : '';
export const operatorPairKey = pair => JSON.stringify([text(pair?.store), text(pair?.supplierNumber)]);
export function normalizeOperatorPairs(pairs = []) {
  return [...new Map((Array.isArray(pairs) ? pairs : []).map(pair => ({ store: text(pair?.store), supplierNumber: text(pair?.supplierNumber) }))
    .filter(pair => pair.store && pair.supplierNumber).map(pair => [operatorPairKey(pair), pair])).values()];
}
export function normalizeOperatorConfig(value) {
  if (value == null) return { version: 1, mode: 'all', activeProfileId: '', profiles: [] };
  const profiles = Array.isArray(value.profiles) ? value.profiles.filter(p => text(p?.id) && text(p?.name)).map(p => ({ id: text(p.id), name: text(p.name), pairs: normalizeOperatorPairs(p.pairs) })) : [];
  return { version: 1, mode: value.version === 1 && value.mode === 'all' ? 'all' : 'mine', activeProfileId: text(value.activeProfileId), profiles };
}
export function activeOperatorScope(config) {
  return { mode: config.mode, pairs: config.profiles.find(p => p.id === config.activeProfileId)?.pairs ?? [] };
}
export function parseOperatorNumbers(value) {
  return [...new Set(String(value ?? '').split(/[\s,，;；]+/u).map(text).filter(Boolean))];
}
// Match real store/number pairs. Never combine independent storeNames/supplierNumbers arrays.
export function filterOperatorRows(rows = [], scope, identityRows = rows) {
  if (scope?.mode === 'all') return rows;
  const pairs = new Set(normalizeOperatorPairs(scope?.pairs).map(operatorPairKey));
  if (!pairs.size) return [];
  const skuKey = row => JSON.stringify([text(row.store), canonicalPlatformSku(row.platformSku ?? row.sku)]);
  const selectedSkus = new Set(identityRows.filter(row => pairs.has(operatorPairKey(row)) && (row.platformSku ?? row.sku)).map(skuKey));
  return rows.filter(row => pairs.has(operatorPairKey(row)) || (row.platformSku ?? row.sku) && selectedSkus.has(skuKey(row))
    || (row.operatorPairs ?? []).some(pair => pairs.has(operatorPairKey(pair))));
}
