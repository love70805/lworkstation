import { buildSalesMonth, salesScale, salesGroupedScale, salesStoreKey, salesStoreColor, salesMonthRange, salesOverviewMonths, assignSalesStoreColors } from '../domain/salesChartModel';
import { SalesMonthChart, SalesGroupedMonthChart, SalesHoverSummary } from './SalesMonthChart';
import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel, Button } from '../components/UI';
import { readLedgerSalesAnalytics, readWorkspaceSalesMonths, readLedgerPeriodSalesDetails } from '../data/repositories/salesAnalyticsRepository';
import Decimal from 'decimal.js';
import SalesPeriodDetails, { showSalesValue } from './SalesPeriodDetails';

const Exact = Decimal.clone({ precision: 80 });
const workspaceColors = new Map();

function ScopedSalesAnalytics({ workspaceId, ledgerId, store, stores, onStoreChange }) {
  const [metric, setMetric] = useState('revenueExact'), [view, setView] = useState('daily');
  const [selection, setSelection] = useState(null), [hovered, setHovered] = useState(null);
  const [monthMode, setMonthMode] = useState('overview'), [rangeLength, setRangeLength] = useState(12), [rangeEnd, setRangeEnd] = useState(null), [chartOffset, setChartOffset] = useState(0);
  if (!workspaceColors.has(workspaceId)) workspaceColors.set(workspaceId, new Map());
  const colorAssignments = useRef(workspaceColors.get(workspaceId));
  const positions = useRef(new Map()), pendingRestore = useRef(null);
  const [hiddenStores, setHiddenStores] = useState([]);
  const [chosenStore, setChosenStore] = useState(null), [listStates, setListStates] = useState({});
  const [changing, setChanging] = useState(false), [storeError, setStoreError] = useState('');
  const alive = useRef(true), storeId = useId(), chartRef = useRef(null);
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
  const rangeMonths = useMemo(() => salesMonthRange(months, rangeLength, rangeEnd ?? months.at(-1)?.period), [months, rangeLength, rangeEnd]);
  const plottedMonths = useMemo(() => monthMode === 'overview' ? salesOverviewMonths(rangeMonths) : rangeMonths, [rangeMonths, monthMode]);
  const chartMonths = view === 'monthly' ? months : month ? [month] : [];
  const storeNames = [...new Map(chartMonths.flatMap(item => item.monthlySegments ?? item.daily.flatMap(day => day.segments)).map(segment => [salesStoreKey(segment.store), segment.store])).values()];
  const visibleMonth = useMemo(() => month ? { ...month, daily: month.daily.map(day => ({ ...day, segments: day.segments.filter(segment => !hiddenStores.includes(salesStoreKey(segment.store))) })) } : null, [month, hiddenStores]);
  const scale = useMemo(() => view === 'monthly' ? salesGroupedScale(plottedMonths, metric, { monthly: true, hiddenStores: monthMode === 'overview' ? [] : hiddenStores }) : salesScale(visibleMonth ? [visibleMonth] : [], metric), [view, plottedMonths, monthMode, visibleMonth, metric, hiddenStores]);
  const detailScope = JSON.stringify([scope, selection]);
  const details = useLiveQuery(async () => {
    if (!selection) return null;
    if (selection.ledgerId.startsWith('missing:')) return { scope: detailScope, data: { period: selection.period, status: 'unknown', totalsExact: { revenueExact: null, quantityExact: null }, stores: [], rows: [] } };
    try {
      const detail = await readLedgerPeriodSalesDetails({ workspaceId, ledgerId: selection.ledgerId, store, ...(selection.date ? { date: selection.date } : {}) });
      const selectedMonth = selection.ledgerId === ledgerId ? month : months.find(item => item.ledgerId === selection.ledgerId);
      const day = selection.date ? selectedMonth?.daily.find(item => item.date === selection.date) : null;
      if (day && !['data', 'known_zero'].includes(day.status)) return { scope: detailScope, data: { ...detail, status: 'unknown', availability: day.status, totalsExact: { revenueExact: null, quantityExact: null } } };
      return { scope: detailScope, data: detail };
    } catch (error) { return { scope: detailScope, error: error.message }; }
  }, [workspaceId, ledgerId, store, selection, month, months]);
  const contextKey = selection ? JSON.stringify([selection.ledgerId, selection.date, chosenStore, selection.storeKeys]) : 'trend';
  function remember() {
    const nodes = [];
    for (let node = chartRef.current; node; node = node.parentElement) nodes.push({ node, top: node.scrollTop, left: node.scrollLeft });
    const focus = document.activeElement;
    positions.current.set(contextKey, { x: window.scrollX, y: window.scrollY, nodes, focusLabel: focus?.getAttribute('aria-label'), storeKey: focus?.getAttribute('data-store-key') });
  }
  function restore(key) { pendingRestore.current = key; }
  useLayoutEffect(() => {
    if (pendingRestore.current !== contextKey || (selection && details?.scope !== detailScope)) return;
    const position = positions.current.get(contextKey);
    pendingRestore.current = null;
    if (!position) return;
    const frame = requestAnimationFrame(() => {
      const candidates = [...(chartRef.current?.querySelectorAll('button, [role="button"]') ?? [])];
      const focus = candidates.find(node => position.storeKey ? node.getAttribute('data-store-key') === position.storeKey : position.focusLabel && node.getAttribute('aria-label') === position.focusLabel);
      focus?.focus({ preventScroll: true });
      for (const item of position.nodes) if (item.node.isConnected) { item.node.scrollTop = item.top; item.node.scrollLeft = item.left; }
      window.scrollTo(position.x, position.y);
    });
    return () => cancelAnimationFrame(frame);
  }, [contextKey, details, detailScope, selection]);
  function select(next) {
    remember(); setChosenStore(null); setSelection(next); setHovered(null);
    restore(JSON.stringify([next.ledgerId, next.date, null, next.storeKeys]));
  }
  function close() {
    remember(); setSelection(null); setChosenStore(null); setHovered(null); restore('trend');
  }
  function chooseStore(next) {
    remember(); setChosenStore(next); restore(JSON.stringify([selection.ledgerId, selection.date, next, selection.storeKeys]));
  }
  function changePeriod(next) {
    remember(); setSelection(next); restore(JSON.stringify([next.ledgerId, next.date, chosenStore, next.storeKeys]));
  }
  async function changeStore(next) {
    setSelection(null); setStoreError(''); setChanging(true);
    try { await onStoreChange(next); }
    catch (error) { if (alive.current) setStoreError(error.message || '店铺切换失败，请重试。'); }
    finally { if (alive.current) setChanging(false); }
  }
  const periods = selection?.date ? (month?.daily ?? []).map(day => ({ ledgerId, period: month.period, date: day.date }))
    : rangeMonths.map(item => ({ ledgerId: item.ledgerId, period: item.period, ...(selection?.storeKeys ? { storeKeys: selection.storeKeys } : {}) }));
  const position = periods.findIndex(item => item.ledgerId === selection?.ledgerId && item.date === selection?.date);
  const listKey = contextKey;
  function updateList(next) {
    setListStates(current => ({ ...current, [listKey]: { ...current[listKey], ...next } }));
  }
  const scopedDetail = useMemo(() => {
    const detail = details?.scope === detailScope ? details.data : null;
    if (!detail || !selection?.storeKeys) return detail;
    const keys = new Set(selection.storeKeys);
    const selected = detail.stores.filter(item => keys.has(salesStoreKey(item.store)));
    const totalsExact = selected.reduce((sum, item) => {
      for (const key of ['revenueExact', 'quantityExact']) sum[key] = new Exact(sum[key]).plus(item[key] ?? 0).toFixed();
      return sum;
    }, { revenueExact: '0', quantityExact: '0' });
    return { ...detail, stores: selected, rows: detail.rows.filter(item => keys.has(salesStoreKey(item.store))), totalsExact: detail.status === 'unknown' ? detail.totalsExact : totalsExact, periodTotalsExact: detail.totalsExact, hasStoreSelection: true, emptySelection: !keys.size, missingSelectedStores: keys.size - selected.length };
  }, [details, detailScope, selection]);
  const comparisonTotals = rangeMonths.reduce((sum, item) => {
    for (const segment of item.monthlySegments ?? []) {
      if (hiddenStores.includes(salesStoreKey(segment.store))) continue;
      for (const key of ['revenueExact', 'quantityExact']) sum[key] = new Exact(sum[key]).plus(segment[key] ?? 0).toFixed();
    }
    return sum;
  }, { revenueExact: '0', quantityExact: '0' });
  const periodTotals = rangeMonths.reduce((sum, item) => {
    if (item.coverage === 'unknown' || item.missingStore) { sum.missing++; return sum; }
    for (const key of ['revenueExact', 'quantityExact']) sum[key] = new Exact(sum[key]).plus(item.monthTotalsExact[key] ?? 0).toFixed();
    return sum;
  }, { revenueExact: '0', quantityExact: '0', missing: 0 });
  if (!result || result.scope !== scope) return <Panel>正在读取每日销售...</Panel>;
  if (result.error) return <Panel><p role="alert">{result.error}</p></Panel>;
  return <Panel className="sales-analytics" style={assignSalesStoreColors([...storeNames, ...stores], colorAssignments.current)}>
    <div className="sales-analytics-heading"><div><h2>销售趋势</h2><p>台账 · {view === 'daily' ? `${data.period} · ` : ''}{store === 'all' ? '全部店铺' : store}</p></div><div className="sales-analysis-controls">
      {onStoreChange ? <label htmlFor={storeId}>店铺<select id={storeId} aria-label="每日销售店铺" value={store} disabled={changing} onChange={event => void changeStore(event.target.value)}><option value="all">全部店铺</option>{stores.map(name => <option key={name}>{name}</option>)}</select></label> : null}
      <div role="group" aria-label="趋势周期">{[['daily', '每日'], ['monthly', '月度']].map(([key, label]) => <Button key={key} aria-pressed={view === key} onClick={() => { setView(key); setSelection(null); setHovered(null); }}>{label}</Button>)}</div>
      <div role="group" aria-label="趋势指标"><Button aria-pressed={metric === 'revenueExact'} onClick={() => setMetric('revenueExact')}>销售额</Button><Button aria-pressed={metric === 'quantityExact'} onClick={() => setMetric('quantityExact')}>销量</Button></div>
    </div></div>
    {changing ? <p role="status">正在切换店铺...</p> : null}{storeError ? <p role="alert">{storeError}</p> : null}
    {!selection && view === 'daily' ? <>
      <div className="sales-month-totals"><p>{month.missingStore ? '该店不存在于本月来源' : month.coverage === 'unknown' ? '销售原额待查 · 销量待查' : <>销售原额 ¥{showSalesValue(month.monthTotalsExact.revenueExact)} · 销量 {showSalesValue(month.monthTotalsExact.quantityExact, 6)} 件</>}{month.isCurrent ? ` · 统计截止 ${month.cutoff || '尚无有效日期'}` : ''}</p></div>
      {month.coverage !== 'complete' ? <p role="status">{month.coverage === 'unknown' ? '尚未取得销售数据，空白日期未视为零。' : `${month.unlocated} 条销售记录缺少有效月内添加日期；仅显示已定位记录，空白日期待查。请核对添加时间映射和账本月份。`}</p> : null}
    </> : null}
    {!selection && view === 'monthly' ? <div className="sales-month-controls">
      <div role="group" aria-label="月度模式"><Button aria-pressed={monthMode === 'overview'} onClick={() => { setMonthMode('overview'); setChartOffset(0); }}>月度总览</Button><Button aria-pressed={monthMode === 'comparison'} onClick={() => { setMonthMode('comparison'); setChartOffset(0); }}>店铺对比</Button></div>
      <label>期间<select aria-label="月份范围" value={rangeLength} onChange={event => { setRangeLength(Number(event.target.value)); setRangeEnd(current => current ?? months.at(-1)?.period); setChartOffset(0); }}>{[3,6,12].map(count => <option key={count} value={count}>近 {count} 个月</option>)}</select></label>
      <label>截止月份<select aria-label="截止月份" value={rangeEnd ?? months.at(-1)?.period ?? ''} onChange={event => { setRangeEnd(event.target.value); setChartOffset(0); }}>{months.map(item => <option key={item.ledgerId} value={item.period}>{item.period}</option>)}</select></label>
      <p>{store === 'all' ? '全部店铺' : store}期间合计 · 销售原额 ¥{showSalesValue(periodTotals.missing === rangeMonths.length ? null : periodTotals.revenueExact)} · 销量 {showSalesValue(periodTotals.missing === rangeMonths.length ? null : periodTotals.quantityExact, 6)} 件{periodTotals.missing ? ' · ' + periodTotals.missing + ' 个月缺数据，合计仅含已知月份' : ''}</p>
      {monthMode === 'comparison' ? <p>所选店铺期间合计 · {storeNames.every(name => hiddenStores.includes(salesStoreKey(name))) ? '未选择店铺' : <>销售原额 ¥{showSalesValue(comparisonTotals.revenueExact)} · 销量 {showSalesValue(comparisonTotals.quantityExact, 6)} 件 · 仅含已有来源</>}</p> : null}
    </div> : null}
    {!selection && (view === 'daily' || monthMode === 'comparison') ? <div className="sales-store-selection-actions"><Button onClick={() => setHiddenStores([])}>全选店铺</Button><Button onClick={() => setHiddenStores(storeNames.map(salesStoreKey))}>清空店铺</Button></div> : null}
    {!selection && (view === 'daily' || monthMode === 'comparison') ? <div className="sales-store-legend" aria-label="店铺颜色">{storeNames.map(name => {
      const checked = !hiddenStores.includes(salesStoreKey(name));
      const toggle = () => setHiddenStores(current => checked ? [...current, salesStoreKey(name)] : current.filter(key => key !== salesStoreKey(name)));
      return view === 'monthly' ? <label key={name}><input type="checkbox" checked={checked} onChange={toggle} /><i style={{ background: salesStoreColor(name) }} />{name}</label> : <button key={name} type="button" aria-pressed={checked} onClick={toggle}><i style={{ background: salesStoreColor(name) }} />{name}</button>;
    })}</div> : null}
    {!selection && (view === 'daily' || monthMode === 'comparison') && storeNames.length > 0 && storeNames.every(name => hiddenStores.includes(salesStoreKey(name))) ? <p role="status">{view === 'monthly' ? '未选择店铺，可勾选或全选店铺继续；全部店铺期间合计保留，所选明细为空。' : '店铺柱已全部隐藏，点击图例可重新显示；合计与明细保持原范围。'}</p> : null}
    <div ref={chartRef} className="sales-analysis-body">
      {!selection ? <div className="sales-charts-area">
        {view === 'daily' ? <SalesMonthChart month={visibleMonth} sourceMonth={month} metric={metric} scale={scale} hovered={hovered} onHover={setHovered} onSelect={date => select({ ledgerId, period: month.period, date })} />
          : !monthsResult || monthsResult.scope !== scope ? <p role="status">正在读取月度销售...</p> : monthsResult.error ? <p role="alert">{monthsResult.error}</p> : !months.length ? <p>暂无可用账本月份。</p> : <SalesGroupedMonthChart mode={monthMode} offset={chartOffset} onOffsetChange={setChartOffset} months={plottedMonths} metric={metric} scale={scale} hiddenStores={monthMode === 'overview' ? [] : hiddenStores} hovered={hovered} onHover={setHovered} onSelect={item => select({ ledgerId: item.ledgerId, period: item.period, ...(monthMode === 'comparison' ? { storeKeys: storeNames.map(salesStoreKey).filter(key => !hiddenStores.includes(key)) } : {}) })} />}
        {hovered && view === 'daily' ? <div className="sales-day-tooltip"><SalesHoverSummary month={month} date={hovered} metric={metric} hiddenStores={hiddenStores} /></div> : null}
      </div> : !details || details.scope !== detailScope ? <section className="sales-day-details sales-details-loading" aria-busy="true"><p role="status">正在读取 {selection.date || selection.period} {chosenStore ? '商品' : '店铺'}明细...</p><div className="sales-period-navigation"><Button aria-label={selection.date ? '上一日' : '上一月'} disabled={position <= 0} onClick={() => changePeriod(periods[position - 1])}>上一期</Button><select aria-label={selection.date ? '选择日期' : '选择月份'} value={selection.date || selection.period} onChange={event => changePeriod(periods.find(item => (item.date || item.period) === event.target.value))}>{periods.map(item => <option key={item.date || item.period} value={item.date || item.period}>{item.date || item.period}</option>)}</select><Button aria-label={selection.date ? '下一日' : '下一月'} disabled={position < 0 || position >= periods.length - 1} onClick={() => changePeriod(periods[position + 1])}>下一期</Button><Button onClick={close}>返回趋势</Button></div></section>
        : details.error ? <section className="sales-day-details"><p role="alert">{details.error}</p><Button onClick={close}>返回趋势</Button></section>
          : <SalesPeriodDetails key={listKey} data={scopedDetail} metric={metric} chosenStore={chosenStore} onChooseStore={chooseStore} state={listStates[listKey]} onStateChange={updateList} close={close} periods={periods} onPeriodChange={value => changePeriod(periods.find(item => (item.date || item.period) === value))} previous={position > 0 ? () => changePeriod(periods[position - 1]) : null} next={position >= 0 && position < periods.length - 1 ? () => changePeriod(periods[position + 1]) : null} />}
    </div>
  </Panel>;
}
export default function SalesAnalytics({ workspaceId, ledgerId, store = 'all', stores = [], onStoreChange }) {
  return <ScopedSalesAnalytics key={JSON.stringify([workspaceId, ledgerId])} {...{ workspaceId, ledgerId, store, stores, onStoreChange }} />;
}
