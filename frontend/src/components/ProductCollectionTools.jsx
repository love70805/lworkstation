import { useEffect, useId, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { Panel } from './UI';
import { useErpCollectionTasks } from '../hooks/useErpCollectionTasks';
import { controlErpCollectionTask } from '../lib/erpInboxTransport';
import { erpCollectionPresentation } from '../domain/erpCollectionStatus';
import ErpCollectionProgress from './ErpCollectionProgress';
import ErpCollectionLauncher from './ErpCollectionLauncher';
import { prepareProductArchiveCollection } from '../data/repositories/erpCatalogRepository';

export default function ProductCollectionTools({ workspaceId }) {
  const collection = useErpCollectionTasks(workspaceId);
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const tasks = collection.tasks.filter(task => !['stopped', 'invalidated'].includes(task.status) && task.batches?.length && task.batches.every(batch => batch.deliveryId))
    .toSorted((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const task = tasks.find(item => item.taskId === selected) ?? tasks.find(item => erpCollectionPresentation(item).running) ?? tasks[0];
  const view = erpCollectionPresentation(task);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const runtime = window.shopeersDesktopRuntime;
  async function control(action, refresh = false) {
    if (!task || busy) return;
    setBusy(true); setError('');
    try {
      const continuing = ['catalog', 'resume', 'retry_failed'].includes(action);
      if (continuing) await prepareProductArchiveCollection(task);
      await controlErpCollectionTask(task.taskId, { workspaceId, action: continuing ? 'request_resume' : action,
        requestId: task.requestId, scopeHash: task.scopeHash, filters: task.filters,
        ...(continuing ? { mode: 'catalog', catalogMode: 'on_demand', refreshCatalog: refresh } : {}) });
      let result = { ok: true };
      if (continuing && runtime?.startErpCollection) {
        result = await runtime.startErpCollection({ workspaceId, ledgerId: task.ledgerId, requestId: task.requestId, mode: 'catalog' });
        if (!result?.ok) throw new Error(result?.error || '商品档案获取尚未启动，请重试。');
      }
      collection.refresh();
      return result;
    } catch (failure) { if (!['catalog', 'resume', 'retry_failed'].includes(action)) setError(failure.message); return { ok: false, error: failure.message }; } finally { setBusy(false); }
  }
  const attention = Boolean(view.running || view.state === 'queued' || error || collection.error);
  useEffect(() => { if (attention) setExpanded(true); }, [attention]);
  return <>
    <button type="button" className="catalog-erp-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(previous => !previous)}>
      <Download size={15} aria-hidden="true" />获取商品档案{attention ? <small>{error || collection.error ? '需检查' : view.title}</small> : null}<ChevronDown size={13} aria-hidden="true" />
    </button>
    <Panel id={id} hidden={!expanded} className="product-collection-tools">
    <div className="product-archive-entry">
      <div><p>从 ERP 补齐名称、图片、属性和 1688 链接。已有人工资料优先。</p>
      </div>
      <div className="product-archive-action"><ErpCollectionLauncher workspaceId={workspaceId} ledgerId={task?.ledgerId} requestId={task?.requestId}
        mode="catalog" task={task} ready={Boolean(task) && !busy && !collection.error}
        onStart={() => control('catalog', task.batches.every(batch => batch.catalogStatus === 'completed'))} onStarted={collection.refresh} /></div>
    </div>
    {task ? <>
      <label className="product-catalog-source">获取范围 <select className="select-input" disabled={busy || view.running || view.state === 'queued'} value={task.taskId} onChange={event => setSelected(event.target.value)}>{tasks.map(item => <option key={item.taskId} value={item.taskId}>{item.ledgerPeriod} · {item.expectedSkus?.length ?? item.requestSnapshot?.expectedSkus?.length ?? 0} 个 SKU</option>)}</select></label>
      {task.runMode === 'catalog' || task.batches.some(batch => batch.catalogStatus) ? <ErpCollectionProgress task={task} showCatalog catalogOnly onControl={control} busy={busy} error={error || collection.error} statusError={collection.error} /> : null}
    </> : <p role="status">{collection.loading ? '正在读取可复用的商品范围…' : '暂无可复用的 SKU 对应关系。完成成本采集后即可一键获取。'}</p>}
    {!runtime?.startErpCollection ? <p role="status">后台获取在 Windows 桌面版中使用。</p> : null}
    {(error || collection.error) && task?.runMode !== 'catalog' ? <p role="alert">{error || collection.error}</p> : null}
  </Panel></>;
}
