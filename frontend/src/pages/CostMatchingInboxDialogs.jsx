import { History, Inbox, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, Modal } from "../components/UI";
import { ERP_INBOX_MATCH_REASONS } from "../domain/erpInboxMatching";

export function CostMatchingInboxQueueDialog({
  open,
  inboxQueue,
  processedInboxRecords,
  ledger,
  requests = [],
  selectedPendingInboxIds,
  loadedInboxId,
  accountingReadOnly,
  ledgerLocked,
  onClose,
  onManualImport,
  onTogglePending,
  onDeleteSelected,
  onLoadInbox,
  onDeleteOne,
  onVoid,
}) {
  return (
    <Modal
      open={open}
      title={`ERP 回传待处理（${inboxQueue.pendingCount}）`}
      description="已收到不等于已采用。批次须匹配账本和请求，允许在已登记 SKC 范围内分批回传。"
      className="cost-inbox-queue-modal"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onManualImport}>手动导入</Button>{selectedPendingInboxIds.size > 0 ? <Button icon={Trash2} variant="danger" disabled={ledgerLocked} onClick={() => onDeleteSelected([...selectedPendingInboxIds])}>删除所选 {selectedPendingInboxIds.size} 个</Button> : null}<Button variant="primary" onClick={onClose}>关闭</Button></>}
    >
      <div className="cost-inbox-queue">
        {inboxQueue.items.length === 0 ? <EmptyState icon={Inbox} title="暂无待处理回传" description="ERP Assistant 完成采集后，批次会先进入这里，再按请求范围自动载入。" /> : inboxQueue.items.map((item) => {
          const batch = item.inbox.envelope?.batch ?? {};
          const skcCount = Array.isArray(batch.query?.platformSkcs) ? batch.query.platformSkcs.length : 0;
          const sentAt = item.inbox.envelope?.sentAt ?? item.inbox.receivedAt;
          const isLoaded = item.inbox.status === "loaded";
          const isActive = item.inbox.id === loadedInboxId;
          const period = item.request?.ledgerPeriod ?? (item.inbox.ledgerId === ledger?.id ? ledger?.period : null) ?? "月份待核对";
          return <article className={"cost-inbox-item" + (isLoaded ? " loaded" : "")} key={item.inbox.id}>
            <div className="cost-inbox-item-select">{item.inbox.status === "pending" ? <input type="checkbox" aria-label={"选择批次 " + item.inbox.batchId} checked={selectedPendingInboxIds.has(item.inbox.id)} onChange={(event) => onTogglePending(item.inbox.id, event.target.checked)} /> : null}</div>
            <div className="cost-inbox-item-main"><strong>{period} · {skcCount} 个平台 SKC</strong><small>接收：{item.inbox.receivedAt || sentAt ? new Date(item.inbox.receivedAt ?? sentAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知"}</small><small>批次 <code>{item.inbox.batchId}</code></small>{!item.scopeMatched ? <small>{ERP_INBOX_MATCH_REASONS[item.reason] ?? item.reason}</small> : null}</div>
            <div className="cost-inbox-item-status"><Badge tone={isLoaded ? "info" : item.scopeMatched ? "default" : "warning"}>{isActive ? "已载入，待采用" : isLoaded ? "待恢复核对" : "已收到，待载入"}</Badge><Button disabled={accountingReadOnly || isActive || !item.scopeMatched} onClick={() => onLoadInbox(item)}>{accountingReadOnly ? "账本已定稿" : isActive ? "已载入" : isLoaded ? "恢复载入" : "载入核对"}</Button><Button icon={Trash2} variant="ghost" disabled={ledgerLocked} title="删除批次" onClick={() => onDeleteOne(item.inbox.id)}>删除批次</Button></div>
          </article>;
        })}
      </div>
      <details className="cost-inbox-history">
        <summary><History size={16} />已采用与历史批次 <strong>{processedInboxRecords.length}</strong></summary>
        <div className="cost-inbox-history-list">
          {processedInboxRecords.length === 0 ? <p className="pending-text">暂无历史批次。</p> : processedInboxRecords.map((record) => <article className="cost-inbox-history-item" key={record.id}>
            <div><strong>{requests.find(request => request.id === record.requestId)?.ledgerPeriod ?? (record.ledgerId === ledger?.id ? ledger?.period : "月份待核对")} · {record.batchId}</strong><small>{record.historyAt ? new Date(record.historyAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知"} · {record.sourceLabel}</small>{record.appliedBatchId ? <small>已采用记录 <code>{record.appliedBatchId}</code></small> : null}{record.voidReason ? <small>撤回说明：{record.voidReason}</small> : null}</div>
            <div className="cost-inbox-item-status"><Badge tone={record.status === "applied" ? "success" : record.status === "voided" ? "warning" : "default"}>{record.statusLabel}</Badge>{record.status === "applied" ? <Button icon={RotateCcw} variant="ghost" disabled={ledgerLocked} onClick={() => onVoid(record)}>{ledgerLocked ? "账本已锁定" : "撤回本次采用"}</Button> : null}</div>
          </article>)}
        </div>
      </details>
    </Modal>
  );
}

export function CostMatchingDeleteBatchDialog({ ids, deleting, onCancel, onConfirm }) {
  return (
    <Modal
      open={ids.length > 0}
      title="删除 ERP 批次"
      description={"确认删除所选 " + ids.length + " 个批次？这些候选将从待处理列表移除，原始回传和操作记录仍保留。"}
      onClose={() => { if (!deleting) onCancel(); }}
      footer={<><Button variant="ghost" disabled={deleting} onClick={onCancel}>取消</Button><Button variant="danger" icon={Trash2} loading={deleting} onClick={onConfirm}>删除 {ids.length} 个批次</Button></>}
    />
  );
}

export function CostMatchingVoidBatchDialog({ draft, voiding, ledgerStatus, onCancel, onReasonChange, onConfirm }) {
  return (
    <Modal
      open={Boolean(draft)}
      title="撤回本次采用的 ERP 成本"
      description={ledgerStatus === "finalized" ? "该账本已定稿。确认后会重新打开本月并撤回这次 ERP 成本；旧报告、原始候选和人工成本保留。不会自动恢复更早的 ERP 成本。" : "撤回不会删除原始候选和采购证据，也不会改变人工成本；不再采用这次 ERP 结果，且不会自动恢复更早的 ERP 成本。"}
      onClose={() => { if (!voiding) onCancel(); }}
      footer={<><Button variant="ghost" disabled={voiding} onClick={onCancel}>取消</Button><Button variant="danger" icon={RotateCcw} loading={voiding} disabled={!draft?.reason?.trim()} onClick={onConfirm}>确认撤回并重新核对</Button></>}
    >
      {draft ? <div className="form-field"><label htmlFor="erp-withdraw-reason" className="required">撤回说明</label><textarea id="erp-withdraw-reason" className="text-area" rows="3" value={draft.reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="说明为什么这次结果不再用于本月核算" /></div> : null}
    </Modal>
  );
}
