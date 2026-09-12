import { Navigate, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getActiveMemberContext } from '../data/database';
import { profitWorkspaceHref, validatedLedgerSearch } from '../lib/workspaceNavigation';

export default function LegacyCostRedirect() {
  const { search, hash } = useLocation();
  const context = useLiveQuery(async () => {
    const member = await getActiveMemberContext();
    const id = new URLSearchParams(search).get('ledger');
    const ledger = id ? await db.ledgers.get(id) : null;
    const current = await getActiveMemberContext();
    return { search, query: current.workspaceId === member.workspaceId ? validatedLedgerSearch(search, ledger, member.workspaceId) : '' };
  }, [search], null);
  if (!context || context.search !== search) return <div role="status">正在打开成本核对…</div>;
  return <Navigate to={`${profitWorkspaceHref(context.query, 'cost')}${hash}`} replace />;
}
