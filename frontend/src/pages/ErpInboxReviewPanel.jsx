import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Inbox, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button, Modal, Panel } from '../components/UI';
import { formatErpUnitCost } from '../lib/profitPrecision';

export function ErpPendingSkuList({ entries = [], onReviewItem, onOverview, batchCount = 0, locked = false, title = '待处理 SKU', showOverview = true }) {
  return <Panel className="erp-review-panel">
    <div className="erp-review-heading"><div><h2>{title} · {entries.length} 条店铺 SKU</h2><p>以下原因来自工作台对采购证据的核验。候选成本尚未计入利润。</p></div>{showOverview ? <Button icon={Inbox} onClick={onOverview}>全部 {batchCount} 批回传</Button> : null}</div>
    {entries.length ? <div className="erp-review-skus">{entries.map(entry => <article className="erp-review-sku" key={entry.id} data-platform-sku={entry.platformSku} data-inbox-id={entry.inboxId}>
      <div className="erp-review-identity"><strong className="mono">{entry.platformSku}</strong><span>{entry.store} · {entry.attribute || entry.productName || '属性未提供'}</span><small>SKC <code>{entry.platformSkc || '待核对'}</code></small></div>
      <div className="erp-review-reason"><strong>待核对原因</strong><p>{entry.reasonText}</p></div>
      <div className="erp-review-candidate"><small>ERP 候选成本</small><strong className="mono">{entry.unitCost == null ? '暂无候选价' : formatErpUnitCost(entry.unitCost)}</strong><small>{entry.batchIndex ? '第 ' + entry.batchIndex + ' 批' : '尚无可用回传'}</small></div>
      <div className="erp-review-actions"><Button aria-label={entry.store + ' · ' + entry.platformSku + ' · 查看异常详情'} onClick={() => onReviewItem(entry, 'details')}>查看证据</Button>{!locked && entry.canCorrect !== false ? <Button variant="ghost" aria-label={entry.store + ' · ' + entry.platformSku + ' · 直接人工更正'} onClick={() => onReviewItem(entry, 'edit')}>人工更正</Button> : null}</div>
    </article>)}</div> : <div className="erp-review-empty"><CheckCircle2 size={18} aria-hidden="true" /><span>当前没有待补成本。原始采购异常仍保留在批次记录中。</span></div>}
  </Panel>;
}

export default function ErpInboxReviewDialog({ open, review, overviewRevision, inboxQueue, loadedInboxId, accountingReadOnly, ledgerLocked, selectedPendingInboxIds, onClose, onManualImport, onTogglePending, onDeleteSelected, onDeleteOne, onVoid, onLoadInbox, onReviewItem }) {
  const [selectedId, setSelectedId] = useState(null);
  const contentRef = useRef(null), overviewScroll = useRef(0);
  useLayoutEffect(() => { setSelectedId(null); overviewScroll.current = 0; }, [overviewRevision]);
  useLayoutEffect(() => { const body = contentRef.current?.closest('.modal-body'); if (body) body.scrollTop = selectedId ? 0 : overviewScroll.current; }, [selectedId, open]);
  const openBatch = id => { overviewScroll.current = contentRef.current?.closest('.modal-body')?.scrollTop ?? 0; setSelectedId(id); };
  const batches = review.batches;
  const selected = batches.find(batch => batch.id === selectedId);
  const missingBatches = batches.filter(batch => batch.currentMissingCount > 0).length;
  const close = () => { setSelectedId(null); onClose(); };
  const batchLabel = batch => ['voided', 'rejected'].includes(batch.inbox.status) ? batch.inbox.status === 'voided' ? '本次采用已撤回' : '本次回传已拒绝'
    : batch.currentMissingCount ? '当前 ' + batch.currentMissingCount + ' 条店铺 SKU待补成本'
      : batch.historicalExceptionCount ? '本批当前无待补项 · 原异常记录保留' : '当前无待补成本';
  const batchActions = batch => {
    const queueItem = inboxQueue.items.find(item => item.inbox.id === batch.id);
    return <div className="erp-review-batch-actions">
      {queueItem ? <Button disabled={accountingReadOnly || batch.id === loadedInboxId || !queueItem.scopeMatched} onClick={() => onLoadInbox(queueItem)}>{batch.id === loadedInboxId ? '采购证据已载入' : '载入采购证据核对'}</Button> : null}
      {batch.inbox.appliedBatchId && !['voided', 'rejected'].includes(batch.inbox.status) ? <details className="erp-review-more"><summary>更多操作</summary><Button icon={RotateCcw} variant="ghost" disabled={ledgerLocked} onClick={() => onVoid(batch.inbox)}>撤回本次采用</Button></details> : batch.inbox.status === 'pending' ? <details className="erp-review-more"><summary>更多操作</summary><Button icon={Trash2} variant="ghost" disabled={ledgerLocked} onClick={() => onDeleteOne(batch.id)}>删除批次</Button></details> : null}
    </div>;
  };
  return <Modal open={open} title={selected ? '第 ' + selected.index + ' / ' + batches.length + ' 批回传' : 'ERP 回传总览（' + batches.length + ' 批）'} description={selected ? '查看本批当前缺成本与原始核验结果；浏览记录不会改变成本采用。' : '全部回传在这里查看。待补成本按当前有效 ERP 或人工成本计算，原始异常证据保留。'} className="cost-inbox-queue-modal erp-review-modal" onClose={close}
    footer={<>{selected ? <Button icon={ArrowLeft} onClick={() => setSelectedId(null)}>返回全部 {batches.length} 批次</Button> : <Button variant="ghost" onClick={onManualImport}>手动导入</Button>}{selectedPendingInboxIds.size ? <Button icon={Trash2} variant="danger" disabled={ledgerLocked} onClick={() => onDeleteSelected([...selectedPendingInboxIds])}>删除所选 {selectedPendingInboxIds.size} 个</Button> : null}<Button variant="primary" onClick={close}>关闭</Button></>}>
    {selected ? <div ref={contentRef} className="erp-review-batch-detail" data-inbox-id={selected.id}>
      <div className="erp-review-detail-nav"><Button icon={ArrowLeft} onClick={() => setSelectedId(null)}>返回全部 {batches.length} 批次</Button><span>第 {selected.index} / {batches.length} 批 · {selected.skcCount} 个 SKC</span></div>
      <div className="erp-review-batch-summary"><Badge tone={selected.currentMissingCount ? 'warning' : 'success'}>{batchLabel(selected)}</Badge><p>原回传自动采用 {selected.automaticCount} 个 SKU · 原待核验 {selected.historicalExceptionCount} 个 SKU{selected.coveredCount ? ' · 当前已补齐 ' + selected.coveredCount + ' 条店铺 SKU' : ''}</p><small className="mono">批次 {selected.batchId}</small>{batchActions(selected)}</div>
      <ErpPendingSkuList entries={selected.entries.filter(entry => entry.currentMissing)} onReviewItem={onReviewItem} showOverview={false} locked={accountingReadOnly} title="本批待处理 SKU" />
      {selected.entries.some(entry => !entry.currentMissing) ? <details className="erp-review-covered"><summary>已补齐与原始异常记录 · {selected.entries.filter(entry => !entry.currentMissing).length} 项</summary>{selected.entries.filter(entry => !entry.currentMissing).map(entry => <article key={entry.id}><strong className="mono">{entry.platformSku}</strong><span>{entry.reviewRowId == null ? '本月无对应店铺明细' : entry.store + ' · 当前成本有效'}</span><p>原核验原因：{entry.reasonText}</p></article>)}</details> : null}
    </div> : <div ref={contentRef} className="erp-review-overview">
      <div className="erp-review-overview-summary" role="status"><strong>{batches.length} 批回传</strong><span>{missingBatches} 批当前有待补成本</span><span>{review.exceptions.length} 条店铺 SKU待处理</span></div>
      {batches.length ? batches.map(batch => <article className="erp-review-batch" key={batch.id} data-inbox-id={batch.id}>
        <div className="erp-review-batch-heading"><div><strong>第 {batch.index} / {batches.length} 批 · {batch.skcCount} 个平台 SKC</strong><small>{batch.inbox.receivedAt ? new Date(batch.inbox.receivedAt).toLocaleString('zh-CN', { hour12: false }) : '接收时间待核对'}</small></div><Badge tone={batch.currentMissingCount ? 'warning' : ['voided', 'rejected'].includes(batch.inbox.status) ? 'default' : 'success'}>{batchLabel(batch)}</Badge></div>
        <p>原回传自动采用 {batch.automaticCount} 个 SKU · 原待核验 {batch.historicalExceptionCount} 个 SKU</p><small className="mono">批次 {batch.batchId}</small>
        <div className="erp-review-batch-footer">{batch.inbox.status === 'pending' && !batch.inbox.appliedBatchId ? <label><input type="checkbox" checked={selectedPendingInboxIds.has(batch.id)} aria-label={'选择批次 ' + batch.batchId} onChange={event => onTogglePending(batch.id, event.target.checked)} />选择此批</label> : <span /> }<Button onClick={() => openBatch(batch.id)}>查看第 {batch.index} 批{batch.currentMissingCount ? '待处理 SKU' : '记录'}</Button></div>
      </article>) : <p className="erp-review-empty">当前月份还没有 ERP 回传。</p>}
    </div>}
  </Modal>;
}

