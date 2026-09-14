import { useRef, useState } from 'react';
import DataTable from '../components/DataTable';
import { Button } from '../components/UI';
import { displayMoney } from '../domain/profitReports';

const PAGE_SIZE = 12;
function ProfitGroup({ group, columns, prepareRows }) {
  const [open, setOpen] = useState(false);
  return <details className="profit-skc-group" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>{group.store} · SKC {group.groupSkc}</strong><span>{group.skuCount} 个 SKU · {group.quantityExact ?? group.qty} 件 · 销售 ¥{displayMoney(group.revenueExact ?? group.revenue)} · 利润 {group.finalizable ? `¥${displayMoney(group.profitExact ?? group.profit)}` : '待核对'}</span></summary>
    {open ? <DataTable className="profit-table" columns={columns} data={prepareRows(group.variants)} getRowId={row => row.id} getRowProps={row => ({ className: !row.finalizable ? 'missing-profit-row' : '' })} /> : null}
  </details>;
}

export default function ProfitGroups({ groups, columns, prepareRows }) {
  const [page, setPage] = useState(0);
  const scroll = useRef(null);
  const count = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const current = Math.min(page, count - 1);
  const changePage = next => { setPage(next); if (scroll.current) scroll.current.scrollTop = 0; };
  return <>
    <div className="profit-groups-scroll" ref={scroll}>
      {groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(group => <ProfitGroup key={group.id} group={group} columns={columns} prepareRows={prepareRows} />)}
      {!groups.length ? <p className="no-results">没有符合筛选条件的商品。</p> : null}
    </div>
    <nav className="profit-groups-pagination" aria-label="利润商品分页"><span>共 {groups.length} 个 SKC · {current + 1} / {count} 页</span><Button disabled={current === 0} onClick={() => changePage(current - 1)}>上一页</Button><Button disabled={current + 1 === count} onClick={() => changePage(current + 1)}>下一页</Button></nav>
  </>;
}
