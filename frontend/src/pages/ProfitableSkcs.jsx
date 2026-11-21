import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { Exact } from '../domain/profitAmounts';
import { profitableSkcs } from '../domain/salesProfitAnalysis';

const PAGE_SIZE = 3;
function amount(value, places = 2) {
  const exact = new Exact(value), display = exact.toDecimalPlaces(places);
  return !exact.isZero() && display.isZero() ? exact.toSignificantDigits(2).toFixed() : display.toFixed();
}
function SkcEntry({ item, productId, onOpenProduct, onOpenProfit, hasDispatch, expanded, onToggle }) {
  const [feedback, setFeedback] = useState(null);
  const timeout = useRef(null);
  useEffect(() => () => clearTimeout(timeout.current), []);
  async function copy() {
    clearTimeout(timeout.current);
    try {
      await navigator.clipboard.writeText(item.skc);
      setFeedback('copied');
      timeout.current = setTimeout(() => setFeedback(null),1800);
    } catch { setFeedback('manual'); }
  }
  return <li data-skc={item.skc}>
    <div className="sales-skc-identity">
      {productId && onOpenProduct ? <button type="button" className="sales-skc-link" aria-label={'打开 ' + item.skc + ' 的商品资料'} data-trend-action="product" onClick={() => onOpenProduct(productId,item.stores,item.skc)}>{item.skc}</button> : <strong>{item.skc}</strong>}
      <button type="button" className={'sales-copy-skc' + (feedback === 'copied' ? ' copied' : '')} title="复制 SKC" aria-label={'复制 SKC ' + item.skc} onClick={copy}>{feedback === 'copied' ? <Check size={16} /> : <Copy size={14} />}</button>
      <span className="sales-skc-feedback" role="status">{feedback === 'copied' ? '已复制' : ''}</span>
    </div>
    {feedback === 'manual' && <input className="sales-manual-copy" aria-label="手动复制 SKC" readOnly value={item.skc} ref={el => { if (el) { el.focus(); el.select(); } }} />}
    <small className="sales-skc-stores">店铺 {item.stores.join('、')}</small>
    <button type="button" className="sales-skc-breakdown" aria-expanded={expanded} aria-label={item.skc + ' 利润构成'} onClick={onToggle}>
      <span>{hasDispatch ? '利润贡献' : '商品利润'}</span><strong title={item.profit}>¥{amount(item.profit)}</strong><ChevronDown size={13} />
    </button>
    {expanded && <div className="sales-skc-expanded"><dl>
      {hasDispatch && <><div><dt>销售商品利润</dt><dd>¥{amount(item.salesProfit)}</dd></div><div><dt>代发节省</dt><dd>{item.dispatchQuantity} 件 · ¥{amount(item.dispatch)}</dd></div></>}
      {item.minUnit != null && <div><dt>单件成本</dt><dd title={item.minUnit === item.maxUnit ? item.minUnit : item.minUnit + '–' + item.maxUnit}>¥{amount(item.minUnit,4)}{item.minUnit !== item.maxUnit && '–' + amount(item.maxUnit,4)}</dd></div>}
      <div><dt>采购成本</dt><dd title={item.purchase}>¥{amount(item.purchase)}</dd></div>
    </dl>
      {onOpenProfit && <button className="inline-link" type="button" data-trend-action="profit" aria-label={'查看 ' + item.skc + ' 的月度利润明细'} onClick={() => onOpenProfit(item.skc,item.stores)}>查看月度利润明细 ›</button>}
    </div>}
  </li>;
}

export default function ProfitableSkcs({ rows, unitCosts, catalog, onOpenProduct, onOpenProfit, hasDispatch, state, onStateChange }) {
  const ranking = useMemo(() => profitableSkcs(rows,unitCosts),[rows,unitCosts]);
  const page = state?.skcPage ?? 0;
  const setPage = skcPage => onStateChange({skcPage, expandedSkc:null});
  const pages = Math.max(1,Math.ceil(ranking.length/PAGE_SIZE)), current = Math.min(page,pages-1);
  return <section className="sales-profitable-skcs" aria-label="盈利 SKC">
    <header><h4>盈利 SKC</h4>{ranking.length > 0 && <small>{ranking.length} 款</small>}</header>
    {ranking.length ? <ul>{ranking.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE).map(item => <SkcEntry key={item.key} item={item} productId={catalog?.get(item.key)} expanded={state?.expandedSkc === item.key} onToggle={() => onStateChange({expandedSkc:state?.expandedSkc === item.key ? null : item.key})} {...{onOpenProduct,onOpenProfit,hasDispatch}} />)}</ul> : <p>当前范围暂无已核盈利 SKC。</p>}
    {pages > 1 && <nav aria-label="盈利 SKC 翻页"><button type="button" disabled={!current} aria-label="上一页盈利 SKC" onClick={() => setPage(current-1)}><ChevronLeft size={15} /></button><span>{current+1} / {pages}</span><button type="button" disabled={current+1>=pages} aria-label="下一页盈利 SKC" onClick={() => setPage(current+1)}><ChevronRight size={15} /></button></nav>}
  </section>;
}
