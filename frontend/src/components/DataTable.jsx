import { useEffect, useMemo, useRef, useState } from "react";
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
              <th key={header.id} style={style}>
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

export default function DataTable({
  data,
  columns,
  className = "",
  emptyState = "没有符合当前筛选条件的数据。",
  getRowId,
  getRowProps,
  pageSize = 20,
  virtualizeThreshold = 100,
  estimateSize = 64,
}) {
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });
  const stableColumns = useMemo(() => columns, [columns]);
  const table = useTable({
    features,
    data,
    columns: stableColumns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId,
  });
  useEffect(() => {
    const maxPageIndex = Math.max(0, Math.ceil(data.length / pagination.pageSize) - 1);
    setPagination((current) => current.pageIndex > maxPageIndex ? { ...current, pageIndex: maxPageIndex } : current);
  }, [data.length, pagination.pageSize]);
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
    <>
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
        <span>显示第 {start} 至 {end} 条，共 {totalRows} 条</span>
        {pageCount > 1 ? (
          <div className="pagination">
            <button aria-label="上一页" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft size={17} /></button>
            {pageNumbers.map((page, index) => (
              <span className="pagination-slot" key={page}>
                {index > 0 && page - pageNumbers[index - 1] > 1 ? <i>...</i> : null}
                <button className={page === pagination.pageIndex ? "active" : ""} onClick={() => table.setPageIndex(page)}>{page + 1}</button>
              </span>
            ))}
            <button aria-label="下一页" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight size={17} /></button>
          </div>
        ) : null}
      </div>
    </>
  );
}
