import { Button, Modal } from './UI';

export default function ErpCostRecollectionDialog({ intent, busy, changed, error, onClose, onConfirm }) {
  return <Modal open={Boolean(intent)} title="重新获取 ERP 成本" className="cost-recollection-dialog"
    description="确认后停止旧采集任务，从头读取当前范围。新证据通过核验后更新 ERP 成本；人工更正、旧回执和历史报告保留。"
    onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" loading={busy} disabled={busy || changed} onClick={onConfirm}>确认重新获取</Button></>}>
    {intent ? <div className="cost-correction-help">
      <p>账本月份：<strong>{intent.input.ledger.period}</strong></p>
      <p>筛选范围：{intent.filterLabel}</p>
      <p>本次重新读取 <strong>{intent.input.platformSkcs.length} 个 SKC / {intent.input.expectedSkus.length} 个 SKU</strong>。</p>
      <p>商品 SKC：{intent.input.platformSkcs.slice(0, 8).join('、')}{intent.input.platformSkcs.length > 8 ? ' 等' : ''}</p>
      {changed ? <p role="alert">月份、筛选范围或台账已变化，请关闭后重新确认。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </Modal>;
}
