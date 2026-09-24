import { useState } from "react";
import { Button, Modal } from "../components/UI";
import { saveManualCostOverride, revokeManualCostOverride } from "../data/repositories/profitRepository";

export default function ManualCostDialog({ ledger, row, onClose, onNext, children, readOnly = false, hasEffectiveErpCost = false, className = "", title = "人工更正成本" }) {
  const [amount, setAmount] = useState(row.unitCost == null ? "" : String(row.unitCost));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const act = async (revoke, next = false) => {
    if (saving || readOnly) return;
    setSaving(true); setError("");
    try {
      if (revoke) await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: row.manualOverride.id });
      else await saveManualCostOverride({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, unitCost: amount, reason });
      if (next && onNext) onNext();
      else onClose();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  };
  const invalid = saving || amount.trim() === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0 || !reason.trim();
  return <Modal open title={title} className={className} description={`${ledger.period} · ${row.store} · ${row.platformSku}。${readOnly ? "已定稿或锁定，当前只读。" : hasEffectiveErpCost ? "ERP 正式成本已生效，无需人工确认；仅需更正时填写下方金额和说明。" : "人工更正仅对当前店铺月份生效；撤销后恢复最新可用 ERP 或缺失状态。"}`} onClose={() => !saving && onClose()}
    footer={<>{!readOnly && row.manualOverride ? <Button disabled={saving} onClick={() => act(true)}>撤销当前更正</Button> : null}<Button disabled={saving} onClick={onClose}>{readOnly ? "关闭" : "取消"}</Button>{!readOnly ? <><Button variant="primary" loading={saving} disabled={invalid} onClick={() => act(false)}>保存更正</Button>{onNext ? <Button disabled={invalid} onClick={() => act(false, true)}>保存并下一项</Button> : null}</> : null}</>}>
    {children}
    {!readOnly ? <><div className="form-field"><label htmlFor="manual-cost-value">单件成本（CNY，可为 0）</label><input id="manual-cost-value" className="text-input" type="number" min="0" step="any" disabled={saving} value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
    <div className="form-field"><label htmlFor="manual-cost-reason">更正说明</label><textarea id="manual-cost-reason" className="text-input" disabled={saving} value={reason} onChange={(event) => setReason(event.target.value)} /></div></> : null}
    {error ? <p role="alert">{error}</p> : null}
  </Modal>;
}
