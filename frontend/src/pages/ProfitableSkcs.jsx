import { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { Exact } from '../domain/profitAmounts';
import { profitableSkcs } from '../domain/salesProfitAnalysis';

const PAGE_SIZE = 3;

function displayAmount(value, places = 2) {
  const amount = new Exact(value);
  const shortened = amount.toDecimalPlaces(places);
  return !amount.isZero() && shortened.isZero() ? amount.toSignificantDigits(2).toFixed() : shortened.toFixed();
}

export default function ProfitableSkcs({ rows, unitCosts, catalog, onOpenProduct }) {
  const ranking = useMemo(() => profitableSkcs(rows, unitCosts), [rows, unitCosts]);
  const [page, setPage] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const pages = Math.max(1, Math.ceil(ranking.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  function turn(next) { setFeedback(null); setPage(next); }
  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ text: label + '已复制' });
    } catch {
      setFeedback({ text: '请手动复制' + label, value });
    }
  }
  return <section className="sales-profitable-skcs" aria-label="盈利 SKC">
    <header><h4>盈利 SKC</h4>{ranking.length > 0 && <small>{ranking.length} 款</small>}</header>
    {ranking.length ? <ul>{ranking.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(item => {
      const id = catalog?.get(item.key);
      const unit = item.minUnit === item.maxUnit ? item.minUnit : item.minUnit + '–' + item.maxUnit;
      const unitLabel = item.minUnit == null ? null : displayAmount(item.minUnit, 4) + (item.minUnit === item.maxUnit ? '' : '–' + displayAmount(item.maxUnit, 4));
      return <li key={item.key}>
        <div className="sales-skc-identity">
          <button type="button" className="sales-copy-skc" onClick={() => copy(item.skc, 'SKC')} aria-label={'复制 SKC ' + item.skc} title={'复制 ' + item.skc}>
            <span>{item.skc}</span><Copy size={13} aria-hidden="true" />
          </button>
          {id && onOpenProduct && <button type="button" className="sales-catalog-link" title="打开商品资料" aria-label={'打开 ' + item.skc + ' 的商品资料'} onClick={() => onOpenProduct(id)}>
            资料<ArrowUpRight size={13} aria-hidden="true" />
          </button>}
        </div>
        <dl>
          <div><dt>商品利润</dt><dd className="sales-skc-profit" title={item.profit}>¥{displayAmount(item.profit)}</dd></div>
          {unitLabel != null && <div><dt>单件成本</dt><dd><button type="button" title={'复制单件成本 ' + unit} aria-label={'复制 ' + item.skc + ' 单件成本'} onClick={() => copy(unit, '单件成本')}>¥{unitLabel}</button></dd></div>}
          <div><dt>采购成本</dt><dd><button type="button" title={'复制采购成本 ' + item.purchase} aria-label={'复制 ' + item.skc + ' 采购成本'} onClick={() => copy(item.purchase, '采购成本')}>¥{displayAmount(item.purchase)}</button></dd></div>
        </dl>
      </li>;
    })}</ul> : <p>当前范围暂无已核盈利 SKC。</p>}
    {pages > 1 && <nav aria-label="盈利 SKC 翻页"><button type="button" disabled={!current} aria-label="上一页盈利 SKC" onClick={() => turn(current - 1)}><ChevronLeft size={15} /></button>
      <span>{current + 1} / {pages}</span><button type="button" disabled={current + 1 >= pages} aria-label="下一页盈利 SKC" onClick={() => turn(current + 1)}><ChevronRight size={15} /></button></nav>}
    {feedback && <div className="sales-copy-feedback"><span role="status">{feedback.text}</span>
      {feedback.value != null && <input aria-label="手动复制内容" readOnly value={feedback.value} ref={input => { if (input) { input.focus(); input.select(); } }} />}</div>}
  </section>;
}
