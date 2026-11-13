const ready = Object.freeze({ blocked: false, title: '', message: '' });
const blocked = (title, message) => ({ blocked: true, title, message });
export const ERP_COST_CHANGING = '当前结果仍会变化，可查看采购证据；人工更正、确认原价和异常处理暂不可用。';

// Completion means delivery AND local evaluation, not the absence of exceptions.
// Block the ledger rather than its display filter: one warehouse can serve many SKUs.
export function erpCostEditingGuard({ workspaceId, ledgerId, tasks = [], inboxes = [], loading = false, error = '' }) {
  if (error || loading) return blocked('正在确认成本核算状态', error
    ? '暂时无法确认采集状态，成本操作暂不可用。请刷新采集状态后重试。'
    : '正在读取采集与本机核算状态，请稍候再处理成本。');
  const scoped = tasks.filter(t => t.workspaceId === workspaceId && t.ledgerId === ledgerId)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  // Old finished/abandoned attempts must not relock a newer completed request.
  const current = scoped.filter((t, i) => i === 0 || t.runnerId && !['stopped', 'invalidated', 'completed'].includes(t.status));
  const receipts = inboxes.filter(r => r.workspaceId === workspaceId && r.ledgerId === ledgerId);
  const live = r => !['rejected', 'voided'].includes(r.status);
  for (const task of current) {
    const stopped = ['stopped', 'invalidated'].includes(task.status);
    const batches = task.batches ?? [];
    const delivered = batches.length > 0 && batches.every(b => b.deliveryId);
    if (!stopped && task.runMode !== 'catalog' && !delivered) {
      const paused = ['paused', 'interrupted', 'expired', 'failed', 'partial'].includes(task.status);
      return blocked(paused ? '本次成本采集尚未完成' : '成本正在采集，当前为临时结果',
        paused ? `${ERP_COST_CHANGING} 请继续任务，或明确停止采集后处理已有结果。` : ERP_COST_CHANGING);
    }
    const outcomes = receipts.filter(r => r.requestId === task.requestId || batches.some(b => b.deliveryId === r.deliveryId));
    if (!stopped && batches.some(b => b.deliveryId && !outcomes.some(r => r.deliveryId === b.deliveryId))) {
      return blocked('成本已送达，正在完成本机核算', ERP_COST_CHANGING);
    }
    if (outcomes.some(r => live(r) && r.adoptionPending)) return blocked('正在核验采购证据并更新成本', ERP_COST_CHANGING);
    if (!stopped && outcomes.some(r => live(r) && r.adoptionFailure)) return blocked('本机成本核算尚未完成',
      '部分回传核算失败，请先重试自动采用。当前可查看证据，暂不修改成本或处理异常。');
  }
  // Manually imported receipts also pass through automatic adoption.
  if (!current.length && receipts.some(r => live(r) && r.adoptionPending)) return blocked('正在核验采购证据并更新成本', ERP_COST_CHANGING);
  return ready;
}
