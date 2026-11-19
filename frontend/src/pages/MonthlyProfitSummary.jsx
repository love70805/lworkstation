import { displayMoney } from '../domain/profitReports';

const money = value => `¥${displayMoney(value)}`;

export default function MonthlyProfitSummary({ summary, ledger, onEdit }) {
  const ready = summary.status === 'ready';
  const frozen = ['finalized', 'locked'].includes(ledger.status);
  const hasDispatch = ready && summary.dispatchAmountExact != null;
  const profitSources = hasDispatch ? '商品利润 + 代发' : '商品利润';
  return <section className="profit-monthly-summary" aria-label="整月利润汇总">
    <p>整月合计 · 全部店铺<span>按整月台账计算</span></p>
    {summary.status === 'error' ? <p role="alert">整月汇总读取失败：{summary.error} 请在本月报告中重新读取。</p> : null}
    <div className="profit-summary-strip profit-summary-monthly" aria-live="polite">
      <div className="profit-summary-item"><span>代发金额</span><strong>{ready ? hasDispatch ? money(summary.dispatchAmountExact) : '未录入' : summary.status === 'error' ? '读取失败' : '正在读取…'}</strong>
        {ready && <small>{hasDispatch ? `${summary.dispatchQuantityExact} 件 × 每件 ${summary.rateExact} 元${summary.frozen ? ' · 已随基础保存' : ''}` : '可直接导出，利润不含代发'}</small>}
        {onEdit && !frozen && <button className="inline-link" disabled={!ready} onClick={() => onEdit('dispatch')}>{hasDispatch ? '更新代发' : '登记代发'}</button>}
      </div>
      <div className="profit-summary-item"><span>独立扣款</span><strong>{ready ? summary.deductionExact === null ? '尚未取得' : money(summary.deductionExact) : summary.status === 'error' ? '读取失败' : '正在读取…'}</strong><small>{ready && summary.deductionExact !== null ? summary.deductionSaved ? '已随报告保存' : summary.missingStores.length ? `待取得：${summary.missingStores.join('、')}` : '各店已齐 · 保留来源正负' : '取得前可先导出未扣款报告'}</small>{onEdit && ledger.status !== 'locked' && !summary.deductionSaved ? <button className="inline-link" disabled={!ready} onClick={() => onEdit('deduction')}>{ready && summary.deductionExact !== null ? '更新扣款' : '登记扣款'}</button> : null}</div>
      <div className={`profit-summary-item profit-summary-total ${!ready || summary.profitExact === null || summary.deductionExact === null || summary.missingStores.length ? 'is-pending' : ''}`}><span>{ready ? summary.label : '本月利润'}</span><strong>{!ready ? summary.status === 'error' ? '读取失败' : '正在读取…' : summary.profitExact === null ? '待确认成本' : money(summary.profitExact)}</strong>
        {ready && <small>{summary.deductionExact === null ? `${profitSources}，扣款尚未取得` : `${profitSources} − 独立扣款${summary.missingStores.length ? '，部分店铺尚未取得' : ''}`}</small>}
        {ready && summary.frozen && summary.deductionExact !== null ? <small>{summary.formalSaved?'已保存为正式利润表':'当前来源待保存为正式利润表'}</small> : null}</div>
    </div>
  </section>;
}
