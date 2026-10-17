import { displayMoney } from '../domain/profitReports';

const money = value => `¥${displayMoney(value)}`;

export default function MonthlyProfitSummary({ summary, ledger, onEdit }) {
  const ready = summary.status === 'ready';
  const frozen = ['finalized', 'locked'].includes(ledger.status);
  return <section className="profit-monthly-summary" aria-label="整月利润汇总">
    <p>整月合计 · 全部店铺<span>不随上方商品筛选变化</span></p>
    {summary.status === 'error' ? <p role="alert">整月汇总读取失败：{summary.error} 请在本月报告中重新读取。</p> : null}
    <div className="profit-summary-strip profit-summary-monthly" aria-live="polite">
      <div className="profit-summary-item"><span>代发金额</span><strong>{ready ? summary.dispatchAmountExact === null ? '待登记' : money(summary.dispatchAmountExact) : summary.status === 'error' ? '读取失败' : '正在读取…'}</strong><small>{ready && summary.dispatchQuantityExact !== null ? `${summary.dispatchQuantityExact} 件 × 每件 ${summary.rateExact} 元${summary.frozen ? ' · 已随基础保存' : ''}` : '真实零件也需明确登记'}</small>{onEdit ? <button className="inline-link" disabled={!ready || frozen} onClick={() => onEdit('dispatch')}>登记代发</button> : null}</div>
      <div className="profit-summary-item"><span>独立扣款</span><strong>{ready ? summary.deductionExact === null ? '尚未取得' : money(summary.deductionExact) : summary.status === 'error' ? '读取失败' : '正在读取…'}</strong><small>{ready && summary.deductionExact !== null ? summary.missingStores.length ? `待取得：${summary.missingStores.join('、')}` : '各店已齐 · 保留来源正负' : '取得前可先保存未扣款报告'}</small>{onEdit ? <button className="inline-link" disabled={!ready || ledger.status === 'locked'} onClick={() => onEdit('deduction')}>登记扣款</button> : null}</div>
      <div className={`profit-summary-item profit-summary-total ${!ready || summary.profitExact === null || summary.deductionExact === null || summary.missingStores.length ? 'is-pending' : ''}`}><span>{ready ? summary.label : '本月利润'}</span><strong>{!ready ? summary.status === 'error' ? '读取失败' : '正在读取…' : summary.costsPending ? '待确认成本' : summary.profitExact === null ? '待登记代发' : money(summary.profitExact)}</strong><small>{ready && summary.deductionExact !== null ? summary.missingStores.length ? '已减当前扣款，部分店铺尚未取得' : '商品利润 + 代发 − 独立扣款' : '商品利润 + 代发，扣款尚未取得'}</small>{ready && summary.frozen && summary.deductionExact !== null ? <small>当前来源暂算；已保存报告保持不变</small> : null}</div>
    </div>
  </section>;
}
