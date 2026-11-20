import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/UI';
import { salesStoreColor, salesStoreKey } from '../domain/salesChartModel';
import { revealListStart } from '../lib/pageListScroll';
import { combinedProfit } from '../domain/salesProfitAnalysis';

const Exact = Decimal.clone({ precision: 80 });
const PAGE_SIZE = 5;
const EMPTY_STATE = { query: '', page: 0, scrollLeft: 0, lossOnly: false };
export const showSalesValue = (value, digits = 2) => value == null ? '待查' : new Exact(value).toDecimalPlaces(digits, Decimal.ROUND_DOWN).toFixed();
const pair = totals => `销售原额 ${totals?.revenueExact == null ? '待查' : `¥${new Exact(totals.revenueExact).toFixed()}`} · 销量 ${totals?.quantityExact == null ? '待查' : `${new Exact(totals.quantityExact).toFixed()} 件`}`;
const tieKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
const loss = row => row.profitExact != null && new Exact(row.profitExact).lt(0);
const money = amount => amount == null ? '待核' : '¥' + showSalesValue(amount);
function margin(row) {
  return row?.profitExact != null && new Exact(row.revenueExact).gt(0)
    ? showSalesValue(new Exact(row.profitExact).div(row.revenueExact).times(100), 1) + '%' : '—';
}

const skcColor = key => {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 68% 48%)`;
};
function pieComposition(rows, metric, total) {
  const profit = metric === 'profitExact';
  const metricName = profit ? '利润' : metric === 'revenueExact' ? '销售额' : '销量';
  const losses = profit ? rows.filter(loss) : [];
  const empty = { metricName, slices: [], losses };
  if (total == null || !rows.length || rows.some(row => row[metric] == null)) return empty;
  const sum = profit ? combinedProfit(rows) : rows.reduce((value, row) => value.plus(row[metric]), new Exact(0));
  if (!new Exact(total).eq(sum)) return empty;
  if (!profit && rows.some(row => new Exact(row[metric]).lt(0))) return empty;

  const positive = rows.filter(row => new Exact(row[metric]).gt(0));
  const lossPie = profit && !positive.length && losses.length > 0;
  const members = lossPie ? losses : positive;
  if (!members.length) return empty;
  const basis = profit ? new Exact(combinedProfit(members)).abs() : new Exact(total);
  let angle = -Math.PI / 2;
  const point = value => [100 + 90 * Math.cos(value), 100 + 90 * Math.sin(value)].join(',');
  const slices = members.map(row => {
    const share = new Exact(row[metric]).abs().div(basis);
    const start = angle;
    angle += share.toNumber() * Math.PI * 2;
    const path = 'M100,100 L' + point(start) + ' A90,90 0 ' + (share.gt(0.5) ? 1 : 0) + ',1 ' + point(angle) + ' Z';
    return { row, path, percent: share.times(100).toDecimalPlaces(1).toFixed() };
  });
  return { metricName: lossPie ? '亏损额' : profit && losses.length ? '盈利额' : metricName, slices, losses };
}

function StoreComposition({ rows, total, status, metric, chosenStore, onChooseStore, onChooseProduct, highlighted }) {
  const products = Boolean(chosenStore), profit = metric === 'profitExact';
  const { metricName, slices, losses } = useMemo(() => pieComposition(rows, metric, total), [rows, metric, total]);
  const label = item => products ? item.platformSkc || item.platformSkus?.join('、') || 'SKC 待补充' : item.store;
  const choose = item => products ? onChooseProduct(item.key) : onChooseStore(salesStoreKey(item.store));
  const selected = products ? rows.find(row => row.key === highlighted) : null;
  const selectedSlice = slices.find(slice => slice.row.key === highlighted);
  const lossTotal = losses.length ? combinedProfit(losses) : null;
  let selectionNote = '点击扇区查看明细';
  if (selectedSlice) selectionNote = '选中商品占' + metricName + '的 ' + selectedSlice.percent + '%';
  else if (profit && selected?.profitExact != null) {
    selectionNote = loss(selected) && lossTotal != null ? '选中商品占亏损额的 ' + new Exact(selected.profitExact).div(lossTotal).times(100).toDecimalPlaces(1).toFixed() + '%'
      : '选中商品利润 ' + money(selected.profitExact);
  }
  const category = products ? 'SKC' : '店铺';
  const heading = profit ? (metricName === '亏损额' ? '亏损构成' : metricName === '盈利额' ? '盈利构成' : '利润构成') : category + ' 构成';
  const positiveLeader = profit ? slices.reduce((best, {row}) => new Exact(row.profitExact).gt(best?.profitExact ?? 0) ? row : best, null) : null;
  const lossLeader = losses.reduce((worst, row) => !worst || new Exact(row.profitExact).lt(worst.profitExact) ? row : worst, null);
  const link = (caption, row) => <button type="button" aria-label={caption + '，' + label(row)} onClick={() => choose(row)}>{caption}</button>;
  return <aside className="sales-period-composition" aria-label={heading}>
    <h3>{heading}</h3>
    {slices.length ? <svg className="sales-store-pie" viewBox="0 0 200 200" role="group" aria-label={metricName + category + '构成'}>
      {slices.map(({ row, path, percent }) => {
        const name = label(row) + ' ' + (profit ? money(row[metric]) : showSalesValue(row[metric], 6)) + '，占' + metricName + ' ' + percent + '%';
        const props = { fill: products ? skcColor(row.key) : salesStoreColor(row.store), role: 'button', tabIndex: 0,
          'aria-label': name, 'aria-pressed': products && highlighted === row.key, onClick: () => choose(row),
          onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(row); } } };
        return slices.length === 1 ? <circle key={row.key} cx="100" cy="100" r="90" {...props}><title>{name}</title></circle>
          : <path key={row.key} d={path} {...props}><title>{name}</title></path>;
      })}
    </svg> : <p className="sales-pie-fallback" role="status">{status === 'unknown' ? '数据待查，暂无可用占比。' : profit
      ? (total != null && new Exact(total).isZero() && rows.every(row => row.profitExact != null && new Exact(row.profitExact).isZero()) ? '商品利润为 0，暂无金额占比。' : '暂无可核实的利润占比。')
      : '含负值、合计非正或构成不完整，不绘制扇形占比。'}</p>}
    <div className="sales-composition-notes">
      {slices.length ? <p className="sales-chart-note">{selectionNote}</p> : null}
      {lossTotal != null ? <p>亏损合计 <b className="sales-loss">{money(lossTotal)}</b></p> : null}
      {profit && (positiveLeader || lossLeader) ? <div className="sales-composition-links">{positiveLeader && link('利润最高', positiveLeader)}{lossLeader && link('亏损最多', lossLeader)}</div> : null}
      {profit && selected?.profitExact != null && new Exact(selected.quantityExact).gt(0) ? <p>选中商品每件利润 <b>{money(new Exact(selected.profitExact).div(selected.quantityExact))}</b></p> : null}
    </div>
  </aside>;
}

export default function SalesPeriodDetails({ selection, data, error, metric, chosenStore, onChooseStore, state, onStateChange, onBack, onTrend, periods, onPeriodChange, position }) {
  const { date, period } = selection;
  const label = date || period;
  const headingRef = useRef(null);
  const headingId = useId();
  const selectedTotals = chosenStore && data?.status !== 'unknown' ? data?.stores.find(item => salesStoreKey(item.store) === chosenStore) : null;
  const loading = !data && !error;
  const periodTotalLabel = data?.hasStoreSelection ? '当月所选店铺合计' : data?.scope?.store === 'all' ? (date ? '当日全部店铺合计' : '当月全部店铺合计') : '期间合计';
  useLayoutEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [label, chosenStore]);

  return <section className="sales-day-details sales-period-details" aria-labelledby={headingId}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onBack(); } }}>
    <div className="sales-detail-toolbar">
      <nav className="sales-detail-path" aria-label="分析路径">
        <Button onClick={onBack}><ArrowLeft size={16} />{onTrend ? '返回店铺' : '返回趋势'}</Button>
        {onTrend ? <button type="button" className="sales-trend-shortcut" onClick={onTrend} aria-label="直接返回趋势">趋势</button> : null}
      </nav>
      <div className="sales-period-navigation">
        <Button title={date ? '上一日' : '上一月'} aria-label={date ? '上一日' : '上一月'} disabled={position <= 0} onClick={() => onPeriodChange(periods[position - 1])}><ChevronLeft size={16} /></Button>
        <select aria-label={date ? '选择日期' : '选择月份'} value={label} onChange={event => onPeriodChange(periods.find(item => (item.date || item.period) === event.target.value))}>
          {periods.map(item => <option key={item.date || item.period}>{item.date || item.period}</option>)}
        </select>
        <Button title={date ? '下一日' : '下一月'} aria-label={date ? '下一日' : '下一月'} disabled={position < 0 || position >= periods.length - 1} onClick={() => onPeriodChange(periods[position + 1])}><ChevronRight size={16} /></Button>
      </div>
    </div>
    <div className="sales-details-heading"><div>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>{label} {chosenStore ? `${selectedTotals?.store ?? chosenStore} 商品明细` : '店铺明细'}</h3>
      {data ? <p>{periodTotalLabel} · {data.emptySelection ? '未选择店铺' : <>{metric === 'profitExact' ? `商品利润 ${money(data.status === 'unknown' ? null : data.totalsExact.profitExact)} · ` : ''}{pair(data.status === 'unknown' ? null : data.totalsExact)}</>}</p> : null}
      {data?.hasStoreSelection ? <p>当月全部店铺合计 · {pair(data.status === 'unknown' ? null : data.periodTotalsExact)}</p> : null}
    </div></div>
    {loading ? <div className="sales-details-loading" aria-busy="true"><p role="status">正在读取 {label} {chosenStore ? '商品' : '店铺'}明细...</p></div>
      : error ? <p role="alert">{error}</p>
      : <SalesDetailList {...{ data, metric, chosenStore, selectedTotals, onChooseStore, state, onStateChange }} />}
  </section>;
}

function SalesDetailList({ data, metric, chosenStore, selectedTotals, onChooseStore, state, onStateChange }) {
  const { query, page, scrollLeft, lossOnly: savedLossOnly } = { ...EMPTY_STATE, ...state };
  const lossOnly = data.hasProfitAnalysis && savedLossOnly;
  const savedSort = state?.sort;
  const sort = !data.hasProfitAnalysis && ['profitExact', 'lossFirst'].includes(savedSort) ? 'revenueExact' : savedSort ?? (metric === 'profitExact' ? 'profitExact' : 'revenueExact');
  const searchId = useId(), sortId = useId(), tableRef = useRef(null);
  const previousPage = useRef(page);
  const [highlighted, setHighlighted] = useState(null);
  const storeRows = useMemo(() => chosenStore ? data.rows.filter(row => salesStoreKey(row.store) === chosenStore) : data.stores ?? [], [data.rows, data.stores, chosenStore]);
  const sortedRows = useMemo(() => {
    const ascending = sort === 'lossFirst', field = ascending ? 'profitExact' : sort;
    return storeRows.toSorted((a, b) => {
      if ((a[field] == null) !== (b[field] == null)) return a[field] == null ? 1 : -1;
      return (ascending ? 1 : -1) * new Exact(a[field] ?? 0).cmp(b[field] ?? 0) || tieKey(a, b);
    });
  }, [storeRows, sort]);
  const filtered = useMemo(() => {
    const search = query.trim().normalize('NFKC').toLocaleLowerCase();
    const rows = lossOnly ? sortedRows.filter(loss) : sortedRows;
    return search ? rows.filter(row => [row.platformSkc || 'SKC 待补充', row.store, ...(row.platformSkus ?? [])].some(value => String(value).normalize('NFKC').toLocaleLowerCase().includes(search))) : rows;
  }, [sortedRows, query, lossOnly]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  const pageRows = data.status === 'unknown' ? [] : filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  useLayoutEffect(() => { if (page !== current) onStateChange({ page: current }); }, [page, current, onStateChange]);
  useLayoutEffect(() => { if (tableRef.current) tableRef.current.scrollLeft = scrollLeft; }, [scrollLeft]);
  useLayoutEffect(() => {
    if (previousPage.current !== current) revealListStart(tableRef.current);
    previousPage.current = current;
  }, [current]);
  const pendingProductFocus = useRef(null);
  function focusProductRow(button) {
    button?.focus({ preventScroll: true });
    button?.closest('tr').scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function onChooseProduct(key) {
    const filteredIndex = filtered.findIndex(row => row.key === key);
    const index = filteredIndex >= 0 ? filteredIndex : sortedRows.findIndex(row => row.key === key);
    if (index < 0) return;
    setHighlighted(key);
    const targetPage = Math.floor(index / PAGE_SIZE);
    if (filteredIndex >= 0 && targetPage === current) {
      focusProductRow(tableRef.current?.querySelectorAll('.sales-product-entry')[index % PAGE_SIZE]);
      return;
    }
    pendingProductFocus.current = key;
    onStateChange(filteredIndex >= 0 ? { page: targetPage } : { query: '', lossOnly: false, page: targetPage, scrollLeft: 0 });
  }
  useLayoutEffect(() => {
    if (pendingProductFocus.current !== highlighted || !highlighted) return;
    pendingProductFocus.current = null;
    focusProductRow(tableRef.current?.querySelector('.sales-product-entry[aria-pressed="true"]'));
  }, [highlighted, current, query]);
  function selectRow(event, row) {
    event.currentTarget.querySelector('button').focus({ preventScroll: true });
    if (chosenStore) setHighlighted(row.key);
    else onChooseStore(salesStoreKey(row.store));
  }
  return <>
    {data.missingSelectedStores > 0 ? <p role="status">{data.missingSelectedStores} 家所选店铺本月无可用来源，合计仅含已知店铺，缺数据未补零。</p> : null}
    {data.unlocatedCount ? <p role="status">{data.date ? '仅含已定位到当天的记录；另有' : '本月包含'} {data.unlocatedCount} 条未定位到日期的记录。</p> : null}
    <div className={'sales-period-layout' + (chosenStore ? ' is-products' : '')}>
      <StoreComposition rows={data.status === 'unknown' ? [] : storeRows} total={(chosenStore ? selectedTotals : data.totalsExact)?.[metric]} status={data.status}
        {...{ metric, chosenStore, onChooseStore, onChooseProduct, highlighted }} />
      <div className="sales-period-products">
        <h3>{chosenStore ? (selectedTotals?.store ?? chosenStore) + ' · 该店商品明细' : (data.hasStoreSelection ? '当期所选店铺' : '当期全部店铺')}</h3>
        {chosenStore ? <div className="sales-selected-store-totals"><p>店铺合计 · {pair(selectedTotals)}{data.hasProfitAnalysis ? ` · 商品利润 ${money(selectedTotals?.profitExact)}` : ''}</p></div> : null}
        {data.status === 'unknown' ? <p role="status">{data.availability === 'future' ? '该日期尚未发生，未按零计算。' : data.availability === 'unobserved' ? '该日期尚未统计，未按零计算。' : '期间数据待查，空白未按零计算。'}</p> : <>
          {data.status === 'known_zero' ? <p>{data.date ? '当天' : '本月'}已知销售额与销量为 0，无商品记录。</p> : null}
          <div className="sales-details-controls"><label htmlFor={searchId}>{chosenStore ? '查找商品' : '查找店铺'}<input id={searchId} value={query} placeholder={chosenStore ? 'SKC、SKU 或店铺' : '店铺名称'} onChange={event => onStateChange({ query: event.target.value, page: 0, scrollLeft: 0 })} /></label>
            <label htmlFor={sortId}>排序<select id={sortId} value={sort} onChange={event => onStateChange({ sort: event.target.value, page: 0, scrollLeft: 0 })}>{data.hasProfitAnalysis ? <><option value="profitExact">利润从高到低</option><option value="lossFirst">利润从低到高</option></> : null}<option value="revenueExact">销售额从高到低</option><option value="quantityExact">销量从高到低</option></select></label>
            {data.hasProfitAnalysis ? <Button aria-pressed={Boolean(lossOnly)} onClick={() => onStateChange({ lossOnly: !lossOnly, page: 0, scrollLeft: 0 })}>只看亏损</Button> : null}
            {query ? <Button onClick={() => onStateChange({ query: '', page: 0, scrollLeft: 0 })}>清空搜索</Button> : null}</div>
          <p className="sales-list-scope">{lossOnly ? '已核亏损项' : query.trim() ? '搜索结果' : chosenStore ? '该店全部商品' : (data.hasStoreSelection ? '当期所选店铺' : '当期全部店铺')} {filtered.length}/{storeRows.length} 项 · 合计不随筛选或翻页变化</p>
          <div className={'sales-day-table' + (data.hasProfitAnalysis ? ' has-profit-columns' : '')} ref={tableRef} onScroll={event => onStateChange({ scrollLeft: event.currentTarget.scrollLeft })}>
            <table>
              <thead><tr><th>{chosenStore ? 'SKC / SKU' : '店铺'}</th>
                {data.hasProfitAnalysis ? <>
                  <th>销售原额<small>{chosenStore ? '销量 · 均价' : '销量'}</small></th>
                  <th>采购成本<small>仓储费</small></th><th>商品利润<small>利润率</small></th>
                </> : <><th>销量</th><th>销售原额</th>{chosenStore && <th>均价</th>}</>}
              </tr></thead>
              <tbody>{pageRows.map(row => <tr key={row.key} onClick={event => selectRow(event, row)} data-highlighted={highlighted === row.key || undefined}>
                <td>{chosenStore
                  ? <button className="sales-product-entry" type="button" aria-pressed={highlighted === row.key}>
                    <strong><i className="sales-row-swatch" style={{ background: skcColor(row.key) }} /><span>{row.platformSkc || 'SKC 待补充'}</span></strong>
                    <small>{row.platformSkus?.join('、') || 'SKU 待查'}</small>
                  </button>
                  : <button className="sales-store-entry" type="button" data-store-key={salesStoreKey(row.store)}>
                    <i className="sales-row-swatch" style={{ background: salesStoreColor(row.store) }} />{row.store} ›
                  </button>}</td>
                {data.hasProfitAnalysis ? <>
                  <td>¥{showSalesValue(row.revenueExact)}<small>{showSalesValue(row.quantityExact, 6)} 件{chosenStore && <span title={row.averagePriceExact ?? '待查'}> · {row.averagePriceExact == null ? '待查' : '¥' + showSalesValue(row.averagePriceExact)}</span>}</small></td>
                  <td>{money(row.purchaseCostExact)}<small>{money(row.warehouseCostExact)}</small></td>
                  <td className={'sales-profit-cell' + (loss(row) ? ' sales-loss' : '')}>{money(row.profitExact)}<small>{margin(row)}</small></td>
                </> : <>
                  <td>{showSalesValue(row.quantityExact, 6)}</td><td>¥{showSalesValue(row.revenueExact)}</td>
                  {chosenStore && <td title={row.averagePriceExact ?? '待查'}>{showSalesValue(row.averagePriceExact)}</td>}
                </>}
              </tr>)}</tbody>
            </table>
          </div>
          {!filtered.length ? <p>{chosenStore && !storeRows.length ? '该店在此期间无商品记录，不能据此认定销售为零。' : lossOnly ? '当前范围没有匹配的已核亏损项。' : '没有匹配的结果，可清空搜索。'}</p> : null}
          <div className="sales-pagination"><Button disabled={!current} onClick={() => onStateChange({ page: current - 1 })}>上一页</Button><span>第 {current + 1}/{pages} 页 · 每页 {PAGE_SIZE} 项</span><Button disabled={current + 1 >= pages} onClick={() => onStateChange({ page: current + 1 })}>下一页</Button></div>
        </>}
      </div>
    </div>
  </>;
}
