import { useId, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { salesSegments, salesGroupedSegments, salesStoreColor, salesStoreKey } from '../domain/salesChartModel';
import SalesChartTooltip, { useChartHover } from './SalesChartTooltip';
import Decimal from 'decimal.js';
const value = input => input == null ? '待查' : new Decimal(input).toFixed();
const statusText = day => ({ future: '未发生', unobserved: '尚未统计', unknown: '数据待查', absent_store: '所选店铺无记录' }[day?.status] || '数据待查');
const metricLabel = { revenueExact: '销售额', quantityExact: '销量', profitExact: '商品利润' };
const metricValue = (number, metric) => metric === 'profitExact' && number != null ? new Decimal(number).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed() : value(number);
function profitBreakdown(row) {
  const money = number => number == null ? '待核' : '¥' + metricValue(number, 'profitExact');
  return {
    contribution: money(row.profitExact),
    sales: money(row.dispatchAmountExact == null ? row.profitExact : row.salesProfitExact),
    dispatch: '¥' + value(row.dispatchAmountExact ?? '0'),
  };
}

export function salesPair(day, metric, hasDispatch = day?.dispatchAmountExact != null) {
  if (day?.revenueExact == null) return statusText(day) + (day?.dispatchAmountExact != null ? ' · 已知代发节省 ¥' + value(day.dispatchAmountExact) : '');
  if (metric !== 'profitExact') return `销售原额 ¥${value(day.revenueExact)} · 销量 ${value(day.quantityExact)} 件`;
  if (!hasDispatch) return day.profitExact == null ? '商品利润待核' : '商品利润 ¥' + metricValue(day.profitExact, metric);
  const { contribution, sales, dispatch } = profitBreakdown(day);
  return '利润贡献 ' + contribution + ' · 销售商品利润 ' + sales + ' · 代发节省 ' + dispatch;
}

function DispatchProfitSummary({ totals, stores, percentages }) {
  const total = profitBreakdown(totals);
  const showShare = percentages?.size > 0;
  return <><table className="sales-tooltip-breakdown" aria-label="利润贡献明细">
    <thead><tr><th scope="col">店铺</th><th scope="col">利润贡献</th><th scope="col">销售商品利润</th><th scope="col">代发节省</th>{showShare && <th scope="col">占比</th>}</tr></thead>
    <tbody><tr className="sales-tooltip-total"><th scope="row">合计</th><td>{total.contribution}</td><td>{total.sales}</td><td>{total.dispatch}</td>{showShare && <td />}</tr></tbody>
    <tbody className="sales-tooltip-stores">{stores.map(row => {
      const { contribution, sales, dispatch } = profitBreakdown(row);
      return <tr key={row.key}><th scope="row"><i style={{ background: salesStoreColor(row.store) }} />{row.store}</th><td>{contribution}</td><td>{sales}</td><td>{dispatch}</td>
        {showShare && <td>{percentages.has(row.key) ? percentages.get(row.key) + '%' : '—'}</td>}</tr>;
    })}</tbody>
  </table><span className="sales-tooltip-compact-summary">{salesPair(totals, 'profitExact', true)}</span></>;
}

export function SalesMonthChart({ month, metric, scale, selectedDay, onSelect }) {
  const id = useId();
  const { anchor, entryRatio, events } = useChartHover();
  const days = useMemo(() => (selectedDay ? month.daily.filter(day => day.date === selectedDay) : month.daily).map(day => {
    const plotted = day.status === 'data' ? salesSegments(day, metric, scale) : [];
    const stores = plotted.map(segment => `${segment.store} ${salesPair(segment, metric, month.hasDispatch)}${segment.percent != null ? `，占比 ${segment.percent}%` : ''}`);
    return { ...day, plotted, label: [day.date + '：' + salesPair(day, metric, month.hasDispatch), ...stores].join('；') };
  }), [month, selectedDay, metric, scale]);
  const active = anchor?.isConnected && days.find(day => day.date === anchor.dataset.date);
  const showBreakdown = month.hasDispatch && metric === 'profitExact' && active?.status === 'data' && active.revenueExact != null;
  return <section className={`sales-chart-panel sales-stack-chart${selectedDay ? ' is-day' : ''}`} data-period={month.period} aria-label={`${month.period} 销售图`}>
    {selectedDay ? <h3>{selectedDay}</h3> : null}
    <div className="sales-daily-chart" aria-label={'每日' + (month.hasDispatch && metric === 'profitExact' ? '利润贡献' : metricLabel[metric])}>
      <div className="sales-chart-axis" aria-hidden="true">{scale.max > 0 ? <span>{value(scale.max)}</span> : null}<span style={{ top: `${scale.zero}%` }}>0</span>{scale.min < 0 ? <span className="sales-axis-min">{value(scale.min)}</span> : null}</div>
      <div className="sales-chart-plot"><div className="sales-zero-line" style={{ top: `${scale.zero}%` }} aria-hidden="true" /><div className="sales-chart-bars">
        {days.map(day => <button key={day.date} type="button" data-date={day.date} className={`sales-daily-bar${day.status === 'known_zero' ? ' is-empty' : ''}${active === day ? ' is-selected' : ''}`} aria-label={day.label} aria-describedby={id} onClick={() => onSelect(day.date)} {...events}>
          {day[metric] == null && !day.plotted.length ? <span className="sales-unknown-mark" style={{ top: `${Math.min(scale.zero, 94)}%` }}>·</span> : day.plotted.map(segment => <span key={segment.key} className={`sales-stack-segment${Number(segment[metric]) < 0 ? ' is-negative' : Number(segment[metric]) === 0 ? ' is-zero' : ''}`} style={{ top: `${segment.top}%`, height: `${segment.height}%`, background: salesStoreColor(segment.store) }}>
            {selectedDay && segment.height >= 14 ? <span className="sales-segment-label">{segment.store}{segment.percent != null ? ` ${segment.percent}%` : ''}</span> : null}
            {Number(segment[metric]) === 0 ? <span className="sales-zero-tick" /> : null}
          </span>)}
          <small className={Number(day.date.slice(8)) % 5 === 1 || day.date === month.daily.at(-1).date ? 'sales-date-major' : ''}>{selectedDay ? '' : day.date.slice(8)}</small>
        </button>)}
      </div></div>
    </div>
    <p id={id} className="sales-chart-note">{metric === 'quantityExact' ? '单位：件' : '单位：元'}{selectedDay ? ' · 店铺占比' : ' · 点击日期查看明细'}</p>
    {active && <SalesChartTooltip anchor={anchor} entryRatio={entryRatio}><div className="sales-hover-summary" role="status">
      <strong>{active.date}</strong>
      {showBreakdown ? <DispatchProfitSummary totals={active} stores={active.segments}
        percentages={new Map(active.plotted.filter(segment => segment.percent != null).map(segment => [segment.key, segment.percent]))} /> : <>
        <span>{active.status === 'known_zero' ? (month.hasDispatch ? '当日无销售或已登记的代发记录' : '当日无销售记录') : salesPair(active, metric)}</span>
        {active.plotted.map(segment => <small key={segment.key}><i style={{ background: salesStoreColor(segment.store) }} />{segment.store} · {salesPair(segment, metric)}{segment.percent != null ? ` · ${segment.percent}%` : ''}</small>)}
      </>}
    </div></SalesChartTooltip>}
  </section>;
}

function hoveredMonthColumn(event) {
  const hit = event.target.closest('.sales-month-column');
  if (hit) return hit;
  const columns = event.currentTarget.querySelector('.sales-month-columns');
  if (!columns?.childElementCount) return event.currentTarget;
  // The gaps belong to the nearest evenly spaced column. The month remains the drilldown target.
  const { left, width } = columns.getBoundingClientRect();
  const index = Math.floor((event.clientX - left) / Math.max(1, width) * columns.childElementCount);
  return columns.children[Math.max(0, Math.min(index, columns.childElementCount - 1))] ?? event.currentTarget;
}

export function SalesGroupedMonthChart({ months, metric, scale, hiddenStores = [], onSelect, mode = 'comparison', offset = 0, onOffsetChange = () => {} }) {
  const root = useRef(null), [width, setWidth] = useState(900);
  const { anchor, entryRatio, events } = useChartHover(hoveredMonthColumn);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const names = [...new Set(months.flatMap(month => month.monthlySegments ?? []).map(item => item.store))].filter(name => !hiddenStores.includes(salesStoreKey(name))).sort((a,b) => salesStoreKey(a).localeCompare(salesStoreKey(b)));
  const capacity = Math.max(1, Math.floor((width - 58) / (mode === 'overview' ? 56 : Math.max(82, names.length * 25 + 20))));
  const end = Math.max(Math.min(capacity, months.length), months.length - offset), start = Math.max(0, end - capacity);
  const activeKey = anchor?.isConnected && anchor.closest('[data-period-key]')?.dataset.periodKey;
  const visible = months.slice(start, end), active = visible.find(month => month.ledgerId === activeKey);
  const knownMonth = active && !active.missingStore && active.coverage !== 'unknown' && active.monthTotalsExact?.revenueExact != null;
  const storeRows = (active?.monthlySegments ?? []).filter(segment => !hiddenStores.includes(salesStoreKey(segment.store)));
  const showBreakdown = knownMonth && active.hasDispatch && metric === 'profitExact';
  const single = visible.length === 1;
  const ticks = [...[0,25,50,75,100].filter(top => Math.abs(top - scale.zero) > 5), scale.zero].sort((a,b) => a-b);
  return <section ref={root} className={'sales-chart-panel sales-grouped-chart' + (single ? ' is-single-month' : '') + (single && mode !== 'overview' && width / Math.max(names.length, 1) < 65 ? ' is-dense-month' : '')} aria-label="月度销售图">
    {months.length > capacity ? <div className="sales-month-window"><button type="button" disabled={start === 0} onClick={() => onOffsetChange(Math.min(months.length - capacity, offset + capacity))}>较早月份</button><span>图中 {visible[0]?.period} 至 {visible.at(-1)?.period} · 已选 {months.length} 个月</span><button type="button" disabled={end === months.length} onClick={() => onOffsetChange(Math.max(0, offset - capacity))}>较新月份</button></div> : null}
    <div className="sales-daily-chart" aria-label={'月度' + (metric === 'profitExact' && months.some(month => month.hasDispatch) ? '利润贡献' : metricLabel[metric])}>
      <div className="sales-chart-axis" aria-hidden="true">{ticks.map(top => <span key={top} style={{ top: top + '%' }}>{top === scale.zero ? '0' : value(new Decimal(scale.max).minus(new Decimal(scale.range).times(top / 100)).toSignificantDigits(3))}</span>)}</div>
      <div className="sales-chart-plot sales-month-plot"><div className="sales-month-track">{[0,25,50,75,100].map(top => <div key={top} className="sales-grid-line" style={{ top: top + '%' }} aria-hidden="true" />)}<div className="sales-zero-line" style={{ top: scale.zero + '%' }} aria-hidden="true" />
        <div className="sales-month-groups">{visible.map(month => {
          const unknown = month.missingStore || month.coverage === 'unknown';
          const actual = unknown ? [] : salesGroupedSegments({ ...month.monthTotalsExact, segments: month.monthlySegments ?? [] }, metric, scale);
          const segments = names.map(name => actual.find(item => item.store === name) ?? { key: salesStoreKey(name), store: name, [metric]: null });
          return <button key={month.ledgerId} type="button" data-period-key={month.ledgerId} className={'sales-month-group' + (active === month ? ' is-selected' : '')} aria-label={month.period + '：' + (unknown ? '数据待查' : salesPair(month.monthTotalsExact, metric, month.hasDispatch))} onClick={() => onSelect(month)} {...events}>
            <span className="sales-month-columns">{segments.map(segment => <span className="sales-month-column" key={segment.key}>
              {segment[metric] == null
                ? <span className="sales-unknown-mark" style={{ top: Math.min(scale.zero, 94) + '%' }}>·</span>
                : <>
                  <span className={'sales-grouped-segment' + (Number(segment[metric]) < 0 ? ' is-negative' : '')} style={{ top: segment.top + '%', height: segment.height + '%', background: mode === 'overview' ? 'var(--sales-overview, #3b82f6)' : salesStoreColor(segment.store) }} />
                  {Number(segment[metric]) === 0 && <span className="sales-zero-tick" style={{ top: scale.zero + '%' }} />}
                </>}
              {single && mode !== 'overview' ? <span className="sales-column-name">{segment.store}</span> : null}
            </span>)}</span>
            {unknown && !segments.length ? <span className="sales-unknown-mark" style={{ top: Math.min(scale.zero, 94) + '%' }}>·</span> : null}
            {single && mode !== 'overview' ? null : <small>{month.period}</small>}
          </button>;
        })}</div>
      </div></div>
    </div>
    <p className="sales-chart-note">{metric === 'quantityExact' ? '单位：件' : '单位：元'} · {single ? visible[0]?.period + ' · ' : ''}{mode === 'overview' ? '全部店铺合计' : '店铺对比'} · 点击月份查看店铺</p>
    {active && <SalesChartTooltip anchor={anchor} entryRatio={entryRatio}><div className="sales-hover-summary" role="status">
      <strong>{active.period}</strong>
      {showBreakdown ? <DispatchProfitSummary totals={active.monthTotalsExact} stores={mode === 'overview' ? [] : storeRows} /> : <>
        <span>{active.missingStore || active.coverage === 'unknown' ? '数据待查，未按零计算。' : salesPair(active.monthTotalsExact, metric)}</span>
        {storeRows.map(segment => <small key={segment.key}><i style={{ background: salesStoreColor(segment.store) }} />{segment.store} · {salesPair(segment, metric)}</small>)}
      </>}
      {active.unlocated ? <span>{active.unlocated} 条记录未定位到日期，已计入本月。</span> : null}
    </div></SalesChartTooltip>}
  </section>;
}
