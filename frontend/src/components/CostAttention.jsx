import { AlertCircle, Info } from 'lucide-react';

export default function CostAttention({ missing, children, collected = false, hasAnomalies = false, noCostCount, guard }) {
  if (guard?.blocked) return <div className="cost-attention is-collecting">
    <div className="profit-cost-alert" role="status"><Info size={20} aria-hidden="true" /><span>
      <strong>{guard.title}</strong><small>{guard.message}</small>
      {missing > 0 ? <small>暂有 {missing} 条店铺 SKU 未取得有效成本，数量以本次核算结束后为准。</small> : <small>已取得的成本和利润可先查看，当前尚未核算完成。</small>}
    </span></div>{children}
  </div>;
  const explanation = noCostCount > 0 ? '有采购价但需核对的项目归入成本异常；没有可用采购成本的项目，请补录真实单件成本后计算利润。' : hasAnomalies ? '已收到价格异常，请先核对原始采购价，再决定保留原价或更正。' : collected ? '成本已回传，仍有项目缺少有效成本，请到明细核对原因并补齐。' : '采集后会显示可用成本和异常原因，也可在明细中人工补齐。';
  return <div className={`cost-attention${missing || hasAnomalies ? ' needs-attention' : ''}`}>
    {missing > 0 ? <div className="profit-cost-alert" role="status">
      <AlertCircle size={20} aria-hidden="true" />
      <span><strong>当前范围还有 {missing} 条店铺 SKU {noCostCount === missing ? '没有成本' : '待处理成本'}</strong>
        <small>{explanation}</small></span>
    </div> : null}
    {children}
  </div>;
}
