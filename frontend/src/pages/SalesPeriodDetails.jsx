import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import Decimal from 'decimal.js';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../components/UI';
import { salesStoreColor, salesStoreKey } from '../domain/salesChartModel';

const Exact = Decimal.clone({ precision: 80 });
const PAGE_SIZE = 6;
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

export default function SalesPeriodDetails({ data, metric, chosenStore, onChooseStore, state, onStateChange, close, previous, next }) {
  const { query, sort, page, scroll } = { ...EMPTY_STATE, ...state };
  const searchId = useId(), sortId = useId(), tableRef = useRef(null);
  const headingRef = useRef(null);
  const label = data.date || data.period;
  useLayoutEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [label]);
  const storeRows = useMemo(() => chosenStore ? data.rows.filter(row => salesStoreKey(row.store) === chosenStore) : data.rows, [data.rows, chosenStore]);
  const ranked = useMemo(() => chosenStore ? storeRows.filter(row => row.platformSkc?.trim()).toSorted((a, b) => new Exact(b.quantityExact).cmp(a.quantityExact) || tieKey(a, b)).slice(0, 5) : storeRows, [storeRows, chosenStore]);
  const selectedTotals = chosenStore && data.status !== 'unknown' ? data.stores?.find(item => salesStoreKey(item.store) === chosenStore) : null;
  // Ranking excludes missing SKCs; its denominator still includes every store row.
  const validShare = selectedTotals?.quantityExact != null && new Exact(selectedTotals.quantityExact).gt(0)
    && storeRows.every(row => row.quantityExact != null && new Exact(row.quantityExact).gte(0));
  const quantityShare = quantity => validShare ? `${new Exact(quantity).div(selectedTotals.quantityExact).times(100).toDecimalPlaces(1).toFixed()}%` : '待查';
  const topQuantity = useMemo(() => ranked.reduce((sum, row) => sum.plus(row.quantityExact), new Exact(0)), [ranked]);
  const filtered = useMemo(() => {
    const search = query.trim().normalize('NFKC').toLocaleLowerCase();
    return ranked.filter(row => [row.platformSkc || 'SKC 待补充', row.store, ...(row.platformSkus ?? [])].some(value => String(value).normalize('NFKC').toLocaleLowerCase().includes(search)))
      .toSorted((a, b) => new Exact(b[chosenStore ? 'quantityExact' : sort]).cmp(a[chosenStore ? 'quantityExact' : sort]) || tieKey(a, b));
  }, [ranked, query, sort, chosenStore]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  useLayoutEffect(() => { if (tableRef.current) tableRef.current.scrollTop = scroll; }, [scroll]);
  return <section className="sales-day-details sales-period-details" aria-label={`${label} 商品明细`} onKeyDown={event => { if (event.key === 'Escape') close(); }}>
    <div className="sales-details-heading"><div><h3 ref={headingRef} tabIndex={-1}>{label} 商品明细</h3><p>{pair(data.status === 'unknown' ? null : data.totalsExact)}</p></div><div className="sales-period-navigation">
      <Button title={data.date ? '上一日' : '上一月'} aria-label={data.date ? '上一日' : '上一月'} disabled={!previous} onClick={previous}><ChevronLeft size={16} /></Button>
      <Button title={data.date ? '下一日' : '下一月'} aria-label={data.date ? '下一日' : '下一月'} disabled={!next} onClick={next}><ChevronRight size={16} /></Button>
      <Button onClick={close}><ArrowLeft size={16} />返回总览</Button>
    </div></div>
    {data.unlocatedCount ? <p role="status">{data.date ? '仅含已定位到当天的记录；另有' : '本月包含'} {data.unlocatedCount} 条未定位到日期的记录。</p> : null}
    <div className="sales-period-layout">
      <StoreComposition {...{ data, metric, chosenStore, onChooseStore }} />
      <div className="sales-period-products">
        <h3>{chosenStore ? `${storeRows[0]?.store ?? chosenStore} · 销量 Top 5 SKC` : '期间全部商品'}</h3>
        {chosenStore ? <div className="sales-selected-store-totals"><p>店铺合计 · {pair(selectedTotals)}</p><p>Top 5 销量占店铺全部销量：{quantityShare(topQuantity)}{!validShare ? ' · 无可用正值分母或含负销量，不计算占比。' : ''}</p></div> : null}
        {data.status === 'unknown' ? <><p role="status">{data.availability === 'future' ? '该日期尚未发生，未按零计算。' : data.availability === 'unobserved' ? '该日期尚未统计，未按零计算。' : '期间数据待查，空白未按零计算。'}</p>{chosenStore && !storeRows.length ? <p>该店在此期间无商品记录。</p> : null}</> : <>
          {data.status === 'known_zero' ? <p>{data.date ? '当天' : '本月'}已知销售额与销量为 0，无商品记录。</p> : null}
          <div className="sales-details-controls"><label htmlFor={searchId}>查找商品<input id={searchId} value={query} placeholder="SKC、SKU 或店铺" onChange={event => onStateChange({ query: event.target.value, page: 0, scroll: 0 })} /></label>
            {!chosenStore ? <label htmlFor={sortId}>排序<select id={sortId} value={sort} onChange={event => onStateChange({ sort: event.target.value, page: 0, scroll: 0 })}><option value="revenueExact">销售额从高到低</option><option value="quantityExact">销量从高到低</option></select></label> : null}</div>
          <p className="sales-list-scope">{query.trim() ? '搜索结果' : chosenStore ? '销量 Top 5 SKC' : '期间全部商品'} {filtered.length}/{ranked.length} 项 · 期间合计不随筛选变化</p>
          {chosenStore && storeRows.some(row => !row.platformSkc?.trim()) ? <p>SKC 待补充记录不参与排名，可在全部店铺明细查看。</p> : null}
          <div className="sales-day-table" ref={tableRef} onScroll={event => onStateChange({ scroll: event.currentTarget.scrollTop })}><table><thead><tr><th>SKC / 店铺</th><th>销量</th>{chosenStore ? <th>店铺销量占比</th> : null}<th>销售原额</th><th>均价</th></tr></thead><tbody>{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <tr key={row.key}><td><strong><i className="sales-row-swatch" style={{ background: salesStoreColor(row.store) }} />{row.platformSkc || 'SKC 待补充'}</strong><small>{row.store} · {row.platformSkus?.join('、') || 'SKU 待查'}</small></td><td>{showSalesValue(row.quantityExact, 6)}</td>{chosenStore ? <td>{quantityShare(row.quantityExact)}</td> : null}<td>¥{showSalesValue(row.revenueExact)}</td><td title={row.averagePriceExact ?? '待查'}>{showSalesValue(row.averagePriceExact)}</td></tr>)}</tbody></table></div>
          {!filtered.length ? <p>{chosenStore && !storeRows.length ? '该店在此期间无商品记录。' : chosenStore && !ranked.length ? '该店在此期间无可排名的 SKC。' : '没有匹配的期间商品。'}</p> : null}
          <div className="sales-pagination"><Button disabled={!current} onClick={() => onStateChange({ page: current - 1, scroll: 0 })}>上一页</Button><span>第 {current + 1}/{pages} 页 · 每页 {PAGE_SIZE} 项</span><Button disabled={current + 1 >= pages} onClick={() => onStateChange({ page: current + 1, scroll: 0 })}>下一页</Button></div>
        </>}
      </div>
    </div>
  </section>;
}
