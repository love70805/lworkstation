import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { PackageSearch } from 'lucide-react';
import { getSelectionReferenceSnapshot } from '../data/database';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import { Button } from './UI';

const money = value => Number(value ?? 0).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' });

function ObservationRows({ refresh, navigate }) {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async () => {
    try {
      const snapshot = await getSelectionReferenceSnapshot({ compact: true });
      return { rows: buildSelectionReferenceRows(snapshot).toSorted((left, right) => Number(right.recentRevenue ?? 0) - Number(left.recentRevenue ?? 0)).slice(0, 5) };
    } catch (error) { return { error: error.message }; }
  }, [refresh, attempt], null);
  if (!result) return <p role="status">正在读取商品成本观察…</p>;
  if (result.error) return <div role="alert">商品成本观察读取失败：{result.error}<Button onClick={() => setAttempt(value => value + 1)}>重试读取</Button></div>;
  if (!result.rows.length) return <p>暂无可观察的商品成本。</p>;
  return <div className="reference-mini-table"><div className="reference-mini-head"><span>平台 SKU</span><span>成本</span><span>利润</span></div>{result.rows.map(row => <button className="reference-mini-row" key={row.id} onClick={() => row.latestLedgerId ? navigate(`/profit?ledger=${encodeURIComponent(row.latestLedgerId)}`) : navigate('/products?view=reference')}><span><strong className="mono">{row.platformSku}</strong><small>{row.platformSkc || '未关联 SKC'}</small></span><span className="mono">{row.referenceUnitCost == null ? '--' : money(row.referenceUnitCost)}</span><span className={row.latestProfit != null && row.latestProfit < 0 ? 'danger-text' : 'success-text'}>{row.latestProfit == null ? '--' : money(row.latestProfit)}</span></button>)}</div>;
}

export default function WorkspaceCostObservation({ refresh, navigate }) {
  const [open, setOpen] = useState(false);
  return <details className="dashboard-widget reference-widget workspace-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span><PackageSearch size={17} />商品成本观察</span><span className="widget-count">展开查看</span></summary>
    {open ? <ObservationRows refresh={refresh} navigate={navigate} /> : null}
  </details>;
}
