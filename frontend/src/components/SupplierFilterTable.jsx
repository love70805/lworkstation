import { useEffect, useId, useMemo, useRef, useState } from 'react';
import DataTable from './DataTable';
import { Button, SearchInput } from './UI';
import { filterSupplierCandidates, supplierViewStores } from '../domain/supplierFilterPreview';

function PageCheck({ rows, disabled, onSelect }) {
  const ref = useRef(null), selected = rows.filter(row => row.selected).length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = selected > 0 && selected < rows.length; }, [selected, rows.length]);
  return <input ref={ref} type="checkbox" disabled={disabled || !rows.length} aria-label="选中本页货号" checked={rows.length > 0 && selected === rows.length} onChange={event => onSelect(rows, event.target.checked)} />;
}
const identityCount = (row, kind) => row.mappingPending || !row[`${kind}Mapped`] ? '待映射' : row[`${kind}Incomplete`] ? `${row[`${kind}Count`] || ''} 待补`.trim() : row[`${kind}Count`];

// Import and profit/ERP selectors share a searchable, paginated page list.
export default function SupplierFilterTable({ rows = [], store = 'all', mode, onSelect, onInspect, disabled = false, compact = false, resetKey = '' }) {
  const id = useId(), [query, setQuery] = useState(''), [view, setView] = useState('all'), [pageSize, setPageSize] = useState(20);
  const [localMode, setLocalMode] = useState('fuzzy'), recognitionMode = mode ?? localMode;
  const viewedStores = supplierViewStores(store), storeLabel = viewedStores.length ? viewedStores.join('、') : '全部店铺';
  const scoped = useMemo(() => filterSupplierCandidates(rows, { store }), [rows, store]);
  const filtered = useMemo(() => filterSupplierCandidates(rows, { query, store, view, mode: recognitionMode }), [rows, query, store, view, recognitionMode]);
  const counts = useMemo(() => ({ all: scoped.length, matched: scoped.filter(row => row.matched).length, selected: scoped.filter(row => row.selected).length, unselected: scoped.filter(row => !row.selected).length, added: scoped.filter(row => row.change === 'added').length }), [scoped]);
  const columns = useMemo(() => [
    { id: 'selected', size: 42, enableSorting: false, header: ({ table }) => <PageCheck rows={table.getRowModel().rows.map(row => row.original)} disabled={disabled} onSelect={onSelect} />,
      cell: ({ row }) => <input type="checkbox" aria-label={['选择', row.original.store, row.original.supplierNumber].filter(Boolean).join(' ')} disabled={disabled} checked={row.original.selected} onChange={event => onSelect([row.original], event.target.checked)} /> },
    { accessorKey: 'supplierNumber', header: '完整货号', size: 230, cell: ({ row }) => onInspect ? <button type="button" className="supplier-number-link" disabled={disabled} onClick={() => onInspect(row.original)}>{row.original.supplierNumber}</button> : <code>{row.original.supplierNumber}</code> },
    ...(!compact ? [
      { accessorKey: 'store', header: '店铺', size: 120 },
      { accessorKey: 'skcCount', header: 'SKC 数', size: 85, cell: ({ row }) => identityCount(row.original, 'skc') },
      { accessorKey: 'skuCount', header: 'SKU 数', size: 85, cell: ({ row }) => identityCount(row.original, 'sku') },
      { accessorKey: 'sourceRowCount', header: '来源行数', size: 100 },
      { accessorKey: 'reason', header: '选择原因', size: 175 },
      { accessorKey: 'change', header: '本次变化', size: 100, cell: ({ row }) => <span className={`supplier-change ${row.original.change}`}>{({ added: '新增选择', removed: '取消选择', unchanged: '保留' })[row.original.change]}</span> },
    ] : []),
  ], [compact, disabled, onSelect, onInspect]);
  return <section className={`supplier-filter-table${compact ? ' is-compact' : ''}`} aria-label="货号清单">
    <div className="supplier-table-toolbar"><h3>货号清单 <small>{scoped.length.toLocaleString('zh-CN')}</small></h3>
      <SearchInput value={query} onChange={event => setQuery(event.target.value)} label={recognitionMode === 'exact' ? '精准搜索完整货号' : '搜索货号、店铺或平台标识'} placeholder={recognitionMode === 'exact' ? '输入完整货号' : compact ? '搜索货号，如 KPXX' : '搜索货号、店铺、SKC / SKU'} />
      {mode === undefined && <label>识别方式 <select aria-label="货号清单识别方式" value={localMode} onChange={event => setLocalMode(event.target.value)}><option value="fuzzy">模糊识别</option><option value="exact">精准识别</option></select></label>}
    </div>
    <div className="supplier-table-views" role="group" aria-label="货号查看视图">{[['all', '全部'], ['matched', '规则匹配'], ['selected', '已选'], ['unselected', '未选'], ...(!compact ? [['added', '本次新增选择']] : [])].map(([value, label]) => <button type="button" key={value} data-view={value} aria-pressed={view === value} onClick={() => setView(value)}>{label} <span>{counts[value]}</span></button>)}</div>
    <div className="supplier-table-bulk"><span role="status">{storeLabel} · 筛选结果 {filtered.length} 个{!compact ? '（货号按店铺计数）' : ''}</span><div><Button variant="ghost" disabled={disabled || !filtered.length} onClick={() => onSelect(filtered, true)}>选中筛选结果</Button><Button variant="ghost" disabled={disabled || !filtered.length} onClick={() => onSelect(filtered, false)}>取消筛选结果</Button></div></div>
    <DataTable key={pageSize} data={filtered} columns={columns} getRowId={row => row.key} pageSize={pageSize} paginationResetKey={`${resetKey}/${store}/${query}/${view}/${recognitionMode}`} getRowProps={row => ({ className: `${row.selected ? 'is-selected' : ''} supplier-row-${row.change ?? 'unchanged'}` })} emptyState="没有匹配货号，请调整关键词或识别方式；已选项仍保留。" />
    <label className="supplier-page-size" htmlFor={`${id}-size`}>每页 <select id={`${id}-size`} value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>{[20, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}</select></label>
  </section>;
}
