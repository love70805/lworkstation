import { useLayoutEffect, useRef, useState } from 'react';
import DataTable from '../components/DataTable';
import { Button } from '../components/UI';
import { displayMoney } from '../domain/profitReports';
import { readProfitViewState, saveProfitViewState } from '../lib/profitViewState';

const PAGE_SIZE = 12;
function ProfitGroup({ group, columns, prepareRows, open, onToggle }) {
  return <details className="profit-skc-group" open={open} onToggle={event => { if (open !== event.currentTarget.open) onToggle(group.id, event.currentTarget.open); }}>
    <summary><strong>{group.store} · SKC {group.groupSkc}</strong><span>{group.skuCount} 个 SKU · {group.quantityExact ?? group.qty} 件 · 销售 ¥{displayMoney(group.revenueExact ?? group.revenue)} · 利润 {group.finalizable ? `¥${displayMoney(group.profitExact ?? group.profit)}` : '待核对'}</span></summary>
    {open ? <DataTable className="profit-table" columns={columns} data={prepareRows(group.variants)} getRowId={row => row.id} getRowProps={row => ({ className: !row.finalizable ? 'missing-profit-row' : '' })} /> : null}
  </details>;
}

export default function ProfitGroups({ groups, columns, prepareRows, stateKey }) {
  const [page, setPage] = useState(() => readProfitViewState(stateKey).page);
  const [expanded, setExpanded] = useState(() => readProfitViewState(stateKey).expanded);
  const scroll = useRef(null);
  const count = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const current = Math.min(page, count - 1);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = readProfitViewState(stateKey).scroll; }, [stateKey]);
  const changePage = next => { setPage(next); saveProfitViewState(stateKey, { page: next, scroll: 0 }); if (scroll.current) scroll.current.scrollTop = 0; };
  const toggle = (id, open) => setExpanded(previous => {
    const next = open ? [...new Set([...previous, id])] : previous.filter(value => value !== id);
    saveProfitViewState(stateKey, { expanded: next });
    return next;
  });
  return <>
    <div className="profit-groups-scroll" ref={scroll} onScroll={event => saveProfitViewState(stateKey, { scroll: event.currentTarget.scrollTop })}>
      {groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(group => <ProfitGroup key={group.id} group={group} columns={columns} prepareRows={prepareRows} open={expanded.includes(group.id)} onToggle={toggle} />)}
      {!groups.length ? <p className="no-results">没有符合筛选条件的商品。</p> : null}
    </div>
    <nav className="profit-groups-pagination" aria-label="利润商品分页"><span>共 {groups.length} 个 SKC · {current + 1} / {count} 页</span><Button disabled={current === 0} onClick={() => changePage(current - 1)}>上一页</Button><Button disabled={current + 1 === count} onClick={() => changePage(current + 1)}>下一页</Button></nav>
  </>;
}
