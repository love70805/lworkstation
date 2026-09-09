import { useState } from "react";
import { Button, Modal } from "../components/UI";
import { saveManualCostOverride, revokeManualCostOverride } from "../data/repositories/profitRepository";

export default function ManualCostDialog({ ledger, row, onClose }) {
  const [amount, setAmount] = useState(row.unitCost == null ? "" : String(row.unitCost));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const act = async (revoke) => {
    setSaving(true); setError("");
    try {
      if (revoke) await revokeManualCostOverride({ ledgerId: ledger.id, approvalId: row.manualOverride.id });
      else await saveManualCostOverride({ ledgerId: ledger.id, store: row.store, platformSku: row.platformSku, unitCost: amount, reason });
      onClose();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  };
  return <Modal open title="人工更正成本" description={`${ledger.period} · ${row.store} · ${row.platformSku}，仅对当前店铺月份生效。人工更正优先于 ERP，撤销后恢复最新 ERP。`} onClose={() => !saving && onClose()}
    footer={<>{row.manualOverride ? <Button disabled={saving} onClick={() => act(true)}>撤销当前更正</Button> : null}<Button disabled={saving} onClick={onClose}>取消</Button><Button variant="primary" loading={saving} disabled={saving || amount.trim() === "" || !reason.trim()} onClick={() => act(false)}>保存更正</Button></>}>
    <div className="form-field"><label htmlFor="manual-cost-value">单件成本（CNY，可为 0）</label><input id="manual-cost-value" className="text-input" type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
    <div className="form-field"><label htmlFor="manual-cost-reason">更正说明</label><textarea id="manual-cost-reason" className="text-input" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
    {error ? <p role="alert">{error}</p> : null}
  </Modal>;
}
