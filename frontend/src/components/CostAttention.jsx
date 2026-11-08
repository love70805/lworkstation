import { AlertCircle } from 'lucide-react';

export default function CostAttention({ missing, children, collected = false, hasAnomalies = false, compact = false }) {
  const explanation = hasAnomalies ? '已收到价格异常，请先核对原始采购价，再决定保留原价或更正。' : collected ? '成本已回传，仍有项目缺少有效成本，请到明细核对原因并补齐。' : '采集后会显示可用成本和异常原因，也可在明细中人工补齐。';
  return <div className={`cost-attention${missing || hasAnomalies ? ' needs-attention' : ''}`}>
    {missing > 0 ? <div className="profit-cost-alert" role="status">
      <AlertCircle size={20} aria-hidden="true" />
      <span><strong>当前范围还有 {missing} 条店铺 SKU 待确认成本</strong>
        {!compact && <small>{explanation}</small>}</span>
    </div> : null}
    {children}
    {compact && missing > 0 ? <details className="cost-attention-help"><summary>核对说明</summary><p>{explanation}</p></details> : null}
  </div>;
}
