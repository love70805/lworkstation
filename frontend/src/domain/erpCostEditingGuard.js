import { ERP_COST_ROUND_ENDED, canReviewErpCostRound, erpCollectionPresentation, hasFinishedCostAttemptWithIssues, unfinishedCostTaskHint } from './erpCollectionStatus';

const ready = Object.freeze({ blocked: false, title: '', message: '' });
const reviewable = Object.freeze({ blocked: false, title: ERP_COST_ROUND_ENDED, message: '可直接补录缺失成本，或核对有价格异常的采购记录。' });
const blocked = (title, message) => ({ blocked: true, title, message });
export const ERP_COST_CHANGING = '当前结果仍会变化，可查看采购证据；人工更正、确认原价和异常处理暂不可用。';

// Editing waits for the end of the read and for local writes on actual receipts.
// The guard covers the ledger, since one warehouse can serve many SKUs.
export function erpCostEditingGuard({ workspaceId, ledgerId, tasks = [], inboxes = [], loading = false, error = '' }) {
  const scoped = tasks.filter(t => t.workspaceId === workspaceId && t.ledgerId === ledgerId)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  // Old finished/abandoned attempts must not relock a newer completed request.
  const current = scoped.filter((t, i) => i === 0 || t.runnerId && !['stopped', 'invalidated', 'completed'].includes(t.status));
  const receipts = inboxes.filter(r => r.workspaceId === workspaceId && r.ledgerId === ledgerId);
  if (error) {
    const finished = !loading && current.length > 0 && current.every(task => canReviewErpCostRound(task, receipts));
    const unfinished = current.map(unfinishedCostTaskHint).find(Boolean);
    return { ...blocked(finished ? ERP_COST_ROUND_ENDED : '采集状态暂无法确认',
      `${finished ? '上次已确认本机核算结束。' : unfinished ? '上次确认时，' + unfinished : ''}当前无法读取最新任务，请刷新采集状态后再操作。`), lastConfirmedFinished: finished };
  }
  if (loading) return blocked('正在确认成本核算状态', '正在读取采集与本机核算状态，请稍候再处理成本。');
  const live = r => !['rejected', 'voided'].includes(r.status);
  let result = ready;
  for (const task of current) {
    const stopped = ['stopped', 'invalidated'].includes(task.status);
    const batches = task.batches ?? [];
    const delivered = batches.length > 0 && batches.every(b => b.deliveryId);
    const finishedWithIssues = hasFinishedCostAttemptWithIssues(task);
    if (!stopped && task.runMode !== 'catalog' && !delivered && !finishedWithIssues) {
      const stage = erpCollectionPresentation(task);
      return blocked(stage.title, `${unfinishedCostTaskHint(task)}${stage.description}`);
    }
    const outcomes = receipts.filter(r => r.requestId === task.requestId || batches.some(b => b.deliveryId === r.deliveryId));
    const awaitingReceipt = !stopped && batches.some(b => b.deliveryId && !outcomes.some(r => r.deliveryId === b.deliveryId));
    const evaluating = outcomes.some(r => live(r) && r.adoptionPending);
    if (finishedWithIssues && (awaitingReceipt || evaluating)) return blocked('本轮采集已结束，正在核验已回传成本', '本机核算完成后即可补录缺失成本。');
    if (awaitingReceipt) {
      return blocked('成本已送达，正在完成本机核算', ERP_COST_CHANGING);
    }
    if (evaluating) return blocked('正在核验采购证据并更新成本', ERP_COST_CHANGING);
    if (!stopped && outcomes.some(r => live(r) && r.adoptionFailure)) return blocked('本机成本核算尚未完成',
      '部分回传核算失败，请先重试自动采用。当前可查看证据，暂不修改成本或处理异常。');
    if (task === scoped[0] && finishedWithIssues) result = reviewable;
  }
  // Manually imported receipts also pass through automatic adoption.
  if (!current.length && receipts.some(r => live(r) && r.adoptionPending)) return blocked('正在核验采购证据并更新成本', ERP_COST_CHANGING);
  return result;
}
