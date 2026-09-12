import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getActiveMemberContext, listLedgerSummaries } from '../data/database';
import { workspaceLedgerQuery } from './workspaceNavigation';

export function useWorkspaceLedgerScope() {
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const generation = useRef(0);
  const pendingSelection = useRef(null);
  useEffect(() => { generation.current++; pendingSelection.current = null; }, [search]);
  useEffect(() => () => { generation.current++; }, []);
  const result = useLiveQuery(async () => {
    try {
      const member = await getActiveMemberContext();
      const ledgers = (await listLedgerSummaries()).filter(item => item.workspaceId === member.workspaceId);
      const requested = ledgers.find(item => item.id === new URLSearchParams(search).get('ledger'));
      const selected = requested || ledgers[0] || null;
      const rows = selected ? await db.salesRows.where('ledgerId').equals(selected.id).toArray() : [];
      if ((await getActiveMemberContext()).workspaceId !== member.workspaceId) return null;
      const query = selected ? workspaceLedgerQuery(selected.id, search, rows, Boolean(requested)) : new URLSearchParams();
      return { search, workspaceId: member.workspaceId, ledgers, selected, stores: [...new Set(rows.map(row => row.store).filter(Boolean))].sort(), store: query.get('store') || 'all', query: query.toString() };
    } catch (error) { return { search, error: error.message }; }
  }, [search], null);
  const ready = result?.search === search;
  useEffect(() => {
    if (ready && !result.error && result.query !== search) setParams(result.query, { replace: true });
  }, [ready, result, search, setParams]);
  async function change(field, value) {
    if (!ready || result.error) return;
    const token = ++generation.current;
    if (pendingSelection.current?.search !== search) pendingSelection.current = { search, params: new URLSearchParams(result.query) };
    pendingSelection.current.params.set(field, value);
    const next = pendingSelection.current.params.toString();
    const member = await getActiveMemberContext();
    if (token !== generation.current || member.workspaceId !== result.workspaceId) return;
    setParams(next);
  }
  return { ready, context: ready ? result : null, change };
}
