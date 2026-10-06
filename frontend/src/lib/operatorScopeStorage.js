import { normalizeOperatorConfig } from '../domain/operatorScope';

export const operatorStorageKey = workspaceId => `lworkstation:operator-scope:v1:${workspaceId}`;
export const OPERATOR_SCOPE_EVENT = 'lworkstation:operator-scope-changed';
export function readOperatorConfig(workspaceId, storage = globalThis.localStorage) {
  if (!workspaceId) return normalizeOperatorConfig({});
  try { return normalizeOperatorConfig(JSON.parse(storage.getItem(operatorStorageKey(workspaceId)) ?? 'null')); }
  catch { return normalizeOperatorConfig({}); }
}
export function saveOperatorConfig(workspaceId, value, storage = globalThis.localStorage) {
  if (!workspaceId) throw new Error('工作区尚未就绪，请稍后重试。');
  const config = normalizeOperatorConfig(value);
  storage.setItem(operatorStorageKey(workspaceId), JSON.stringify(config));
  globalThis.window?.dispatchEvent(new Event(OPERATOR_SCOPE_EVENT));
  return config;
}
