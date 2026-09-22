import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveMemberContext, listLedgerSummaries } from '../data/database';
import { readLedgerSalesRows } from '../data/repositories/ledgerReadCache';
import { workspaceLedgerQuery } from './workspaceNavigation';

export function useWorkspaceLedgerScope() {
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pendingSelection = useRef(null);
  useEffect(() => { generation.current++; pendingSelection.current = null; }, [search]);
  useEffect(() => () => { generation.current++; }, []);
  const result = useLiveQuery(async () => {
    try {
      const member = await getActiveMemberContext();
      const ledgers = (await listLedgerSummaries()).filter(item => item.workspaceId === member.workspaceId);
      const requestedId = new URLSearchParams(search).get('ledger');
      const requested = ledgers.find(item => item.id === requestedId);
      if (requestedId && !requested) return { search, workspaceId: member.workspaceId, ledgers, error: '指定账本不存在或不属于当前工作区，请重新选择账本。' };
      const selected = requested || ledgers[0] || null;
      const rows = selected ? await readLedgerSalesRows(member.workspaceId, selected.id) : [];
      if ((await getActiveMemberContext()).workspaceId !== member.workspaceId) return null;
      const query = selected ? workspaceLedgerQuery(selected.id, search, rows, Boolean(requested)) : new URLSearchParams();
      return { search, workspaceId: member.workspaceId, ledgers, selected, stores: [...new Set(rows.map(row => row.store).filter(Boolean))].sort(), store: query.get('store') || 'all', query: query.toString() };
    } catch (error) { return { search, error: error.message }; }
  }, [search, revision], null);
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
  return { ready, context: ready ? result : null, change, retry: () => setRevision(value => value + 1) };
}
