import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "../components/UI";
import { saveManualCostOverride, revokeManualCostOverride } from "../data/repositories/profitRepository";
import { describeLedgerCostIdentityIssue } from '../domain/ledgerCostIdentity';
import { previewRecoveredWarehouseCost, saveRecoveredWarehouseCost } from '../data/repositories/warehouseHistoryRecoveryRepository';
import { formatCostPurchaseEvidence, formatErpUnitCost, formatManualUnitCost } from '../lib/profitPrecision';

export default function ManualCostDialog({
  ledger, row, onClose, children, open = true, readOnly = false, hasEffectiveErpCost = false,
  className = "", viewFirst = false, title = viewFirst ? "成本详情" : "人工更正成本", formFirst = false, saveLabel = "保存更正",
}) {
  const identityIssue = row.decision?.identityIssue ?? row.costIdentityIssue;
  const identityConflict = identityIssue?.code === 'ledger_sku_skc_conflict';
  const currentAmount = row.unitCost == null || row.decision?.eligibleForExactProfit === false ? "" : String(row.unitCost);
  const erpApplied = hasEffectiveErpCost || row.costSource === "erp";
  const manualApplied = Boolean(row.manualOverride) || row.costSource === "manual_override";
  const [amount, setAmount] = useState(currentAmount);
  const [editRequested, setEditRequested] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyCandidate, setHistoryCandidate] = useState(null);
  const editedRef = useRef(false);
  const amountRef = useRef(null);
  const openingMode = useRef(ledger.accountingMode);
  const canEdit = !readOnly && !identityConflict;
  const showForm = canEdit && (!viewFirst || editRequested);
  const invalid = saving || amount.trim() === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0;

  useEffect(() => {
    if (!open) setEditRequested(false);
  }, [open]);
  useEffect(() => {
    if (!open || !showForm || !(formFirst || viewFirst)) return;
    const timer = window.setTimeout(() => amountRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, [open, showForm, formFirst, viewFirst]);
  useEffect(() => {
    if (!open || !showForm || erpApplied || manualApplied) return;
    let canceled = false;
    void previewRecoveredWarehouseCost({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, ...(openingMode.current ? { expectedAccountingMode: openingMode.current } : {}) }).then(candidate => {
      if (canceled || !candidate) return;
      setHistoryCandidate(candidate);
      if (!editedRef.current) setAmount(String(candidate.unitCost));
    }).catch(() => { /* Ordinary manual correction remains available. */ });
    return () => { canceled = true; };
  }, [open, showForm, erpApplied, manualApplied, ledger.id, row.store, row.platformSku]);

  function startCorrection() {
    setAmount(currentAmount);
    setHistoryCandidate(null);
    editedRef.current = false;
    setEditRequested(true);
  }

  const historySuggestion = showForm && !erpApplied && !manualApplied ? historyCandidate : null;
  const act = async (revoke) => {
    if (saving || readOnly || (revoke ? !row.manualOverride : !showForm || invalid)) return;
    setSaving(true); setError("");
    try {
      if (openingMode.current !== ledger.accountingMode) throw new Error('核算上下文已变化，请重新打开成本明细。');
      const useHistory = historySuggestion && Number(amount) === historySuggestion.unitCost;
      const reason = useHistory ? historySuggestion.reason : '人工输入单件成本并确认更正';
      if (revoke) await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: row.manualOverride.id, ...(openingMode.current ? {expectedAccountingMode:openingMode.current} : {}) });
      else if (useHistory) await saveRecoveredWarehouseCost({
        ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, inboxId: historySuggestion.inboxId, expectedUnitCost: amount, reason, ...(openingMode.current ? {expectedAccountingMode:openingMode.current} : {}) });
      else await saveManualCostOverride({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, unitCost: amount, reason, ...(openingMode.current ? {expectedAccountingMode:openingMode.current} : {}) });
      onClose();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  };

  let evidence = children;
  if (viewFirst && !evidence) {
    const records = formatCostPurchaseEvidence(row);
    let currentCost = "缺少有效成本";
    if (currentAmount && manualApplied) currentCost = `人工更正 · ${formatManualUnitCost(currentAmount)}/件`;
    else if (currentAmount && erpApplied) currentCost = `ERP 已采用 · ${formatErpUnitCost(currentAmount)}/件`;
    evidence = <div className="cost-detail-current">
      <strong>{currentCost}</strong>
      {records && <small className="cost-purchase-summary">{records}</small>}
    </div>;
  }
  const formBeforeEvidence = formFirst || viewFirst;
  const scope = [ledger.period, row.store, row.platformSku].join(" · ");
  let description = scope;
  if (readOnly) description += "。当前只读。";
  else if (identityConflict && row.manualOverride) description += "。已保存的人工金额可撤销。";
  else if (showForm) description += "。更正仅对本月这家店的该 SKU 生效，操作自动留痕。";

  return <Modal open={open} title={viewFirst && showForm ? "人工更正成本" : title} className={className} description={description} onClose={() => !saving && onClose()}
    footer={<>
      {!readOnly && row.manualOverride && (showForm || identityConflict) && <Button disabled={saving} onClick={() => act(true)}>撤销当前更正</Button>}
      <Button disabled={saving} onClick={onClose}>{showForm ? "取消" : "关闭"}</Button>
      {showForm && <Button variant="primary" loading={saving} disabled={invalid} onClick={() => act(false)}>{saveLabel}</Button>}
      {canEdit && !showForm && <Button onClick={startCorrection}>人工更正</Button>}
    </>}>
    {!formBeforeEvidence && evidence}
    {identityConflict ? <p role="alert">{describeLedgerCostIdentityIssue(identityIssue)}</p> : null}
    {historySuggestion ? <div className="cost-correction-help" role="status"><strong>已自动补查历史仓库采购</strong><p>{historySuggestion.warehouseSku} · ¥{historySuggestion.unitCost}/件。当前映射缺失，保存后按可撤销人工更正生效。</p><details><summary>核对采购证据</summary>{historySuggestion.historyEvidence.warehouseEvidence.decision.selectedRecords.map(record => <p key={record.recordId}>{record.purchaseDate} · 数量 {record.quantity} · 单价 ¥{record.unitPrice}</p>)}</details></div> : null}
    {showForm && <div className="form-field">
      <label htmlFor="manual-cost-value">单件成本（CNY，可为 0）</label>
      <input ref={amountRef} id="manual-cost-value" className="text-input" type="number" min="0" step="any" disabled={saving} value={amount}
        onChange={event => { editedRef.current = true; setAmount(event.target.value); }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && !invalid) {
            event.preventDefault();
            void act(false);
          }
        }} />
    </div>}
    {error ? <p role="alert">{error}</p> : null}
    {formBeforeEvidence && evidence && (showForm
      ? <details className="cost-correction-evidence"><summary>采购证据与异常原因</summary>{evidence}</details>
      : evidence)}
  </Modal>;
}
