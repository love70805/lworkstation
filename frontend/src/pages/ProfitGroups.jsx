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

function ProfitVariants({ group, columns, groupRef }) {
  const [page, setPage] = useState(0);
  const rows = group.variants;
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

function ProfitGroup({ group, columns, open, onToggle }) {
  const headingId = useId();
  const groupRef = useRef(null);
  const label = group.platformSkc ? `SKC ${group.platformSkc}` : group.supplierNumber ? `供方货号 ${group.supplierNumber}` : group.groupSkc || '未填平台 SKC';
  return <tbody className="profit-skc-group" aria-labelledby={headingId} ref={groupRef}>
    <tr><th scope="rowgroup" className="profit-group-label" colSpan={columns.length}>
      <button type="button" className="profit-group-toggle" aria-expanded={open} onClick={() => onToggle(group.id)}>
        <ChevronRight size={15} aria-hidden="true" />
        <strong id={headingId}>{group.store} · {label}{group.platformSkc && group.supplierNumber && <small>供方货号 {group.supplierNumber}</small>}</strong>
        <span>{group.skuCount} 个 SKU · {group.quantityExact ?? group.qty} 件 · 销售 ¥{displayMoney(group.revenueExact ?? group.revenue)} · 利润 {group.finalizable ? `¥${displayMoney(group.profitExact ?? group.profit)}` : '待核对'}</span>
      </button>
    </th></tr>
    {open && <ProfitVariants group={group} columns={columns} groupRef={groupRef} />}
  </tbody>;
}

export default function ProfitGroups({ groups, columns, skcCount, storeSkuCount, stateKey, initiallyExpanded = false, expandRequest = 0, compactHeading = false }) {
  const [page, setPage] = useState(() => readProfitViewState(stateKey).page);
  const [expandAll, setExpandAll] = useState(() => readProfitViewState(stateKey).expandAll ?? initiallyExpanded);
  const [exceptions, setExceptions] = useState(() => readProfitViewState(stateKey).exceptions ?? []);
  const tableRef = useRef(null);
  const hasRows = groups.length > 0;
  const scroll = useRef(null);
  const tableId = useId();
  const previousPage = useRef(page);
  const handledExpansion = useRef(0);
  const count = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const current = Math.min(page, count - 1);
  const pageGroups = groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const topbar = document.querySelector('.topbar');
    let frame;
    // The horizontal scroll frame clips native sticky positioning. Move the real header
    // within the table so its columns also follow horizontal scrolling and resizing.
    const alignHeader = () => {
      const bounds = table.getBoundingClientRect();
      const top = topbar?.getBoundingClientRect().bottom ?? 0;
      const limit = Math.max(0, bounds.height - table.tHead.offsetHeight);
      const offset = Math.min(Math.max(0, top - bounds.top), limit);
      table.tHead.style.transform = 'translateY(' + offset + 'px)';
      frame = undefined;
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(alignHeader); };
    alignHeader();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(table);
    observer?.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [hasRows]);
  useLayoutEffect(() => {
    if (!expandRequest || handledExpansion.current === expandRequest) return;
    handledExpansion.current = expandRequest;
    setPage(0);
    setExpandAll(true);
    setExceptions([]);
  }, [expandRequest]);
  useLayoutEffect(() => {
    saveProfitViewState(stateKey, { page, expandAll, exceptions });
  }, [stateKey, page, expandAll, exceptions]);
  useLayoutEffect(() => {
    if (previousPage.current !== current) revealListStart(scroll.current);
    previousPage.current = current;
  }, [current]);
  const toggleGroup = id => setExceptions(previous => previous.includes(id) ? previous.filter(key => key !== id) : [...previous, id]);
  return <>
    <div className={`profit-table-heading${compactHeading ? " compact" : ""}`}>
      {!compactHeading ? <div><h2>月度利润明细</h2><p>点分组查看 SKU 明细。金额单位为人民币（CNY）。</p></div> : null}
      <div className="profit-table-tools">
        <span className="profit-filter-count">当前 {skcCount} 个平台 SKC · {storeSkuCount} 条店铺 SKU</span>
        {groups.length > 1 && <Button variant="ghost" aria-controls={tableId} onClick={() => { setExpandAll(!expandAll); setExceptions([]); }}>
          {expandAll ? '收起全部明细' : '展开全部明细'}
        </Button>}
      </div>
    </div>
    <div className="profit-groups-list" ref={scroll}>
      {groups.length ? <TableScrollArea label="商品成本明细">
        <table ref={tableRef} id={tableId} className="data-table profit-table" aria-label="商品成本明细">
          <thead><tr>{columns.map(column => <th key={column.id ?? column.accessorKey} scope="col" style={column.meta?.headerStyle}>{column.header}</th>)}</tr></thead>
          {pageGroups.map(group => <ProfitGroup key={group.id} group={group} columns={columns} open={expandAll !== exceptions.includes(group.id)} onToggle={toggleGroup} />)}
        </table>
      </TableScrollArea> : <p className="no-results">没有符合筛选条件的商品。</p>}
    </div>
    <nav className="profit-groups-pagination" aria-label="利润商品分页"><span>共 {groups.length} 个分组 · {current + 1} / {count} 页</span><Button disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</Button><Button disabled={current + 1 === count} onClick={() => setPage(current + 1)}>下一页</Button></nav>
  </>;
}
