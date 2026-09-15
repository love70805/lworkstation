import { useId, useMemo } from 'react';
import { salesSegments, salesStoreColor, salesStoreKey } from '../domain/salesChartModel';
import Decimal from 'decimal.js';
const value = input => input == null ? '待查' : new Decimal(input).toFixed();
const statusText = day => ({ future: '未发生', unobserved: '尚未统计', unknown: '数据待查' }[day?.status] || '数据待查');
export const salesPair = day => day?.revenueExact == null ? statusText(day) : `销售原额 ¥${value(day.revenueExact)} · 销量 ${value(day.quantityExact)} 件`;
export function SalesMonthChart({ month, sourceMonth = month, metric, scale, selectedDay, onSelect, hovered, onHover }) {
  const id = useId();
  const days = useMemo(() => (selectedDay ? month.daily.filter(day => day.date === selectedDay) : month.daily).map(day => {
    const original = sourceMonth.daily.find(item => item.date === day.date) ?? day;
    const percentages = new Map(salesSegments(original, metric, scale).map(segment => [segment.key, segment.percent]));
    return { ...day, plotted: day[metric] == null ? [] : salesSegments(day, metric, scale).map(segment => ({ ...segment, percent: percentages.get(segment.key) })) };
  }), [month, sourceMonth, selectedDay, metric, scale]);
  return <section className={`sales-chart-panel sales-stack-chart${selectedDay ? ' is-day' : ''}`} data-period={month.period} aria-label={`${month.period} 销售图`}>
    {selectedDay ? <h3>{selectedDay}</h3> : null}
    <div className="sales-daily-chart" aria-label={metric === 'revenueExact' ? '每日销售额' : '每日销量'}>
      <div className="sales-chart-axis" aria-hidden="true">{scale.max > 0 ? <span>{value(scale.max)}</span> : null}<span style={{ top: `${scale.zero}%` }}>0</span>{scale.min < 0 ? <span className="sales-axis-min">{value(scale.min)}</span> : null}</div>
      <div className="sales-chart-plot"><div className="sales-zero-line" style={{ top: `${scale.zero}%` }} aria-hidden="true" /><div className="sales-chart-bars">
        {days.map(day => <button key={day.date} type="button" className={`sales-daily-bar${hovered === day.date ? ' is-selected' : ''}`} aria-label={`${day.date}：${salesPair(day)}；${day.plotted.map(segment => `${segment.store} ${salesPair(segment)}${segment.percent != null ? `，占比 ${segment.percent}%` : ''}`).join('；')}`} aria-describedby={id} onClick={() => onSelect(day.date)} onMouseEnter={() => onHover(day.date)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(day.date)} onBlur={() => onHover(null)}>
          {day[metric] == null ? <span className="sales-unknown-mark" style={{ top: `${Math.min(scale.zero, 94)}%` }}>·</span> : day.plotted.map(segment => <span key={segment.key} className={`sales-stack-segment${Number(segment[metric]) < 0 ? ' is-negative' : Number(segment[metric]) === 0 ? ' is-zero' : ''}`} style={{ top: `${segment.top}%`, height: `${segment.height}%`, background: salesStoreColor(segment.store) }}>
            {selectedDay && segment.height >= 14 ? <span className="sales-segment-label">{segment.store}{segment.percent != null ? ` ${segment.percent}%` : ''}</span> : null}
            {Number(segment[metric]) === 0 ? <span className="sales-zero-tick" /> : null}
          </span>)}
          {day[metric] === '0' && !day.segments.some(segment => Number(segment[metric])) ? <span className="sales-known-zero" style={{ top: `${scale.zero}%` }}>0</span> : null}
          <small className={Number(day.date.slice(8)) % 5 === 1 || day.date === month.daily.at(-1).date ? 'sales-date-major' : ''}>{selectedDay ? '' : day.date.slice(8)}</small>
        </button>)}
      </div></div>
    </div>
    <p id={id} className="sales-chart-note">{metric === 'revenueExact' ? '单位：元' : '单位：件'}{selectedDay ? ' · 店铺占比' : ' · 点击日期查看明细'}</p>
  </section>;
}
export function SalesHoverSummary({ month, date, metric, hiddenStores = [] }) {
  const day = month.daily.find(item => item.date === date);
  const segments = day ? salesSegments(day, metric, { zero: 100, range: 1 }) : [];
  return <div className="sales-hover-summary" role="status"><strong>{date}</strong><span>{salesPair(day)}</span>{segments.filter(segment => !hiddenStores.includes(salesStoreKey(segment.store))).map(segment => <small key={segment.key}><i style={{ background: salesStoreColor(segment.store) }} />{segment.store} · {salesPair(segment)}{segment.percent != null ? ` · ${segment.percent}%` : ''}</small>)}</div>;
}
