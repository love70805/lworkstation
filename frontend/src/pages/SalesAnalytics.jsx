import { buildSalesMonth, salesScale, salesGroupedScale, salesStoreKey, salesStoreColor } from '../domain/salesChartModel';
import { SalesMonthChart, SalesGroupedMonthChart, SalesHoverSummary } from './SalesMonthChart';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel, Button } from '../components/UI';
import { readLedgerSalesAnalytics, readWorkspaceSalesMonths, readLedgerPeriodSalesDetails } from '../data/repositories/salesAnalyticsRepository';
import SalesPeriodDetails, { showSalesValue } from './SalesPeriodDetails';

function ScopedSalesAnalytics({ workspaceId, ledgerId, store, stores, onStoreChange }) {
  const [metric, setMetric] = useState('revenueExact'), [view, setView] = useState('daily');
  const [selection, setSelection] = useState(null), [hovered, setHovered] = useState(null);
  const [hiddenStores, setHiddenStores] = useState([]);
  const [chosenStore, setChosenStore] = useState(null), [listStates, setListStates] = useState({});
  const [changing, setChanging] = useState(false), [storeError, setStoreError] = useState('');
  const alive = useRef(true), storeId = useId(), chartRef = useRef(null), returnPosition = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setSelection(null); setHovered(null); setStoreError(''); setChanging(false);
    setHiddenStores([]); setChosenStore(null); setListStates({});
  }, [store]);
  const scope = JSON.stringify([workspaceId, ledgerId, store]);
  const result = useLiveQuery(async () => {
    try { return { scope, data: await readLedgerSalesAnalytics({ workspaceId, ledgerId, store }) }; }
    catch (error) { return { scope, error: error.message }; }
  }, [workspaceId, ledgerId, store]);
  const monthsResult = useLiveQuery(async () => {
    if (view !== 'monthly') return null;
    try { return { scope, data: await readWorkspaceSalesMonths({ workspaceId, store }) }; }
    catch (error) { return { scope, error: error.message }; }
  }, [workspaceId, ledgerId, store, view]);
  const data = result?.scope === scope ? result.data : null;
  const month = useMemo(() => data ? data.chartMonth ?? buildSalesMonth(data, { store }) : null, [data, store]);
  const months = useMemo(() => monthsResult?.scope === scope && Array.isArray(monthsResult.data)
    ? [...monthsResult.data].sort((a, b) => a.period.localeCompare(b.period) || a.ledgerId.localeCompare(b.ledgerId)) : [], [monthsResult, scope]);
  const chartMonths = view === 'monthly' ? months : month ? [month] : [];
  const storeNames = [...new Map(chartMonths.flatMap(item => item.monthlySegments ?? item.daily.flatMap(day => day.segments)).map(segment => [salesStoreKey(segment.store), segment.store])).values()];
  const visibleMonth = useMemo(() => month ? { ...month, daily: month.daily.map(day => ({ ...day, segments: day.segments.filter(segment => !hiddenStores.includes(salesStoreKey(segment.store))) })) } : null, [month, hiddenStores]);
  const scale = useMemo(() => view === 'monthly' ? salesGroupedScale(months, metric, { monthly: true, hiddenStores }) : salesScale(visibleMonth ? [visibleMonth] : [], metric), [view, months, visibleMonth, metric, hiddenStores]);
  const detailScope = JSON.stringify([scope, selection]);
  const details = useLiveQuery(async () => {
    if (!selection) return null;
    try {
      const detail = await readLedgerPeriodSalesDetails({ workspaceId, ledgerId: selection.ledgerId, store, ...(selection.date ? { date: selection.date } : {}) });
      const selectedMonth = selection.ledgerId === ledgerId ? month : months.find(item => item.ledgerId === selection.ledgerId);
      const day = selection.date ? selectedMonth?.daily.find(item => item.date === selection.date) : null;
      if (day && !['data', 'known_zero'].includes(day.status)) return { scope: detailScope, data: { ...detail, status: 'unknown', availability: day.status, totalsExact: { revenueExact: null, quantityExact: null } } };
      return { scope: detailScope, data: detail };
    } catch (error) { return { scope: detailScope, error: error.message }; }
  }, [workspaceId, ledgerId, store, selection, month, months]);
  function select(next) {
    returnPosition.current = { x: window.scrollX, y: window.scrollY, chartLeft: chartRef.current?.querySelector('.sales-month-plot')?.scrollLeft ?? 0, label: next.date || next.period };
    setSelection(next); setHovered(null);
  }
  function close() {
    setSelection(null); setHovered(null);
    requestAnimationFrame(() => {
      const position = returnPosition.current;
      const button = [...(chartRef.current?.querySelectorAll('button') ?? [])].find(node => node.getAttribute('aria-label')?.startsWith(position?.label));
      button?.focus({ preventScroll: true });
      const plot = chartRef.current?.querySelector('.sales-month-plot');
      if (plot && position) plot.scrollLeft = position.chartLeft;
      if (position) window.scrollTo(position.x, position.y);
    });
  }
  async function changeStore(next) {
    setSelection(null); setStoreError(''); setChanging(true);
    try { await onStoreChange(next); }
    catch (error) { if (alive.current) setStoreError(error.message || '店铺切换失败，请重试。'); }
    finally { if (alive.current) setChanging(false); }
  }
  const periods = selection?.date ? (month?.daily ?? []).map(day => ({ ledgerId, period: month.period, date: day.date }))
    : months.map(item => ({ ledgerId: item.ledgerId, period: item.period }));
  const position = periods.findIndex(item => item.ledgerId === selection?.ledgerId && item.date === selection?.date);
  const listKey = JSON.stringify([selection, chosenStore]);
  function updateList(next) {
    setListStates(current => ({ ...current, [listKey]: { ...current[listKey], ...next } }));
  }
  if (!result || result.scope !== scope) return <Panel>正在读取每日销售...</Panel>;
  if (result.error) return <Panel><p role="alert">{result.error}</p></Panel>;
  return <Panel className="sales-analytics">
    <div className="sales-analytics-heading"><div><h2>销售趋势</h2><p>{view === 'daily' ? `${data.period} · ` : ''}{store === 'all' ? '全部店铺' : store}</p></div><div className="sales-analysis-controls">
      {onStoreChange ? <label htmlFor={storeId}>店铺<select id={storeId} aria-label="每日销售店铺" value={store} disabled={changing} onChange={event => void changeStore(event.target.value)}><option value="all">全部店铺</option>{stores.map(name => <option key={name}>{name}</option>)}</select></label> : null}
      <div role="group" aria-label="趋势周期">{[['daily', '每日'], ['monthly', '月度']].map(([key, label]) => <Button key={key} aria-pressed={view === key} onClick={() => { setView(key); setSelection(null); setHovered(null); }}>{label}</Button>)}</div>
      <div role="group" aria-label="趋势指标"><Button aria-pressed={metric === 'revenueExact'} onClick={() => setMetric('revenueExact')}>销售额</Button><Button aria-pressed={metric === 'quantityExact'} onClick={() => setMetric('quantityExact')}>销量</Button></div>
    </div></div>
    {changing ? <p role="status">正在切换店铺...</p> : null}{storeError ? <p role="alert">{storeError}</p> : null}
    {!selection && view === 'daily' ? <>
      <div className="sales-month-totals"><p>{month.missingStore ? '该店不存在于本月来源' : month.coverage === 'unknown' ? '销售原额待查 · 销量待查' : <>销售原额 ¥{showSalesValue(month.monthTotalsExact.revenueExact)} · 销量 {showSalesValue(month.monthTotalsExact.quantityExact, 6)} 件</>}{month.isCurrent ? ` · 统计截止 ${month.cutoff || '尚无有效日期'}` : ''}</p></div>
      {month.coverage !== 'complete' ? <p role="status">{month.coverage === 'unknown' ? '尚未取得销售数据，空白日期未视为零。' : `${month.unlocated} 条销售记录缺少有效月内添加日期；仅显示已定位记录，空白日期待查。请核对添加时间映射和账本月份。`}</p> : null}
    </> : null}
    {!selection ? <div className="sales-store-legend" aria-label="店铺颜色">{storeNames.map(name => <button key={name} type="button" aria-pressed={!hiddenStores.includes(salesStoreKey(name))} onClick={() => setHiddenStores(current => current.includes(salesStoreKey(name)) ? current.filter(key => key !== salesStoreKey(name)) : [...current, salesStoreKey(name)])}><i style={{ background: salesStoreColor(name) }} />{name}</button>)}</div> : null}
    {!selection && storeNames.length > 0 && storeNames.every(name => hiddenStores.includes(salesStoreKey(name))) ? <p role="status">店铺柱已全部隐藏，点击图例可重新显示；合计与明细保持原范围。</p> : null}
    <div ref={chartRef} className="sales-analysis-body">
      {!selection ? <div className="sales-charts-area">
        {view === 'daily' ? <SalesMonthChart month={visibleMonth} sourceMonth={month} metric={metric} scale={scale} hovered={hovered} onHover={setHovered} onSelect={date => select({ ledgerId, period: month.period, date })} />
          : !monthsResult || monthsResult.scope !== scope ? <p role="status">正在读取月度销售...</p> : monthsResult.error ? <p role="alert">{monthsResult.error}</p> : !months.length ? <p>暂无可用账本月份。</p> : <SalesGroupedMonthChart months={months} metric={metric} scale={scale} hiddenStores={hiddenStores} hovered={hovered} onHover={setHovered} onSelect={item => select({ ledgerId: item.ledgerId, period: item.period })} />}
        {hovered && view === 'daily' ? <div className="sales-day-tooltip"><SalesHoverSummary month={month} date={hovered} metric={metric} hiddenStores={hiddenStores} /></div> : null}
      </div> : !details || details.scope !== detailScope ? <section className="sales-day-details" aria-busy="true"><p>正在读取 {selection.date || selection.period} 商品明细...</p><Button onClick={close}>返回总览</Button></section>
        : details.error ? <section className="sales-day-details"><p role="alert">{details.error}</p><Button onClick={close}>返回总览</Button></section>
          : <SalesPeriodDetails key={listKey} data={details.data} metric={metric} chosenStore={chosenStore} onChooseStore={setChosenStore} state={listStates[listKey]} onStateChange={updateList} close={close} previous={position > 0 ? () => setSelection(periods[position - 1]) : null} next={position >= 0 && position < periods.length - 1 ? () => setSelection(periods[position + 1]) : null} />}
    </div>
  </Panel>;
}
export default function SalesAnalytics({ workspaceId, ledgerId, store = 'all', stores = [], onStoreChange }) {
  return <ScopedSalesAnalytics key={JSON.stringify([workspaceId, ledgerId])} {...{ workspaceId, ledgerId, store, stores, onStoreChange }} />;
}
