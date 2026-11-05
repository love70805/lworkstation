const PURCHASE_PAGE = 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html';
// Full-history evidence is narrowed by the task's immutable SKC/SKU snapshot.
const PURCHASE_FILTERS = Object.freeze({ sku: '', storeId: '', queryRange: '0', createTimePeriod: '', orderNo: '', supplierName: '', organizationName: '', createdBy: '', warehouseId: '0', paymentType: '0', paymentStatus: '0', purchaseStatus: '', exceptionSheetStatus: '', tradeName: '', inTransitTime: '', exceptionHandlingStatus: '', emergencySign: '', purchasingPersonnel: '', accountName1688: '', storeAssociatedAccountName1688: '', suggestedPayment: '', orderType: '', buildType: '', mineableType: '', changePrice: '', adjacentToTheSameSupplier: '0', sort: '', limit: '50' });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
function createWorkspaceErpCollector({ requestInbox, createView, getContext, interval = setInterval, clear = clearInterval, now = Date.now, ackTimeoutMs = 15000, probeTimeoutMs = 5000, viewTimeoutMs = 30000 }) {
  let current = null, starting = null, timer = null, polling = false, generation = 0;
  let state = { status: 'idle' };
  const snapshot = () => ({ ...state });
  const owns = (owner, revision) => current === owner && generation === revision;
  const queued = task => task?.status === 'ready' && !task.runnerId;
  const pageUrl = owner => `${PURCHASE_PAGE}?lworkstationRequest=${encodeURIComponent(owner.requestId)}&lworkstationResume=${encodeURIComponent(owner.task.resumeRequestId)}`;
  const close = view => { try { if (view && !view.webContents.isDestroyed()) view.webContents.close(); } catch { /* Already released. */ } };
  function closeView(owner = current) {
    if (owner === current) { if (timer) clear(timer); timer = null; }
    const view = owner?.view; if (owner) owner.view = null; close(view);
  }
  function bounded(promise, ms, message) {
    let deadline;
    return Promise.race([promise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(deadline));
  }
  const control = (action, extra = {}, owner = current) => owner?.task ? requestInbox({ route: `/erp/v1/collection-tasks/${encodeURIComponent(owner.task.taskId)}/control`, method: 'POST', body: { workspaceId: owner.workspaceId, requestId: owner.requestId, scopeHash: owner.task.scopeHash, filters: owner.task.filters, action, ...extra } }) : Promise.resolve(null);
  const readTask = owner => bounded(requestInbox({ route: `/erp/v1/collection-tasks/${encodeURIComponent(owner.task.taskId)}`, query: { workspaceId: owner.workspaceId } }), probeTimeoutMs, 'ERP 任务状态读取超时');
  function publish(owner, status, extra = {}) { state = { requestId: owner.requestId, taskId: owner.task.taskId, status, ...extra }; }
  function startTimer() { if (timer) clear(timer); timer = interval(() => { void poll(); }, 3000); timer?.unref?.(); }
  function retainLateView(owner, revision, intent, opening) {
    void opening.then(view => {
      const active = current;
      if (active && (active !== owner || owns(owner, revision)) && active.requestId === owner.requestId
        && active.workspaceId === owner.workspaceId && getContext()?.workspaceId === active.workspaceId
        && active.task.resumeRequestId === intent && !['paused','stopped','invalidated','completed'].includes(active.task.status)) {
        active.view = view; active.opening = null; startTimer(); void poll();
      } else close(view);
    }, () => {});
  }
  async function openView(owner, revision) {
    const intent = owner.task.resumeRequestId;
    const opening = Promise.resolve().then(() => createView(pageUrl(owner)));
    owner.opening = opening;
    let view;
    try { view = await bounded(opening, viewTimeoutMs, 'ERP 页面加载超时，请重新连接 ERP。'); }
    catch (error) {
      // A document can claim before its load event. Invalidate the unclaimed
      // intent atomically before discarding it; a winning executor keeps its page.
      let fenced;
      try { fenced = await fence(owner, revision); }
      catch {
        if (owns(owner, revision)) { retainLateView(owner, revision, intent, opening); startTimer(); error.preserveView = true; }
        else void opening.then(close, () => {});
        throw error;
      }
      if (!owns(owner, revision) || fenced || !owner.task.runnerId) {
        owner.opening = null; void opening.then(close, () => {}); throw error;
      }
      owner.hasRun = true; retainLateView(owner, revision, intent, opening); startTimer();
      publish(owner, owner.task.status); return;
    }
    owner.opening = null;
    if (!owns(owner, revision) || getContext()?.workspaceId !== owner.workspaceId) { close(view); throw new Error('工作区已改变，采集未启动。'); }
    owner.view = view; owner.ackStartedAt = now(); startTimer();
  }
  async function fence(owner, revision) {
    try {
      const result = await bounded(control('reconnect', { resumeRequestId: owner.task.resumeRequestId, catalogMode: 'on_demand' }, owner), probeTimeoutMs, 'ERP 接收状态确认超时，请重新连接 ERP。');
      if (!owns(owner, revision)) return false;
      owner.task = result.task; return true;
    } catch (error) {
      if (!owns(owner, revision)) return false;
      if (error.code !== 'ERP_TASK_HANDOFF_CHANGED' && error.status !== 409) throw error;
      const { task } = await readTask(owner);
      if (!owns(owner, revision)) return false;
      owner.task = task;
      if (task.runnerId || task.status === 'running') owner.hasRun = true;
      publish(owner, queued(task) ? 'waiting_ack' : task.status);
      if (task.runnerId && !owner.view) startTimer();
      if (['paused','stopped','invalidated','completed'].includes(task.status)) closeView(owner);
      return false;
    }
  }
  async function reconnect(owner, revision) {
    if (!queued(owner.task) || !await fence(owner, revision)) return;
    closeView(owner);
    if (owner.reconnects >= 1) { publish(owner, 'sync_error', { error: 'ERP 尚未确认接收任务，请点击重新连接 ERP。已送达结果保留。' }); return; }
    owner.reconnects += 1; publish(owner, 'reconnecting');
    await openView(owner, revision);
    if (owns(owner, revision)) publish(owner, 'waiting_ack');
  }
  async function poll() {
    if (!current || polling) return;
    const owner = current, revision = generation; polling = true;
    try {
      if (getContext()?.workspaceId !== owner.workspaceId) { await stop('workspace_changed'); return; }
      const { task } = await readTask(owner);
      if (!owns(owner, revision)) return;
      owner.task = task;
      if (task.runnerId || task.status === 'running') owner.hasRun = true;
      if (['stopped','invalidated','completed'].includes(task.status)) { publish(owner, task.status); closeView(owner); return; }
      if (task.status === 'paused' && task.pauseReason?.code !== 'ERP_LOGIN_REQUIRED') { publish(owner, 'paused'); closeView(owner); return; }
      const login = owner.view && !owner.view.webContents.isDestroyed() && await bounded(owner.view.webContents.executeJavaScript("Boolean(new RegExp('(^|/)(login|signin)([/.]|$)', 'i').test(location.pathname)||document.querySelector('input[type=\"password\"]'))"), probeTimeoutMs, 'ERP 页面响应超时');
      if (!owns(owner, revision)) return;
      if (login || task.pauseReason?.code === 'ERP_LOGIN_REQUIRED') { owner.ackStartedAt = now(); publish(owner, 'waiting_login'); return; }
      publish(owner, queued(task) ? 'waiting_ack' : task.status);
      if (queued(task) && now() - owner.ackStartedAt >= ackTimeoutMs) { await reconnect(owner, revision); return; }
      const catalogActive = task.runnerId && task.runMode === 'catalog' && task.batches.some(batch => batch.catalogStatus !== 'completed');
      if (['cost_complete','partial'].includes(task.status) && !catalogActive && !(task.catalogMode === 'after_costs' && task.status === 'cost_complete' && !task.batches.every(batch => batch.catalogStatus === 'completed'))) closeView(owner);
    } catch (error) {
      if (!owns(owner, revision)) return;
      if (queued(owner.task)) {
        try { await reconnect(owner, revision); }
        catch (failure) { if (owns(owner, revision)) publish(owner, 'sync_error', { error: failure.message }); }
      } else publish(owner, owner.task.status, { error: error.message });
    } finally { polling = false; }
  }
  async function launch(input) {
    if (!validId(input?.requestId) || !validId(input?.workspaceId) || !validId(input?.ledgerId) || getContext()?.workspaceId !== input.workspaceId) throw new Error('采集请求不属于当前工作区。');
    if (current?.view && current.requestId === input.requestId) {
      await poll();
      if (['starting','running','waiting_ack','reconnecting','ready'].includes(state.status) && !state.error) return snapshot();
      if (current?.task?.runnerId && !['paused','stopped','invalidated'].includes(current.task.status)) return snapshot();
    }
    if ((current?.view || current?.opening) && current.requestId !== input.requestId) throw new Error('已有成本采集正在执行，请先暂停或停止。');
    if (current?.sessionInvalidated && current.requestId === input.requestId) throw Object.assign(new Error('ERP 登录已变化，请重新准备本月采集。'), { code: 'ERP_SESSION_CHANGED' });
    const revision = ++generation;
    const registered = await requestInbox({ route: '/erp/v1/requests', query: { workspaceId: input.workspaceId, includeHistory: true } });
    const request = (registered.records ?? registered.requests ?? []).find(item => (item.requestId ?? item.id) === input.requestId && item.workspaceId === input.workspaceId && item.ledgerId === input.ledgerId);
    if (!request || request.status !== 'registered' || !request.platformSkcs?.length || !request.expectedSkus?.length) throw Object.assign(new Error('采集请求已失效，请重新准备当前范围。'), { code: 'ERP_REQUEST_INVALID' });
    const existing = await requestInbox({ route: '/erp/v1/collection-tasks', query: { workspaceId: input.workspaceId, requestId: input.requestId } });
    const retained = existing.tasks?.find(task => task.requestId === input.requestId && task.status !== 'stopped');
    const initialSku = String(request.platformSkcs[0]?.platformSkc ?? request.platformSkcs[0]).trim();
    const created = retained ? { task: retained } : await requestInbox({ route: '/erp/v1/collection-tasks', method: 'POST', body: { workspaceId: input.workspaceId, requestId: input.requestId, executionProtocol: 2, costFlow: 'task', executionTarget: 'desktop', catalogMode: 'on_demand', filters: { ...PURCHASE_FILTERS, sku: initialSku } } });
    if (revision !== generation || getContext()?.workspaceId !== input.workspaceId) throw new Error('工作区已改变，采集未启动。');
    const previous = current;
    const owner = { ...input, request, task: created.task, view: previous?.view ?? null, hasRun: false, reconnects: 0, ackStartedAt: now() }; current = owner;
    try {
      if (['stopped','invalidated'].includes(owner.task.status)) throw Object.assign(new Error('旧任务已结束，请重新准备当前范围。'), { code: 'ERP_TASK_STOPPED' });
      if (owner.task.status === 'completed') { publish(owner, 'completed'); return snapshot(); }
      if (queued(owner.task) && owner.task.executionTarget === 'desktop') { if (!await fence(owner, revision)) return snapshot(); }
      else owner.task = (await control('request_resume', { executionTarget: 'desktop', catalogMode: 'on_demand', mode: input.mode === 'catalog' ? 'catalog' : 'cost', retryFailed: input.retryFailed === true }, owner)).task;
      if (!owns(owner, revision)) return snapshot();
      if (owner.task.runnerId) {
        owner.hasRun = true; publish(owner, owner.task.status); startTimer(); return snapshot();
      }
      closeView(owner); publish(owner, 'starting'); await openView(owner, revision); await poll(); return snapshot();
    } catch (error) {
      if (owns(owner, revision)) { if (!error.preserveView) closeView(owner); publish(owner, 'sync_error', { error: error.message }); }
      throw error;
    }
  }
  function start(input) {
    if (starting) return starting.requestId === input?.requestId ? starting.promise : Promise.reject(new Error('正在准备另一项采集，请稍后重试。'));
    const promise = launch(input).finally(() => { starting = null; }); starting = { requestId: input?.requestId, promise }; return promise;
  }
  async function stop(status = 'stopped') {
    const owner = current; generation++; closeView(owner);
    await control(['session_changed','workspace_changed'].includes(status) ? 'stop' : 'pause', {}, owner).catch(() => {});
    if (current === owner) state = { ...state, status };
  }
  async function sessionChanged() {
    if (!current?.task || current.sessionInvalidated) return;
    const owner = current, revision = generation;
    const { task } = await readTask(owner);
    if (!owns(owner, revision)) return;
    owner.task = task; if (task.status === 'running') owner.hasRun = true;
    if (task.status === 'completed') { publish(owner, 'completed'); closeView(owner); return; }
    if (owner.view && state.status === 'waiting_login' && !owner.hasRun && !['stopped','invalidated','completed'].includes(task.status)) {
      owner.task = (await control('request_resume', { executionTarget: 'desktop', catalogMode: 'on_demand', mode: owner.mode === 'catalog' ? 'catalog' : 'cost', retryFailed: owner.mode !== 'catalog' }, owner)).task;
      if (!owns(owner, revision)) return;
      await bounded(owner.view.webContents.loadURL(pageUrl(owner)), viewTimeoutMs, 'ERP 页面加载超时'); owner.ackStartedAt = now(); await poll(); return;
    }
    owner.sessionInvalidated = true; await stop('session_changed');
    if (owner.request) await requestInbox({ route: '/erp/v1/requests', method: 'POST', body: { workspaceId: owner.workspaceId, request: { ...owner.request, id: owner.requestId, cancel: true } } }).catch(() => {});
  }
  return { start, snapshot, poll, stop, sessionChanged, dispose() { generation++; closeView(); current = null; } };
}
module.exports = { createWorkspaceErpCollector, PURCHASE_FILTERS, PURCHASE_PAGE };
