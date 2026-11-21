import { buildSalesMonth, salesScale, salesGroupedScale, salesStoreKey, salesStoreColor, salesMonthRange, salesOverviewMonths, assignSalesStoreColors } from '../domain/salesChartModel';
import { SalesMonthChart, SalesGroupedMonthChart, SalesHoverSummary } from './SalesMonthChart';
import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Panel, Button } from '../components/UI';
import { readLedgerSalesAnalytics, readWorkspaceSalesMonths, readLedgerPeriodSalesDetails } from '../data/repositories/salesAnalyticsRepository';
import { readSalesProfitAnalysis } from '../data/repositories/salesProfitAnalysisRepository';
import { readSalesCatalogLinks } from '../data/repositories/selectionRepository';
import Decimal from 'decimal.js';
import SalesPeriodDetails, { showSalesValue } from './SalesPeriodDetails';
import { combinedProfit, withChartProfit, withDetailProfit } from '../domain/salesProfitAnalysis';

const Exact = Decimal.clone({ precision: 80 });
const workspaceColors = new Map();
const detailKey = (period, storeKey, productView = 'skc') => JSON.stringify([period.ledgerId, period.date, storeKey, period.storeKeys, storeKey ? productView : null]);

function storeTotals(rows) {
  if (!rows.length) return { revenueExact: null, quantityExact: null, profitExact: null };
  const sum = key => rows.reduce((total, row) => total.plus(row[key] ?? 0), new Exact(0)).toFixed();
  return { revenueExact: sum('revenueExact'), quantityExact: sum('quantityExact'), profitExact: combinedProfit(rows) };
}

function filterChartMonth(month, hidden, includeDays) {
  if (!month || !hidden.length || month.missingLedger || month.missingStore) return month;
  const visible = row => !hidden.includes(salesStoreKey(row.store));
  const segments = (month.monthlySegments ?? []).filter(visible);
  return { ...month, monthlySegments: segments, monthTotalsExact: storeTotals(segments),
    daily: includeDays ? month.daily.map(day => {
      if (day.status !== 'data') return day;
      const selected = day.segments.filter(visible);
      return { ...day, ...storeTotals(selected), segments: selected, status: selected.length ? 'data' : 'absent_store' };
    }) : month.daily,
  };
}

function ScopedSalesAnalytics({ workspaceId, ledgerId, store, stores, onStoreChange, onOpenProduct }) {
  const [showQuantity, setShowQuantity] = useState(false), [view, setView] = useState('daily');
  const [selection, setSelection] = useState(null), [hovered, setHovered] = useState(null);
  const [monthMode, setMonthMode] = useState('overview'), [rangeLength, setRangeLength] = useState(12), [rangeEnd, setRangeEnd] = useState(null), [chartOffset, setChartOffset] = useState(0);
  if (!workspaceColors.has(workspaceId)) workspaceColors.set(workspaceId, new Map());
  const colorAssignments = useRef(workspaceColors.get(workspaceId));
  const positions = useRef(new Map()), pendingRestore = useRef(null);
  const [hiddenStores, setHiddenStores] = useState([]);
  const [listStore, setListStore] = useState(null), [listStates, setListStates] = useState({});
  const [productView, setProductView] = useState('skc');
  const chosenStore = selection?.directStore ?? listStore;
  const [changing, setChanging] = useState(false), [storeError, setStoreError] = useState('');
  const alive = useRef(true), storeId = useId(), chartRef = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setSelection(null); setHovered(null); setStoreError(''); setChanging(false);
    setHiddenStores([]); setListStore(null); setListStates({});
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
  const salesMonth = useMemo(() => data ? data.chartMonth ?? buildSalesMonth(data, { store }) : null, [data, store]);
  const months = useMemo(() => monthsResult?.scope === scope && Array.isArray(monthsResult.data)
    ? [...monthsResult.data].sort((a, b) => a.period.localeCompare(b.period) || a.ledgerId.localeCompare(b.ledgerId)) : [], [monthsResult, scope]);
  const salesRange = useMemo(() => salesMonthRange(months, rangeLength, rangeEnd ?? months.at(-1)?.period), [months, rangeLength, rangeEnd]);
  const daily = view === 'daily';
  const requestedIds = JSON.stringify(daily ? [ledgerId] : salesRange.filter(item => !item.missingLedger).map(item => item.ledgerId));
  const profitScope = JSON.stringify([scope, daily, requestedIds]);
  const profitResult = useLiveQuery(async () => {
    if (!data) return null;
    const byLedger = {}, errors = {};
    for (const id of JSON.parse(requestedIds)) {
      try { byLedger[id] = await readSalesProfitAnalysis({ workspaceId, ledgerId: id, store, daily }); }
      catch (error) { errors[id] = error.message; }
    }
    return { scope: profitScope, byLedger, errors };
  }, [profitScope, Boolean(data)]);
  const profitData = profitResult?.scope === profitScope ? profitResult : null;
  const month = useMemo(() => salesMonth && withChartProfit(salesMonth, profitData?.byLedger[ledgerId]), [salesMonth, profitData, ledgerId]);
  const rangeMonths = useMemo(() => salesRange.map(item => withChartProfit(item, profitData?.byLedger[item.ledgerId])), [salesRange, profitData]);
  const actualMonths = daily ? (month ? [month] : []) : rangeMonths.filter(item => !item.missingLedger && !item.missingStore);
  const plottedMonths = useMemo(() => monthMode === 'overview' ? salesOverviewMonths(rangeMonths) : rangeMonths.map(item => filterChartMonth(item, hiddenStores, false)), [rangeMonths, monthMode, hiddenStores]);
  const chartMonths = view === 'monthly' ? rangeMonths : month ? [month] : [];
  const storeNames = [...new Map(chartMonths.flatMap(item => item.monthlySegments ?? item.daily.flatMap(day => day.segments)).map(segment => [salesStoreKey(segment.store), segment.store])).values()];
  const visibleStoreKeys = storeNames.map(salesStoreKey).filter(key => !hiddenStores.includes(key));
  const usesStoreSelection = daily || monthMode === 'comparison';
  const noStores = usesStoreSelection && storeNames.length > 0 && !visibleStoreKeys.length;
  const narrowed = usesStoreSelection && visibleStoreKeys.length < storeNames.length;
  const detailScope = JSON.stringify([scope, selection]);
  const needCatalog = Boolean(selection && onOpenProduct);
  const catalog = useLiveQuery(() => needCatalog ? readSalesCatalogLinks(workspaceId).catch(() => null) : null, [workspaceId, needCatalog]);
  const details = useLiveQuery(async () => {
    if (!selection) return null;
    if (selection.ledgerId.startsWith('missing:')) return { scope: detailScope, data: { period: selection.period, status: 'unknown', totalsExact: { revenueExact: null, quantityExact: null }, stores: [], rows: [] } };
    try {
      const detail = await readLedgerPeriodSalesDetails({ workspaceId, ledgerId: selection.ledgerId, store, ...(selection.date ? { date: selection.date } : {}) });
      const selectedMonth = selection.ledgerId === ledgerId ? salesMonth : months.find(item => item.ledgerId === selection.ledgerId);
      const day = selection.date ? selectedMonth?.daily.find(item => item.date === selection.date) : null;
      if (day && !['data', 'known_zero'].includes(day.status)) return { scope: detailScope, data: { ...detail, status: 'unknown', availability: day.status, totalsExact: { revenueExact: null, quantityExact: null } } };
      return { scope: detailScope, data: detail };
    } catch (error) { return { scope: detailScope, error: error.message }; }
  }, [workspaceId, ledgerId, store, selection, salesMonth, months]);
  const contextKey = selection ? detailKey(selection, chosenStore, productView) : 'trend';
  function remember() {
    const nodes = [];
    for (let node = chartRef.current; node; node = node.parentElement) nodes.push({ node, top: node.scrollTop, left: node.scrollLeft });
    const focus = document.activeElement;
    positions.current.set(contextKey, { x: window.scrollX, y: window.scrollY, nodes, focusLabel: focus?.getAttribute('aria-label'), storeKey: focus?.getAttribute('data-store-key'), date: focus?.getAttribute('data-date') });
  }
  function restore(key) { pendingRestore.current = key; }
  const detailReady = !selection || details?.scope === detailScope;
  useLayoutEffect(() => {
    if (pendingRestore.current !== contextKey || !detailReady) return;
    const position = positions.current.get(contextKey);
    if (!position) { pendingRestore.current = null; return; }
    const frame = requestAnimationFrame(() => {
      pendingRestore.current = null;
      const candidates = [...(chartRef.current?.querySelectorAll('button, [role="button"]') ?? [])];
      const focus = candidates.find(node => (position.date && node.getAttribute('data-date') === position.date)
        || (position.storeKey && node.getAttribute('data-store-key') === position.storeKey)
        || (position.focusLabel && node.getAttribute('aria-label') === position.focusLabel));
      focus?.focus({ preventScroll: true });
      for (const item of position.nodes) if (item.node.isConnected) { item.node.scrollTop = item.top; item.node.scrollLeft = item.left; }
      window.scrollTo(position.x, position.y);
    });
    return () => cancelAnimationFrame(frame);
  }, [contextKey, detailReady]);
  function select(next) {
    remember(); setListStore(null); setProductView('skc'); setSelection(next); setHovered(null);
    restore(detailKey(next, next.directStore ?? null));
  }
  function selectDay(date) {
    // Aggregate-only months can draw a total but do not identify an individual store.
    const names = store === 'all' ? month.stores ?? [] : [store];
    const visible = names.filter(name => !hiddenStores.includes(salesStoreKey(name)));
    if (noStores) return;
    select({ ledgerId, period: month.period, date, directStore: visible.length === 1 ? salesStoreKey(visible[0]) : null,
      ...(narrowed && names.length ? { storeKeys: visible.map(salesStoreKey) } : {}) });
  }
  function close() {
    remember(); setSelection(null); setListStore(null); setHovered(null); restore('trend');
  }
  function chooseStore(next, mode = 'skc') {
    remember(); setListStore(next); setProductView(mode);
    const key = detailKey(selection, next, mode);
    if (mode !== 'skc') setListStates(current => ({ ...current, [key]: {} }));
    restore(key);
  }
  function changePeriod(next) {
    remember(); setSelection(next); restore(detailKey(next, chosenStore, productView));
  }
  async function changeStore(next) {
    setSelection(null); setStoreError(''); setChanging(true);
    try { await onStoreChange(next); }
    catch (error) { if (alive.current) setStoreError(error.message || '店铺切换失败，请重试。'); }
    finally { if (alive.current) setChanging(false); }
  }
  const periods = selection?.date ? (month?.daily ?? []).map(day => ({ ...selection, date: day.date }))
    : rangeMonths.map(item => ({ ledgerId: item.ledgerId, period: item.period, ...(selection?.storeKeys ? { storeKeys: selection.storeKeys } : {}) }));
  const position = periods.findIndex(item => item.ledgerId === selection?.ledgerId && item.date === selection?.date);
  const listKey = contextKey;
  function updateList(next) {
    setListStates(current => ({ ...current, [listKey]: { ...current[listKey], ...next } }));
  }
  const scopedDetail = useMemo(() => {
    const detail = details?.scope === detailScope ? withDetailProfit(details.data, profitData?.byLedger[selection?.ledgerId], selection?.date) : null;
    if (!detail || !selection?.storeKeys) return detail;
    const keys = new Set(selection.storeKeys);
    const selected = detail.stores.filter(item => keys.has(salesStoreKey(item.store)));
    const totalsExact = storeTotals(selected);
    const missingStores = [...keys].filter(key => !selected.some(item => salesStoreKey(item.store) === key));
    const knownZero = detail.status === 'known_zero';
    return { ...detail, stores: selected, rows: detail.rows.filter(item => keys.has(salesStoreKey(item.store))),
      totalsExact: detail.status === 'unknown' || knownZero ? detail.totalsExact : totalsExact,
      unlocatedCount: [...keys].reduce((sum, key) => sum + (detail.unlocatedByStore?.[key] ?? 0), 0),
      hasStoreSelection: true, missingStores: knownZero ? [] : missingStores };
  }, [details, detailScope, selection, profitData]);
  const chartAmounts = hiddenStores.length && (daily || monthMode === 'comparison') && visibleStoreKeys.length
    ? actualMonths.flatMap(item => (item.monthlySegments ?? []).filter(segment => visibleStoreKeys.includes(salesStoreKey(segment.store))))
    : actualMonths.map(item => item.monthTotalsExact);
  const detailAmount = chosenStore ? scopedDetail?.stores.find(item => salesStoreKey(item.store) === chosenStore) : scopedDetail?.totalsExact;
  const selectedBreakdown = chosenStore && detailAmount?.breakdown;
  const verifiedSubset = (productView === 'earning' && selectedBreakdown?.earned > 0) || (productView === 'loss' && selectedBreakdown?.lost > 0);
  const readyForProfit = scopedDetail && ['data', 'known_zero'].includes(scopedDetail.status) && detailAmount
    ? verifiedSubset || detailAmount.profitExact != null : chartAmounts.length > 0 && chartAmounts.every(item => item.profitExact != null);
  const canShowProfit = chosenStore && scopedDetail ? detailAmount?.hasPriced
    : (scopedDetail?.stores ?? chartAmounts).some(item => item.hasPriced || item.profitExact != null);
  const metric = showQuantity ? 'quantityExact' : readyForProfit ? 'profitExact' : 'revenueExact';
  const visibleMonth = useMemo(() => filterChartMonth(month, hiddenStores, true), [month, hiddenStores]);
  const scale = useMemo(() => daily ? salesScale(visibleMonth ? [visibleMonth] : [], metric)
    : salesGroupedScale(plottedMonths, metric, { monthly: true, hiddenStores: monthMode === 'overview' ? [] : hiddenStores }),
  [daily, plottedMonths, monthMode, visibleMonth, metric, hiddenStores]);
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
  const rangeProfit = combinedProfit(actualMonths.map(item => item.monthTotalsExact));
  const comparedProfit = monthMode === 'comparison' && !daily
    ? combinedProfit(actualMonths.flatMap(item => (item.monthlySegments ?? []).filter(segment => visibleStoreKeys.includes(salesStoreKey(segment.store))))) : null;
  const profitLabel = value => value == null ? '待核' : '¥' + showSalesValue(value);
  const scopeNames = storeNames.filter(name => visibleStoreKeys.includes(salesStoreKey(name)));
  const scopeLabel = noStores ? '未选择店铺' : narrowed ? (scopeNames.length <= 3 ? '所选店铺 ' + scopeNames.join('、') : '已选 ' + scopeNames.length + ' 家店铺') : store === 'all' ? '全部店铺' : store;
  if (!result || result.scope !== scope) return <Panel>正在读取每日销售...</Panel>;
  if (result.error) return <Panel><p role="alert">{result.error}</p></Panel>;
  return <Panel className="sales-analytics" style={assignSalesStoreColors([...storeNames, ...stores], colorAssignments.current)}>
    <div className="sales-analytics-heading"><div><h2>销售与利润趋势</h2><p>台账 · {view === 'daily' ? `${data.period} · ` : ''}{scopeLabel}</p></div><div className="sales-analysis-controls">
      {onStoreChange ? <label htmlFor={storeId}>店铺<select id={storeId} aria-label="每日销售店铺" value={store} disabled={changing} onChange={event => void changeStore(event.target.value)}><option value="all">全部店铺</option>{stores.map(name => <option key={name}>{name}</option>)}</select></label> : null}
      <div role="group" aria-label="趋势周期" className="sales-period-switch">
        {[['daily', '按日'], ['monthly', '按月']].map(([period, label]) => <Button key={period} aria-pressed={view === period}
          onClick={() => { if (view !== period) { setView(period); setSelection(null); setHovered(null); } }}>{label}</Button>)}
      </div>
      <div role="group" aria-label="趋势指标"><Button aria-pressed={!showQuantity} onClick={() => setShowQuantity(false)}>{readyForProfit ? '商品利润' : '销售额'}</Button><Button aria-pressed={showQuantity} onClick={() => setShowQuantity(true)}>销量</Button></div>
    </div></div>
    {profitData && Object.keys(profitData.errors).length > 0 ? <p className="sales-profit-caption" role="status">利润读取提示 · {Object.values(profitData.errors)[0]}</p>
      : actualMonths.some(item => item.accountingMode) ? <p className="sales-profit-caption">{(actualMonths.find(item => item.accountingMode)?.accountingMode === 'historical_lowest' ? '最低成本核算' : '常规核算')} · 商品利润扣除采购成本和仓储费，月度代发与扣款见「利润核算」。{!readyForProfit ? (canShowProfit ? '部分成本待核。' : '成本待核，可先查看销售额和销量。') : ''}</p> : null}
    {changing ? <p role="status">正在切换店铺...</p> : null}{storeError ? <p role="alert">{storeError}</p> : null}
    {!selection && view === 'daily' && !noStores ? <>
      <div className="sales-month-totals"><p>{month.missingStore ? '该店不存在于本月来源' : month.coverage === 'unknown' ? '销售原额待查 · 销量待查' : <>{narrowed && '所选店铺合计 · '}{metric === 'profitExact' ? <strong>商品利润 {profitLabel(visibleMonth.monthTotalsExact.profitExact)} · </strong> : null}销售原额 ¥{showSalesValue(visibleMonth.monthTotalsExact.revenueExact)} · 销量 {showSalesValue(visibleMonth.monthTotalsExact.quantityExact, 6)} 件</>}{month.isCurrent ? ` · 统计截止 ${month.cutoff || '尚无有效日期'}` : ''}</p></div>
      {month.coverage !== 'complete' ? <p role="status">{month.coverage === 'unknown' ? '尚未取得销售数据，空白日期未视为零。' : `${month.unlocated} 条销售记录缺少有效月内添加日期；仅显示已定位记录，空白日期待查。请核对添加时间映射和账本月份。`}</p> : null}
    </> : null}
    {!selection && view === 'monthly' ? <div className="sales-month-controls">
      <div role="group" aria-label="月度模式"><Button aria-pressed={monthMode === 'overview'} onClick={() => { setMonthMode('overview'); setChartOffset(0); }}>月度总览</Button><Button aria-pressed={monthMode === 'comparison'} onClick={() => { setMonthMode('comparison'); setChartOffset(0); }}>店铺对比</Button></div>
      <label>期间<select aria-label="月份范围" value={rangeLength} onChange={event => { setRangeLength(Number(event.target.value)); setRangeEnd(current => current ?? months.at(-1)?.period); setChartOffset(0); }}>{[3,6,12].map(count => <option key={count} value={count}>近 {count} 个月</option>)}</select></label>
      <label>截止月份<select aria-label="截止月份" value={rangeEnd ?? months.at(-1)?.period ?? ''} onChange={event => { setRangeEnd(event.target.value); setChartOffset(0); }}>{months.map(item => <option key={item.ledgerId} value={item.period}>{item.period}</option>)}</select></label>
      {monthMode === 'overview' ? <p>{store === 'all' ? '全部店铺' : store}期间合计 · {metric === 'profitExact' ? `商品利润 ${profitLabel(rangeProfit)} · ` : ''}销售原额 ¥{showSalesValue(periodTotals.missing === rangeMonths.length ? null : periodTotals.revenueExact)} · 销量 {showSalesValue(periodTotals.missing === rangeMonths.length ? null : periodTotals.quantityExact, 6)} 件{periodTotals.missing ? ' · ' + periodTotals.missing + ' 个月缺数据，合计仅含已知月份' : ''}</p>
        : !noStores && <p>所选店铺期间合计 · {metric === 'profitExact' ? `商品利润 ${profitLabel(comparedProfit)} · ` : ''}销售原额 ¥{showSalesValue(comparisonTotals.revenueExact)} · 销量 {showSalesValue(comparisonTotals.quantityExact, 6)} 件 · 仅含已有来源</p>}
    </div> : null}
    {!selection && usesStoreSelection && storeNames.length > 0 ? <div className="sales-store-selection-actions"><Button disabled={!narrowed} onClick={() => setHiddenStores([])}>全选店铺</Button><Button disabled={noStores} onClick={() => { setHiddenStores(storeNames.map(salesStoreKey)); setHovered(null); }}>清空店铺</Button></div> : null}
    {!selection && (view === 'daily' || monthMode === 'comparison') ? <div className="sales-store-legend" aria-label="店铺颜色">{storeNames.map(name => {
      const checked = !hiddenStores.includes(salesStoreKey(name));
      const toggle = () => setHiddenStores(current => checked ? [...current, salesStoreKey(name)] : current.filter(key => key !== salesStoreKey(name)));
      return view === 'monthly' ? <label key={name}><input type="checkbox" checked={checked} onChange={toggle} /><i style={{ background: salesStoreColor(name) }} />{name}</label> : <button key={name} type="button" aria-pressed={checked} onClick={toggle}><i style={{ background: salesStoreColor(name) }} />{name}</button>;
    })}</div> : null}
    <div ref={chartRef} className="sales-analysis-body">
      {!selection && noStores ? <p role="status">请选择至少一家店铺查看趋势。</p> : !selection ? <div className="sales-charts-area">
        {view === 'daily' ? <SalesMonthChart month={visibleMonth} metric={metric} scale={scale} hovered={hovered} onHover={setHovered} onSelect={selectDay} />
          : !monthsResult || monthsResult.scope !== scope ? <p role="status">正在读取月度销售...</p> : monthsResult.error ? <p role="alert">{monthsResult.error}</p> : !months.length ? <p>暂无可用账本月份。</p> : <SalesGroupedMonthChart mode={monthMode} offset={chartOffset} onOffsetChange={setChartOffset} months={plottedMonths} metric={metric} scale={scale} hiddenStores={monthMode === 'overview' ? [] : hiddenStores} hovered={hovered} onHover={setHovered} onSelect={item => select({ ledgerId: item.ledgerId, period: item.period, ...(monthMode === 'comparison' ? { storeKeys: visibleStoreKeys } : {}) })} />}
        {hovered && view === 'daily' ? <div className="sales-day-tooltip"><SalesHoverSummary month={visibleMonth} date={hovered} metric={metric} hiddenStores={hiddenStores} /></div> : null}
      </div> : <SalesPeriodDetails key={detailKey(selection, chosenStore)} selection={selection} data={scopedDetail} error={details?.scope === detailScope ? details.error : null}
        unitCosts={profitData?.byLedger[selection.ledgerId]?.unitCosts} catalog={catalog} onOpenProduct={onOpenProduct}
        metric={metric} chosenStore={chosenStore} onChooseStore={chooseStore} productView={productView} onProductView={setProductView} state={listStates[listKey]} onStateChange={updateList}
        onBack={listStore ? () => chooseStore(null) : close} onTrend={listStore ? close : null}
        periods={periods} onPeriodChange={changePeriod} position={position} />}
    </div>
  </Panel>;
}
export default function SalesAnalytics({ workspaceId, ledgerId, store = 'all', stores = [], onStoreChange, onOpenProduct }) {
  return <ScopedSalesAnalytics key={JSON.stringify([workspaceId, ledgerId])} {...{ workspaceId, ledgerId, store, stores, onStoreChange, onOpenProduct }} />;
}
