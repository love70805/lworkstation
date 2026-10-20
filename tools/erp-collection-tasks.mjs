import crypto from 'node:crypto';

const PREFIX = '/erp/v1/collection-tasks';
const LEASE_MS = 2 * 60 * 60 * 1000;
export const COST_BATCH_SIZE = 5;
const RUNNER_LEASE_MS = 45000;
const canonical = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value ?? null);
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const timestamp = now => new Date(now).toISOString();
const hash = value => crypto.createHash('sha256').update(stable(value)).digest('hex');

export function collectionScopeHash(request) {
  return hash({ workspaceId: request.workspaceId, ledgerId: request.ledgerId, ledgerPeriod: request.ledgerPeriod,
    ledgerVersion: request.ledgerVersion ?? null,
    ...(request.historyMappings?.length ? { historyMappings: request.historyMappings } : {}),
    skcs: [...new Set((request.platformSkcs ?? []).map(item => canonical(item?.platformSkc ?? item)))].sort(),
    skus: (request.expectedSkus ?? []).map(item => [canonical(item.platformSku), canonical(item.platformSkc), canonical(item.store ?? item.storeName)]).sort((a,b) => stable(a).localeCompare(stable(b))),
  });
}

function requestFor(records, requestId) {
  const request = records.find(item => item.kind === 'request' && item.requestKind !== 'catalog' && item.requestId === requestId);
  if (!request || !['registered', 'expired'].includes(request.status)) fail('ERP_TASK_REQUEST_INVALID', '任务关联的账本请求已变更，请从工作台重新开始。');
  return request;
}

function renew(task, request, records, now) {
  const expires = timestamp(now + LEASE_MS);
  task.leaseExpiresAt = expires;
  task.updatedAt = timestamp(now);
  if (task.runnerId) task.runnerLeaseExpiresAt = timestamp(now + RUNNER_LEASE_MS);
  request.leaseExpiresAt = expires;
  request.status = 'registered';
  for (const companion of records) {
    if (companion.kind === 'request' && companion.requestKind === 'catalog' && companion.requestId === `${request.requestId}-CATALOG`
      && companion.sourceRequestId === request.requestId && companion.workspaceId === request.workspaceId && ['registered','expired'].includes(companion.status)) {
      companion.leaseExpiresAt = expires; companion.status = 'registered';
    }
  }
}

function refresh(task) {
  const count = predicate => task.batches.filter(predicate).reduce((sum, batch) => sum + batch.platformSkcs.length, 0);
  task.summary = { total: count(() => true), collected: count(batch => !!batch.collectedAt), delivered: count(batch => !!batch.deliveryId),
    adopted: task.batches.reduce((sum, batch) => sum + (batch.adoption?.adoptedCount ?? 0), 0),
    manualEffective: task.batches.reduce((sum, batch) => sum + (batch.adoption?.manualEffectiveCount ?? 0), 0),
    adoptedUnit: 'SKU', failedBatches: task.batches.filter(batch => ['failed','incomplete'].includes(batch.status)).length,
    totalBatches: task.batches.length, deliveredBatches: task.batches.filter(batch => !!batch.deliveryId).length };
  if (task.status === 'running' && task.batches.every(batch => ['delivered', 'failed', 'incomplete'].includes(batch.status))) {
    task.status = task.batches.every(batch => batch.status === 'delivered') ? 'cost_complete' : 'partial';
  }
  return task;
}

export function recoverCollectionTasks(records, instanceId, now = Date.now()) {
  let changed = false;
  for (const task of records.filter(item => item.kind === 'collection-task')) {
    const unfinishedCatalog = ['cost_complete','partial'].includes(task.status)
      && task.batches.some(batch => batch.deliveryId && batch.catalogStatus !== 'completed');
    const lostRunner = task.runnerId && Date.parse(task.runnerLeaseExpiresAt) <= now;
    if ((task.status === 'running' || task.status === 'ready' || unfinishedCatalog && (task.catalogMode !== 'on_demand' || task.runnerId))
      && (task.instanceId !== instanceId || Date.parse(task.leaseExpiresAt) <= now || lostRunner)) {
      task.status = 'paused'; task.recoveryRequired = true; task.updatedAt = timestamp(now); changed = true;
      delete task.runnerId; delete task.runnerLeaseExpiresAt;
    }
  }
  return changed;
}

function resetAttempt(batch) {
  batch.status = 'pending'; batch.attemptId = null;
  // Historical envelopes remain in the inbox; only the current attempt's
  // references are detached so an old receipt cannot skip fresh ERP reads.
  for (const field of ['resultDeliveryId', 'deliveryId', 'collectedAt', 'deliveredAt', 'evidenceComplete', 'error', 'adoption', 'adoptionReportedAt', 'catalogStatus', 'catalogUpdatedAt', 'catalogError']) delete batch[field];
}

function splitPendingBatches(task) {
  task.batches = task.batches.flatMap(batch => {
    if (batch.status !== 'pending' || batch.platformSkcs.length <= COST_BATCH_SIZE || batch.resultDeliveryId || batch.deliveryId) return [batch];
    const chunks = [];
    for (let i = 0; i < batch.platformSkcs.length; i += COST_BATCH_SIZE) chunks.push({
      batchId: i === 0 ? batch.batchId : `${batch.batchId}:part:${crypto.randomUUID()}`,
      platformSkcs: batch.platformSkcs.slice(i, i + COST_BATCH_SIZE), status: 'pending', attemptId: null,
    });
    return chunks;
  });
}

export function handleCollectionTaskRequest(records, { method, url, payload = {}, instanceId, now = Date.now() }) {
  if (!url.pathname.startsWith(PREFIX)) return null;
  const requestedWorkspace = String(payload.workspaceId ?? url.searchParams.get('workspaceId') ?? '').trim();
  if (!requestedWorkspace) fail('ERP_TASK_WORKSPACE_REQUIRED', '任务操作缺少工作区。', 400);
  const parts = url.pathname.slice(PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length && method === 'GET') {
    const tasks = records.filter(item => item.kind === 'collection-task' && ['workspaceId','ledgerId','requestId'].every(key => !url.searchParams.get(key) || item[key] === url.searchParams.get(key)));
    return { status: 200, body: { tasks: tasks.toSorted((left,right) => String(right.createdAt).localeCompare(String(left.createdAt))).map(task => refresh(structuredClone(task))) } };
  }
  if (!parts.length && method === 'POST') {
    const request = requestFor(records, payload.requestId);
    if (requestedWorkspace !== request.workspaceId) fail('ERP_TASK_WORKSPACE_MISMATCH', '任务工作区不匹配。', 403);
    if (request.status !== 'registered') fail('ERP_TASK_REQUEST_EXPIRED', '请求已过期，请在工作台重新核对范围后继续。');
    const filters = payload.filters && typeof payload.filters === 'object' && !Array.isArray(payload.filters) ? payload.filters : {};
    if (JSON.stringify(filters).length > 20000) fail('ERP_TASK_FILTERS_INVALID', '查询条件过大。', 400);
    const existing = records.find(item => item.kind === 'collection-task' && item.requestId === request.requestId && item.status !== 'stopped');
    if (existing) {
      if (hash(existing.filters) !== hash(filters) || existing.scopeHash !== collectionScopeHash(request)) fail('ERP_TASK_SCOPE_CHANGED', '任务查询条件或账本范围已变化。');
      return { status: 200, body: { task: refresh(existing), idempotent: true } };
    }
    const skcs = [...new Map(request.platformSkcs.map(item => [canonical(item?.platformSkc ?? item), String(item?.platformSkc ?? item).trim()])).values()];
    const coordinated = payload.executionProtocol === 2;
    const task = { kind: 'collection-task', schemaVersion: 1, taskId: crypto.randomUUID(), requestId: request.requestId,
      workspaceId: request.workspaceId, ledgerId: request.ledgerId, ledgerPeriod: request.ledgerPeriod, ledgerVersion: request.ledgerVersion ?? null,
      requestSnapshot: structuredClone(request), expectedSkus: structuredClone(request.expectedSkus ?? []), scopeHash: collectionScopeHash(request),
      filters: structuredClone(filters), queryCapturedAt: payload.queryCapturedAt ?? timestamp(now), status: 'paused', phase: 'cost',
      createdAt: timestamp(now), updatedAt: timestamp(now), instanceId, batches: [] };
    if (coordinated) Object.assign(task, { executionProtocol: 2, catalogMode: 'on_demand', runMode: 'cost' });
    const batchSize = coordinated ? COST_BATCH_SIZE : 20;
    for (let i = 0; i < skcs.length; i += batchSize) task.batches.push({ batchId: `${task.taskId}:${i / batchSize + 1}`, platformSkcs: skcs.slice(i,i+batchSize), status: 'pending', attemptId: null });
    records.push(refresh(task));
    return { status: 201, body: { task } };
  }
  const task = records.find(item => item.kind === 'collection-task' && item.taskId === parts[0]);
  if (!task) fail('ERP_TASK_NOT_FOUND', '采集任务不存在。', 404);
  if (requestedWorkspace !== task.workspaceId) fail('ERP_TASK_WORKSPACE_MISMATCH', '任务工作区不匹配。', 403);
  if (method === 'GET' && parts.length === 1) return { status: 200, body: { task: refresh(structuredClone(task)) } };
  if (method !== 'POST') fail('METHOD_NOT_ALLOWED', '不支持的任务操作。', 405);
  if (parts[1] === 'control') {
    const action = payload.action;
    if (['request_resume', 'claim', 'release'].includes(action)) {
      if (action === 'release') {
        if (!payload.runnerId || payload.runnerId !== task.runnerId) fail('ERP_TASK_RUNNER_CHANGED', '执行者已变化，请刷新任务状态。');
        delete task.runnerId; delete task.runnerLeaseExpiresAt;
        refresh(task);
        if (task.status === 'running') { task.status = 'paused'; task.recoveryRequired = true; }
        task.updatedAt = timestamp(now);
        return { status: 200, body: { task: refresh(task) } };
      }
      const request = requestFor(records, task.requestId);
      if (payload.requestId && payload.requestId !== task.requestId || collectionScopeHash(request) !== task.scopeHash
        || payload.filters && hash(payload.filters) !== hash(task.filters)) fail('ERP_TASK_SCOPE_CHANGED', '任务月份、店铺、SKU/SKC 或导入版本已变化，请从当前账本重新准备采集。');
      if (['stopped', 'completed', 'invalidated'].includes(task.status)) fail('ERP_TASK_STOPPED', '任务已结束，请从当前账本准备新任务。');
      if (request.status === 'expired' && payload.scopeHash !== task.scopeHash) fail('ERP_TASK_REVALIDATION_REQUIRED', '任务已过期，请在工作台核对当前账本后点击继续原任务。');
      if (action === 'request_resume') {
        const mode = payload.mode ?? 'cost';
        if (!['cost', 'catalog'].includes(mode) || payload.retryFailed != null && typeof payload.retryFailed !== 'boolean') fail('ERP_TASK_MODE_INVALID', '任务继续方式无效。', 400);
        if (mode === 'catalog' && task.batches.some(batch => !batch.deliveryId)) fail('ERP_TASK_COST_FIRST', '请先完成成本采集，再按需补齐商品资料。');
        if (task.runnerId && Date.parse(task.runnerLeaseExpiresAt) > now && task.status !== 'paused'
          || task.status === 'ready' && task.runMode === mode && !payload.retryFailed) return { status: 200, body: { task: refresh(task), idempotent: true } };
        for (const batch of task.batches) if (batch.status === 'running' || payload.retryFailed && ['failed', 'incomplete'].includes(batch.status)) resetAttempt(batch);
        if (mode === 'cost') splitPendingBatches(task);
        Object.assign(task, { executionProtocol: 2, catalogMode: 'on_demand', runMode: mode, status: 'ready', recoveryRequired: false,
          resumeRequestId: crypto.randomUUID(), resumeRequestedAt: timestamp(now), instanceId });
        delete task.runnerId; delete task.runnerLeaseExpiresAt; delete task.pauseReason;
      } else {
        if (task.executionProtocol !== 2 || task.status !== 'ready' || payload.resumeRequestId !== task.resumeRequestId) fail('ERP_TASK_ALREADY_CLAIMED', '任务已由其他页面接续或继续请求已失效，请查看统一任务状态。');
        if (typeof payload.runnerId !== 'string' || payload.runnerId.length < 8 || payload.runnerId.length > 200) fail('ERP_TASK_RUNNER_INVALID', '缺少有效执行者标识。', 400);
        if (records.some(item => item.kind === 'collection-task' && item.taskId !== task.taskId && item.workspaceId === task.workspaceId
          && item.runnerId && !['paused', 'stopped', 'completed', 'invalidated'].includes(item.status) && Date.parse(item.runnerLeaseExpiresAt) > now)) fail('ERP_TASK_OTHER_RUNNING', '当前工作区已有任务正在采集，本任务等待执行。');
        task.runnerId = payload.runnerId; task.status = 'running';
      }
      renew(task, request, records, now);
      return { status: 200, body: { task: refresh(task) } };
    }
    if (['resume','retry_failed','heartbeat'].includes(action)) {
      if (task.executionProtocol === 2 && action !== 'heartbeat') fail('ERP_TASK_USE_COORDINATED_RESUME', '请更新 ERP 助手，使用统一的继续原任务入口。');
      if (task.executionProtocol === 2 && (!task.runnerId || payload.runnerId !== task.runnerId)) fail('ERP_TASK_RUNNER_CHANGED', '执行者已变化，请刷新任务状态。');
      const request = requestFor(records, payload.requestId ?? task.requestId);
      if (collectionScopeHash(request) !== task.scopeHash || (payload.filters && hash(payload.filters) !== hash(task.filters))) fail('ERP_TASK_SCOPE_CHANGED', '店铺、月份、SKU/SKC、查询条件或台账导入版本已变化，请新建采集任务。');
      if (action === 'heartbeat' && (task.status === 'stopped' || task.recoveryRequired || request.status !== 'registered')) fail('ERP_TASK_RESUME_REQUIRED', '需要核对范围并点击继续。');
      if (task.status === 'stopped') fail('ERP_TASK_STOPPED', '任务已停止，请新建采集任务。');
      if (request.status === 'expired' && payload.scopeHash !== task.scopeHash) fail('ERP_TASK_REVALIDATION_REQUIRED', '过期任务需要工作台核对当前账本范围。');
      task.requestId = request.requestId; task.requestSnapshot = structuredClone(request); task.instanceId = instanceId;
      if (action !== 'heartbeat') {
        if (task.status === 'running' && !task.recoveryRequired) return { status: 200, body: { task: refresh(task), idempotent: true } };
        for (const batch of task.batches) if (batch.status === 'running' || (action === 'retry_failed' && ['failed','incomplete'].includes(batch.status))) {
          resetAttempt(batch);
        }
        task.status = 'running'; task.recoveryRequired = false; delete task.pauseReason;
      }
      renew(task, request, records, now);
    } else if (action === 'pause' || action === 'stop') {
      if (payload.reason != null && (action !== 'pause' || payload.reason?.code !== 'ERP_SERVICE_UNAVAILABLE')) fail('ERP_TASK_PAUSE_REASON_INVALID', '暂停原因格式无效。', 400);
      task.status = action === 'pause' ? 'paused' : 'stopped'; task.updatedAt = timestamp(now);
      if (payload.reason) task.pauseReason = { code: 'ERP_SERVICE_UNAVAILABLE', message: String(payload.reason.message || 'ERP 服务暂不可用，请在服务恢复后继续原任务。').slice(0, 500), at: timestamp(now) };
      else delete task.pauseReason;
    } else fail('ERP_TASK_ACTION_INVALID', '未知任务操作。', 400);
    return { status: 200, body: { task: refresh(task) } };
  }
  if (parts[1] === 'batches' && parts[2]) {
    const batch = task.batches.find(item => item.batchId === parts[2]);
    if (!batch) fail('ERP_TASK_BATCH_NOT_FOUND', '任务批次不存在。', 404);
    if (task.status === 'stopped' || task.recoveryRequired) fail('ERP_TASK_NOT_RUNNING', '任务已经停止或等待恢复。');
    if (task.executionProtocol === 2 && (!task.runnerId || payload.runnerId !== task.runnerId)) fail('ERP_TASK_RUNNER_CHANGED', '执行者已变化，旧页面不能继续写入任务。');
    requestFor(records, task.requestId);
    if (['catalog_running','catalog_completed','catalog_failed'].includes(payload.state)) {
      if (!payload.attemptId || payload.attemptId !== batch.attemptId) fail('ERP_TASK_STALE_ATTEMPT', '旧尝试不能更新当前资料批次。');
      if (!batch.deliveryId || !['delivered','incomplete'].includes(batch.status)) fail('ERP_TASK_COST_FIRST', '成本批次送达后才能补充资料。');
      if (payload.state === 'catalog_running' && task.status === 'paused') fail('ERP_TASK_NOT_RUNNING', '任务已暂停。');
      batch.catalogStatus = payload.state.slice('catalog_'.length); batch.catalogUpdatedAt = timestamp(now);
      batch.catalogError = payload.state === 'catalog_failed' ? String(payload.error ?? '资料采集失败').slice(0,2000) : null;
      task.phase = 'catalog'; task.updatedAt = timestamp(now);
      return { status: 200, body: {task: refresh(task), batch} };
    }
    if (payload.state === 'running') {
      if (task.status !== 'running' || batch.status !== 'pending') fail('ERP_TASK_BATCH_NOT_PENDING', '批次不在等待执行状态。');
      batch.attemptId = crypto.randomUUID(); batch.status = 'running'; batch.startedAt = timestamp(now); batch.error = null;
    } else {
      if (!payload.attemptId || payload.attemptId !== batch.attemptId) fail('ERP_TASK_STALE_ATTEMPT', '旧尝试不能更新当前批次。');
      if (!['running','collected'].includes(batch.status)) fail('ERP_TASK_BATCH_TERMINAL', '批次已经完成，请通过重试操作开始新尝试。');
      if (!['collected','failed','pending'].includes(payload.state)) fail('ERP_TASK_STATE_INVALID', '未知批次状态。', 400);
      batch.status = payload.state;
      if (payload.state === 'collected') {
        batch.collectedAt = timestamp(now); batch.evidenceComplete = payload.evidenceComplete !== false;
        batch.error = batch.evidenceComplete ? null : String(payload.error || '成本证据未齐，请展开本批回传结果核对。').slice(0,2000);
        if (payload.resultDeliveryId) batch.resultDeliveryId = String(payload.resultDeliveryId).slice(0,200);
      }
      if (payload.state === 'failed') batch.error = String(payload.error ?? '采集失败').slice(0,2000);
    }
    batch.updatedAt = timestamp(now); task.updatedAt = timestamp(now); task.phase = String(payload.phase ?? task.phase).slice(0,100);
    return { status: 200, body: { task: refresh(task), batch } };
  }
  if (parts[1] === 'adoption') {
    const batch = task.batches.find(item => item.deliveryId === payload.deliveryId);
    if (!batch) fail('ERP_TASK_RECEIPT_NOT_FOUND', '采用报告没有对应的已送达批次。');
    const adoption = {};
    for (const key of ['adoptedCount','protectedCount','evidenceIncompleteCount','missingCount','anomalyCount','manualEffectiveCount','expectedCount','supersededCount']) {
      const value = Number(payload[key] ?? 0);
      if (!Number.isSafeInteger(value) || value < 0) fail('ERP_TASK_ADOPTION_INVALID', '采用报告数量无效。', 400);
      adoption[key] = value;
    }
    if (adoption.adoptedCount + adoption.manualEffectiveCount > task.expectedSkus.filter(item => batch.platformSkcs.some(skc => canonical(skc) === canonical(item.platformSkc))).length) fail('ERP_TASK_ADOPTION_INVALID', '采用数量超出批次账本范围。',400);
    batch.adoption = adoption; batch.adoptionReportedAt = timestamp(now); task.updatedAt = timestamp(now);
    return { status: 200, body: { task: refresh(task) } };
  }
  fail('NOT_FOUND', '未知任务接口。', 404);
}

export function validateCollectionDelivery(records, payload) {
  if (!payload.collectionTask) return null;
  const { taskId, batchId, attemptId } = payload.collectionTask;
  const task = records.find(item => item.kind === 'collection-task' && item.taskId === taskId);
  const batch = task?.batches.find(item => item.batchId === batchId);
  if (!task || !batch || !attemptId || batch.attemptId !== attemptId) fail('ERP_TASK_STALE_ATTEMPT', '采集批次已被新尝试替代。');
  if (task.status === 'stopped' || task.recoveryRequired) fail('ERP_TASK_STOPPED', '任务已停止，不能接收未完成读取。');
  if (payload.requestId !== task.requestId || payload.workspaceId !== task.workspaceId || payload.ledgerId !== task.ledgerId || hash([...new Set(payload.querySkcs.map(item => canonical(item?.platformSkc ?? item)))].sort()) !== hash(batch.platformSkcs.map(canonical).sort())) fail('ERP_TASK_SCOPE_CHANGED', '回传范围与任务批次不一致。');
  if (!['running','collected','delivered','incomplete'].includes(batch.status)) fail('ERP_TASK_BATCH_TERMINAL', '批次不接受回传。');
  if (batch.resultDeliveryId && batch.status === 'delivered' && batch.resultDeliveryId !== payload.resultDeliveryId) fail('ERP_TASK_DELIVERY_CONFLICT', '批次已经绑定另一投递。');
  return { task, batch };
}

export function recordCollectionDelivery(context, receipt, now = Date.now()) {
  if (!context) return;
  const {task,batch} = context;
  if (receipt.evidenceComplete === false) batch.evidenceComplete = false;
  batch.status = batch.evidenceComplete === false ? 'incomplete' : 'delivered';
  if (batch.status === 'incomplete') batch.error ||= 'ERP 回传缺少本批台账 SKU 的完整成本证据，请展开回传结果核对。';
  batch.collectedAt ||= timestamp(now); batch.deliveredAt = timestamp(now); batch.deliveryId = receipt.deliveryId; batch.resultDeliveryId = receipt.resultDeliveryId;
  batch.adoption = null; task.updatedAt = timestamp(now); refresh(task);
}
