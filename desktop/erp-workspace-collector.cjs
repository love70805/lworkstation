const PURCHASE_PAGE = 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html';
// Reuse the observed full-history query contract. Every read is subsequently
// narrowed by the immutable task's SKC/SKU snapshot, never a foreground form.
const PURCHASE_FILTERS = Object.freeze({ sku: '', storeId: '', queryRange: '0', createTimePeriod: '', orderNo: '', supplierName: '', organizationName: '', createdBy: '', warehouseId: '0', paymentType: '0', paymentStatus: '0', purchaseStatus: '', exceptionSheetStatus: '', tradeName: '', inTransitTime: '', exceptionHandlingStatus: '', emergencySign: '', purchasingPersonnel: '', accountName1688: '', storeAssociatedAccountName1688: '', suggestedPayment: '', orderType: '', buildType: '', mineableType: '', changePrice: '', adjacentToTheSameSupplier: '0', sort: '', limit: '50' });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
function createWorkspaceErpCollector({ requestInbox, createView, getContext, interval = setInterval, clear = clearInterval }) {
  let current = null, starting = null, timer = null, polling = false, generation = 0;
  let state = { status: 'idle' };
  const snapshot = () => ({ ...state });
  function closeView() {
    if (timer) clear(timer); timer = null;
    const view = current?.view;
    if (current) current.view = null;
    try { if (view && !view.webContents.isDestroyed()) view.webContents.close(); } catch { /* A renderer may already have released its native view. */ }
  }
  async function control(action, extra = {}) {
    if (!current?.task) return;
    return requestInbox({ route: `/erp/v1/collection-tasks/${encodeURIComponent(current.task.taskId)}/control`, method: 'POST', body: { workspaceId: current.workspaceId, requestId: current.requestId, scopeHash: current.task.scopeHash, filters: current.task.filters, action, ...extra } });
  }
  async function poll() {
    if (!current || polling) return;
    const owner = current, revision = generation;
    polling = true;
    try {
      if (getContext()?.workspaceId !== owner.workspaceId) { await stop('workspace_changed'); return; }
      const { task } = await requestInbox({ route: `/erp/v1/collection-tasks/${encodeURIComponent(owner.task.taskId)}`, query: { workspaceId: owner.workspaceId } });
      if (current !== owner || revision !== generation) return;
      owner.task = task;
      const login = owner.view && await owner.view.webContents.executeJavaScript(`Boolean(/\\/(?:login|signin)(?:[/.]|$)/i.test(location.pathname)||document.querySelector('input[type="password"]'))`);
      if (current !== owner || revision !== generation) return;
      if (task.status === 'running') owner.hasRun = true;
      // A historical batch error cannot keep a terminal task waiting for login.
      // Only the current document or an explicit live pause describes auth state.
      const terminal = ['stopped','invalidated','completed'].includes(task.status);
      const waiting = !terminal && (login || task.pauseReason?.code === 'ERP_LOGIN_REQUIRED');
      state = { requestId: owner.requestId, taskId: task.taskId, status: waiting ? 'waiting_login' : task.status };
      if (!waiting && ['paused','stopped','invalidated','completed','cost_complete','partial'].includes(task.status)
        && !(task.catalogMode === 'after_costs' && task.status === 'cost_complete' && !task.batches.every(batch => batch.catalogStatus === 'completed'))) closeView();
    } catch (error) {
      if (current === owner && revision === generation) state = { ...state, error: error.message };
    } finally { polling = false; }
  }
  async function launch(input) {
    const context = getContext();
    if (!validId(input?.requestId) || !validId(input?.workspaceId) || !validId(input?.ledgerId) || context?.workspaceId !== input.workspaceId) throw new Error('采集请求不属于当前工作区。');
    if (current?.view && current.requestId === input.requestId) {
      await poll();
      if (['starting','running','ready'].includes(state.status) && !state.error) return snapshot();
      closeView();
    }
    if (current?.view) throw new Error('已有成本采集正在执行，请先暂停或停止。');
    if (current?.sessionInvalidated && current.requestId === input.requestId) throw Object.assign(new Error('ERP 登录已变化，请重新准备本月采集。'), { code: 'ERP_SESSION_CHANGED' });
    const revision = ++generation;
    const registered = await requestInbox({ route: '/erp/v1/requests', query: { workspaceId: input.workspaceId, includeHistory: true } });
    const requests = registered.records ?? registered.requests ?? [];
    const request = requests.find(item => (item.requestId ?? item.id) === input.requestId && item.workspaceId === input.workspaceId && item.ledgerId === input.ledgerId);
    if (!request || request.status !== 'registered' || !request.platformSkcs?.length || !request.expectedSkus?.length) throw Object.assign(new Error('采集请求已失效，请重新准备当前范围。'), { code: 'ERP_REQUEST_INVALID' });
    const existing = await requestInbox({ route: '/erp/v1/collection-tasks', query: { workspaceId: input.workspaceId, requestId: input.requestId } });
    const retained = existing.tasks?.find(task => task.requestId === input.requestId && task.status !== 'stopped');
    const initialSku=String(request.platformSkcs[0]?.platformSkc??request.platformSkcs[0]).trim();
    const created = retained ? { task: retained } : await requestInbox({ route: '/erp/v1/collection-tasks', method: 'POST', body: { workspaceId: input.workspaceId, requestId: input.requestId, executionProtocol: 2, executionTarget: 'desktop', catalogMode: 'after_costs', filters: { ...PURCHASE_FILTERS, sku: initialSku } } });
    if (revision !== generation || getContext()?.workspaceId !== input.workspaceId) throw new Error('工作区已改变，采集未启动。');
    current = { ...input, request, task: created.task, view: null, hasRun: false };
    if (['stopped','invalidated'].includes(created.task.status)) throw Object.assign(new Error('旧任务已结束，请重新准备当前范围。'), { code: 'ERP_TASK_STOPPED' });
    if (created.task.status === 'completed') { state = { ...input, taskId: created.task.taskId, status: 'completed' }; return snapshot(); }
    const resumed = await control('request_resume', { executionTarget: 'desktop', mode: input.mode === 'catalog' ? 'catalog' : 'cost', retryFailed: input.retryFailed === true });
    current.task = resumed.task;
    state = { ...input, taskId: resumed.task.taskId, status: 'starting' };
    const view = await createView(`${PURCHASE_PAGE}?lworkstationRequest=${encodeURIComponent(input.requestId)}`);
    if (revision !== generation || getContext()?.workspaceId !== input.workspaceId) { if (!view.webContents.isDestroyed()) view.webContents.close(); throw new Error('工作区已改变，采集已停止。'); }
    current.view = view;
    timer = interval(() => { void poll(); }, 3000); timer?.unref?.();
    await poll();
    return snapshot();
  }
  function start(input) {
    if (starting) return starting.requestId === input?.requestId ? starting.promise : Promise.reject(new Error('正在准备另一项采集，请稍后重试。'));
    const promise = launch(input).catch(error => { state = { ...state, status: 'error', error: error.message }; closeView(); throw error; }).finally(() => { starting = null; });
    starting = { requestId: input?.requestId, promise };
    return promise;
  }
  async function stop(status = 'stopped') { generation++; closeView(); await control(['session_changed','workspace_changed'].includes(status)?'stop':'pause').catch(() => {}); state = { ...state, status }; }
  async function sessionChanged() {
    if (!current?.task || current.sessionInvalidated) return;
    const owner = current, revision = generation;
    const { task } = await requestInbox({ route: `/erp/v1/collection-tasks/${encodeURIComponent(owner.task.taskId)}`, query: { workspaceId: owner.workspaceId } });
    if (current !== owner || revision !== generation) return;
    current.task = task;
    if (task.status === 'running') current.hasRun = true;
    if (task.status === 'completed') {
      state = { requestId: owner.requestId, taskId: task.taskId, status: task.status };
      closeView();
      return;
    }
    if (current.view && state.status === 'waiting_login' && !current.hasRun && !['stopped','invalidated','completed'].includes(current.task.status)) {
      await control('request_resume', { executionTarget: 'desktop', retryFailed: true });
      await current.view.webContents.loadURL(`${PURCHASE_PAGE}?lworkstationRequest=${encodeURIComponent(current.requestId)}`);
      await poll();
      return;
    }
    current.sessionInvalidated=true;
    await stop('session_changed');
    // Cancel the old request so the workspace's next registration creates a
    // fresh snapshot rather than combining evidence from two login sessions.
    if (current?.request) await requestInbox({ route: '/erp/v1/requests', method: 'POST', body: { workspaceId: current.workspaceId, request: { ...current.request, id: current.requestId, cancel: true } } }).catch(() => {});
  }
  return { start, snapshot, poll, stop, sessionChanged, dispose() { generation++; closeView(); current = null; } };
}
module.exports = { createWorkspaceErpCollector, PURCHASE_FILTERS, PURCHASE_PAGE };
