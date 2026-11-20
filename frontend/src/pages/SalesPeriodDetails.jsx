import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/UI';
import { salesStoreColor, salesStoreKey } from '../domain/salesChartModel';
import { revealListStart } from '../lib/pageListScroll';

const Exact = Decimal.clone({ precision: 80 });
const PAGE_SIZE = 5;
const EMPTY_STATE = { query: '', sort: 'revenueExact', page: 0, scrollLeft: 0 };
export const showSalesValue = (value, digits = 2) => value == null ? '待查' : new Exact(value).toDecimalPlaces(digits, Decimal.ROUND_DOWN).toFixed();
const pair = totals => `销售原额 ${totals?.revenueExact == null ? '待查' : `¥${new Exact(totals.revenueExact).toFixed()}`} · 销量 ${totals?.quantityExact == null ? '待查' : `${new Exact(totals.quantityExact).toFixed()} 件`}`;
const tieKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

const skcColor = key => {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 68% 48%)`;
};
function StoreComposition({ data, metric, chosenStore, onChooseStore, onChooseProduct, highlighted, legendRows }) {
  const products = Boolean(chosenStore);
  const stores = data.status === 'unknown' ? [] : products ? data.rows.filter(row => salesStoreKey(row.store) === chosenStore) : data.stores ?? [];
  const total = products ? data.stores?.find(item => salesStoreKey(item.store) === chosenStore)?.[metric] : data.totalsExact[metric];
  const label = item => products ? item.platformSkc || 'SKC 待补充' : item.store;
  const color = item => products ? skcColor(item.key) : salesStoreColor(item.store);
  const sum = stores.reduce((value, item) => value.plus(item[metric] ?? 0), new Exact(0));
  const valid = data.status !== 'unknown' && total != null && new Exact(total).gt(0)
    && stores.every(item => item[metric] != null && new Exact(item[metric]).gte(0)) && sum.eq(total);
  let angle = -Math.PI / 2;
  const slices = valid ? stores.filter(item => new Exact(item[metric]).gt(0)).map(item => {
    const fraction = new Exact(item[metric]).div(total).toNumber(), start = angle;
    angle += fraction * Math.PI * 2;
    const point = value => `${100 + 90 * Math.cos(value)},${100 + 90 * Math.sin(value)}`;
    return { ...item, fraction, path: `M100,100 L${point(start)} A90,90 0 ${fraction > 0.5 ? 1 : 0},1 ${point(angle)} Z` };
  }) : [];
  const choose = name => onChooseStore(chosenStore === salesStoreKey(name) ? null : salesStoreKey(name));
  return <aside className="sales-period-composition" aria-label={products ? "SKC 构成" : "店铺构成"}>
    <h3>{products ? "SKC 构成" : "店铺构成"}</h3>
    {valid ? <svg className="sales-store-pie" viewBox="0 0 200 200" role="group" aria-label={`${metric === 'revenueExact' ? '销售额' : '销量'}${products ? 'SKC' : '店铺'}构成`}>
      {slices.map(item => {
        const percentage = new Exact(item[metric]).div(total).times(100).toDecimalPlaces(1).toFixed();
        const props = { fill: color(item), role: 'button', tabIndex: 0, 'aria-label': `${label(item)} ${showSalesValue(item[metric], 6)}，占比 ${percentage}%`, 'aria-pressed': products ? highlighted === item.key : chosenStore === salesStoreKey(item.store), onClick: () => (products ? onChooseProduct(item.key) : choose(item.store)), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (products ? onChooseProduct(item.key) : choose(item.store)); } } };
        const title = <title>{label(item)} · {pair(item)} · 占比 {percentage}%</title>;
        return item.fraction >= 1 ? <circle key={item.key} cx="100" cy="100" r="90" {...props}>{title}</circle> : <path key={item.key} d={item.path} {...props}>{title}</path>;
      })}
    </svg> : <p className="sales-pie-fallback" role="status">{data.status === 'unknown' ? '数据待查，暂无可用占比。' : '含负值、合计非正或构成不完整，不绘制扇形占比。'}</p>}
    <p className="sales-chart-note">{valid ? `构成图包含全部 ${stores.length} 项；` : ''}图例对应当前明细页。</p>
    <div className="sales-pie-legend">{legendRows.map(item => <button type="button" key={item.key} aria-label={products ? undefined : `查看 ${item.store} 商品明细`} aria-pressed={products ? highlighted === item.key : chosenStore === salesStoreKey(item.store)} onClick={() => (products ? onChooseProduct(item.key) : choose(item.store))}><i style={{ background: color(item) }} /><span>{label(item)}<small>{pair(item)}</small></span></button>)}</div>

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
      {data ? <p>{periodTotalLabel} · {data.emptySelection ? '未选择店铺' : pair(data.status === 'unknown' ? null : data.totalsExact)}</p> : null}
      {data?.hasStoreSelection ? <p>当月全部店铺合计 · {pair(data.status === 'unknown' ? null : data.periodTotalsExact)}</p> : null}
    </div></div>
    {loading ? <div className="sales-details-loading" aria-busy="true"><p role="status">正在读取 {label} {chosenStore ? '商品' : '店铺'}明细...</p></div>
      : error ? <p role="alert">{error}</p>
      : <SalesDetailList {...{ data, metric, chosenStore, selectedTotals, onChooseStore, state, onStateChange }} />}
  </section>;
}

function SalesDetailList({ data, metric, chosenStore, selectedTotals, onChooseStore, state, onStateChange }) {
  const { query, sort, page, scrollLeft } = { ...EMPTY_STATE, ...state };
  const searchId = useId(), sortId = useId(), tableRef = useRef(null);
  const previousPage = useRef(page);
  const [highlighted, setHighlighted] = useState(null);
  const storeRows = useMemo(() => chosenStore ? data.rows.filter(row => salesStoreKey(row.store) === chosenStore) : data.stores ?? [], [data.rows, data.stores, chosenStore]);
  const sortedRows = useMemo(() => storeRows.toSorted((a, b) => new Exact(b[sort] ?? 0).cmp(a[sort] ?? 0) || tieKey(a, b)), [storeRows, sort]);
  const filtered = useMemo(() => {
    const search = query.trim().normalize('NFKC').toLocaleLowerCase();
    return search ? sortedRows.filter(row => [row.platformSkc || 'SKC 待补充', row.store, ...(row.platformSkus ?? [])].some(value => String(value).normalize('NFKC').toLocaleLowerCase().includes(search))) : sortedRows;
  }, [sortedRows, query]);
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
    onStateChange(filteredIndex >= 0 ? { page: targetPage } : { query: '', page: targetPage, scrollLeft: 0 });
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
      <StoreComposition {...{ data, metric, chosenStore, onChooseStore, onChooseProduct, highlighted }} legendRows={pageRows} />
      <div className="sales-period-products">
        <h3>{chosenStore ? (selectedTotals?.store ?? chosenStore) + ' · 该店商品明细' : (data.hasStoreSelection ? '当期所选店铺' : '当期全部店铺')}</h3>
        {chosenStore ? <div className="sales-selected-store-totals"><p>店铺合计 · {pair(selectedTotals)}</p></div> : null}
        {data.status === 'unknown' ? <p role="status">{data.availability === 'future' ? '该日期尚未发生，未按零计算。' : data.availability === 'unobserved' ? '该日期尚未统计，未按零计算。' : '期间数据待查，空白未按零计算。'}</p> : <>
          {data.status === 'known_zero' ? <p>{data.date ? '当天' : '本月'}已知销售额与销量为 0，无商品记录。</p> : null}
          <div className="sales-details-controls"><label htmlFor={searchId}>{chosenStore ? '查找商品' : '查找店铺'}<input id={searchId} value={query} placeholder={chosenStore ? 'SKC、SKU 或店铺' : '店铺名称'} onChange={event => onStateChange({ query: event.target.value, page: 0, scrollLeft: 0 })} /></label>
            <label htmlFor={sortId}>排序<select id={sortId} value={sort} onChange={event => onStateChange({ sort: event.target.value, page: 0, scrollLeft: 0 })}><option value="revenueExact">销售额从高到低</option><option value="quantityExact">销量从高到低</option></select></label>
            {query ? <Button onClick={() => onStateChange({ query: '', page: 0, scrollLeft: 0 })}>清空搜索</Button> : null}</div>
          <p className="sales-list-scope">{query.trim() ? '搜索结果' : chosenStore ? '该店全部商品' : (data.hasStoreSelection ? '当期所选店铺' : '当期全部店铺')} {filtered.length}/{storeRows.length} 项 · 合计不随筛选或翻页变化</p>
          <div className="sales-day-table" ref={tableRef} onScroll={event => onStateChange({ scrollLeft: event.currentTarget.scrollLeft })}>
            <table>
              <thead><tr><th>{chosenStore ? 'SKC / SKU' : '店铺'}</th><th>销量</th><th>销售原额</th>{chosenStore ? <th>均价</th> : null}</tr></thead>
              <tbody>{pageRows.map(row => <tr key={row.key} onClick={event => selectRow(event, row)} data-highlighted={highlighted === row.key || undefined}>
                <td>{chosenStore
                  ? <button className="sales-product-entry" type="button" aria-pressed={highlighted === row.key}>
                    <strong><i className="sales-row-swatch" style={{ background: skcColor(row.key) }} />{row.platformSkc || 'SKC 待补充'}</strong>
                    <small>{row.platformSkus?.join('、') || 'SKU 待查'}</small>
                  </button>
                  : <button className="sales-store-entry" type="button" data-store-key={salesStoreKey(row.store)}>
                    <i className="sales-row-swatch" style={{ background: salesStoreColor(row.store) }} />{row.store} ›
                  </button>}</td>
                <td>{showSalesValue(row.quantityExact, 6)}</td><td>¥{showSalesValue(row.revenueExact)}</td>
                {chosenStore ? <td title={row.averagePriceExact ?? '待查'}>{showSalesValue(row.averagePriceExact)}</td> : null}
              </tr>)}</tbody>
            </table>
          </div>
          {!filtered.length ? <p>{chosenStore && !storeRows.length ? '该店在此期间无商品记录，不能据此认定销售为零。' : '没有匹配的结果，可清空搜索。'}</p> : null}
          <div className="sales-pagination"><Button disabled={!current} onClick={() => onStateChange({ page: current - 1 })}>上一页</Button><span>第 {current + 1}/{pages} 页 · 每页 {PAGE_SIZE} 项</span><Button disabled={current + 1 >= pages} onClick={() => onStateChange({ page: current + 1 })}>下一页</Button></div>
        </>}
      </div>
    </div>
  </>;
}
