import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Modal, useToast } from './UI';
import { listIgnoredErpCostAnomalies, setErpCostAnomaliesIgnored } from '../data/repositories/profitRepository';
import { canonicalWarehouseSku } from '../domain/identifiers';
import { ERP_COST_ANOMALY_LABELS } from '../domain/erpCostResolution';

const itemKey = item => JSON.stringify([item.inboxId, canonicalWarehouseSku(item.warehouseSku)]);
function groupAnomalies(items, inboxes = []) {
  const groups = new Map();
  for (const item of items) {
    if (!item.inboxId || !item.warehouseSku) continue;
    const key = itemKey(item), group = groups.get(key) ?? { ...item, key, prices: new Set(), reasons: new Set(), labels: new Set() };
    group.prices.add(item.originalUnitPrice);
    for (const reason of item.reasons ?? []) group.reasons.add(ERP_COST_ANOMALY_LABELS[reason] ?? reason);
    if (item.platformSku) group.labels.add([item.platformSku, item.store, item.attribute].filter(Boolean).join(' · '));
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.labels.size) continue;
    const source = inboxes.find(row => row.id === group.inboxId)?.envelope?.batch?.rows ?? [];
    for (const row of source) if (row.warehouseSku && canonicalWarehouseSku(row.warehouseSku) === canonicalWarehouseSku(group.warehouseSku)) {
      if (row.platformSku) { group.labels.add(row.platformSku); group.platformSku ??= row.platformSku; }
    }
  }
  return [...groups.values()];
}

export default function ErpAnomalyActions({ ledgerId, locked = false, onReview, inboxes, readPending, hasPendingAnomalies = false }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [tab, setTab] = useState('pending'), [selected, setSelected] = useState(new Set()), [limit, setLimit] = useState(30);
  const [pending, setPending] = useState([]), [loading, setLoading] = useState(false);
  const { notify } = useToast();
  const loaded = useLiveQuery(() => inboxes ? [] : listIgnoredErpCostAnomalies(ledgerId), [ledgerId, Boolean(inboxes)], []);
  const ignored = useMemo(() => inboxes ? inboxes.filter(row => row.ledgerId === ledgerId && !['voided', 'rejected'].includes(row.status))
    .flatMap(row => (row.costResolutions ?? []).filter(item => item.action === 'ignore_anomaly').map(item => ({ ...item, inboxId: row.id }))) : loaded, [inboxes, ledgerId, loaded]);
  const ignoredGroups = useMemo(() => groupAnomalies(ignored, inboxes), [ignored, inboxes]);
  const pendingGroups = useMemo(() => groupAnomalies(pending, inboxes), [pending, inboxes]);
  const groups = tab === 'pending' ? pendingGroups : ignoredGroups;
  const chosen = groups.filter(item => selected.has(item.key));
  useEffect(() => { setOpen(false); setSelected(new Set()); setPending([]); setError(''); }, [ledgerId]);
  useEffect(() => {
    if (!open || tab !== 'pending') return;
    let cancelled = false;
    setLoading(true);
    // Let the modal and its loading feedback paint before reading evidence.
    const timer = setTimeout(async () => {
      try {
        const entries = await readPending?.() ?? [];
        if (!cancelled) setPending(entries.flatMap(entry => (entry.match?.costDecision?.anomalies ?? [])
          .filter(item => item.status === 'pending' && Number.isFinite(item.originalUnitPrice) && item.originalUnitPrice >= 0)
          .map(item => ({ ...item, inboxId: entry.inboxId, platformSku: entry.platformSku, store: entry.store, attribute: entry.attribute }))));
      } catch (failure) { if (!cancelled) setError(failure.message); }
      finally { if (!cancelled) setLoading(false); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, tab, readPending]);
  function show(nextTab) { setTab(nextTab); setSelected(new Set()); setLimit(30); setError(''); setOpen(true); }
  async function apply(value, items) {
    setBusy(true); setError('');
    try {
      const result = await setErpCostAnomaliesIgnored({ ledgerId, ignored: value,
        ...(items ? { selectedItems: items.map(({ inboxId, warehouseSku }) => ({ inboxId, warehouseSku })) } : {}) });
      setSelected(new Set());
      notify(value ? result.changedCount ? '已忽略价格异常，可用原价参与核算。没有可用采购数据的项目仍待补齐。' : '没有可忽略的价格异常；缺少采购数据的项目请另行补齐。' : '已恢复异常提醒。人工更正保留，ERP 成本已重新核对。');
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  if (!hasPendingAnomalies && !ignoredGroups.length && !open && !busy && !error) return null;
  return <div className="erp-anomaly-actions">
    <div className="page-actions">{hasPendingAnomalies ? <><Button onClick={() => show('pending')}>核对价格异常</Button>
      <Button disabled={locked || busy} loading={busy} onClick={() => apply(true)}>一键忽略异常</Button></> : null}
      {ignoredGroups.length ? <Button variant="ghost" onClick={() => show('ignored')}>已忽略异常 · {ignoredGroups.length}</Button> : null}</div>
    {hasPendingAnomalies ? <small>本月全部店铺 · 忽略后按原始采购价核算（含 0 元），可逐项或多选处理；无采购数据的项目仍需补齐。</small> : null}
    {error && !open ? <p role="alert">{error}</p> : null}
    <Modal open={open} title="价格异常" description="忽略不代表价格已核实。原始证据保留，恢复提醒后重新判断成本；人工更正不受影响。按同一次回传的仓库商品处理，共用采购的 SKU 一同生效。" onClose={() => !busy && setOpen(false)}
      footer={<><Button disabled={busy} onClick={() => setOpen(false)}>关闭</Button>
        {tab === 'ignored' ? <Button disabled={locked || busy || !groups.length} onClick={() => apply(false)}>恢复本月全部提醒</Button> : null}
        <Button variant="primary" loading={busy} disabled={locked || busy || loading && tab === 'pending' || !chosen.length} onClick={() => apply(tab === 'pending', chosen)}>{tab === 'pending' ? '忽略选中' : '恢复选中'}（{chosen.length} 项）</Button></>}>
      <div className="anomaly-tabs" role="tablist" aria-label="异常处理状态">
        <Button role="tab" aria-selected={tab === 'pending'} disabled={busy} onClick={() => show('pending')}>待核对</Button>
        <Button role="tab" aria-selected={tab === 'ignored'} disabled={busy} onClick={() => show('ignored')}>已忽略 · {ignoredGroups.length}</Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {loading && tab === 'pending' ? <p role="status">正在读取可处理的价格异常…<progress aria-label="读取异常" /></p> : <>
        {groups.length ? <label className="anomaly-select-all"><input type="checkbox" aria-label="全选本列表" disabled={locked || busy} checked={chosen.length === groups.length}
          onChange={event => setSelected(event.target.checked ? new Set(groups.map(item => item.key)) : new Set())} />全选本列表（{groups.length} 项）<span>已选 {chosen.length} 项 · 本月全部店铺</span></label> : <p>{tab === 'pending' ? '本月没有可忽略的价格异常。缺少采购数据的项目请补齐成本。' : '本月没有已忽略的异常。'}</p>}
        {groups.slice(0, limit).map(item => <div className="anomaly-select-row" key={item.key}>
          <input type="checkbox" aria-label={`选择 ${[...item.labels].join('、') || item.warehouseSku}`} checked={selected.has(item.key)} disabled={locked || busy}
            onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.key); else next.delete(item.key); return next; })} />
          <div className="anomaly-item-text">{onReview ? <button className="inline-link" disabled={busy} onClick={() => { setOpen(false); onReview(item); }}>{[...item.labels].join('、') || item.warehouseSku}</button> : <strong>{[...item.labels].join('、') || item.warehouseSku}</strong>}
            <small>原始采购单价 {[...item.prices].map(price => `¥${price}`).join('、')} · {tab === 'ignored' ? '异常已忽略' : [...item.reasons].join('；')}</small>
            <small>仓库商品 {item.warehouseSku}</small></div>
          <Button disabled={locked || busy} onClick={() => apply(tab === 'pending', [item])}>{tab === 'pending' ? '忽略此项' : '恢复提醒'}</Button>
        </div>)}
        {groups.length > limit ? <Button onClick={() => setLimit(value => value + 30)}>显示更多</Button> : null}
      </>}
    </Modal>
  </div>;
}
