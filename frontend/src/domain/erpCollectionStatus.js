export function hasPendingErpCatalog(task) {
  return (task?.batches ?? []).some(batch => batch.deliveryId && batch.catalogStatus !== 'completed');
}

// Adoption reports update the task long after procurement has stopped. Cost
// timing ends at the durable receipt, independently of remaining exceptions.
export function erpCostCollectionTiming(task) {
  const batches = task?.batches ?? [];
  const completed = batches.length > 0 && batches.every(batch => batch.deliveryId);
  const deliveredAt = batches.map(batch => Date.parse(batch.deliveredAt ?? batch.collectedAt)).filter(Number.isFinite);
  const end = completed ? (deliveredAt.length ? Math.max(...deliveredAt) : NaN) : Date.parse(task?.updatedAt ?? task?.createdAt);
  const duration = end - Date.parse(task?.createdAt);
  return { completed, endedAt: completed && Number.isFinite(end) ? new Date(end).toISOString() : null,
    elapsedMinutes: Number.isFinite(duration) ? Math.max(0, Math.floor(duration / 60000)) : null };
}

export function isActiveErpCollection(task) {
  if (!task || ['stopped', 'completed', 'invalidated'].includes(task.status)) return false;
  if (task.status === 'cost_complete' && task.catalogMode === 'on_demand' && !task.runnerId) return false;
  return task.status !== 'cost_complete' || hasPendingErpCatalog(task);
}

// Task preparation and a durable receipt are not proof of an active ERP read.
// Use batch activity to avoid asking users to resume a task that is still running.
export function erpCollectionPresentation(task) {
  const batches = task?.batches ?? [];
  const catalogPending = hasPendingErpCatalog(task);
  const inactive = !task || task.recoveryRequired || ['ready', 'paused', 'interrupted', 'expired', 'stopped', 'completed', 'invalidated'].includes(task.status);
  const catalogExecution = task?.catalogMode !== 'on_demand' || task?.runMode === 'catalog' && task?.runnerId;
  const catalogRunning = !inactive && catalogExecution && batches.some(batch => batch.catalogStatus === 'running');
  const costRunning = !inactive && batches.some(batch => batch.status === 'running');
  const delivering = !inactive && batches.some(batch => batch.status === 'collected' && !batch.deliveryId);
  const preparingCatalog = !inactive && (task.runMode === 'catalog' && task.runnerId
    || task.catalogMode === 'after_costs' && task.runnerId && task.phase === 'catalog_ready'
    || task.executionProtocol !== 2 && task.status === 'running' && task.phase === 'catalog')
    && batches.some(batch => batch.deliveryId && !batch.catalogStatus);
  const awaitingAdoption = !inactive && task?.catalogMode === 'after_costs' && Boolean(task.runnerId) && task.phase === 'cost_adoption';
  const running = catalogRunning || costRunning || delivering || preparingCatalog || awaitingAdoption || task?.status === 'pausing';
  const terminal = !task || ['stopped', 'completed', 'invalidated'].includes(task.status);
  const costIssues = batches.some(batch => ['failed', 'incomplete'].includes(batch.status));
  const costDelivered = batches.length > 0 && batches.every(batch => batch.deliveryId);
  const catalogOnly = costDelivered && !costIssues && catalogPending;
  const neverStarted = batches.every(batch => batch.status === 'pending' && !batch.deliveryId && !batch.catalogStatus);
  const pendingCost = batches.some(batch => ['pending', 'running', 'collected'].includes(batch.status));
  const queued = task?.executionProtocol === 2 && task.status === 'ready';
  const claimed = task?.executionProtocol === 2 && Boolean(task.runnerId) && !inactive;
  const canResume = !running && !terminal && !queued && !claimed && (task.recoveryRequired
    || ['ready', 'paused', 'interrupted', 'expired'].includes(task.status)
    || ['partial', 'failed'].includes(task.status) && (pendingCost || catalogPending && task.catalogMode !== 'on_demand')
    || task.status === 'cost_complete' && catalogPending);
  let state = 'waiting', title = '等待开始或继续原任务';
  let description = '点击继续原任务后，已登录的 ERP 采购管理页会接续读取；两端显示同一个任务，无需再次点击。';
  let tone = 'info';
  if (task?.status === 'stopped' || task?.status === 'invalidated') {
    state = 'stopped'; title = task.status === 'invalidated' ? '采集范围已变化' : '采集已停止';
    description = '已送达结果保留；再次采集前请核对当前账本范围。'; tone = 'warning';
  } else if (task?.status === 'pausing') {
    state = 'pausing'; title = '正在暂停后台采集';
    description = '等待当前操作结束；已送达结果保留。';
  } else if (awaitingAdoption) {
    state = 'cost_adoption'; title = '成本已送达，正在完成本机核算';
    description = '全部批次处理完成后，统一复用暂存资料补全商品并自动建档；无需再次请求已取得的 ERP 资料。';
  } else if (queued || claimed && !running) {
    state = 'queued'; title = queued ? '继续请求已保存，等待 ERP 接续' : 'ERP 已接续，正在准备读取';
    description = '无需重复点击。请保持 ERP 采购管理页已打开且已登录；连接恢复后会接续这个任务。';
  } else if (catalogOnly && !running) {
    state = 'cost_completed'; title = '成本采集已完成';
    description = task.catalogMode === 'after_costs'
      ? '继续原任务后，待全部成本核算回执确认，再统一复用暂存资料补全商品并自动建档。'
      : '商品图片、链接等资料可按需补齐；已采用成本可以继续核算利润，无需重新采集成本。'; tone = 'success';
  } else if (task?.status === 'paused' && task.pauseReason?.code === 'ERP_SERVICE_UNAVAILABLE') {
    state = 'paused'; title = 'ERP 服务暂不可用，采集已暂停';
    description = '有限重试后仍未取得完整响应。已送达结果和已采用成本保留；服务恢复后点击继续原任务，成本证据缺项需重试失败批次。'; tone = 'warning';
  } else if (task?.recoveryRequired || ['interrupted', 'expired'].includes(task?.status) || task?.status === 'paused' && !neverStarted) {
    state = 'paused'; title = '后台采集已暂停，等待继续';
    description = '点击继续原任务，自动核验原月份、店铺和商品范围并接续；已送达批次不重采，已采用成本保持有效。'; tone = 'warning';
  } else if (catalogRunning || preparingCatalog) {
    state = 'catalog_running'; title = catalogRunning ? '正在后台补充商品资料' : '正在准备后台补充商品资料';
    description = '可以继续使用工作台，无需重复启动。图片和链接用于商品建档，不阻塞已采用成本的利润核算。';
  } else if (costRunning || delivering) {
    state = 'cost_running'; title = delivering ? '正在后台确认成本送达' : '正在后台采集采购成本';
    description = '可以继续使用工作台，无需重复启动。已送达批次通过证据校验后自动采用，异常项单独核对。';
  } else if ((costDelivered && !catalogPending && !costIssues) || task?.status === 'completed') {
    state = 'completed'; title = '成本采集与资料检查已结束';
    description = '成本是否已采用以明细为准；无需继续采集。'; tone = 'success';
  } else if (costIssues || batches.some(batch => batch.catalogStatus === 'failed')) {
    state = 'attention'; title = costIssues ? '采集已结束，成本证据仍需核对' : '成本已回传，商品资料仍需处理';
    description = '请查看对应批次原因。图片、链接缺项单独补齐，已采用成本可继续核算利润。'; tone = 'warning';
  }
  return { state, title, description, tone, running, catalogPending, catalogOnly, canResume,
    canStop: isActiveErpCollection(task), canRetry: !running && !terminal && !queued && !claimed && costIssues };
}
