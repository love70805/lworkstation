import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

function getColumnSize(column) {
  return Number(column.columnDef?.size ?? 150);
}

function SortIcon({ direction }) {
  if (direction === "asc") return <ArrowUp size={13} />;
  if (direction === "desc") return <ArrowDown size={13} />;
  return <ArrowUpDown size={13} />;
}

function TableHeader({ table, fixedWidths = false }) {
  return (
    <thead>
      {table.getHeaderGroups().map((group) => (
        <tr key={group.id}>
          {group.headers.map((header) => {
            const sortable = header.column.getCanSort();
            const width = getColumnSize(header.column);
            const headerStyle = header.column.columnDef.meta?.headerStyle;
            const style = fixedWidths
              ? { width, minWidth: width, maxWidth: width, flex: `0 0 ${width}px`, ...headerStyle }
              : headerStyle;
            return (
              <th key={header.id} style={style} aria-sort={sortable ? (header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none") : undefined}>
                {header.isPlaceholder ? null : sortable ? (
                  <button className="sortable-header" onClick={header.column.getToggleSortingHandler()}>
                    <table.FlexRender header={header} />
                    <SortIcon direction={header.column.getIsSorted()} />
                  </button>
                ) : <table.FlexRender header={header} />}
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
}

function StandardBody({ table, rows, emptyState, getRowProps }) {
  return (
    <tbody>
      {rows.map((row) => {
        const rowProps = getRowProps?.(row.original) ?? {};
        return (
          <tr key={row.id} {...rowProps}>
            {row.getAllCells().map((cell) => (
              <td key={cell.id} style={{ width: getColumnSize(cell.column), ...cell.column.columnDef.meta?.cellStyle }}>
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        );
      })}
      {!rows.length ? <tr><td colSpan={table.getAllLeafColumns().length} className="no-results">{emptyState}</td></tr> : null}
    </tbody>
  );
}

function VirtualBody({ table, rows, getRowProps, estimateSize, className = "" }) {
  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => rows[index].id,
    overscan: 8,
  });
  const tableWidth = table.getAllLeafColumns().reduce((total, column) => total + getColumnSize(column), 0);

  return (
    <div className="virtual-table-scroll" ref={scrollRef}>
      <table className={`data-table virtual-data-table ${className}`} style={{ width: tableWidth, minWidth: tableWidth }}>
        <TableHeader table={table} fixedWidths />
        <tbody style={{ height: virtualizer.getTotalSize(), width: tableWidth }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const rowProps = getRowProps?.(row.original) ?? {};
            return (
              <tr
                key={row.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{ width: tableWidth, transform: `translateY(${virtualRow.start}px)` }}
                {...rowProps}
              >
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{
                      width: getColumnSize(cell.column),
                      minWidth: getColumnSize(cell.column),
                      maxWidth: getColumnSize(cell.column),
                      flex: `0 0 ${getColumnSize(cell.column)}px`,
                      ...cell.column.columnDef.meta?.cellStyle,
                    }}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DataTable = forwardRef(function DataTable({
  data,
  columns,
  className = "",
  emptyState = "没有符合当前筛选条件的数据。",
  getRowId,
  getRowProps,
  pageSize = 20,
  virtualizeThreshold = 100,
  estimateSize = 64,
  paginationResetKey,
  initialViewState,
  dataReady = true,
}, ref) {
  const regionRef = useRef(null);
  const initialPage = Math.max(0, Math.floor(Number(initialViewState?.pageIndex) || 0));
  const previousPageRef = useRef(initialPage);
  const restoringRef = useRef(Boolean(initialViewState));
  const resetScopeRef = useRef(paginationResetKey);
  const [sorting, setSorting] = useState(initialViewState?.sorting ?? []);
  const previousSortingRef = useRef(sorting);
  const [pagination, setPagination] = useState({ pageIndex: initialPage, pageSize });
  useImperativeHandle(ref, () => ({
    getViewState: () => {
      const area = regionRef.current?.querySelector(".virtual-table-scroll, .table-wrap");
      return { pageIndex: pagination.pageIndex, sorting, scrollTop: area?.scrollTop ?? 0, scrollLeft: area?.scrollLeft ?? 0, windowScrollY: window.scrollY };
    },
  }), [pagination.pageIndex, sorting]);
  const stableColumns = useMemo(() => columns, [columns]);
  const table = useTable({
    features,
    data,
    columns: stableColumns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: paginationResetKey === undefined && !initialViewState,
    getRowId,
  });
  useEffect(() => {
    if (!dataReady) return;
    const maxPageIndex = Math.max(0, Math.ceil(data.length / pagination.pageSize) - 1);
    setPagination((current) => current.pageIndex > maxPageIndex ? { ...current, pageIndex: maxPageIndex } : current);
  }, [data.length, pagination.pageSize, dataReady]);
  useEffect(() => {
    if (resetScopeRef.current === paginationResetKey && previousSortingRef.current === sorting) return;
    resetScopeRef.current = paginationResetKey;
    previousSortingRef.current = sorting;
    restoringRef.current = false;
    setPagination((current) => current.pageIndex === 0 ? current : { ...current, pageIndex: 0 });
  }, [paginationResetKey, sorting]);
  useLayoutEffect(() => {
    if (!restoringRef.current || !dataReady) return;
    const maxPage = Math.max(0, Math.ceil(data.length / pagination.pageSize) - 1);
    if (pagination.pageIndex > maxPage) return;
    const area = regionRef.current?.querySelector(".virtual-table-scroll, .table-wrap");
    if (area) {
      area.scrollTop = initialViewState.scrollTop ?? 0;
      area.scrollLeft = initialViewState.scrollLeft ?? 0;
    }
    window.scrollTo({ top: initialViewState.windowScrollY ?? 0, behavior: "auto" });
    previousPageRef.current = pagination.pageIndex;
    restoringRef.current = false;
  }, [dataReady, data.length, pagination.pageIndex, pagination.pageSize, initialViewState]);
  useEffect(() => {
    if (restoringRef.current || previousPageRef.current === pagination.pageIndex) return;
    previousPageRef.current = pagination.pageIndex;
    const scrollArea = regionRef.current?.querySelector(".virtual-table-scroll, .table-wrap");
    if (scrollArea) {
      scrollArea.scrollTop = 0;
      const top = scrollArea.getBoundingClientRect().top;
      if (top < 64 || top >= window.innerHeight) scrollArea.scrollIntoView?.({ block: "start", behavior: "auto" });
    }
  }, [pagination.pageIndex]);
  const rows = table.getRowModel().rows;
  const totalRows = table.getRowCount();
  const pageCount = table.getPageCount();
  const start = totalRows ? pagination.pageIndex * pagination.pageSize + 1 : 0;
  const end = totalRows ? Math.min(totalRows, start + rows.length - 1) : 0;
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index).filter((index) => (
    pageCount <= 5 || index === 0 || index === pageCount - 1 || Math.abs(index - pagination.pageIndex) <= 1
  ));
  const shouldVirtualize = rows.length >= virtualizeThreshold;

  return (
    <div className="data-table-region" ref={regionRef}>
      {shouldVirtualize ? (
        <VirtualBody table={table} rows={rows} getRowProps={getRowProps} estimateSize={estimateSize} className={className} />
      ) : (
        <div className="table-wrap">
          <table className={`data-table ${className}`}>
            <TableHeader table={table} />
            <StandardBody table={table} rows={rows} emptyState={emptyState} getRowProps={getRowProps} />
          </table>
        </div>
      )}
      <div className="table-footer">
        <span role="status" aria-live="polite">显示第 {start} 至 {end} 条，共 {totalRows} 条</span>
        {pageCount > 1 ? (
          <nav className="pagination" aria-label="表格分页">
            <button aria-label="上一页" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft size={17} /></button>
            {pageNumbers.map((page, index) => (
              <span className="pagination-slot" key={page}>
                {index > 0 && page - pageNumbers[index - 1] > 1 ? <i>...</i> : null}
                <button aria-label={`第 ${page + 1} 页`} aria-current={page === pagination.pageIndex ? "page" : undefined} className={page === pagination.pageIndex ? "active" : ""} onClick={() => table.setPageIndex(page)}>{page + 1}</button>
              </span>
            ))}
            <button aria-label="下一页" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight size={17} /></button>
          </nav>
        ) : null}
      </div>
    </div>
  );
});

export default DataTable;
