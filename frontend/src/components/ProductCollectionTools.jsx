import { useState } from 'react';
import { Button, Panel } from './UI';
import { useErpCollectionTasks } from '../hooks/useErpCollectionTasks';
import { controlErpCollectionTask } from '../lib/erpInboxTransport';
import ErpCollectionProgress from './ErpCollectionProgress';
import ProductArchiveImport from './ProductArchiveImport';

export default function ProductCollectionTools({ workspaceId }) {
  const collection = useErpCollectionTasks(workspaceId);
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const tasks = collection.tasks.filter(task => task.batches?.some(batch => batch.deliveryId)).toSorted((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const task = tasks.find(item => item.taskId === selected) ?? tasks[0];
  async function control(action) {
    if (!task || busy) return;
    setBusy(true); setError('');
    try {
      const continuing = ['catalog', 'resume', 'retry_failed'].includes(action);
      await controlErpCollectionTask(task.taskId, { workspaceId, action: continuing ? 'request_resume' : action,
        requestId: task.requestId, scopeHash: task.scopeHash, filters: task.filters,
        ...(continuing ? { mode: 'catalog', catalogMode: 'on_demand' } : {}) });
      if (continuing && window.shopeersDesktopRuntime?.startErpCollection) {
        const result = await window.shopeersDesktopRuntime.startErpCollection({ workspaceId, ledgerId: task.ledgerId, requestId: task.requestId, mode: 'catalog' });
        if (!result?.ok) throw new Error(result?.error || '资料补齐尚未启动，请重试。');
      }
      collection.refresh();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <details className="product-collection-tools" open={new URLSearchParams(window.location.search).has('collection') ? true : undefined}><summary>补齐商品资料</summary><Panel>
    <p>补齐名称、图片和 1688 链接，复用已经取得的 SKU 对应关系。商品资料不改变月度正式成本。</p>
    <ProductArchiveImport />
    {task ? <><label>资料来源 <select className="select-input" value={task.taskId} onChange={event => setSelected(event.target.value)}>{tasks.map(item => <option key={item.taskId} value={item.taskId}>{item.ledgerPeriod} · {item.expectedSkus?.length ?? item.requestSnapshot?.expectedSkus?.length ?? 0} 个 SKU</option>)}</select></label>
      <ErpCollectionProgress task={task} showCatalog onControl={control} busy={busy} error={error || collection.error} statusError={collection.error} />
    </> : <p role="status">{collection.loading ? '正在读取可复用的采集记录…' : '先完成一次 ERP 成本采集，即可复用对应关系补齐资料。已有商品也可在档案中单独补齐。'}</p>}
    {error && !task ? <p role="alert">{error}</p> : null}
  </Panel></details>;
}
