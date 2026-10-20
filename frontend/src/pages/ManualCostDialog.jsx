import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "../components/UI";
import { saveManualCostOverride, revokeManualCostOverride } from "../data/repositories/profitRepository";
import { describeLedgerCostIdentityIssue } from '../domain/ledgerCostIdentity';
import { previewRecoveredWarehouseCost, saveRecoveredWarehouseCost } from '../data/repositories/warehouseHistoryRecoveryRepository';

export default function ManualCostDialog({ ledger, row, onClose, onNext, children, open = true, readOnly = false, hasEffectiveErpCost = false, className = "", title = "人工更正成本", formFirst = false, queueProgress = null, saveLabel = "保存更正" }) {
  const identityIssue = row.decision?.identityIssue ?? row.costIdentityIssue;
  const identityConflict = identityIssue?.code === 'ledger_sku_skc_conflict';
  const [amount, setAmount] = useState(row.unitCost == null || row.decision?.eligibleForExactProfit === false ? "" : String(row.unitCost));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyCandidate, setHistoryCandidate] = useState(null);
  const editedRef = useRef(false);
  const amountRef = useRef(null);
  useEffect(() => {
    if (!open || readOnly || identityConflict || !formFirst) return;
    const timer = window.setTimeout(() => amountRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, [open, readOnly, identityConflict, formFirst]);
  useEffect(() => {
    if (!open || readOnly || identityConflict || hasEffectiveErpCost || row.manualOverride) return;
    let canceled = false;
    void previewRecoveredWarehouseCost({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku }).then(candidate => {
      if (canceled || !candidate) return;
      setHistoryCandidate(candidate);
      if (!editedRef.current) { setAmount(String(candidate.unitCost)); setReason(candidate.reason); }
    }).catch(() => { /* Ordinary manual correction remains available. */ });
    return () => { canceled = true; };
  }, [open, readOnly, identityConflict, hasEffectiveErpCost, ledger.id, row.store, row.platformSku, row.manualOverride]);
  const act = async (revoke, next = false) => {
    if (saving || readOnly || (!revoke && identityConflict)) return;
    setSaving(true); setError("");
    try {
      if (revoke) await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: row.manualOverride.id });
      else if (historyCandidate && Number(amount) === historyCandidate.unitCost) await saveRecoveredWarehouseCost({
        ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, inboxId: historyCandidate.inboxId, expectedUnitCost: amount, reason });
      else await saveManualCostOverride({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, unitCost: amount, reason });
      if (next && onNext) onNext();
      else onClose();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  };
  const invalid = saving || amount.trim() === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0 || !reason.trim();
  return <Modal open={open} title={title} className={className} description={`${ledger.period} · ${row.store} · ${row.platformSku}。${readOnly ? "已定稿或锁定，当前只读。" : identityConflict ? "当前台账归属存在冲突，已保存的人工金额可撤销。" : hasEffectiveErpCost ? "ERP 正式成本已生效，无需人工确认；仅需更正时填写下方金额和说明。" : "人工更正仅对当前店铺月份生效；撤销后恢复最新可用 ERP 或缺失状态。"}`} onClose={() => !saving && onClose()}
    footer={<>{!readOnly && row.manualOverride ? <Button disabled={saving} onClick={() => act(true)}>撤销当前更正</Button> : null}<Button disabled={saving} onClick={onClose}>{readOnly || identityConflict ? "关闭" : "取消"}</Button>{!readOnly && !identityConflict ? <><Button variant={onNext ? "secondary" : "primary"} loading={saving} disabled={invalid} onClick={() => act(false)}>{saveLabel}</Button>{onNext ? <Button variant="primary" disabled={invalid} onClick={() => act(false, true)}>保存并下一项</Button> : null}</> : null}</>}>
    {queueProgress ? <p className="cost-correction-progress" role="status">待补成本 · 第 {queueProgress.index} / {queueProgress.total} 项</p> : null}
    {!formFirst ? children : null}
    {identityConflict ? <p role="alert">{describeLedgerCostIdentityIssue(identityIssue)}</p> : null}
    {historyCandidate ? <div className="cost-correction-help" role="status"><strong>已自动补查历史仓库采购</strong><p>{historyCandidate.warehouseSku} · ¥{historyCandidate.unitCost}/件。当前映射缺失，保存后按可撤销人工更正生效。</p><details><summary>核对采购证据</summary>{historyCandidate.historyEvidence.warehouseEvidence.decision.selectedRecords.map(record => <p key={record.recordId}>{record.purchaseDate} · 数量 {record.quantity} · 单价 ¥{record.unitPrice}</p>)}</details></div> : null}
    {!readOnly && !identityConflict ? <><div className="form-field"><label htmlFor="manual-cost-value">单件成本（CNY，可为 0）</label><input ref={amountRef} id="manual-cost-value" className="text-input" type="number" min="0" step="any" disabled={saving} value={amount} onChange={(event) => { editedRef.current = true; setAmount(event.target.value); }} /></div>
    <div className="form-field"><label htmlFor="manual-cost-reason">更正说明</label><textarea id="manual-cost-reason" className="text-input" disabled={saving} value={reason} onChange={(event) => { editedRef.current = true; setReason(event.target.value); }} /></div></> : null}
    {error ? <p role="alert">{error}</p> : null}
    {formFirst ? children : null}
  </Modal>;
}
