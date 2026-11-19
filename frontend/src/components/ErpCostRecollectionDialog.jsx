import { Button, Modal } from './UI';
import { unfinishedCostTaskHint } from '../domain/erpCollectionStatus';

export default function ErpCostRecollectionDialog({ intent, task = intent?.task, editingGuard, busy, changed, error, onClose, onConfirm, onScope }) {
  const retry = intent?.choice === 'retry';
  const unfinished = unfinishedCostTaskHint(task);
  const labels = { retry: '重试本轮未完成项', missing: '仅补缺成本', full: '重新采集当前全部' };
  return <Modal open={Boolean(intent)} title="重新获取 ERP 成本" className="cost-recollection-dialog"
    description="选好范围并确认后开始。新证据通过核验后更新 ERP 成本，已保存的人工价和历史报告保留。"
    onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" loading={busy} disabled={busy || changed || !retry && !intent?.input.expectedSkus.length} onClick={onConfirm}>{retry ? '确认重试' : '确认重新获取'}</Button></>}>
    {intent ? <div className="cost-correction-help">
      <p>账本月份：<strong>{intent.input.ledger.period}</strong></p>
      {unfinished && !intent.run?.stopped && <p role="status"><strong>{unfinished}</strong>取消可保留原任务。确认重新获取会结束原任务，再按下方范围采集。</p>}
      {!unfinished && editingGuard?.blocked && <p role="status"><strong>{editingGuard.title}</strong> {editingGuard.message}</p>}
      <fieldset disabled={busy || changed || Boolean(intent.run?.stopped || intent.run?.request)}><legend>采集范围</legend>
        {Object.entries(intent.scopes).map(([choice, scope]) => <label key={choice}>
          <input type="radio" name="erp-cost-scope" value={choice} checked={choice === intent.choice} onChange={() => onScope(choice)} />
          {labels[choice]}（{scope.expectedSkus.length} 个 SKU）
        </label>)}
      </fieldset>
      <p>{retry ? '范围来自上轮任务，含读取失败或证据不完整的项。' : `当前筛选范围 · ${intent.filterLabel}。`}</p>
      <p>本次{retry ? '重试' : '重新读取'} <strong>{intent.input.platformSkcs.length} 个 SKC / {intent.input.expectedSkus.length} 个 SKU</strong>。</p>
      {intent.input.platformSkcs.length ? <p>商品 SKC：{intent.input.platformSkcs.slice(0, 8).join('、')}{intent.input.platformSkcs.length > 8 ? ' 等' : ''}</p>
        : <p>{retry ? '先送达已暂存的采购证据。' : '采购证据已送达，等待本机核算。'}</p>}
      {changed && !busy ? <p role="alert">采集任务或所选范围已变化，请关闭后重新确认。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </Modal>;
}
