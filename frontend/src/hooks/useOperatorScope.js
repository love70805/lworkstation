import { useMemo, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveMemberContext } from '../data/database';
import { activeOperatorScope } from '../domain/operatorScope';
import { OPERATOR_SCOPE_EVENT, readOperatorConfig, saveOperatorConfig } from '../lib/operatorScopeStorage';

function subscribe(listener) {
  window.addEventListener(OPERATOR_SCOPE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(OPERATOR_SCOPE_EVENT, listener); window.removeEventListener('storage', listener); };
}
export function useOperatorScope(workspaceId) {
  const context = useLiveQuery(async () => workspaceId ? null : getActiveMemberContext(), [workspaceId], null);
  const id = workspaceId || context?.workspaceId;
  const raw = useSyncExternalStore(subscribe, () => JSON.stringify(readOperatorConfig(id)), () => JSON.stringify(readOperatorConfig(id)));
  const config = useMemo(() => JSON.parse(raw), [raw]);
  const scope = useMemo(() => activeOperatorScope(config), [config]);
  return { workspaceId: id, config, scope, restricted: scope.mode !== 'all', save: value => saveOperatorConfig(id, value) };
}
