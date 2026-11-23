import { useId, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { salesSegments, salesGroupedSegments, salesStoreColor, salesStoreKey } from '../domain/salesChartModel';
import Decimal from 'decimal.js';
const value = input => input == null ? '待查' : new Decimal(input).toFixed();
const statusText = day => ({ future: '未发生', unobserved: '尚未统计', unknown: '数据待查', absent_store: '所选店铺无记录' }[day?.status] || '数据待查');
const metricLabel = { revenueExact: '销售额', quantityExact: '销量', profitExact: '商品利润' };
const metricValue = (number, metric) => metric === 'profitExact' && number != null ? new Decimal(number).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed() : value(number);
export const salesPair = (day, metric) => metric === 'profitExact' && day?.revenueExact != null
  ? (day.dispatchAmountExact != null
    ? '利润贡献 ' + (day.profitExact == null ? '待核' : '¥' + metricValue(day.profitExact, metric)) + ' · 销售商品利润 ' + (day.salesProfitExact == null ? '待核' : '¥' + metricValue(day.salesProfitExact, metric)) + ' · 代发节省 ¥' + value(day.dispatchAmountExact)
    : day.profitExact == null ? '商品利润待核' : '商品利润 ¥' + metricValue(day.profitExact, metric))
  : day?.revenueExact == null ? statusText(day) + (day?.dispatchAmountExact != null ? ' · 已知代发节省 ¥' + value(day.dispatchAmountExact) : '') : `销售原额 ¥${value(day.revenueExact)} · 销量 ${value(day.quantityExact)} 件`;
function hoverEvents(key, onHover) {
  const focusedKey = () => document.activeElement?.getAttribute('data-period-key');
  return {
    'data-period-key': key,
    onFocus: () => onHover(key), onBlur: () => onHover(null),
    onMouseEnter: () => { if (!focusedKey() || focusedKey() === key) onHover(key); },
    onMouseMove: event => { if (event.movementX || event.movementY) onHover(key); },
    onMouseLeave: () => onHover(focusedKey() ?? null),
  };
}
export function SalesMonthChart({ month, metric, scale, selectedDay, onSelect, hovered, onHover }) {
  const id = useId();
  const days = useMemo(() => (selectedDay ? month.daily.filter(day => day.date === selectedDay) : month.daily).map(day => ({
    ...day, plotted: day.status === 'data' ? salesSegments(day, metric, scale) : [],
  })), [month, selectedDay, metric, scale]);
  return <section className={`sales-chart-panel sales-stack-chart${selectedDay ? ' is-day' : ''}`} data-period={month.period} aria-label={`${month.period} 销售图`}>
    {selectedDay ? <h3>{selectedDay}</h3> : null}
    <div className="sales-daily-chart" aria-label={'每日' + (month.hasDispatch && metric === 'profitExact' ? '利润贡献' : metricLabel[metric])}>
      <div className="sales-chart-axis" aria-hidden="true">{scale.max > 0 ? <span>{value(scale.max)}</span> : null}<span style={{ top: `${scale.zero}%` }}>0</span>{scale.min < 0 ? <span className="sales-axis-min">{value(scale.min)}</span> : null}</div>
      <div className="sales-chart-plot"><div className="sales-zero-line" style={{ top: `${scale.zero}%` }} aria-hidden="true" /><div className="sales-chart-bars">
        {days.map(day => <button key={day.date} type="button" data-date={day.date} className={`sales-daily-bar${day.status === 'known_zero' ? ' is-empty' : ''}${hovered === day.date ? ' is-selected' : ''}`} aria-label={`${day.date}：${salesPair(day, metric)}；${day.plotted.map(segment => `${segment.store} ${salesPair(segment, metric)}${segment.percent != null ? `，占比 ${segment.percent}%` : ''}`).join('；')}`} aria-describedby={id} onClick={() => onSelect(day.date)} {...hoverEvents(day.date, onHover)}>
          {day[metric] == null && !day.plotted.length ? <span className="sales-unknown-mark" style={{ top: `${Math.min(scale.zero, 94)}%` }}>·</span> : day.plotted.map(segment => <span key={segment.key} className={`sales-stack-segment${Number(segment[metric]) < 0 ? ' is-negative' : Number(segment[metric]) === 0 ? ' is-zero' : ''}`} style={{ top: `${segment.top}%`, height: `${segment.height}%`, background: salesStoreColor(segment.store) }}>
            {selectedDay && segment.height >= 14 ? <span className="sales-segment-label">{segment.store}{segment.percent != null ? ` ${segment.percent}%` : ''}</span> : null}
            {Number(segment[metric]) === 0 ? <span className="sales-zero-tick" /> : null}
          </span>)}
          <small className={Number(day.date.slice(8)) % 5 === 1 || day.date === month.daily.at(-1).date ? 'sales-date-major' : ''}>{selectedDay ? '' : day.date.slice(8)}</small>
        </button>)}
      </div></div>
    </div>
    <p id={id} className="sales-chart-note">{metric === 'quantityExact' ? '单位：件' : '单位：元'}{selectedDay ? ' · 店铺占比' : ' · 点击日期查看明细'}</p>
  </section>;
}
export function SalesHoverSummary({ month, date, metric, hiddenStores = [] }) {
  const day = month.daily.find(item => item.date === date);
  const segments = day?.status === 'data' ? salesSegments(day, metric, { zero: 100, range: 1 }) : [];
  return <div className="sales-hover-summary" role="status"><strong>{date}</strong><span>{day?.status === 'known_zero' ? (month.hasDispatch ? '当日无销售或已登记的代发记录' : '当日无销售记录') : salesPair(day, metric)}</span>{segments.filter(segment => !hiddenStores.includes(salesStoreKey(segment.store))).map(segment => <small key={segment.key}><i style={{ background: salesStoreColor(segment.store) }} />{segment.store} · {salesPair(segment, metric)}{segment.percent != null ? ` · ${segment.percent}%` : ''}</small>)}</div>;
}

export function SalesGroupedMonthChart({ months, metric, scale, hiddenStores = [], hovered, onHover, onSelect, mode = 'comparison', offset = 0, onOffsetChange = () => {} }) {
  const root = useRef(null), [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const names = [...new Set(months.flatMap(month => month.monthlySegments ?? []).map(item => item.store))].filter(name => !hiddenStores.includes(salesStoreKey(name))).sort((a,b) => salesStoreKey(a).localeCompare(salesStoreKey(b)));
  const capacity = Math.max(1, Math.floor((width - 58) / (mode === 'overview' ? 56 : Math.max(82, names.length * 25 + 20))));
  const end = Math.max(Math.min(capacity, months.length), months.length - offset), start = Math.max(0, end - capacity);
  const visible = months.slice(start, end), active = months.find(month => month.ledgerId === hovered);
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
          return <button key={month.ledgerId} type="button" className={'sales-month-group' + (hovered === month.ledgerId ? ' is-selected' : '')} aria-label={month.period + '：' + (unknown ? '数据待查' : salesPair(month.monthTotalsExact, metric))} onClick={() => onSelect(month)} {...hoverEvents(month.ledgerId, onHover)}>
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
    {active ? <div className="sales-day-tooltip"><div className="sales-hover-summary" role="status"><strong>{active.period}</strong><span>{active.missingStore || active.coverage === 'unknown' ? '数据待查，未按零计算。' : salesPair(active.monthTotalsExact, metric)}</span>{active.unlocated ? <span>{active.unlocated} 条记录未定位到日期，已计入本月。</span> : null}{(active.monthlySegments ?? []).filter(segment => !hiddenStores.includes(salesStoreKey(segment.store))).map(segment => <small key={segment.key}><i style={{ background: salesStoreColor(segment.store) }} />{segment.store} · {salesPair(segment, metric)}</small>)}</div></div> : null}
  </section>;
}
