import { useId } from 'react';
import { salesSegments, salesStoreColor, salesDayDifference } from '../domain/salesChartModel';
import Decimal from 'decimal.js';
const value = input => input == null ? '待查' : new Decimal(input).toFixed();
const statusText = day => ({ future: '未发生', unobserved: '尚未统计', unknown: '数据待查' }[day?.status] || '数据待查');
export const salesPair = day => day?.revenueExact == null ? statusText(day) : `销售原额 ¥${value(day.revenueExact)} · 销量 ${value(day.quantityExact)} 件`;
export function SalesMonthChart({ month, metric, scale, selectedDay, onSelect, hovered, onHover }) {
  const id = useId(), days = selectedDay ? month.daily.filter(day => day.date === selectedDay) : month.daily;
  return <section className={`sales-chart-panel sales-stack-chart${selectedDay ? ' is-day' : ''}`} aria-label={`${month.period} 销售图`}>
    <h3>{selectedDay || month.period}</h3>
    <div className="sales-daily-chart" aria-label={metric === 'revenueExact' ? '每日销售额' : '每日销量'}>
      <div className="sales-chart-axis" aria-hidden="true">{scale.max > 0 ? <span>{value(scale.max)}</span> : null}<span style={{ top: `${scale.zero}%` }}>0</span>{scale.min < 0 ? <span className="sales-axis-min">{value(scale.min)}</span> : null}</div>
      <div className="sales-chart-plot"><div className="sales-zero-line" style={{ top: `${scale.zero}%` }} aria-hidden="true" /><div className="sales-chart-bars">
        {days.map(day => <button key={day.date} type="button" className={`sales-daily-bar${hovered === Number(day.date.slice(8)) ? ' is-selected' : ''}`} aria-label={`${day.date}：${salesPair(day)}`} aria-describedby={id} onClick={() => onSelect(day.date)} onMouseEnter={() => onHover(Number(day.date.slice(8)))} onMouseLeave={() => onHover(null)} onFocus={() => onHover(Number(day.date.slice(8)))} onBlur={() => onHover(null)}>
          {day[metric] == null ? <span className="sales-unknown-mark" style={{ top: `${Math.min(scale.zero, 94)}%` }}>·</span> : salesSegments(day, metric, scale).map(segment => <span key={segment.key} className={`sales-stack-segment${Number(segment[metric]) < 0 ? " is-negative" : ""}`} title={`${segment.store} · ${salesPair(segment)} · ${segment.percent == null ? '含负值或净额为零，不计算占比' : `${segment.percent}%`}`} style={{ top: `${segment.top}%`, height: `${segment.height}%`, background: salesStoreColor(segment.store) }}>
            {selectedDay ? <span className="sales-segment-label">{segment.store} · {segment.percent == null ? value(segment[metric]) : `${segment.percent}%`}</span> : null}
          </span>)}
          {day[metric] === '0' && !day.segments.some(segment => Number(segment[metric])) ? <span className="sales-known-zero" style={{ top: `${scale.zero}%` }}>0</span> : null}
          <small className={Number(day.date.slice(8)) % 5 === 1 || day.date === month.daily.at(-1).date ? 'sales-date-major' : ''}>{selectedDay ? '当天' : day.date.slice(8)}</small>
        </button>)}
      </div></div>
    </div>
    <p id={id} className="sales-chart-note">{metric === 'revenueExact' ? '单位：元' : '单位：件'} · 零基线{selectedDay ? ' · 占比按当前店铺范围' : ' · 点击日期查看商品'}{month.isCurrent ? ` · 统计截止 ${month.cutoff || '尚无有效日期'}` : ''}</p>
    {selectedDay && days.some(day => day.segments.some(segment => Number(segment[metric]) < 0) || day[metric] === '0') ? <p className="sales-chart-note">含负值或净额为零时显示原值，不计算占比。</p> : null}
  </section>;
}
export function SalesHoverSummary({ months, dayNumber, metric }) {
  if (!dayNumber) return <div className="sales-hover-summary">悬停或聚焦日期查看店铺金额、销量和占比{months.length > 1 ? '；两个月按日号对齐' : ''}</div>;
  const days = months.map(month => month.daily[dayNumber - 1]);
  const difference = months.length > 1 ? salesDayDifference(days[0], days[1], metric) : null;
  return <div className="sales-hover-summary" role="status">{months.map((month, index) => <div key={month.period}><strong>{month.period} · {dayNumber} 日</strong><span>{days[index] ? salesPair(days[index]) : '该月无此日期'}</span>{days[index]?.segments.map(segment => <small key={segment.key}>{segment.store} · {salesPair(segment)}{salesSegments(days[index], metric, { zero: 100, range: 1 }).find(item => item.key === segment.key)?.percent != null ? ` · ${salesSegments(days[index], metric, { zero: 100, range: 1 }).find(item => item.key === segment.key).percent}%` : ' · 占比不适用'}</small>)}</div>)}{months.length > 1 ? <p>主月 − 对比月：{difference == null ? '数据不完整，差额待查' : `${value(difference)} ${metric === 'revenueExact' ? '元' : '件'}`}</p> : null}</div>;
}
