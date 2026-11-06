import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { BoardChip } from './BoardChip';
import { readPendingSkuCount } from '../data/repositories/ledgerOverviewRepository';
import { buildProfitHref } from '../lib/profitFilter';

export default function PendingSkuStatus({ workspaceId, ledgerId, store }) {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async () => {
    try { return { count: await readPendingSkuCount(workspaceId, ledgerId, store) }; }
    catch (error) { return { error: error.message }; }
  }, [workspaceId, ledgerId, store, attempt]);

  return <div className="workspace-pending-skus">
    <span>待核对 SKU</span>
    {!result ? <span role="status">读取中…</span> : result.error ? <>
      <span role="alert">{result.error}</span><button type="button" className="inline-link" onClick={() => setAttempt(value => value + 1)}>重试</button>
    </> : result.count > 0 ? (
      <Link className="workspace-pending-link" aria-label={`查看当前范围待核对的 ${result.count} 条店铺 SKU`}
        to={buildProfitHref({ ledgerId, view: 'detail', storeFilter: store, missingOnly: true }) + '#profit-detail-area'}>
        <BoardChip color="orange">{result.count} 条</BoardChip>
      </Link>
    ) : <BoardChip color="lime">0 条</BoardChip>}
  </div>;
}
