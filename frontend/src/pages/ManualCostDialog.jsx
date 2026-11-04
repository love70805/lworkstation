import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "../components/UI";
import { saveManualCostOverride, revokeManualCostOverride } from "../data/repositories/profitRepository";
import { describeLedgerCostIdentityIssue } from '../domain/ledgerCostIdentity';
import { previewRecoveredWarehouseCost, saveRecoveredWarehouseCost } from '../data/repositories/warehouseHistoryRecoveryRepository';

export default function ManualCostDialog({ ledger, row, onClose, children, open = true, readOnly = false, hasEffectiveErpCost = false, className = "", title = "人工更正成本", formFirst = false, saveLabel = "保存更正" }) {
  const identityIssue = row.decision?.identityIssue ?? row.costIdentityIssue;
  const identityConflict = identityIssue?.code === 'ledger_sku_skc_conflict';
  const [amount, setAmount] = useState(row.unitCost == null || row.decision?.eligibleForExactProfit === false ? "" : String(row.unitCost));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyCandidate, setHistoryCandidate] = useState(null);
  const editedRef = useRef(false);
  const amountRef = useRef(null);
  const openingMode = useRef(ledger.accountingMode);
  useEffect(() => {
    if (!open || readOnly || identityConflict || !formFirst) return;
    const timer = window.setTimeout(() => amountRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, [open, readOnly, identityConflict, formFirst]);
  useEffect(() => {
    if (!open || readOnly || identityConflict || hasEffectiveErpCost || row.manualOverride) return;
    let canceled = false;
    void previewRecoveredWarehouseCost({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, ...(openingMode.current ? { expectedAccountingMode: openingMode.current } : {}) }).then(candidate => {
      if (canceled || !candidate) return;
      setHistoryCandidate(candidate);
      if (!editedRef.current) setAmount(String(candidate.unitCost));
    }).catch(() => { /* Ordinary manual correction remains available. */ });
    return () => { canceled = true; };
  }, [open, readOnly, identityConflict, hasEffectiveErpCost, ledger.id, row.store, row.platformSku, row.manualOverride]);
  const act = async (revoke) => {
    if (saving || readOnly || (!revoke && identityConflict)) return;
    setSaving(true); setError("");
    try {
      if (openingMode.current !== ledger.accountingMode) throw new Error('核算上下文已变化，请重新打开成本明细。');
      const reason = historyCandidate && Number(amount) === historyCandidate.unitCost
        ? historyCandidate.reason : '人工输入单件成本并确认更正';
      if (revoke) await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: row.manualOverride.id, ...(openingMode.current ? {expectedAccountingMode:openingMode.current} : {}) });
      else if (historyCandidate && Number(amount) === historyCandidate.unitCost) await saveRecoveredWarehouseCost({
        ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, inboxId: historyCandidate.inboxId, expectedUnitCost: amount, reason, ...(openingMode.current ? {expectedAccountingMode:openingMode.current} : {}) });
      else await saveManualCostOverride({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, unitCost: amount, reason, ...(openingMode.current ? {expectedAccountingMode:openingMode.current} : {}) });
      onClose();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  };
  const invalid = saving || amount.trim() === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0;
  return <Modal open={open} title={title} className={className} description={`${ledger.period} · ${row.store} · ${row.platformSku}。${readOnly ? "当前只读。" : identityConflict ? "当前台账归属存在冲突，已保存的人工金额可撤销。" : hasEffectiveErpCost ? "ERP 成本已生效；如需更正，输入单件成本后确认即可。" : "输入单件成本后确认，仅对当前店铺月份生效，操作自动留痕。"}`} onClose={() => !saving && onClose()}
    footer={<>{!readOnly && row.manualOverride ? <Button disabled={saving} onClick={() => act(true)}>撤销当前更正</Button> : null}<Button disabled={saving} onClick={onClose}>{readOnly || identityConflict ? "关闭" : "取消"}</Button>{!readOnly && !identityConflict ? <Button variant="primary" loading={saving} disabled={invalid} onClick={() => act(false)}>{saveLabel}</Button> : null}</>}>
    {!formFirst ? children : null}
    {identityConflict ? <p role="alert">{describeLedgerCostIdentityIssue(identityIssue)}</p> : null}
    {historyCandidate ? <div className="cost-correction-help" role="status"><strong>已自动补查历史仓库采购</strong><p>{historyCandidate.warehouseSku} · ¥{historyCandidate.unitCost}/件。当前映射缺失，保存后按可撤销人工更正生效。</p><details><summary>核对采购证据</summary>{historyCandidate.historyEvidence.warehouseEvidence.decision.selectedRecords.map(record => <p key={record.recordId}>{record.purchaseDate} · 数量 {record.quantity} · 单价 ¥{record.unitPrice}</p>)}</details></div> : null}
    {!readOnly && !identityConflict ? <div className="form-field"><label htmlFor="manual-cost-value">单件成本（CNY，可为 0）</label><input ref={amountRef} id="manual-cost-value" className="text-input" type="number" min="0" step="any" disabled={saving} value={amount} onChange={(event) => { editedRef.current = true; setAmount(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !invalid) { event.preventDefault(); void act(false); } }} /></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {formFirst ? children : null}
  </Modal>;
}
