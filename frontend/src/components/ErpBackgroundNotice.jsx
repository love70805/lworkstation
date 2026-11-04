import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Info, LoaderCircle } from 'lucide-react';
import { erpCollectionPresentation, isActiveErpCollection } from '../domain/erpCollectionStatus';
import { readErpCollectionActivity, subscribeErpCollectionActivity } from '../lib/erpCollectionActivity';
import { profitWorkspaceHref } from '../lib/workspaceNavigation';
import { requestErpInboxRefresh } from '../lib/erpInboxEvents';

export function revealErpCollectionProgress() {
  const panel = document.getElementById('erp-collection-progress');
  panel?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  panel?.focus({ preventScroll: true });
}

export function ErpBackgroundNoticeContent({ tasks = [], error = '', receiptError = '' }) {
  const active = tasks.filter(isActiveErpCollection);
  const task = active.find(item => erpCollectionPresentation(item).running) ?? active[0] ?? (receiptError ? tasks[0] : null);
  if (!task && !receiptError) return null;
  const view = erpCollectionPresentation(task);
  const hasError = Boolean(error || receiptError);
  const Icon = hasError ? AlertCircle : view.running ? LoaderCircle : view.tone === 'warning' ? AlertCircle : Info;
  const count = (task?.batches ?? []).reduce((sum, batch) => sum + (batch.deliveryId ? batch.platformSkcs.length : 0), 0);
  const total = (task?.batches ?? []).reduce((sum, batch) => sum + batch.platformSkcs.length, 0);
  return <div className={`erp-background-notice erp-activity-${hasError ? 'warning' : view.tone}`} role="status" aria-live="polite">
    <Icon size={20} className={!hasError && view.running ? 'spin' : ''} aria-hidden="true" />
    <div className="erp-background-copy"><strong>{receiptError ? '成本回传处理遇到问题' : error ? '后台采集状态暂无法确认' : view.title}</strong>
      {task && <span>{task.ledgerPeriod} · 成本已送达 {count} / {total} 个 SKC{active.length > 1 ? ` · 另有 ${active.length - 1} 个任务` : ''}</span>}
      <small>{receiptError ? `${receiptError} 系统会自动重试；是否计入利润请查看成本采用明细。` : error ? `连接检查失败：${error}。已收到结果保留，连接恢复后自动刷新状态。` : view.description}</small>
    </div>
    {receiptError ? <button type="button" className="button button-ghost" onClick={requestErpInboxRefresh}>重试处理</button> : null}
    <Link className="button button-ghost" to={!receiptError && view.state === 'catalog_running' ? '/products?collection=1' : profitWorkspaceHref(task ? `ledger=${encodeURIComponent(task.ledgerId)}` : '', 'detail') + (receiptError ? '' : '#erp-collection-progress')} onClick={() => { if (!receiptError) window.setTimeout(revealErpCollectionProgress, 0); }}>{receiptError ? '查看待处理成本' : view.state === 'catalog_running' ? '查看资料补齐' : '查看采集状态'}</Link>
  </div>;
}

export default function ErpBackgroundNotice({ workspaceId }) {
  const activity = useSyncExternalStore(subscribeErpCollectionActivity,
    () => readErpCollectionActivity(workspaceId), () => readErpCollectionActivity(workspaceId));
  return <ErpBackgroundNoticeContent {...activity} />;
}
