import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tableFeatures, useTable } from '@tanstack/react-table';
import { ChevronRight } from 'lucide-react';
import { DataTableRows } from '../components/DataTable';
import TableScrollArea from '../components/TableScrollArea';
import { Button } from '../components/UI';
import { displayMoney } from '../domain/profitReports';
import { readProfitViewState, saveProfitViewState } from '../lib/profitViewState';
import { revealListStart } from '../lib/pageListScroll';

const PAGE_SIZE = 12;
const VARIANT_PAGE_SIZE = 20;
const features = tableFeatures({});
const getRowId = row => row.id;
const getRowProps = row => ({ className: row.finalizable ? 'profit-variant-row' : 'profit-variant-row missing-profit-row' });

function ProfitVariants({ group, columns, prepareRows, groupRef }) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => prepareRows(group.variants), [prepareRows, group.variants]);
  const pageCount = Math.max(1, Math.ceil(rows.length / VARIANT_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const data = useMemo(() => rows.slice(current * VARIANT_PAGE_SIZE, (current + 1) * VARIANT_PAGE_SIZE), [rows, current]);
  const table = useTable({ features, columns, data, getRowId });
  const changePage = next => {
    setPage(next);
    revealListStart(groupRef.current);
  };
  return <>
    <DataTableRows table={table} rows={table.getRowModel().rows} getRowProps={getRowProps} />
    {pageCount > 1 && <tr><td className="profit-group-page-cell" colSpan={columns.length}>
      <nav className="profit-group-pages" aria-label={`${group.store} ${group.groupSkc} 的明细分页`}>
        <span>共 {rows.length} 条明细</span>
        <Button disabled={current === 0} onClick={() => changePage(current - 1)}>上一页</Button>
        <select aria-label="明细页码" value={current} onChange={event => changePage(Number(event.target.value))}>
          {Array.from({ length: pageCount }, (_, index) => <option key={index} value={index}>{index + 1} / {pageCount} 页</option>)}
        </select>
        <Button disabled={current + 1 === pageCount} onClick={() => changePage(current + 1)}>下一页</Button>
      </nav>
    </td></tr>}
  </>;
}

function ProfitGroup({ group, columns, prepareRows, open, onToggle }) {
  const headingId = useId();
  const groupRef = useRef(null);
  const label = group.platformSkc ? `SKC ${group.platformSkc}` : group.supplierNumber ? `供方货号 ${group.supplierNumber}` : group.groupSkc || '未填平台 SKC';
  return <tbody className="profit-skc-group" aria-labelledby={headingId} ref={groupRef}>
    <tr><th scope="rowgroup" className="profit-group-label" colSpan={columns.length}>
      <button type="button" className="profit-group-toggle" aria-expanded={open} onClick={() => onToggle(group.id, !open)}>
        <ChevronRight size={15} aria-hidden="true" />
        <strong id={headingId}>{group.store} · {label}</strong>
        <span>{group.skuCount} 个 SKU · {group.quantityExact ?? group.qty} 件 · 销售 ¥{displayMoney(group.revenueExact ?? group.revenue)} · 利润 {group.finalizable ? `¥${displayMoney(group.profitExact ?? group.profit)}` : '待核对'}</span>
      </button>
    </th></tr>
    {open && <ProfitVariants group={group} columns={columns} prepareRows={prepareRows} groupRef={groupRef} />}
  </tbody>;
}

export default function ProfitGroups({ groups, columns, prepareRows, stateKey, showAllColumns = false, expandRequest = 0 }) {
  const [page, setPage] = useState(() => readProfitViewState(stateKey).page);
  const [expanded, setExpanded] = useState(() => readProfitViewState(stateKey).expanded);
  const scroll = useRef(null);
  const previousPage = useRef(page);
  const previousColumnView = useRef('');
  const handledExpansion = useRef(0);
  const count = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const current = Math.min(page, count - 1);
  useLayoutEffect(() => {
    if (!expandRequest || handledExpansion.current === expandRequest) return;
    handledExpansion.current = expandRequest;
    const next = groups.slice(0, PAGE_SIZE).map(group => group.id);
    setPage(0);
    setExpanded(next);
    saveProfitViewState(stateKey, { page: 0, expanded: next });
  }, [expandRequest, groups, stateKey]);
  useLayoutEffect(() => {
    const view = JSON.stringify([stateKey, current, showAllColumns]);
    if (previousColumnView.current === view) return;
    previousColumnView.current = view;
    if (!showAllColumns) return;
    // Reveal the current page so changing columns also has a visible result
    // when every SKC was collapsed. Keep rendering bounded by pagination.
    setExpanded(previous => {
      const next = [...new Set([...previous, ...groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(group => group.id)])];
      saveProfitViewState(stateKey, { expanded: next });
      return next;
    });
  }, [showAllColumns, current, stateKey, groups]);
  useLayoutEffect(() => {
    const position = readProfitViewState(stateKey).windowScrollY;
    if (Number.isFinite(position)) window.scrollTo({ top: position, behavior: 'auto' });
    return () => saveProfitViewState(stateKey, { windowScrollY: window.scrollY });
  }, [stateKey]);
  useLayoutEffect(() => {
    if (previousPage.current !== current) revealListStart(scroll.current);
    previousPage.current = current;
  }, [current]);
  const changePage = next => { setPage(next); saveProfitViewState(stateKey, { page: next }); };
  const toggle = (id, open) => setExpanded(previous => {
    const next = open ? [...new Set([...previous, id])] : previous.filter(value => value !== id);
    saveProfitViewState(stateKey, { expanded: next });
    return next;
  });
  return <>
    <div className="profit-groups-list" ref={scroll}>
      {groups.length ? <TableScrollArea label="商品成本明细">
        <table className="data-table profit-table" aria-label="商品成本明细">
          <thead><tr>{columns.map(column => <th key={column.id ?? column.accessorKey} scope="col" style={column.meta?.headerStyle}>{column.header}</th>)}</tr></thead>
          {groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(group => <ProfitGroup key={group.id} group={group} columns={columns} prepareRows={prepareRows} open={expanded.includes(group.id)} onToggle={toggle} />)}
        </table>
      </TableScrollArea> : <p className="no-results">没有符合筛选条件的商品。</p>}
    </div>
    <nav className="profit-groups-pagination" aria-label="利润商品分页"><span>共 {groups.length} 个分组 · {current + 1} / {count} 页</span><Button disabled={current === 0} onClick={() => changePage(current - 1)}>上一页</Button><Button disabled={current + 1 === count} onClick={() => changePage(current + 1)}>下一页</Button></nav>
  </>;
}
