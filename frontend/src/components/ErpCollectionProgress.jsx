import { Button, Panel } from './UI';
import { hasPendingErpCatalog, isActiveErpCollection } from '../domain/erpCollectionStatus';

const labels = { ready: '等待开始', running: '采集中', paused: '已暂停', pausing: '正在暂停', stopped: '已停止', interrupted: '等待继续', expired: '等待重新核验', partial: '部分完成', cost_complete: '成本采集已完成', completed: '成本采集已完成', complete: '成本采集已完成', failed: '有失败批次', invalidated: '范围已变化' };
export default function ErpCollectionProgress({ task, inboxes = [], onControl, busy = false, locked = false, error = '' }) {
  if (!task) return error ? <p className="cost-registration-status" role="status">采集任务状态暂不可用：{error}</p> : null;
  const batches = task.batches ?? [];
  const delivered = batches.filter(batch => batch.deliveryId);
  const collected = batches.filter(batch => batch.collectedAt || batch.deliveryId);
  const received = new Set(delivered.map(batch => batch.deliveryId));
  const outcomes = inboxes.filter(inbox => received.has(inbox.deliveryId));
  const adopted = new Set(outcomes.filter(inbox => !['rejected', 'voided'].includes(inbox.status)).flatMap(inbox => (inbox.adoption?.items ?? []).filter(item => item.state === 'adopted').map(item => item.canonicalPlatformSku ?? item.platformSku)));
  const manual = new Set(outcomes.flatMap(inbox => (inbox.adoption?.items ?? []).filter(item => item.state === 'manual_effective').map(item => item.canonicalPlatformSku ?? item.platformSku)));
  const failures = batches.filter(batch => ['failed', 'incomplete'].includes(batch.status));
  const total = task.summary?.total ?? batches.reduce((sum, batch) => sum + batch.platformSkcs.length, 0);
  const count = list => list.reduce((sum, batch) => sum + batch.platformSkcs.length, 0);
  const elapsed = Math.max(0, Math.floor((Date.parse(task.updatedAt ?? task.createdAt) - Date.parse(task.createdAt)) / 60000));
  const catalogPending = hasPendingErpCatalog(task);
  const running = ['running', 'pausing'].includes(task.status) || task.status === 'cost_complete' && task.phase === 'catalog' && !task.recoveryRequired;
  const canResume = task.recoveryRequired || ['ready', 'paused', 'interrupted', 'expired', 'partial', 'failed'].includes(task.status) || task.status === 'cost_complete' && catalogPending;
  return <Panel className="erp-collection-progress">
    <div className="panel-header"><div><h2>ERP 分批采集</h2><p>{task.ledgerPeriod} · 固定 {total} 个 SKC · {labels[task.status] ?? '等待核对'}</p></div>
      <div className="page-actions">
        {running ? <Button disabled={busy || task.status === 'pausing'} onClick={() => onControl('pause')}>暂停采集</Button> : null}
        {isActiveErpCollection(task) ? <Button disabled={busy} onClick={() => onControl('stop')}>停止采集</Button> : null}
        {canResume ? <Button disabled={busy || locked} onClick={() => onControl('resume')}>{task.status === 'cost_complete' ? '继续补充资料' : '核验并继续'}</Button> : null}
        {failures.length ? <Button disabled={busy || locked || running} onClick={() => onControl('retry_failed')}>重试失败批次</Button> : null}
      </div>
    </div>
    <div className="erp-collection-counts" role="status"><span>已采集 <strong>{count(collected)} / {total}</strong> SKC</span><span>已送达 <strong>{count(delivered)} / {total}</strong> SKC</span><span>已采用 <strong>{adopted.size}</strong> SKU{manual.size ? ` · 人工有效 ${manual.size}` : ''}</span></div>
    <progress max={Math.max(1, batches.length)} value={delivered.length} aria-label="ERP 批次送达进度" />
    <p>已送达 {delivered.length} / {batches.length} 批 · 耗时 {elapsed} 分钟 · 最近进展 {task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString('zh-CN') : '等待采集'}</p>
    <p>查看筛选不改变此任务；已送达结果按证据核验后采用。恢复后请在 ERP 助手点击继续采集。</p>
    {task.phase ? <p>当前阶段：{task.phase === 'catalog' ? '补充资料' : '采购成本'}</p> : null}
    {catalogPending ? <p>资料已完成 {batches.filter(batch => batch.catalogStatus === 'completed').length} / {batches.length} 批；成本回传与资料进度分别保留。</p> : null}
    {failures.length ? <details><summary>{failures.length} 个失败批次</summary>{failures.map((batch, index) => <p key={batch.batchId}>批次 {batches.indexOf(batch) + 1}：{batch.error?.message ?? batch.error ?? '采集未完成'}</p>)}</details> : null}
    {error ? <p role="alert">{error}</p> : null}
  </Panel>;
}
