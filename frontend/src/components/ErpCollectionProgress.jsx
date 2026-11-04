import { Button, Panel } from './UI';
import { AlertCircle, CheckCircle2, Info, LoaderCircle } from 'lucide-react';
import { erpCollectionPresentation, erpCostCollectionTiming } from '../domain/erpCollectionStatus';

const canonical = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
function scopeSkcs(batches) {
  return [...new Map(batches.flatMap(batch => batch.platformSkcs ?? []).filter(value => canonical(value))
    .map(value => [canonical(value), String(value).trim()])).values()];
}
const scopeLabel = batch => `SKC：${scopeSkcs([batch]).join('、') || '范围暂不可用'}`;

function costIssue(batch, outcomes) {
  if (batch.error) return batch.error.message ?? batch.error;
  const source = outcomes.find(inbox => inbox.deliveryId === batch.deliveryId)?.envelope?.batch;
  const evidence = source?.warehouseEvidence;
  const mappingCount = evidence?.mappingFailures?.length || source?.sourceMeta?.mappingFailureCount || 0;
  const detailCount = evidence?.detailFailures?.length || source?.sourceMeta?.detailFailureCount || 0;
  const reasons = [];
  if (mappingCount) reasons.push(`平台 SKU 映射不完整 ${mappingCount} 个仓库 SKU`);
  if (detailCount) reasons.push(`采购明细读取失败 ${detailCount} 单`);
  return reasons.join('；') || '成本已送达，但对应台账 SKU 的成本证据未齐，请展开回传结果核对。';
}
function mappingIssues(batch, outcomes) {
  const source = outcomes.find(inbox => inbox.deliveryId === batch.deliveryId)?.envelope?.batch;
  const failures = source?.sourceMeta?.mappingFailures ?? source?.warehouseEvidence?.mappingFailures;
  return (Array.isArray(failures) ? failures : []).filter(item => item?.platformSku || item?.platformSkc || item?.warehouseSku);
}
export default function ErpCollectionProgress({ task, inboxes = [], onControl, busy = false, locked = false, error = '', statusError = '', showCatalog = false }) {
  if (!task) return error ? <p className="cost-registration-status" role="status">采集任务状态暂不可用：{error}</p> : null;
  const batches = task.batches ?? [];
  const expectedSkus = task.expectedSkus ?? task.requestSnapshot?.expectedSkus ?? [];
  const stores = [...new Set(expectedSkus.map(item => item.store).filter(Boolean))];
  const skuCount = new Set(expectedSkus.map(item => canonical(item.platformSku)).filter(Boolean)).size;
  const delivered = batches.filter(batch => batch.deliveryId);
  const collected = batches.filter(batch => batch.collectedAt || batch.deliveryId);
  const received = new Set(delivered.map(batch => batch.deliveryId));
  const outcomes = inboxes.filter(inbox => received.has(inbox.deliveryId) && (!task.workspaceId || inbox.workspaceId === task.workspaceId));
  const adopted = new Set(outcomes.filter(inbox => !['rejected', 'voided'].includes(inbox.status)).flatMap(inbox => (inbox.adoption?.items ?? []).filter(item => item.state === 'adopted').map(item => item.canonicalPlatformSku ?? item.platformSku)));
  const manual = new Set(outcomes.flatMap(inbox => (inbox.adoption?.items ?? []).filter(item => item.state === 'manual_effective').map(item => item.canonicalPlatformSku ?? item.platformSku)));
  const failures = batches.filter(batch => ['failed', 'incomplete'].includes(batch.status));
  const readFailures = failures.filter(batch => batch.status === 'failed');
  const incomplete = failures.filter(batch => batch.status === 'incomplete');
  const catalogChecked = batches.filter(batch => ['completed', 'failed'].includes(batch.catalogStatus));
  const catalogComplete = batches.filter(batch => batch.catalogStatus === 'completed');
  const catalogIssues = batches.filter(batch => batch.catalogStatus === 'failed');
  const count = list => scopeSkcs(list).length;
  const total = count(batches);
  const deliveredCount = count(delivered);
  const localFailure = outcomes.find(inbox => inbox.adoptionFailure && !['rejected', 'voided'].includes(inbox.status))?.adoptionFailure;
  const localPending = outcomes.some(inbox => inbox.adoptionPending && !['rejected', 'voided'].includes(inbox.status));
  const timing = erpCostCollectionTiming(task);
  const presentation = erpCollectionPresentation(task);
  let view = statusError ? { ...presentation, running: false, canResume: false, canRetry: false,
    tone: 'warning', title: '采集状态暂无法确认', description: '连接检查失败；已收到结果保留。连接恢复后自动刷新状态，请先查看下方错误原因。' }
    : !presentation.running && (localFailure || localPending) ? { ...presentation, tone: localFailure ? 'warning' : 'info' } : presentation;
  if (!showCatalog && timing.completed && !statusError) {
    const waiting = localPending || outcomes.length < delivered.length;
    view = { ...view, running: waiting, catalogOnly: false, canResume: false, canStop: false,
      tone: localFailure ? 'warning' : waiting ? 'info' : 'success',
      title: localFailure ? '本机核算待重试' : waiting ? '成本已送达，正在核验并更新利润' : '成本已更新',
      description: localFailure ? localFailure.message : waiting ? '原始采购数据已收到，正在保存可用成本。' : '价格异常可一键忽略；无采购数据的项目在明细中单独提示。' };
  }
  const awaitingLocal = !showCatalog && timing.completed && view.running;
  const stage = awaitingLocal ? {label: '正在核验采购证据并更新利润'} : task.progress;
  const Icon = view.running ? LoaderCircle : view.tone === 'warning' ? AlertCircle : view.tone === 'success' ? CheckCircle2 : Info;
  return <Panel className="erp-collection-progress" id="erp-collection-progress" tabIndex={-1}>
    <div className="panel-header"><div><h2>ERP 采集任务</h2><p>{task.ledgerPeriod} · 范围 {total} 个 SKC{skuCount ? ` / ${skuCount} 个 SKU` : ''}{task.taskId ? ` · 任务 ${task.taskId.slice(-8)}` : ''}</p></div>
      <div className="page-actions">
        {!awaitingLocal && (view.running || view.state === 'queued') ? <Button disabled={busy || Boolean(statusError) || task.status === 'pausing'} onClick={() => onControl('pause')}>暂停采集</Button> : null}
        {view.canStop && (!view.catalogOnly || view.running) ? <Button disabled={busy || Boolean(statusError)} onClick={() => onControl('stop')}>停止采集</Button> : null}
        {view.canResume && (showCatalog || !view.catalogOnly) ? <Button disabled={busy || locked} onClick={() => onControl(view.catalogOnly ? 'catalog' : 'resume')}>{view.catalogOnly ? task.catalogMode === 'after_costs' ? '继续整理商品资料' : '按需补齐商品资料' : '继续原任务'}</Button> : null}
        {failures.length ? <Button disabled={busy || locked || !view.canRetry} onClick={() => onControl('retry_failed')}>重试未完成项</Button> : null}
      </div>
    </div>
    <div className={`erp-collection-activity erp-activity-${view.tone}`} role="status" aria-live="polite">
      <Icon size={20} className={view.running ? 'spin' : ''} aria-hidden="true" />
      <div><strong>{view.title}</strong><p>{view.description}</p></div>
    </div>
    <div className="erp-collection-counts" role="status"><span>已采集 <strong>{count(collected)} / {total}</strong> SKC</span><span>已送达 <strong>{deliveredCount} / {total}</strong> SKC</span><span>已采用 <strong>{adopted.size}</strong> SKU{manual.size ? ` · 人工有效 ${manual.size}` : ''}</span></div>
    {localFailure ? <p role="status">本机核算未完成：{localFailure.message || '成本采用处理失败，请查看成本核对中的重试处理入口。'}。已送达证据保留，请以成本采用明细为准。</p>
      : localPending ? <p role="status">正在本机核验并采用成本；采购证据送达不代表核算完成，请以成本采用明细为准。</p> : null}
    {view.running && (!stage || stage.phase !== 'catalog' || showCatalog) ? <div className="erp-collection-meter" role="status">
      <span>{stage?.label || '正在等待 ERP 返回数据'}{stage?.total != null ? ' · ' + stage.completed + ' / ' + stage.total + ' ' + (stage.unit || '') : ' · 总量尚未确认'}</span>
      <progress max={Math.max(1, stage?.total || 1)} value={stage?.total > 0 ? stage.completed : undefined} aria-label="当前处理进度" />
    </div> : null}
    <div className="erp-collection-meter"><span>成本回传 · 已送达 {deliveredCount} / {total} 个 SKC</span><progress max={Math.max(1, total)} value={deliveredCount} aria-label="ERP 成本送达进度" /></div>
    <details className="erp-task-details"><summary>任务范围与采集详情</summary>
    {stores.length ? <p>原任务店铺：{stores.join('、')} · 剩余 {Math.max(0, total - deliveredCount)} 个 SKC 的成本待读取或送达</p> : null}
    {showCatalog ? <div className="erp-collection-meter"><span>商品资料{task.catalogMode === 'on_demand' ? '（按需补齐）' : task.catalogMode === 'after_costs' ? '（全部核算后统一整理）' : ''} · 已检查 {count(catalogChecked)} / {total} 个 SKC · 已确认齐全 {count(catalogComplete)} 个 SKC{catalogIssues.length ? ` · 待核对范围 ${count(catalogIssues)} 个 SKC` : ''}</span><progress max={Math.max(1, total)} value={count(catalogChecked)} aria-label="ERP 资料检查进度" /></div> : null}
    <p>成本采集历时 {timing.elapsedMinutes == null ? '暂无记录' : `${timing.elapsedMinutes} 分钟`}{timing.endedAt ? ` · 成本送达完成 ${new Date(timing.endedAt).toLocaleTimeString('zh-CN')}` : ''} · 最近活动 {task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString('zh-CN') : '等待采集'}</p>
    {timing.completed ? <p>成本读取与送达已结束；后续采用同步和异常核对不计入采集历时。</p> : null}
    <p>查看筛选不改变此任务；已送达结果按证据核验后采用。继续原任务保留已送达进度；重新采集会从头读取。</p>
    {task.phase && (showCatalog || task.phase !== 'catalog') && !['completed', 'cost_completed'].includes(view.state) ? <p>当前阶段：{task.phase === 'catalog' ? '补充资料' : timing.completed ? '成本证据核对' : '采购成本'}</p> : null}
    {showCatalog && view.catalogPending ? <p>成本回传与资料齐全分别核对；图片或供应商链接缺项时，已采用的成本继续保留。</p> : null}
    {task.status === 'paused' && task.pauseReason?.code === 'ERP_PERMISSION_REQUIRED' && task.pauseReason.message ? <p>暂停原因：{task.pauseReason.message}</p> : null}
    </details>
    {readFailures.length ? <details><summary>读取未完成，涉及 {count(readFailures)} 个 SKC</summary>{readFailures.map(batch => <p key={batch.batchId}>{scopeLabel(batch)} · {batch.error?.message ?? batch.error ?? 'ERP 请求未完成，请重试对应范围。'}</p>)}</details> : null}
    {incomplete.length ? <details><summary>成本证据待补齐，涉及 {count(incomplete)} 个 SKC</summary>{incomplete.map(batch => <div key={batch.batchId}><p>{scopeLabel(batch)} · {costIssue(batch, outcomes)}</p>{mappingIssues(batch, outcomes).map((issue, index) => <p key={index}>平台 SKU：{issue.platformSku || '未返回'} · SKC：{issue.platformSkc || '未返回'}{issue.warehouseSku ? ` · 仓库 SKU：${issue.warehouseSku}` : ''} · {issue.message || 'ERP 映射尚未确认，请核对该规格的映射关系。'}</p>)}</div>)}</details> : null}
    {showCatalog && catalogIssues.length ? <details><summary>商品资料待核对，涉及 {count(catalogIssues)} 个 SKC</summary>{catalogIssues.map(batch => <p key={batch.batchId}>{scopeLabel(batch)} · {batch.catalogError || '资料尚未齐全或回执未确认，可继续补充资料。'}</p>)}</details> : null}
    {error ? <p role="alert">{error}</p> : null}
  </Panel>;
}
