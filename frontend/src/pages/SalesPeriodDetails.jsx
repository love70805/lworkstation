import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import Decimal from 'decimal.js';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/UI';
import { salesStoreColor, salesStoreKey } from '../domain/salesChartModel';

const Exact = Decimal.clone({ precision: 80 });
const PAGE_SIZE = 5;
const EMPTY_STATE = { query: '', sort: 'revenueExact', page: 0, scroll: 0 };
export const showSalesValue = (value, digits = 2) => value == null ? '待查' : new Exact(value).toDecimalPlaces(digits, Decimal.ROUND_DOWN).toFixed();
const pair = totals => `销售原额 ${totals?.revenueExact == null ? '待查' : `¥${new Exact(totals.revenueExact).toFixed()}`} · 销量 ${totals?.quantityExact == null ? '待查' : `${new Exact(totals.quantityExact).toFixed()} 件`}`;
const tieKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

function StoreComposition({ data, metric, chosenStore, onChooseStore }) {
  const stores = data.status === 'unknown' ? [] : data.stores ?? [];
  const total = data.totalsExact[metric];
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
  return <aside className="sales-period-composition" aria-label="店铺构成">
    <h3>店铺构成</h3>
    {valid ? <svg className="sales-store-pie" viewBox="0 0 200 200" role="group" aria-label={metric === 'revenueExact' ? '销售额店铺构成' : '销量店铺构成'}>
      {slices.map(item => {
        const percentage = new Exact(item[metric]).div(total).times(100).toDecimalPlaces(1).toFixed();
        const props = { fill: salesStoreColor(item.store), role: 'button', tabIndex: 0, 'aria-label': `${item.store} ${showSalesValue(item[metric], 6)}，占比 ${percentage}%`, 'aria-pressed': chosenStore === salesStoreKey(item.store), onClick: () => choose(item.store), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(item.store); } } };
        const title = <title>{item.store} · {pair(item)} · 占比 {percentage}%</title>;
        return item.fraction >= 1 ? <circle key={item.key} cx="100" cy="100" r="90" {...props}>{title}</circle> : <path key={item.key} d={item.path} {...props}>{title}</path>;
      })}
    </svg> : <p className="sales-pie-fallback" role="status">{data.status === 'unknown' ? '数据待查，暂无可用占比。' : '含负值、合计非正或构成不完整，不绘制扇形占比。'}</p>}
    <div className="sales-pie-legend">{stores.map(item => <button type="button" key={item.key} aria-pressed={chosenStore === salesStoreKey(item.store)} onClick={() => choose(item.store)}><i style={{ background: salesStoreColor(item.store) }} /><span>{item.store}<small>{pair(item)}</small></span></button>)}</div>
    {chosenStore ? <Button onClick={() => onChooseStore(null)}>全部店铺</Button> : null}
  </aside>;
}

export default function SalesPeriodDetails({ data, metric, chosenStore, onChooseStore, state, onStateChange, close, previous, next, periods = [], onPeriodChange }) {
  const { query, sort, page, scroll } = { ...EMPTY_STATE, ...state };
  const searchId = useId(), sortId = useId(), tableRef = useRef(null), headingRef = useRef(null);
  const label = data.date || data.period;
  useLayoutEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [label, chosenStore]);
  const storeRows = useMemo(() => chosenStore ? data.rows.filter(row => salesStoreKey(row.store) === chosenStore) : data.stores ?? [], [data.rows, data.stores, chosenStore]);
  const selectedTotals = chosenStore && data.status !== 'unknown' ? data.stores?.find(item => salesStoreKey(item.store) === chosenStore) : null;
  const filtered = useMemo(() => {
    const search = query.trim().normalize('NFKC').toLocaleLowerCase();
    return storeRows.filter(row => [row.platformSkc || 'SKC 待补充', row.store, ...(row.platformSkus ?? [])].some(value => String(value).normalize('NFKC').toLocaleLowerCase().includes(search)))
      .toSorted((a, b) => new Exact(b[sort] ?? 0).cmp(a[sort] ?? 0) || tieKey(a, b));
  }, [storeRows, query, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  useLayoutEffect(() => { if (page !== current) onStateChange({ page: current }); }, [page, current, onStateChange]);
  useLayoutEffect(() => { if (tableRef.current) tableRef.current.scrollTop = scroll; }, [scroll]);
  const back = chosenStore ? () => onChooseStore(null) : close;
  return <section className="sales-day-details sales-period-details" aria-label={label + (chosenStore ? ' 商品明细' : ' 店铺明细')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); back(); } }}>
    <nav className="sales-detail-path" aria-label="分析路径"><Button onClick={close}>趋势</Button><span>›</span>{chosenStore ? <Button onClick={() => onChooseStore(null)}>{label} 店铺</Button> : <span>{label} 店铺</span>}{chosenStore ? <><span>›</span><span>{selectedTotals?.store ?? chosenStore} 商品</span></> : null}</nav>
    <div className="sales-details-heading"><div><h3 ref={headingRef} tabIndex={-1}>{label} {chosenStore ? '该店商品明细' : '店铺明细'}</h3><p>{data.hasStoreSelection ? '当月所选店铺合计' : '期间合计'} · {data.emptySelection ? '未选择店铺' : pair(data.status === 'unknown' ? null : data.totalsExact)}</p>{data.hasStoreSelection ? <p>当月全部店铺合计 · {pair(data.status === 'unknown' ? null : data.periodTotalsExact)}</p> : null}</div><div className="sales-period-navigation">
      <Button title={data.date ? '上一日' : '上一月'} aria-label={data.date ? '上一日' : '上一月'} disabled={!previous} onClick={previous}><ChevronLeft size={16} /></Button>
      {periods.length ? <select aria-label={data.date ? '选择日期' : '选择月份'} value={data.date || data.period} onChange={event => onPeriodChange(event.target.value)}>{periods.map(item => <option key={item.date || item.period} value={item.date || item.period}>{item.date || item.period}</option>)}</select> : null}
      <Button title={data.date ? '下一日' : '下一月'} aria-label={data.date ? '下一日' : '下一月'} disabled={!next} onClick={next}><ChevronRight size={16} /></Button>
      <Button onClick={back}><ArrowLeft size={16} />{chosenStore ? '返回店铺' : '返回趋势'}</Button>
    </div></div>
    {data.missingSelectedStores > 0 ? <p role="status">{data.missingSelectedStores} 家所选店铺本月无可用来源，合计仅含已知店铺，缺数据未补零。</p> : null}
    {data.unlocatedCount ? <p role="status">{data.date ? '仅含已定位到当天的记录；另有' : '本月包含'} {data.unlocatedCount} 条未定位到日期的记录。</p> : null}
    <div className={'sales-period-layout' + (chosenStore ? ' is-products' : '')}>
      {!chosenStore ? <StoreComposition {...{ data, metric, chosenStore, onChooseStore }} /> : null}
      <div className="sales-period-products">
        <h3>{chosenStore ? (selectedTotals?.store ?? chosenStore) + ' · 该店商品明细' : (data.hasStoreSelection ? '当期所选店铺' : '当期全部店铺')}</h3>
        {chosenStore ? <div className="sales-selected-store-totals"><p>店铺合计 · {pair(selectedTotals)}</p></div> : null}
        {data.status === 'unknown' ? <p role="status">{data.availability === 'future' ? '该日期尚未发生，未按零计算。' : data.availability === 'unobserved' ? '该日期尚未统计，未按零计算。' : '期间数据待查，空白未按零计算。'}</p> : <>
          {data.status === 'known_zero' ? <p>{data.date ? '当天' : '本月'}已知销售额与销量为 0，无商品记录。</p> : null}
          <div className="sales-details-controls"><label htmlFor={searchId}>{chosenStore ? '查找商品' : '查找店铺'}<input id={searchId} value={query} placeholder={chosenStore ? 'SKC、SKU 或店铺' : '店铺名称'} onChange={event => onStateChange({ query: event.target.value, page: 0, scroll: 0 })} /></label>
            <label htmlFor={sortId}>排序<select id={sortId} value={sort} onChange={event => onStateChange({ sort: event.target.value, page: 0, scroll: 0 })}><option value="revenueExact">销售额从高到低</option><option value="quantityExact">销量从高到低</option></select></label>
            {query ? <Button onClick={() => onStateChange({ query: '', page: 0, scroll: 0 })}>清空搜索</Button> : null}</div>
          <p className="sales-list-scope">{query.trim() ? '搜索结果' : chosenStore ? '该店全部商品' : (data.hasStoreSelection ? '当期所选店铺' : '当期全部店铺')} {filtered.length}/{storeRows.length} 项 · 合计不随筛选或翻页变化</p>
          <div className="sales-day-table" ref={tableRef} onScroll={event => onStateChange({ scroll: event.currentTarget.scrollTop })}><table><thead><tr><th>{chosenStore ? 'SKC / SKU' : '店铺'}</th><th>销量</th><th>销售原额</th>{chosenStore ? <th>均价</th> : null}</tr></thead><tbody>{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <tr key={row.key}><td>{chosenStore ? <><strong><i className="sales-row-swatch" style={{ background: salesStoreColor(row.store) }} />{row.platformSkc || 'SKC 待补充'}</strong><small>{row.platformSkus?.join('、') || 'SKU 待查'}</small></> : <button className="sales-store-entry" type="button" data-store-key={salesStoreKey(row.store)} onClick={() => onChooseStore(salesStoreKey(row.store))}><i className="sales-row-swatch" style={{ background: salesStoreColor(row.store) }} />{row.store} ›</button>}</td><td>{showSalesValue(row.quantityExact, 6)}</td><td>¥{showSalesValue(row.revenueExact)}</td>{chosenStore ? <td title={row.averagePriceExact ?? '待查'}>{showSalesValue(row.averagePriceExact)}</td> : null}</tr>)}</tbody></table></div>
          {!filtered.length ? <p>{chosenStore && !storeRows.length ? '该店在此期间无商品记录，不能据此认定销售为零。' : '没有匹配的结果，可清空搜索。'}</p> : null}
          <div className="sales-pagination"><Button disabled={!current} onClick={() => onStateChange({ page: current - 1, scroll: 0 })}>上一页</Button><span>第 {current + 1}/{pages} 页 · 每页 {PAGE_SIZE} 项</span><Button disabled={current + 1 >= pages} onClick={() => onStateChange({ page: current + 1, scroll: 0 })}>下一页</Button></div>
        </>}
      </div>
    </div>
  </section>;
}
