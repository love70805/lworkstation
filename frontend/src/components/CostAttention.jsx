import { AlertCircle } from 'lucide-react';
import { Button } from './UI';

export default function CostAttention({ missing, onShowMissing, children, collected = false, hasAnomalies = false }) {
  return <div className={`cost-attention${missing || hasAnomalies ? ' needs-attention' : ''}`}>
    {missing > 0 ? <div className="profit-cost-alert" role="status">
      <AlertCircle size={20} aria-hidden="true" />
      <span><strong>当前范围还有 {missing} 条店铺 SKU 待确认成本</strong>
        <small>{hasAnomalies ? '已收到价格异常，请先核对原始采购价，再决定保留原价或更正。' : collected ? '成本已回传，仍有项目缺少有效成本，请到明细核对原因并补齐。' : '采集后会显示可用成本和异常原因，也可在明细中人工补齐。'}</small></span>
      <Button variant="primary" onClick={onShowMissing}>只看待补成本</Button>
    </div> : null}
    {children}
  </div>;
}
