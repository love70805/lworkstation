import { useEffect, useRef, useState } from "react";
import { previewSharedManualCost, saveSharedManualCost } from '../data/repositories/sharedManualCostRepository';
import { useCostEditingGuard } from '../hooks/useCostEditingGuard';
import { Button, Modal } from "../components/UI";
import { saveManualCostOverride, revokeManualCostOverride } from "../data/repositories/profitRepository";
import { describeLedgerCostIdentityIssue } from '../domain/ledgerCostIdentity';
import { previewRecoveredWarehouseCost, saveRecoveredWarehouseCost } from '../data/repositories/warehouseHistoryRecoveryRepository';
import { formatCostPurchaseEvidence, formatAccountingUnitCost, formatManualUnitCost } from '../lib/profitPrecision';
import { beginCostReview } from '../lib/costReviewActivity';

function EmbeddedCostForm({ title, description, children, footer }) {
  return <section><h3>{title}</h3><p>{description}</p>{children}<div className="page-actions">{footer}</div></section>;
}

export default function ManualCostDialog({
  ledger, row, onClose, onSaved, onBusyChange, embedded = false, children, open = true, readOnly = false, editingGuard = null, hasEffectiveErpCost = false,
  className = "", viewFirst = false, title = viewFirst ? "成本详情" : "人工更正成本", formFirst = false, saveLabel = "保存更正", purchaseConfirmation = null,
}) {
  const ownGuard = useCostEditingGuard(editingGuard ? null : ledger.workspaceId, ledger.id);
  useEffect(() => open ? beginCostReview() : undefined,[open]);
  const costGuard = editingGuard ?? ownGuard;
  const protectedReadOnly = readOnly || costGuard.blocked;
  const identityIssue = row.decision?.identityIssue ?? row.costIdentityIssue;
  const identityConflict = identityIssue?.code === 'ledger_sku_skc_conflict';
  const currentAmount = row.unitCost == null || row.decision?.eligibleForExactProfit === false ? "" : String(row.unitCost);
  const effectiveSource = row.decision?.source ?? row.costSource;
  const erpApplied = hasEffectiveErpCost || effectiveSource === "erp";
  const hasManual = Boolean(row.manualOverride) || effectiveSource === "manual_override";
  const editAmount = row.manualCostConflict ? "" : String(row.manualOverride?.approvedAmount ?? currentAmount);
  const [amount, setAmount] = useState(editAmount);
  const [editRequested, setEditRequested] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyCandidate, setHistoryCandidate] = useState(null);
  const [lookup, setLookup] = useState(null);
  const [lookupStatus, setLookupStatus] = useState('');
  const [sharedPlan, setSharedPlan] = useState(null), [shareCost, setShareCost] = useState(false);
  const editedRef = useRef(false);
  const amountRef = useRef(null);
  const savingRef = useRef(false);
  const openingMode = useRef(ledger.accountingMode);
  const openingApprovalId = useRef(row.manualOverride?.id);
  const subject = JSON.stringify([ledger.workspaceId, ledger.id, row.store, row.platformSku]);
  const openingSubject = useRef(subject);
  useEffect(() => { onBusyChange?.(saving); return () => onBusyChange?.(false); }, [saving, onBusyChange]);
  const canEdit = !protectedReadOnly && !identityConflict;
  const showForm = canEdit && (!viewFirst || editRequested);
  const invalid = saving || amount.trim() === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0;
  useEffect(() => {
    if (!costGuard.blocked) return;
    setEditRequested(false); setShareCost(false); setAmount(editAmount); setHistoryCandidate(null); editedRef.current = false;
  }, [costGuard.blocked, editAmount]);

  useEffect(() => {
    if (!open) setEditRequested(false);
  }, [open]);
  const lookupKey = JSON.stringify([ledger.id, row.store, row.platformSku]);
  const lookupOpen = lookup === lookupKey && open && showForm;
  useEffect(() => {
    if (!open || !showForm || !(formFirst || viewFirst)) return;
    const timer = window.setTimeout(() => {
      amountRef.current?.focus({ preventScroll: true });
      if (editRequested) amountRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, showForm, formFirst, viewFirst, editRequested]);
  useEffect(() => {
    if (!lookupOpen) return;
    const controller = new AbortController();
    const scope = { ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, signal: controller.signal };
    setLookupStatus('正在查询历史采购与同仓商品…');
    void Promise.allSettled([
      erpApplied || hasManual || row.manualCostConflict ? null : previewRecoveredWarehouseCost({ ...scope, expectedAccountingMode: openingMode.current }),
      previewSharedManualCost(scope),
    ]).then(([history, shared]) => {
      if (controller.signal.aborted) return;
      const candidate = history.value, plan = shared.value;
      setHistoryCandidate(candidate ?? null); setSharedPlan(plan ?? null);
      if (candidate && !editedRef.current) setAmount(String(candidate.unitCost));
      setLookupStatus(history.status === 'rejected' || shared.status === 'rejected' ? '部分资料读取失败，可重新查询。' : candidate || plan ? '' : '没有可用的历史采购或同仓更正建议。');
    });
    return () => controller.abort();
  }, [lookupOpen, ledger.id, row.store, row.platformSku, row.manualCostConflict, erpApplied, hasManual]);

  function startCorrection() {
    openingMode.current = ledger.accountingMode;
    openingApprovalId.current = row.manualOverride?.id;
    openingSubject.current = subject;
    setAmount(editAmount);
    setHistoryCandidate(null);
    editedRef.current = false;
    setEditRequested(true);
  }

  const historySuggestion = showForm && !erpApplied && !hasManual && !row.manualCostConflict ? historyCandidate : null;
  const act = async (revoke) => {
    if (savingRef.current || protectedReadOnly || (revoke ? !row.manualOverride : !showForm || invalid)) return;
    savingRef.current = true;
    setSaving(true); setError("");
    try {
      const useHistory = historySuggestion && Number(amount) === historySuggestion.unitCost;
      // A typed shared price and revoking an identified approval do not depend
      // on the selected ERP formula. A suggested price or group still does.
      const dependsOnMode = !revoke && (!editedRef.current || useHistory || shareCost);
      if (openingSubject.current !== subject || (dependsOnMode && openingMode.current !== ledger.accountingMode)) throw new Error('核算上下文已变化，请重新打开成本明细。');
      if (openingApprovalId.current !== row.manualOverride?.id) throw new Error('人工成本已变化，请重新打开成本明细。');
      const modeCheck = dependsOnMode && openingMode.current ? { expectedAccountingMode: openingMode.current } : {};
      const reason = useHistory ? historySuggestion.reason : '人工输入单件成本并确认更正';
      let saved;
      if (revoke) await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: openingApprovalId.current });
      else if (shareCost && sharedPlan) saved = await saveSharedManualCost({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, unitCost: amount,
        fingerprint: sharedPlan.fingerprint, expectedAccountingMode: openingMode.current });
      else if (useHistory) saved = await saveRecoveredWarehouseCost({
        ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, inboxId: historySuggestion.inboxId, expectedUnitCost: amount, reason, ...(openingMode.current ? {expectedAccountingMode:openingMode.current} : {}) });
      else saved = await saveManualCostOverride({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, unitCost: amount, reason, ...modeCheck });
      onSaved?.(saved); onClose();
    } catch (failure) { setError(failure.message); } finally { savingRef.current = false; setSaving(false); }
  };
  const confirmPurchases = async () => {
    if (!canEdit || !purchaseConfirmation || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      if (openingMode.current !== ledger.accountingMode) throw new Error('核算上下文已变化，请重新打开成本明细。');
      await purchaseConfirmation.onConfirm();
    } catch (failure) { setError(failure.message); }
    finally { savingRef.current = false; setSaving(false); }
  };

  let evidence = children;
  if (viewFirst && !evidence) {
    const records = formatCostPurchaseEvidence(row);
    let currentCost = "缺少有效成本";
    if (currentAmount && erpApplied) currentCost = `ERP 已采用 · ${formatAccountingUnitCost(currentAmount)}/件`;
    else if (currentAmount && hasManual) currentCost = `人工更正 · ${formatAccountingUnitCost(currentAmount)}/件`;
    evidence = <div className="cost-detail-current">
      <strong>{currentCost}</strong>
      {records && <small className="cost-purchase-summary">{records}</small>}
    </div>;
  }
  const formBeforeEvidence = formFirst || viewFirst;
  const scope = [ledger.period, row.store, row.platformSku].join(" · ");
  let description = scope;
  if (protectedReadOnly) description += "。当前只读。";
  else if (identityConflict && row.manualOverride) description += "。已保存的人工金额可撤销。";
  else if (showForm) description += shareCost && sharedPlan ? `。本次同时更正下方 ${sharedPlan.rows.filter(r => r.included).length} 条店铺 SKU，两种核算方式共用人工价。` : "。本月这家店的该 SKU 在两种核算方式中共用一笔人工价。";

  const Frame = embedded ? EmbeddedCostForm : Modal;
  return <Frame open={open} title={title} className={className} description={description} onClose={() => !saving && onClose()}
    footer={<>
      {!protectedReadOnly && row.manualOverride && (showForm || identityConflict) && <Button disabled={saving} onClick={() => act(true)}>撤销当前更正</Button>}
      <Button disabled={saving} onClick={onClose}>{embedded ? "返回列表" : showForm ? "取消" : "关闭"}</Button>
      {showForm && <Button variant="primary" loading={saving} disabled={invalid} onClick={() => act(false)}>{saveLabel}</Button>}
      {canEdit && !showForm && <Button disabled={saving} onClick={startCorrection}>人工更正</Button>}
    </>}>
    {costGuard.blocked ? <p className="cost-correction-help" role="status"><strong>{costGuard.title}</strong><br />{costGuard.message}</p> : null}
    {row.manualCostConflict ? <p className="cost-correction-help" role="status">旧账本记录了不同的人工价（{row.manualCostConflict.map(formatManualUnitCost).join('、')}）。在此确认本月单件成本后，两种核算方式共用该金额。</p> : null}
    {ledger.accountingMode === 'historical_lowest' && row.manualOverride?.approvedAmount != null && erpApplied && currentAmount !== '' ? <p className="cost-correction-help">已保存人工价 {formatManualUnitCost(row.manualOverride.approvedAmount)}/件，本次最低成本核算取 ERP 价 {formatAccountingUnitCost(currentAmount)}/件。</p> : null}
    {canEdit && purchaseConfirmation ? <section className="cost-confirm-purchases" aria-label="确认采购原价">
      <div><strong>使用采购原价</strong><p>{purchaseConfirmation.description}</p></div>
      <Button variant="primary" disabled={saving} onClick={confirmPurchases}>{saving ? '正在保存…' : '确认采购价正确'}</Button>
    </section> : null}
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
    {showForm && !lookupOpen && <Button variant="ghost" onClick={() => setLookup(lookupKey)}>查询历史采购与同仓商品</Button>}
    {lookupOpen && lookupStatus && <p role="status">{lookupStatus}{lookupStatus.includes('失败') && <Button onClick={() => setLookup(null)}>返回查询入口</Button>}</p>}
    {showForm && sharedPlan && sharedPlan.rows.filter(r => r.included).length > 1 ? <section className="cost-correction-help">
      <label><input type="checkbox" checked={shareCost} disabled={saving} onChange={event => setShareCost(event.target.checked)} /> 同时更正同仓的 {sharedPlan.rows.filter(r => r.included).length} 条店铺 SKU</label>
      <p>仓库 SKU：{sharedPlan.warehouseSku}。仅限本月相同采购证据；其他已确认人工成本保留。</p>
      <details><summary>查看影响范围</summary>{sharedPlan.rows.map(item => <p key={JSON.stringify([item.store,item.platformSku])}>{item.store} · {item.platformSku}{item.included ? ' · 应用本次金额' : ' · 保留已有人工成本'}</p>)}</details>
    </section> : null}
    {error ? <p role="alert">{error}</p> : null}
    {formBeforeEvidence && evidence}
  </Frame>;
}
