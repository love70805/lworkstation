import { buildSalesMonth, salesScale, salesStoreKey, salesStoreColor } from '../domain/salesChartModel';
import { SalesMonthChart, SalesHoverSummary } from './SalesMonthChart';
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Decimal from "decimal.js";
import { Panel, Button } from "../components/UI";
import { readLedgerSalesAnalytics, readLedgerDailySalesDetails } from "../data/repositories/salesAnalyticsRepository";
import { activityName, shortActivityName } from "./salesActivitySummary";
import { aggregateDailySalesDetails } from "../domain/salesAnalytics";

const show = (value, digits = 2) => value == null ? "待查" : new Decimal(value).toDecimalPlaces(digits, Decimal.ROUND_DOWN).toFixed();
const pair = day => `销售原额 ${day?.revenueExact == null ? "待查" : `¥${new Decimal(day.revenueExact).toFixed()}`} · 销量 ${day?.quantityExact == null ? "待查" : `${new Decimal(day.quantityExact).toFixed()} 件`}`;
const PAGE_SIZE = 6;

function ActivityDetails({ row }) {
  const [page, setPage] = useState(0);
  const names = useMemo(() => [...new Set(row.activities.map(activity => activityName(activity.raw)))], [row.activities]);
  if (!names.length) return <span className="sales-pending">活动待查</span>;
  return <details className="sales-activities"><summary>活动 · {names.length} 项</summary>
    {names.slice(page * 5, page * 5 + 5).map(name => <p key={name}>{shortActivityName(name)}</p>)}
    {names.length > 5 ? <div className="sales-pagination"><Button disabled={!page} onClick={() => setPage(page - 1)}>上一组活动</Button><span>{page + 1}/{Math.ceil(names.length / 5)}</span><Button disabled={(page + 1) * 5 >= names.length} onClick={() => setPage(page + 1)}>下一组活动</Button></div> : null}
  </details>;
}

function DailyDetails({ data, close }) {
  const [query, setQuery] = useState(""), [sort, setSort] = useState("revenueExact"), [page, setPage] = useState(0);
  const searchId = useId(), sortId = useId(), tableRef = useRef(null);
  useEffect(() => { if (tableRef.current) tableRef.current.scrollTop = 0; }, [page, query, sort]);
  const filtered = useMemo(() => {
    const search = query.trim().normalize("NFKC").toLocaleLowerCase();
    return data.rows.filter(row => [...(row.platformSkcs ?? []), row.platformSku, row.store, ...row.attributes].some(value => String(value).normalize("NFKC").toLocaleLowerCase().includes(search)))
      .toSorted((a, b) => new Decimal(b[sort]).cmp(a[sort]) || a.key.localeCompare(b.key));
  }, [data.rows, query, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  return <section className="sales-day-details" aria-label={`${data.date} 商品明细`} onKeyDown={event => { if (event.key === "Escape") close(); }}>
    <div className="sales-details-heading"><div><h3>{data.date} 商品明细</h3><p>{pair(data.totalsExact)}</p></div><Button onClick={close}>返回全月</Button></div>
    {data.status === "unknown" ? <p role="status">{data.availability === "future" ? "该日期尚未发生，未按零计算。" : data.availability === "unobserved" ? "该日期尚未统计，未按零计算。" : "当天数据待查；尚有未定位到日期的记录或未取得销售来源，空白未按零计算。"}</p> : data.status === "known_zero" ? <p>当天已知销售额与销量为 0，无商品记录。</p> : <>
      {data.unlocatedCount ? <p role="status">仅含已定位到当天的记录；另有 {data.unlocatedCount} 条未定位记录待查。</p> : null}
      <div className="sales-details-controls"><label htmlFor={searchId}>查找商品<input id={searchId} value={query} placeholder="SKC、店铺或属性" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><label htmlFor={sortId}>排序<select id={sortId} value={sort} onChange={event => { setSort(event.target.value); setPage(0); }}><option value="revenueExact">销售额从高到低</option><option value="quantityExact">销量从高到低</option></select></label></div>
      <p className="sales-list-scope">{query.trim() ? "搜索结果" : "当天全部商品"} {filtered.length}/{data.rows.length} 项 · 当日合计不随搜索变化</p>
      <div className="sales-day-table" ref={tableRef}><table><thead><tr><th>SKC / 店铺</th><th>销量</th><th>销售原额</th><th>均价</th></tr></thead><tbody>{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <tr key={row.key}><td><strong>{row.platformSkcs?.join("、") || "SKC 待补充"}</strong><small>{row.store} · {row.attributes.join("、") || "属性待查"}</small><ActivityDetails key={row.key} row={row} /></td><td>{show(row.quantityExact, 6)}</td><td>¥{show(row.revenueExact)}</td><td title={row.averagePriceExact ?? "待查"}>{show(row.averagePriceExact)}</td></tr>)}</tbody></table></div>
      {!filtered.length ? <p>没有匹配的当天商品。</p> : null}
      <div className="sales-pagination"><Button disabled={!current} onClick={() => setPage(current - 1)}>上一页</Button><span>第 {current + 1}/{pages} 页 · 每页 {PAGE_SIZE} 项</span><Button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</Button></div>
    </>}
  </section>;
}


function ScopedSalesAnalytics({ workspaceId, ledgerId, store, stores, onStoreChange }) {
  const [metric, setMetric] = useState('revenueExact'), [date, setSelected] = useState(null), [hovered, setHovered] = useState(null);
  const [hiddenStores, setHiddenStores] = useState([]);
  const [changing, setChanging] = useState(false), [storeError, setStoreError] = useState('');
  const alive = useRef(true), storeId = useId(), chartRef = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setSelected(null); setHovered(null); setStoreError(''); setChanging(false); setHiddenStores([]); }, [store]);
  const scope = JSON.stringify([workspaceId, ledgerId, store]);
  const result = useLiveQuery(async () => {
    try { return { scope, data: await readLedgerSalesAnalytics({ workspaceId, ledgerId, store }) }; }
    catch (error) { return { scope, error: error.message }; }
  }, [workspaceId, ledgerId, store]);
  const data = result?.scope === scope ? result.data : null;
  const month = useMemo(() => data ? data.chartMonth ?? buildSalesMonth(data, { store }) : null, [data, store]);
  const storeNames = useMemo(() => [...new Map((month?.daily.flatMap(day => day.segments) ?? []).map(segment => [salesStoreKey(segment.store), segment.store])).values()], [month]);
  // Filtering is visual only; totals, percentage denominators and details retain their scope.
  const visibleMonth = useMemo(() => month ? { ...month, daily: month.daily.map(day => ({ ...day, segments: day.segments.filter(segment => !hiddenStores.includes(salesStoreKey(segment.store))) })) } : null, [month, hiddenStores]);
  const scale = useMemo(() => salesScale(visibleMonth ? [visibleMonth] : [], metric), [visibleMonth, metric]);
  const detailScope = JSON.stringify([scope, date]);
  const details = useLiveQuery(async () => {
    if (!date) return null;
    try {
      const rows = data.sourceRows?.filter(row => store === 'all' || salesStoreKey(row.store) === salesStoreKey(store));
      const detail = rows ? aggregateDailySalesDetails(rows, { period: month.period, date }) : await readLedgerDailySalesDetails({ workspaceId, ledgerId, store, date });
      const day = month.daily.find(item => item.date === date);
      if (day?.revenueExact == null) return { scope: detailScope, data: { ...detail, status: 'unknown', availability: day.status, totalsExact: { revenueExact: null, quantityExact: null } } };
      return { scope: detailScope, data: detail };
    } catch (error) { return { scope: detailScope, error: error.message }; }
  }, [workspaceId, ledgerId, store, data, date]);
  function select(nextDate) { setSelected(nextDate); setHovered(null); }
  function close() {
    const previous = date;
    setSelected(null); setHovered(null);
    requestAnimationFrame(() => chartRef.current?.querySelector(`button[aria-label^="${previous}"]`)?.focus({ preventScroll: true }));
  }
  async function changeStore(next) {
    setSelected(null); setStoreError(''); setChanging(true);
    try { await onStoreChange(next); }
    catch (error) { if (alive.current) setStoreError(error.message || '店铺切换失败，请重试。'); }
    finally { if (alive.current) setChanging(false); }
  }
  if (!result || result.scope !== scope) return <Panel>正在读取每日销售...</Panel>;
  if (result.error) return <Panel><p role="alert">{result.error}</p></Panel>;
  return <Panel className="sales-analytics">
    <div className="sales-analytics-heading"><div><h2>每日销售</h2><p>{data.period} · {store === 'all' ? '全部店铺' : store}</p></div><div className="sales-analysis-controls">{onStoreChange ? <label htmlFor={storeId}>店铺<select id={storeId} aria-label="每日销售店铺" value={store} disabled={changing} onChange={event => void changeStore(event.target.value)}><option value="all">全部店铺</option>{stores.map(name => <option key={name}>{name}</option>)}</select></label> : null}<div role="group" aria-label="趋势指标"><Button aria-pressed={metric === 'revenueExact'} onClick={() => setMetric('revenueExact')}>销售额</Button><Button aria-pressed={metric === 'quantityExact'} onClick={() => setMetric('quantityExact')}>销量</Button></div></div></div>
    {changing ? <p role="status">正在切换店铺...</p> : null}{storeError ? <p role="alert">{storeError}</p> : null}
    <div className="sales-month-totals"><p>{month.missingStore ? '该店不存在于本月来源' : month.coverage === 'unknown' ? '销售原额待查 · 销量待查' : <>销售原额 ¥{show(month.monthTotalsExact.revenueExact)} · 销量 {show(month.monthTotalsExact.quantityExact, 6)} 件</>}{month.isCurrent ? ` · 统计截止 ${month.cutoff || '尚无有效日期'}` : ''}</p></div>
    {month.coverage !== 'complete' ? <p role="status">{month.coverage === 'unknown' ? '尚未取得销售数据，空白日期未视为零。' : `${month.unlocated} 条销售记录缺少有效月内添加日期；仅显示已定位记录，空白日期待查。请核对添加时间映射和账本月份。`}</p> : null}
    <div className="sales-store-legend" aria-label="店铺颜色">{storeNames.map(name => <button key={name} type="button" aria-pressed={!hiddenStores.includes(salesStoreKey(name))} onClick={() => setHiddenStores(current => current.includes(salesStoreKey(name)) ? current.filter(key => key !== salesStoreKey(name)) : [...current, salesStoreKey(name)])}><i style={{ background: salesStoreColor(name) }} />{name}</button>)}</div>
    {storeNames.length > 0 && storeNames.every(name => hiddenStores.includes(salesStoreKey(name))) ? <p role="status">店铺柱已全部隐藏，点击图例可重新显示；合计与明细保持原范围。</p> : null}
    <div ref={chartRef} className={`sales-analysis-body${date ? ' has-day' : ''}`}>
      <div className="sales-charts-area">
        <SalesMonthChart month={visibleMonth} sourceMonth={month} metric={metric} scale={scale} selectedDay={date} hovered={hovered} onHover={setHovered} onSelect={select} />
        {hovered ? <div className="sales-day-tooltip"><SalesHoverSummary month={month} date={hovered} metric={metric} hiddenStores={hiddenStores} /></div> : null}
      </div>
      {date ? !details || details.scope !== detailScope ? <section className="sales-day-details" aria-busy="true"><p>正在读取 {date} 商品明细...</p><Button onClick={close}>返回全月</Button></section> : details.error ? <section className="sales-day-details"><p role="alert">{details.error}</p><Button onClick={close}>返回全月</Button></section> : <DailyDetails key={detailScope} data={details.data} close={close} /> : null}
    </div>
  </Panel>;
}
export default function SalesAnalytics({ workspaceId, ledgerId, store = 'all', stores = [], onStoreChange }) {
  return <ScopedSalesAnalytics key={JSON.stringify([workspaceId, ledgerId])} {...{ workspaceId, ledgerId, store, stores, onStoreChange }} />;
}
