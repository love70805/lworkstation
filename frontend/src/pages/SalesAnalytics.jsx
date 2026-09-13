import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Decimal from "decimal.js";
import { Panel, Button } from "../components/UI";
import { readLedgerSalesAnalytics, readLedgerDailySalesDetails } from "../data/repositories/salesAnalyticsRepository";
import { activityName, shortActivityName } from "./salesActivitySummary";

const show = (value, digits = 2) => value == null ? "待查" : new Decimal(value).toDecimalPlaces(digits, Decimal.ROUND_DOWN).toFixed();
const pair = day => `销售原额 ${day?.revenueExact == null ? "待查" : `¥${new Decimal(day.revenueExact).toFixed()}`} · 销量 ${day?.quantityExact == null ? "待查" : `${new Decimal(day.quantityExact).toFixed()} 件`}`;
const PAGE_SIZE = 12;

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
  const searchId = useId(), sortId = useId();
  const filtered = useMemo(() => {
    const search = query.trim().normalize("NFKC").toLocaleLowerCase();
    return data.rows.filter(row => [...(row.platformSkcs ?? []), row.platformSku, row.store, ...row.attributes].some(value => String(value).normalize("NFKC").toLocaleLowerCase().includes(search)))
      .toSorted((a, b) => new Decimal(b[sort]).cmp(a[sort]) || a.key.localeCompare(b.key));
  }, [data.rows, query, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  return <section className="sales-day-details" aria-label={`${data.date} 商品明细`} onKeyDown={event => { if (event.key === "Escape") close(); }}>
    <div className="sales-details-heading"><div><h3>{data.date} 商品明细</h3><p>{pair(data.totalsExact)}</p></div><Button onClick={close}>返回全月</Button></div>
    {data.status === "unknown" ? <p role="status">当天数据待查；尚有未定位到日期的记录或未取得销售来源，空白未按零计算。</p> : data.status === "known_zero" ? <p>当天已知销售额与销量为 0，无商品记录。</p> : <>
      {data.unlocatedCount ? <p role="status">仅含已定位到当天的记录；另有 {data.unlocatedCount} 条未定位记录待查。</p> : null}
      <div className="sales-details-controls"><label htmlFor={searchId}>查找商品<input id={searchId} value={query} placeholder="SKC、店铺或属性" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><label htmlFor={sortId}>排序<select id={sortId} value={sort} onChange={event => { setSort(event.target.value); setPage(0); }}><option value="revenueExact">销售额从高到低</option><option value="quantityExact">销量从高到低</option></select></label></div>
      <p className="sales-list-scope">{query.trim() ? "搜索结果" : "当天全部商品"} {filtered.length}/{data.rows.length} 项 · 当日合计不随搜索变化</p>
      <div className="sales-day-table"><table><thead><tr><th>SKC / 店铺</th><th>销量</th><th>销售原额</th><th>均价</th></tr></thead><tbody>{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <tr key={row.key}><td><strong>{row.platformSkcs?.join("、") || "SKC 待补充"}</strong><small>{row.store} · {row.attributes.join("、") || "属性待查"}</small><ActivityDetails key={row.key} row={row} /></td><td>{show(row.quantityExact, 6)}</td><td>¥{show(row.revenueExact)}</td><td title={row.averagePriceExact ?? "待查"}>{show(row.averagePriceExact)}</td></tr>)}</tbody></table></div>
      {!filtered.length ? <p>没有匹配的当天商品。</p> : null}
      <div className="sales-pagination"><Button disabled={!current} onClick={() => setPage(current - 1)}>上一页</Button><span>第 {current + 1}/{pages} 页 · 每页 {PAGE_SIZE} 项</span><Button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</Button></div>
    </>}
  </section>;
}

function DailyChart({ data, metric, selected, select }) {
  const [hovered, setHovered] = useState(null);
  const chartId = useId();
  const days = useMemo(() => {
    const [year, month] = data.period.split("-").map(Number), count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const byDate = new Map(data.daily.map(day => [day.date, day]));
    return Array.from({ length: count }, (_, index) => {
      const date = `${data.period}-${String(index + 1).padStart(2, "0")}`;
      return byDate.get(date) ?? { date, revenueExact: data.coverage.status === "complete" ? "0" : null, quantityExact: data.coverage.status === "complete" ? "0" : null };
    });
  }, [data]);
  const coordinates = days.map(day => Number(day[metric] ?? 0));
  const max = Math.max(0, ...coordinates), min = Math.min(0, ...coordinates), range = max - min || 1;
  const zero = (max || !min ? max || 1 : 0) / range * 100;
  const active = days.find(day => day.date === (hovered ?? selected));
  return <div className="sales-chart-panel">
    <div className="sales-hover-summary" id={chartId}>{active ? <><strong>{active.date}</strong><span>{pair(active)}</span></> : <span>悬停或聚焦查看双值，点击日期查看当天商品</span>}</div>
    <div className="sales-daily-chart" aria-label={metric === "revenueExact" ? "每日销售额" : "每日销量"}>
      <div className="sales-chart-axis" aria-hidden="true">{zero > 12 ? <span>{Number((max || 1).toPrecision(3))}</span> : null}<span style={{ top: `${zero}%` }}>0</span>{min < 0 && zero < 88 ? <span className="sales-axis-min">{Number(min.toPrecision(3))}</span> : null}</div>
      <div className="sales-chart-plot"><div className="sales-zero-line" style={{ top: `${zero}%` }} aria-hidden="true" />
        <div className="sales-chart-bars">{days.map((day, index) => {
          const value = coordinates[index], height = Math.abs(value) / range * 100;
          return <button type="button" className={`sales-daily-bar${selected === day.date ? " is-selected" : ""}`} key={day.date} aria-label={`${day.date}：${pair(day)}`} aria-describedby={chartId} aria-pressed={selected === day.date} onMouseEnter={() => setHovered(day.date)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(day.date)} onBlur={() => setHovered(null)} onClick={() => select(day.date)} onKeyDown={event => { if (event.key === "Escape") { select(null); setHovered(null); } }}>
            {day[metric] == null ? <span className="sales-unknown-mark" style={{ top: `${Math.min(zero, 96)}%` }}>·</span> : <span className={`sales-bar-fill${value < 0 ? " is-negative" : ""}${value === 0 ? " is-zero" : ""}`} style={{ top: `${value > 0 ? zero - height : zero}%`, height: value === 0 ? "2px" : `${height}%` }} />}
            <small className={(index % 5 === 0 || index === days.length - 1) ? "sales-date-major" : ""}>{day.date.slice(8)}</small>
          </button>;
        })}</div>
      </div>
    </div>
    <p className="sales-chart-note">{data.period} · {metric === "revenueExact" ? "单位：元" : "单位：件"}{data.coverage.status !== "complete" ? " · 点标记为空白待查日期" : ""}</p>
  </div>;
}

function ScopedSalesAnalytics({ workspaceId, ledgerId, store, stores, onStoreChange }) {
  const [metric, setMetric] = useState("revenueExact"), [selected, setSelected] = useState(null);
  const [changing, setChanging] = useState(false), [storeError, setStoreError] = useState("");
  const alive = useRef(true), storeId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scope = JSON.stringify([workspaceId, ledgerId, store]);
  const result = useLiveQuery(async () => {
    try { return { scope, data: await readLedgerSalesAnalytics({ workspaceId, ledgerId, store }) }; }
    catch (error) { return { scope, error: error.message }; }
  }, [workspaceId, ledgerId, store]);
  const period = result?.scope === scope ? result.data?.period : null;
  const date = selected?.period === period ? selected.date : null;
  const detailScope = JSON.stringify([scope, period, date]);
  const details = useLiveQuery(async () => {
    if (!date) return null;
    try { return { scope: detailScope, data: await readLedgerDailySalesDetails({ workspaceId, ledgerId, store, date }) }; }
    catch (error) { return { scope: detailScope, error: error.message }; }
  }, [workspaceId, ledgerId, store, period, date]);
  async function changeStore(next) {
    setSelected(null); setStoreError(""); setChanging(true);
    try { await onStoreChange(next); }
    catch (error) { if (alive.current) setStoreError(error.message || "店铺切换失败，请重试。"); }
    finally { if (alive.current) setChanging(false); }
  }
  if (!result || result.scope !== scope) return <Panel>正在读取每日销售...</Panel>;
  if (result.error) return <Panel><p role="alert">{result.error}</p></Panel>;
  const { data } = result;
  return <Panel className="sales-analytics">
    <div className="sales-analytics-heading"><div><h2>每日销售</h2><p>{data.period} · {store === "all" ? "全部店铺" : store} · 按台账添加时间</p></div><div className="sales-analysis-controls">{onStoreChange ? <label htmlFor={storeId}>店铺<select id={storeId} aria-label="每日销售店铺" value={store} disabled={changing} onChange={event => void changeStore(event.target.value)}><option value="all">全部店铺</option>{stores.map(name => <option key={name}>{name}</option>)}</select></label> : null}<div role="group" aria-label="趋势指标"><Button aria-pressed={metric === "revenueExact"} onClick={() => setMetric("revenueExact")}>销售额</Button><Button aria-pressed={metric === "quantityExact"} onClick={() => setMetric("quantityExact")}>销量</Button></div></div></div>
    {changing ? <p role="status">正在切换店铺...</p> : null}{storeError ? <p role="alert">{storeError}</p> : null}
    <p>{data.coverage.status === "unknown" ? "销售原额待查 · 销量待查" : <>销售原额 ¥{show(data.monthTotalsExact.revenueExact)} · 销量 {show(data.monthTotalsExact.quantityExact, 6)} 件</>}</p>
    {data.coverage.status !== "complete" ? <p role="status">{data.coverage.status === "unknown" ? "尚未取得销售数据，空白日期未视为零。" : `${data.undated.count} 条销售记录缺少有效月内添加日期（含 ${data.outOfPeriod.count} 条超月），金额 ¥${show(data.undated.revenueExact)}、销量 ${show(data.undated.quantityExact, 6)} 件未定位到日期。请核对添加时间映射和账本月份，再重新导入；空白日期待查。`}</p> : null}
    <div className={`sales-analysis-body${date ? " has-day" : ""}`}>
      <DailyChart key={period} data={data} metric={metric} selected={date} select={next => setSelected(next ? { period, date: next } : null)} />
      {date ? !details || details.scope !== detailScope ? <section className="sales-day-details" aria-busy="true"><p>正在读取 {date} 商品明细...</p><Button onClick={() => setSelected(null)}>返回全月</Button></section> : details.error ? <section className="sales-day-details"><p role="alert">{details.error}</p><Button onClick={() => setSelected(null)}>返回全月</Button></section> : <DailyDetails key={detailScope} data={details.data} close={() => setSelected(null)} /> : null}
    </div>
  </Panel>;
}

export default function SalesAnalytics({ workspaceId, ledgerId, store = "all", stores = [], onStoreChange }) {
  return <ScopedSalesAnalytics key={JSON.stringify([workspaceId, ledgerId, store])} {...{ workspaceId, ledgerId, store, stores, onStoreChange }} />;
}
