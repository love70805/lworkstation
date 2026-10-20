import { useEffect, useState } from 'react';
import { Button, Modal } from '../components/UI';
import { previewWarehouseHistoryCosts, saveWarehouseHistoryCosts } from '../data/repositories/profitRepository';

export default function WarehouseHistoryDialog({ ledger, onClose, onSaved, initialFile = null }) {
  const [history, setHistory] = useState(null), [sourceName, setSourceName] = useState('');
  const [plan, setPlan] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = async file => {
    if (!file || busy) return;
    setBusy(true); setError(''); setHistory(null); setPlan(null);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('证据文件超过 20 MB，请按相关仓库分批导出。');
      const value = JSON.parse(await file.text());
      const next = await previewWarehouseHistoryCosts({ ledgerId: ledger.id, history: value });
      setHistory(value); setSourceName(file.name); setPlan(next);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (initialFile) void load(initialFile); }, [initialFile]);
  const save = async () => {
    if (busy || !plan?.ready.length) return;
    setBusy(true); setError('');
    try {
      const result = await saveWarehouseHistoryCosts({ ledgerId: ledger.id, history, sourceName });
      onSaved(result); onClose();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <Modal open title="历史仓库采购补齐" className="cost-manual-input-modal" onClose={() => !busy && onClose()}
    description={`${ledger.period} · 仅补当前缺项，已有效的 ERP 和人工成本保留。`}
    footer={<><Button disabled={busy} onClick={onClose}>关闭</Button><Button variant="primary" loading={busy} disabled={busy || !plan?.ready.length} onClick={save}>补齐 {plan?.ready.length ?? 0} 项成本</Button></>}>
    <p>这是历史证据文件的兼容导入。日常采集会自动补查已知历史仓库，可直接在原成本核对流程确认；只有缺少可靠历史关联时，才需在 ERP 助手高级区域按明确仓库补充证据。</p>
    <div className="form-field"><label htmlFor="warehouse-history-file">仓库历史采购证据（JSON）</label><input id="warehouse-history-file" type="file" accept=".json,application/json" disabled={busy} onChange={event => void load(event.target.files?.[0])} /></div>
    <p>系统按台账身份和唯一历史关联自动核对，重算当月及以前最近三笔采购成本。同批合格项一次补齐并记录原始证据；归属冲突、采购价异常或证据不足的项单独保留。补齐通过人工更正记录生效，可撤销。</p>
    {plan ? <div role="status"><p>已核对 {plan.warehouseCount} 个仓库，可补齐 {plan.ready.length} 项。</p>{plan.ready.map(row => <p key={`${row.store}/${row.platformSku}`}>{row.store} · {row.platformSku} · {row.warehouseSku} · ¥{row.unitCost.toFixed(4)}/件</p>)}
      {plan.pending.length ? <details><summary>{plan.pending.length} 项继续待处理</summary>{plan.pending.map(row => <p key={`${row.store}/${row.platformSku}/${row.platformSkc}`}>{row.store} · {row.platformSku}：{row.reason}</p>)}</details> : null}</div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </Modal>;
}
