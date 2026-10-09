import { Button, Panel } from './UI';
import { AlertCircle, CheckCircle2, Info, LoaderCircle } from 'lucide-react';
import { erpCollectionPresentation } from '../domain/erpCollectionStatus';

function costIssue(batch, outcomes) {
  if (batch.error) return batch.error.message ?? batch.error;
  const source = outcomes.find(inbox => inbox.deliveryId === batch.deliveryId)?.envelope?.batch;
  const evidence = source?.warehouseEvidence;
  const mappingCount = evidence?.mappingFailures?.length || source?.sourceMeta?.mappingFailureCount || 0;
  const detailCount = evidence?.detailFailures?.length || source?.sourceMeta?.detailFailureCount || 0;
  const reasons = [];
  if (mappingCount) reasons.push(`平台 SKU 映射不完整 ${mappingCount} 个仓库 SKU`);
  if (detailCount) reasons.push(`采购明细读取失败 ${detailCount} 单`);
  return reasons.join('；') || '成本已送达，但本批台账 SKU 的成本证据未齐，请展开回传结果核对。';
}
export default function ErpCollectionProgress({ task, inboxes = [], onControl, busy = false, locked = false, error = '', statusError = '' }) {
  if (!task) return error ? <p className="cost-registration-status" role="status">采集任务状态暂不可用：{error}</p> : null;
  const batches = task.batches ?? [];
  const stores = [...new Set((task.expectedSkus ?? task.requestSnapshot?.expectedSkus ?? []).map(item => item.store).filter(Boolean))];
  const delivered = batches.filter(batch => batch.deliveryId);
  const collected = batches.filter(batch => batch.collectedAt || batch.deliveryId);
  const received = new Set(delivered.map(batch => batch.deliveryId));
  const outcomes = inboxes.filter(inbox => received.has(inbox.deliveryId));
  const adopted = new Set(outcomes.filter(inbox => !['rejected', 'voided'].includes(inbox.status)).flatMap(inbox => (inbox.adoption?.items ?? []).filter(item => item.state === 'adopted').map(item => item.canonicalPlatformSku ?? item.platformSku)));
  const manual = new Set(outcomes.flatMap(inbox => (inbox.adoption?.items ?? []).filter(item => item.state === 'manual_effective').map(item => item.canonicalPlatformSku ?? item.platformSku)));
  const failures = batches.filter(batch => ['failed', 'incomplete'].includes(batch.status));
  const readFailures = failures.filter(batch => batch.status === 'failed');
  const incomplete = failures.filter(batch => batch.status === 'incomplete');
  const catalogChecked = batches.filter(batch => ['completed', 'failed'].includes(batch.catalogStatus));
  const catalogComplete = batches.filter(batch => batch.catalogStatus === 'completed');
  const catalogIssues = batches.filter(batch => batch.catalogStatus === 'failed');
  const total = task.summary?.total ?? batches.reduce((sum, batch) => sum + batch.platformSkcs.length, 0);
  const count = list => list.reduce((sum, batch) => sum + batch.platformSkcs.length, 0);
  const duration = Date.parse(task.updatedAt ?? task.createdAt) - Date.parse(task.createdAt);
  const elapsed = Number.isFinite(duration) ? Math.max(0, Math.floor(duration / 60000)) : 0;
  const view = statusError ? { ...erpCollectionPresentation(task), running: false, canResume: false, canRetry: false,
    tone: 'warning', title: '采集状态暂无法确认', description: '连接检查失败；已收到结果保留。连接恢复后自动刷新状态，请先查看下方错误原因。' }
    : erpCollectionPresentation(task);
  const Icon = view.running ? LoaderCircle : view.tone === 'warning' ? AlertCircle : view.state === 'completed' ? CheckCircle2 : Info;
  return <Panel className="erp-collection-progress">
    <div className="panel-header"><div><h2>ERP 分批采集</h2><p>{task.ledgerPeriod} · 固定 {total} 个 SKC</p></div>
      <div className="page-actions">
        {view.running ? <Button disabled={busy || task.status === 'pausing'} onClick={() => onControl('pause')}>暂停采集</Button> : null}
        {view.canStop ? <Button disabled={busy || Boolean(statusError)} onClick={() => onControl('stop')}>停止采集</Button> : null}
        {view.canResume ? <Button disabled={busy || locked} onClick={() => onControl('resume')}>{delivered.length === batches.length && view.catalogPending ? '继续补充资料' : '核验并继续'}</Button> : null}
        {failures.length ? <Button disabled={busy || locked || !view.canRetry} onClick={() => onControl('retry_failed')}>重试失败批次</Button> : null}
      </div>
    </div>
    <div className={`erp-collection-activity erp-activity-${view.tone}`} role="status" aria-live="polite">
      <Icon size={20} className={view.running ? 'spin' : ''} aria-hidden="true" />
      <div><strong>{view.title}</strong><p>{view.description}</p></div>
    </div>
    <div className="erp-collection-counts" role="status"><span>已采集 <strong>{count(collected)} / {total}</strong> SKC</span><span>已送达 <strong>{count(delivered)} / {total}</strong> SKC</span><span>已采用 <strong>{adopted.size}</strong> SKU{manual.size ? ` · 人工有效 ${manual.size}` : ''}</span></div>
    {stores.length ? <p>原任务店铺：{stores.join('、')} · 剩余 {batches.length - delivered.length} 批成本待读取或送达</p> : null}
    <div className="erp-collection-meter"><span>成本回传 · 已送达 {delivered.length} / {batches.length} 批</span><progress max={Math.max(1, batches.length)} value={delivered.length} aria-label="ERP 批次送达进度" /></div>
    <div className="erp-collection-meter"><span>资料检查 · 已结束 {catalogChecked.length} / {batches.length} 批 · 资料齐全 {catalogComplete.length} 批{catalogIssues.length ? ` · 待补齐 ${catalogIssues.length} 批` : ''}</span><progress max={Math.max(1, batches.length)} value={catalogChecked.length} aria-label="ERP 资料检查进度" /></div>
    <p>已送达 {delivered.length} / {batches.length} 批 · 耗时 {elapsed} 分钟 · 最近进展 {task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString('zh-CN') : '等待采集'}</p>
    <p>查看筛选不改变此任务；已送达结果按证据核验后采用。{view.canResume ? '恢复后请在 ERP 助手点击继续采集。' : ''}</p>
    {task.phase && view.state !== 'completed' ? <p>当前阶段：{task.phase === 'catalog' ? '补充资料' : '采购成本'}</p> : null}
    {view.catalogPending ? <p>成本回传与资料齐全分别核对；图片或供应商链接缺项时，已采用的成本继续保留。</p> : null}
    {readFailures.length ? <details><summary>{readFailures.length} 批请求失败</summary>{readFailures.map(batch => <p key={batch.batchId}>批次 {batches.indexOf(batch) + 1}：{batch.error?.message ?? batch.error ?? 'ERP 请求未完成，请重试此批次。'}</p>)}</details> : null}
    {incomplete.length ? <details><summary>{incomplete.length} 批成本已送达，证据待补齐</summary>{incomplete.map(batch => <p key={batch.batchId}>批次 {batches.indexOf(batch) + 1}：{costIssue(batch, outcomes)}</p>)}</details> : null}
    {catalogIssues.length ? <details><summary>{catalogIssues.length} 批资料待补齐</summary>{catalogIssues.map(batch => <p key={batch.batchId}>批次 {batches.indexOf(batch) + 1}：{batch.catalogError || '资料尚未齐全或回执未确认，可继续补充资料。'}</p>)}</details> : null}
    {error ? <p role="alert">{error}</p> : null}
  </Panel>;
}
