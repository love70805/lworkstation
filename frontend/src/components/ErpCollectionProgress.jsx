import { Button, Panel } from './UI';
import { AlertCircle, CheckCircle2, Info, LoaderCircle } from 'lucide-react';
import { canReviewErpCostRound, erpCollectionPresentation, erpCostCollectionTiming, hasFinishedCostAttemptWithIssues } from '../domain/erpCollectionStatus';
import { erpCostEditingGuard } from '../domain/erpCostEditingGuard';
import CollectionProgressBar from './CollectionProgressBar';

const canonical = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
function scopeSkcs(batches) {
  return [...new Map(batches.flatMap(batch => batch.platformSkcs ?? []).filter(value => canonical(value))
    .map(value => [canonical(value), String(value).trim()])).values()];
}
const scopeLabel = batch => `SKC：${scopeSkcs([batch]).join('、') || '范围暂不可用'}`;

function costIssue(batch, source) {
  if (batch.error) return batch.error.message ?? batch.error;
  const evidence = source?.warehouseEvidence;
  const mappingCount = evidence?.mappingFailures?.length || source?.sourceMeta?.mappingFailureCount || 0;
  const detailCount = evidence?.detailFailures?.length || source?.sourceMeta?.detailFailureCount || 0;
  const reasons = [];
  if (mappingCount) reasons.push(`平台 SKU 映射不完整 ${mappingCount} 个仓库 SKU`);
  if (detailCount) reasons.push(`采购明细读取失败 ${detailCount} 单`);
  return reasons.join('；') || '成本已送达，但对应台账 SKU 的成本证据未齐，请展开回传结果核对。';
}
function collectionCostIssues(batches, outcomes, expectedSkus) {
  const parents = new Map(expectedSkus.map(row => [canonical(row.platformSku), row.platformSkc]));
  const byDelivery = new Map(outcomes.map(row => [row.deliveryId, row]));
  const evidence = new Map(), anomalies = new Map(), unlocated = [];
  for (const batch of batches) {
    const inbox = byDelivery.get(batch.deliveryId);
    if (!batch.deliveryId || ['voided', 'rejected'].includes(inbox?.status)) continue;
    const source = inbox?.envelope?.batch;
    const failures = source?.sourceMeta?.mappingFailures ?? source?.warehouseEvidence?.mappingFailures;
    const mappings = Array.isArray(failures) ? failures : [];
    const bySku = new Map(mappings.filter(issue => issue?.platformSku).map(issue => [canonical(issue.platformSku), issue]));
    const items = inbox?.adoption?.items;
    const add = (group, issue, message) => {
      const sku = canonical(issue.platformSku);
      const skc = issue.platformSkc || parents.get(sku) || (batch.platformSkcs?.length === 1 ? batch.platformSkcs[0] : null);
      const key = sku || JSON.stringify([skc, issue.warehouseSku]);
      group.set(key, { platformSku: issue.platformSku, platformSkc: skc, warehouseSku: issue.warehouseSku, message });
    };
    if (items?.length && !inbox.adoptionPending && !inbox.adoptionFailure) {
      for (const item of items) {
        const mapping = bySku.get(canonical(item.platformSku));
        if (item.state === 'anomaly_pending') add(anomalies, item, '采购价格异常，需核对单价。');
        if (item.state === 'missing') add(evidence, item, '本月缺少可采用的采购成本。');
        if (item.state === 'evidence_incomplete') add(evidence, { ...item, ...mapping }, mapping?.message || '采购证据或 SKU 归属尚未核实。');
      }
    } else if (batch.status === 'incomplete') {
      for (const issue of mappings) {
        if (issue?.platformSku || issue?.platformSkc || issue?.warehouseSku) add(evidence, issue, issue.message || costIssue(batch, source));
      }
      if (!mappings.length || !items?.length) unlocated.push(batch);
    }
  }
  return { evidence: [...evidence.values()], anomalies: [...anomalies.values()], unlocated };
}

function CostIssueList({ title, issues }) {
  if (!issues.length) return null;
  const skcs = new Set(issues.map(item => canonical(item.platformSkc)).filter(Boolean));
  const skus = new Set(issues.map(item => canonical(item.platformSku)).filter(Boolean));
  return <details><summary>{title}{skcs.size ? `，涉及 ${skcs.size} 个 SKC` : ''}{skus.size ? ` · ${skus.size} 个 SKU` : ''}</summary>
    {issues.map((issue, index) => <p key={index}>{issue.platformSku ? `平台 SKU：${issue.platformSku} · ` : ''}{issue.platformSkc ? `SKC：${issue.platformSkc} · ` : ''}{issue.warehouseSku ? `仓库 SKU：${issue.warehouseSku} · ` : ''}{issue.message}</p>)}
  </details>;
}
export default function ErpCollectionProgress({ task, inboxes = [], editingGuard, reviewReady, onRefresh, onControl, busy = false, locked = false, error = '', statusError = '', showCatalog = false, catalogOnly = false, costScopeEmpty = false, retryScopeEmpty = costScopeEmpty, retryScope, onRecollect, recollectReady }) {
  const refreshButton = onRefresh && <Button variant="ghost" onClick={onRefresh}>刷新采集状态</Button>;
  if (!task) return error ? <p className="cost-registration-status" role="status">采集任务状态暂不可用：{error} {refreshButton}</p> : null;
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
  const issues = collectionCostIssues(batches, outcomes, expectedSkus);
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
  const finishedWithIssues = !showCatalog && hasFinishedCostAttemptWithIssues(task);
  let view = statusError ? { ...presentation, running: false, canResume: false, canRetry: false,
    canStop: false, tone: 'warning', title: editingGuard?.title || '采集状态暂无法确认',
    description: editingGuard?.message || '当前无法读取最新任务，连接恢复后会自动刷新。' }
    : !presentation.running && (localFailure || localPending) ? { ...presentation, tone: localFailure ? 'warning' : 'info' } : presentation;
  if (finishedWithIssues && !statusError) {
    const guard = editingGuard ?? erpCostEditingGuard({ workspaceId: task.workspaceId, ledgerId: task.ledgerId, tasks: [task], inboxes });
    view = { ...view, state: 'attention', running: false, catalogOnly: false, canStop: false, canResume: false,
      canRetry: view.canRetry && !guard.blocked, title: guard.title || presentation.title,
      description: !guard.blocked && !retryScopeEmpty ? '可在“重新获取 ERP 成本”中选择重试本轮未完成项。' : guard.message, tone: guard.blocked && !localFailure ? 'info' : 'warning' };
  } else if (!showCatalog && timing.completed && !statusError) {
    const waiting = outcomes.some(inbox => inbox.adoptionPending && !inbox.adoptionFailure && !['rejected', 'voided'].includes(inbox.status))
      || delivered.some(batch => !outcomes.some(inbox => inbox.deliveryId === batch.deliveryId));
    view = { ...view, state: waiting ? 'cost_adoption' : localFailure ? 'attention' : 'completed',
      running: waiting, catalogOnly: false, canResume: false, canStop: false,
      tone: localFailure ? 'warning' : waiting ? 'info' : 'success',
      title: localFailure ? '本机核算待重试' : waiting ? '成本已送达，正在核验并更新利润' : '成本已更新',
      description: localFailure ? localFailure.message : waiting ? '原始采购数据已收到，正在保存可用成本。' : '请查看上方待补成本与价格异常，核对后再决定如何处理。' };
  }
  if (catalogOnly && !statusError && view.state === 'cost_completed') view = { ...view, tone: 'info', title: '可获取商品档案',
    description: '点击获取后，后台读取 ERP 表格档案并自动补齐商品资料。' };
  if (catalogOnly && !statusError && view.state === 'completed') view = { ...view, title: '商品资料检查已结束', description: '已取得的资料用于补齐商品档案；仍缺少的字段可在商品中继续维护。' };
  const awaitingLocal = !showCatalog && timing.completed && view.running;
  const stage = awaitingLocal ? {label: '正在核验采购证据并更新利润'} : task.progress && (!catalogOnly || task.progress.phase === 'catalog') ? task.progress : null;
  const active = !statusError && (view.running || view.state === 'queued');
  const showStage = active && (stage || !catalogOnly);
  const progressLabel = showStage ? stage?.label || '正在等待 ERP 返回数据' : catalogOnly ? '商品资料检查' : '成本回传';
  const progressTotal = showStage ? stage?.total : total;
  const progressValue = showStage ? stage?.completed : catalogOnly ? count(catalogChecked) : deliveredCount;
  const Icon = view.running ? LoaderCircle : view.tone === 'warning' ? AlertCircle : view.tone === 'success' ? CheckCircle2 : Info;
  return <Panel className="erp-collection-progress" id="erp-collection-progress" tabIndex={-1}>
    <div className="panel-header"><div><h2>{catalogOnly ? '商品档案获取进度' : 'ERP 采集任务'}</h2><p>{task.ledgerPeriod} · 范围 {total} 个 SKC{skuCount ? ` / ${skuCount} 个 SKU` : ''}</p></div>
      <div className="page-actions">
        {!awaitingLocal && (view.running || view.state === 'queued' || task.status === 'ready' && ['waiting_login','sync_error'].includes(view.state)) ? <Button disabled={busy || Boolean(statusError) || task.status === 'pausing'} onClick={() => onControl('pause')}>暂停采集</Button> : null}
        {view.canStop && (!view.catalogOnly || view.running) ? <Button disabled={busy || Boolean(statusError)} onClick={() => onControl('stop')}>停止采集</Button> : null}
        {view.canResume && !catalogOnly && (showCatalog || !view.catalogOnly) ? <Button disabled={busy || locked || costScopeEmpty && !view.catalogOnly} onClick={() => onControl(view.catalogOnly ? 'catalog' : 'resume')}>{view.catalogOnly ? '继续获取商品档案' : '继续原任务'}</Button> : null}
        {finishedWithIssues && onRecollect && <Button variant="ghost" disabled={busy || locked || !recollectReady} onClick={onRecollect}>重新获取 ERP 成本</Button>}
      </div>
    </div>
    <div className={`erp-collection-activity erp-activity-${view.tone}`} role="status" aria-live="polite">
      <Icon size={20} className={view.running ? 'spin' : ''} aria-hidden="true" />
      <div><strong>{view.title}</strong><p>{finishedWithIssues && view.canRetry && !retryScopeEmpty && retryScope
        ? `本轮可重试 ${retryScope.platformSkcs.length} 个 SKC / ${retryScope.expectedSkus.length} 个 SKU。` : view.description}</p></div>
    </div>
    {catalogOnly ? <div className="erp-collection-counts" role="status"><span>已检查 <strong>{count(catalogChecked)} / {total}</strong> SKC</span><span>资料齐全 <strong>{count(catalogComplete)}</strong> SKC</span>{catalogIssues.length ? <span>待补资料 <strong>{count(catalogIssues)}</strong> SKC</span> : null}</div>
      : <div className="erp-collection-counts" role="status"><span>已采集 <strong>{count(collected)} / {total}</strong> SKC</span><span>已送达 <strong>{deliveredCount} / {total}</strong> SKC</span><span>已采用 <strong>{adopted.size}</strong> SKU{manual.size ? ` · 已保留人工价 ${manual.size} 项` : ''}</span></div>}
    {!catalogOnly && (localFailure ? <p role="status">本机核算未完成：{localFailure.message || '成本采用处理失败，请查看成本核对中的重试处理入口。'}。已送达证据保留，请以成本采用明细为准。</p>
      : localPending ? <p role="status">正在本机核验并采用成本；采购证据送达不代表核算完成，请以成本采用明细为准。</p> : null)}
    {(active || showCatalog) && <div className="erp-collection-meter" role="status">
      <span>{showStage ? '当前阶段 · ' : ''}{progressLabel}{showStage ? progressTotal != null ? ` · ${progressValue} / ${progressTotal} ${stage?.unit || ''}` : ' · 等待进度确认' : ` · ${catalogOnly ? '已检查' : '已送达'} ${progressValue} / ${total} 个 SKC`}</span>
      <CollectionProgressBar label={showStage ? '当前处理进度' : catalogOnly ? 'ERP 资料检查进度' : 'ERP 成本送达进度'} completed={progressValue} total={progressTotal} active={active} />
    </div>}
    <details className="erp-task-details"><summary>任务范围与采集详情</summary>
    {task.taskId ? <p>任务编号：{task.taskId}</p> : null}
    {stores.length ? <p>原任务店铺：{stores.join('、')}{!catalogOnly && deliveredCount < total ? finishedWithIssues ? ` · 本轮未送达 ${total - deliveredCount} 个 SKC` : ` · 剩余 ${total - deliveredCount} 个 SKC 的成本待读取或送达` : ''}</p> : null}
    {showCatalog ? <p>商品资料{task.catalogMode === 'on_demand' ? '（按需补齐）' : task.catalogMode === 'after_costs' ? '（全部核算后统一整理）' : ''} · 已检查 {count(catalogChecked)} / {total} 个 SKC · 已确认齐全 {count(catalogComplete)} 个 SKC{catalogIssues.length ? ` · 待核对范围 ${count(catalogIssues)} 个 SKC` : ''}</p> : null}
    {!catalogOnly ? <><p>成本采集历时 {timing.elapsedMinutes == null ? '暂无记录' : `${timing.elapsedMinutes} 分钟`}{timing.endedAt ? ` · 成本送达完成 ${new Date(timing.endedAt).toLocaleTimeString('zh-CN')}` : ''} · 最近活动 {task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString('zh-CN') : '等待采集'}</p>
      {timing.completed ? <p>成本读取与送达已结束；后续采用同步和异常核对不计入采集历时。</p> : null}
      <p>查看筛选不改变此任务；已送达结果按证据核验后采用。继续原任务保留已送达进度；重新采集会从头读取。</p></> : <p>复用已有 SKU 对应关系补齐资料；商品资料不改变月度正式成本。</p>}
    {task.phase && !finishedWithIssues && (showCatalog || task.phase !== 'catalog') && !['completed', 'cost_completed'].includes(view.state) ? <p>当前阶段：{task.phase === 'catalog' ? '补充资料' : timing.completed ? '成本证据核对' : '采购成本'}</p> : null}
    {showCatalog && !catalogOnly && view.catalogPending ? <p>成本回传与资料齐全分别核对；图片或供应商链接缺项时，已采用的成本继续保留。</p> : null}
    {task.status === 'paused' && task.pauseReason?.code === 'ERP_PERMISSION_REQUIRED' && task.pauseReason.message ? <p>暂停原因：{task.pauseReason.message}</p> : null}
    </details>
    {!catalogOnly && readFailures.length ? <details><summary>读取未完成，涉及 {count(readFailures)} 个 SKC</summary>{readFailures.map(batch => <p key={batch.batchId}>{scopeLabel(batch)} · {batch.error?.message ?? batch.error ?? 'ERP 请求未完成，请重试对应范围。'}</p>)}</details> : null}
    {!catalogOnly && <><CostIssueList title="成本证据待补齐" issues={issues.evidence} />{(reviewReady ?? (!statusError && canReviewErpCostRound(task, outcomes))) && <CostIssueList title="采购价格异常待核对" issues={issues.anomalies} />}
      {issues.unlocated.length > 0 && <p role="status">{issues.unlocated.length} 份回执尚无完整的逐项核验结果。</p>}</>}
    {showCatalog && catalogIssues.length ? <details><summary>商品资料待核对，涉及 {count(catalogIssues)} 个 SKC</summary>{catalogIssues.map(batch => <p key={batch.batchId}>{scopeLabel(batch)} · {batch.catalogError || '资料尚未齐全或回执未确认，可继续补充资料。'}</p>)}</details> : null}
    {error || statusError ? <p role="alert">{error || statusError} {statusError && refreshButton}</p> : null}
  </Panel>;
}
