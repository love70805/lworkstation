export function hasPendingErpCatalog(task) {
  return (task?.batches ?? []).some(batch => batch.deliveryId && batch.catalogStatus !== 'completed');
}

export function isActiveErpCollection(task) {
  if (!task || ['stopped', 'completed', 'invalidated'].includes(task.status)) return false;
  return task.status !== 'cost_complete' || hasPendingErpCatalog(task);
}

// Task preparation and a durable receipt are not proof of an active ERP read.
// Use batch activity to avoid asking users to resume a task that is still running.
export function erpCollectionPresentation(task) {
  const batches = task?.batches ?? [];
  const catalogPending = hasPendingErpCatalog(task);
  const inactive = !task || task.recoveryRequired || ['ready', 'paused', 'interrupted', 'expired', 'stopped', 'completed', 'invalidated'].includes(task.status);
  const catalogRunning = !inactive && batches.some(batch => batch.catalogStatus === 'running');
  const costRunning = !inactive && batches.some(batch => batch.status === 'running');
  const delivering = !inactive && batches.some(batch => batch.status === 'collected' && !batch.deliveryId);
  const preparingCatalog = !inactive && ['cost_complete', 'partial'].includes(task.status)
    && batches.some(batch => batch.deliveryId && !batch.catalogStatus);
  const running = catalogRunning || costRunning || delivering || preparingCatalog || task?.status === 'pausing';
  const terminal = !task || ['stopped', 'completed', 'invalidated'].includes(task.status);
  const costIssues = batches.some(batch => ['failed', 'incomplete'].includes(batch.status));
  const costDelivered = batches.length > 0 && batches.every(batch => batch.deliveryId);
  const neverStarted = batches.every(batch => batch.status === 'pending' && !batch.deliveryId && !batch.catalogStatus);
  const pendingCost = batches.some(batch => ['pending', 'running', 'collected'].includes(batch.status));
  const canResume = !running && !terminal && (task.recoveryRequired
    || ['ready', 'paused', 'interrupted', 'expired'].includes(task.status)
    || ['partial', 'failed'].includes(task.status) && (pendingCost || catalogPending)
    || task.status === 'cost_complete' && catalogPending);
  let state = 'waiting', title = '等待 ERP 助手开始或继续采集';
  let description = '请在 ERP 助手开始或继续原任务；当前尚未确认有批次正在读取。';
  let tone = 'info';
  if (task?.status === 'stopped' || task?.status === 'invalidated') {
    state = 'stopped'; title = task.status === 'invalidated' ? '采集范围已变化' : '采集已停止';
    description = '已送达结果保留；再次采集前请核对当前账本范围。'; tone = 'warning';
  } else if (task?.status === 'pausing') {
    state = 'pausing'; title = '正在暂停后台采集';
    description = '等待当前操作结束；已送达结果保留。';
  } else if (task?.status === 'paused' && task.pauseReason?.code === 'ERP_SERVICE_UNAVAILABLE') {
    state = 'paused'; title = 'ERP 服务暂不可用，采集已暂停';
    description = '有限重试后仍未取得完整响应。已送达结果和已采用成本保留；服务恢复后在 ERP 助手继续原任务，成本证据缺项需重试失败批次。'; tone = 'warning';
  } else if (task?.recoveryRequired || ['interrupted', 'expired'].includes(task?.status) || task?.status === 'paused' && !neverStarted) {
    state = 'paused'; title = '后台采集已暂停，等待继续';
    description = '核验原任务范围后，在 ERP 助手继续；已采用成本保持有效。'; tone = 'warning';
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
  return { state, title, description, tone, running, catalogPending, canResume,
    canStop: isActiveErpCollection(task), canRetry: !running && !terminal && costIssues };
}
