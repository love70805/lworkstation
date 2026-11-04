(() => {
  'use strict';
  if (window.ShopeersErpTaskPreview) return;
  let busy = false;
  const rootId = 'erpa-cost-root';
  const stages = { ready: '等待后台接续', running: '正在采集与核验采购成本', paused: '采集已暂停', pausing: '正在暂停', stopped: '采集已停止', invalidated: '采集范围已变化', completed: '任务已完成', partial: '部分成本待核对', cost_complete: '成本已送达，正在核算与整理资料' };
  function mount() {
    if (window.top !== window || !document.body) return false;
    if (document.getElementById(rootId)?.classList.contains('erpa-task-preview')) return true;
    document.getElementById(rootId)?.remove();
    document.getElementById('erpa-cost-trigger')?.remove();
    const trigger = document.createElement('button');
    trigger.id = 'erpa-cost-trigger'; trigger.type = 'button'; trigger.textContent = 'ERP 任务进度';
    const root = document.createElement('div'); root.id = rootId; root.className = 'erpa-task-preview';
    root.innerHTML = '<section class="erpa-panel" role="region" aria-label="后台任务进度"><header class="erpa-header"><h2 class="erpa-title">后台任务进度</h2><button class="erpa-icon-button" type="button" aria-label="关闭任务进度">×</button></header><div class="erpa-task-body" role="status" aria-live="polite">正在读取工作台任务…</div></section>';
    root.querySelector('button').addEventListener('click', () => root.classList.remove('erpa-open'));
    trigger.addEventListener('click', () => { root.classList.toggle('erpa-open'); void refresh(); });
    document.body.append(trigger, root); void refresh(); return true;
  }
  async function refresh() {
    if (busy || window.top !== window) return;
    const body = document.querySelector('.erpa-task-body'); if (!body) return;
    busy = true;
    try {
      const response = await window.ShopeersErpDeliveryBridge.collectionTask({ action: 'list' });
      if (!response?.ok) throw new Error('offline');
      const tasks = (response.tasks || []).filter(task => task.executionTarget === 'desktop').sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      const task = tasks.find(item => !['completed','stopped','invalidated'].includes(item.status)) || tasks[0];
      body.replaceChildren();
      const line = (text, strong = false) => { const element = document.createElement(strong ? 'strong' : 'p'); element.textContent = text; body.append(element); };
      if (!task) { line('暂无后台任务'); line('从工作台开始成本核算后，这里会自动显示进度。'); return; }
      const permissionPaused = task.status === 'paused' && task.pauseReason?.code === 'ERP_PERMISSION_REQUIRED';
      line(permissionPaused ? 'ERP 店铺权限校验未通过，采集已暂停' : task.status === 'cost_complete' && task.catalogMode === 'on_demand' && task.runMode !== 'catalog'
        ? '成本已送达' : stages[task.status] || '等待后台处理', true);
      if (permissionPaused) line('请确认 ERP 采购管理可正常查询，再回工作台继续原任务；已送达结果保留。');
      const batches = task.batches || [], total = task.summary?.total ?? batches.reduce((sum,batch)=>sum+(batch.platformSkcs?.length||0),0);
      const delivered = task.summary?.delivered ?? batches.filter(batch=>batch.deliveryId).reduce((sum,batch)=>sum+(batch.platformSkcs?.length||0),0);
      line(`${task.ledgerPeriod || ''} · 成本已送达 ${delivered} / ${total} 个 SKC`);
      const progress = document.createElement('progress'); progress.max = Math.max(1,total); progress.value = delivered; progress.setAttribute('aria-label','成本回传进度'); body.append(progress);
      line(`已采集 ${task.summary?.collected ?? delivered} 个 SKC · 已采用 ${task.summary?.adopted ?? 0} 个 SKU`);
      if (task.catalogMode === 'after_costs' || task.runMode === 'catalog') line(`商品资料已完成 ${batches.filter(batch=>batch.catalogStatus==='completed').reduce((sum,batch)=>sum+(batch.platformSkcs?.length||0),0)} / ${total} 个 SKC`);
      const current = batches.find(batch => ['running','collecting'].includes(batch.status) || batch.catalogStatus === 'running');
      if (current) line('当前范围：' + (current.platformSkcs || []).slice(0,5).join('、') + ((current.platformSkcs?.length || 0) > 5 ? ` 等 ${current.platformSkcs.length} 个 SKC` : ''));
      if (batches.some(batch=>['failed','incomplete'].includes(batch.status)||batch.catalogStatus==='failed')) line('部分成本或资料待处理，可在工作台查看具体原因并继续。');
      line('进度每 3 秒刷新；暂停、继续和核对在工作台操作。');
    } catch { body.textContent = '暂时无法读取任务进度，后台任务不受影响；连接恢复后自动更新。'; }
    finally { busy = false; }
  }
  function isManaged({ onObserved = () => {}, timeoutMs = 1500 } = {}) {
    return new Promise(resolve => {
      let settled = false, observed = false;
      const finish = value => { if (settled) return; settled = true; window.clearTimeout(timer); resolve(value); };
      const timer = window.setTimeout(() => finish(null), timeoutMs);
      const receive = value => {
        if (observed) return;
        if (window.chrome?.runtime?.lastError) return finish(null);
        if (!value || typeof value !== 'object') return finish(null);
        observed = true;
        const managed = value?.shopeersErpDesktopTaskUi === true;
        try { onObserved(managed); } finally { finish(managed); }
      };
      try {
        if (!window.chrome?.storage?.local?.get) return finish(false);
        const pending = window.chrome.storage.local.get(['shopeersErpDesktopTaskUi'], receive);
        if (pending?.then) void pending.then(receive, () => finish(null));
      } catch { finish(null); }
    });
  }
  window.ShopeersErpTaskPreview = { mount, refresh, isManaged };
})();
