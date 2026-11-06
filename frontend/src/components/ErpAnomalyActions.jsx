import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Modal, useToast } from './UI';
import { listIgnoredErpCostAnomalies, listPendingErpCostAnomalies, setErpCostAnomaliesIgnored } from '../data/repositories/profitRepository';
import { canonicalPlatformSku, canonicalWarehouseSku } from '../domain/identifiers';
import { storeSkuKey } from '../domain/manualCostOverride';
import { ERP_COST_ANOMALY_LABELS } from '../domain/erpCostResolution';

const EMPTY = [];
const itemKey = item => JSON.stringify([item.inboxId, canonicalWarehouseSku(item.warehouseSku)]);
function groupAnomalies(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.inboxId || !item.warehouseSku) continue;
    const key = itemKey(item), group = groups.get(key) ?? { key, inboxId: item.inboxId, warehouseSku: item.warehouseSku, prices: new Set(), reasons: new Set(), skus: new Set() };
    group.prices.add(item.originalUnitPrice);
    for (const reason of item.reasons ?? []) group.reasons.add(ERP_COST_ANOMALY_LABELS[reason] ?? reason);
    if (item.platformSku) group.skus.add(item.platformSku);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// Only the open list needs labels. One warehouse product can cover several
// stores or platform SKUs, so only an unambiguous ledger row can open details.
function describeGroups(groups, inboxes, reviewRows) {
  const receipts = new Map(inboxes.map(inbox => [inbox.id, inbox]));
  const missing = new Map(groups.filter(group => !group.skus.size).map(group => [group.key, new Set()]));
  if (missing.size) {
    const ids = new Set(groups.filter(group => missing.has(group.key)).map(group => group.inboxId));
    for (const inboxId of ids) {
      for (const row of receipts.get(inboxId)?.envelope?.batch?.rows ?? []) {
        if (row.warehouseSku && row.platformSku) missing.get(itemKey({ inboxId, warehouseSku: row.warehouseSku }))?.add(row.platformSku);
      }
    }
  }
  const rowsBySku = new Map();
  for (const row of reviewRows) {
    if (!row.platformSku) continue;
    const sku = canonicalPlatformSku(row.platformSku);
    if (!rowsBySku.has(sku)) rowsBySku.set(sku, new Map());
    rowsBySku.get(sku).set(storeSkuKey(row.store, sku), row);
  }
  return groups.map(group => {
    const skus = missing.get(group.key) ?? group.skus, labels = new Set(), targets = [];
    for (const sku of skus) {
      const matches = rowsBySku.get(canonicalPlatformSku(sku));
      if (matches?.size) {
        for (const row of matches.values()) {
          labels.add([row.platformSku, row.store, row.attribute].filter(Boolean).join(' · '));
          targets.push(row);
        }
      } else labels.add(sku);
    }
    const target = skus.size === 1 && targets.length === 1 ? targets[0] : null;
    return { ...group, batch: receipts.get(group.inboxId)?.batchId ?? group.inboxId, label: [...labels].join('、') || group.warehouseSku, target };
  });
}

export default function ErpAnomalyActions(props) {
  return <LedgerAnomalyActions key={props.ledgerId} {...props} />;
}

function LedgerAnomalyActions({ ledgerId, locked = false, onReview, inboxes, reviewRows = EMPTY }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [tab, setTab] = useState('pending'), [selected, setSelected] = useState(new Set()), [limit, setLimit] = useState(30);
  const [attempt, setAttempt] = useState(0);
  const { notify } = useToast();
  const loaded = useLiveQuery(async () => {
    try {
      const [pending, ignored] = await Promise.all([listPendingErpCostAnomalies(ledgerId, inboxes), inboxes ? EMPTY : listIgnoredErpCostAnomalies(ledgerId)]);
      return { ledgerId, inboxes, attempt, pending, ignored };
    } catch (failure) { return { ledgerId, inboxes, attempt, error: failure.message || '无法读取价格异常。' }; }
  }, [ledgerId, inboxes, attempt]);
  const current = loaded?.ledgerId === ledgerId && loaded.inboxes === inboxes && loaded.attempt === attempt ? loaded : null;
  const ignored = useMemo(() => inboxes ? inboxes.filter(row => row.ledgerId === ledgerId && !['voided', 'rejected'].includes(row.status))
    .flatMap(row => (row.costResolutions ?? []).filter(item => item.action === 'ignore_anomaly').map(item => ({ ...item, inboxId: row.id }))) : current?.ignored ?? EMPTY, [inboxes, ledgerId, current?.ignored]);
  const ignoredGroups = useMemo(() => groupAnomalies(ignored), [ignored]);
  const pendingGroups = useMemo(() => groupAnomalies(current?.pending ?? EMPTY), [current?.pending]);
  const groups = tab === 'pending' ? pendingGroups : ignoredGroups;
  const chosen = groups.filter(item => selected.has(item.key));
  const visibleGroups = useMemo(() => open ? describeGroups(groups.slice(0, limit), inboxes ?? EMPTY, reviewRows) : EMPTY, [open, groups, limit, inboxes, reviewRows]);
  function show(nextTab) { setTab(nextTab); setSelected(new Set()); setLimit(30); setError(''); setOpen(true); }
  async function apply(value, items) {
    setBusy(true); setError('');
    try {
      const result = await setErpCostAnomaliesIgnored({ ledgerId, ignored: value,
        ...(items ? { selectedItems: items.map(({ inboxId, warehouseSku }) => ({ inboxId, warehouseSku })) } : {}) });
      setSelected(new Set());
      setAttempt(value => value + 1);
      notify(value ? result.changedCount ? '已忽略价格异常，可用原价参与核算。没有可用采购数据的项目仍待补齐。' : '没有可忽略的价格异常；缺少采购数据的项目请另行补齐。' : '已恢复异常提醒。人工更正保留，ERP 成本已重新核对。');
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  if (!pendingGroups.length && !ignoredGroups.length && !open && !busy && !error && !current?.error) return null;
  const readError = current?.error ? <div role="alert">读取价格异常失败。{current.error} <Button onClick={() => setAttempt(value => value + 1)}>重试</Button></div> : null;
  return <div className="erp-anomaly-actions">
    <div className="page-actions">{pendingGroups.length ? <Button onClick={() => show('pending')}>核对价格异常</Button> : null}
      {ignoredGroups.length ? <Button variant="ghost" onClick={() => show('ignored')}>已忽略异常 · {ignoredGroups.length}</Button> : null}</div>
    {!open && readError}
    {error && !open ? <p role="alert">{error}</p> : null}
    <Modal open={open} title="价格异常" description="同一次回传的同一仓库商品计一项，关联的店铺和平台 SKU 一起生效。忽略后按原始采购价核算（含 0 元），缺少采购数据的项目仍需补齐。" onClose={() => !busy && setOpen(false)}
      footer={<><Button disabled={busy} onClick={() => setOpen(false)}>关闭</Button>
        {tab === 'pending' && pendingGroups.length > 0 && <Button disabled={locked || busy} onClick={() => apply(true, pendingGroups)}>忽略全部店铺异常（{pendingGroups.length}）</Button>}
        {tab === 'ignored' ? <Button disabled={locked || busy || !groups.length} onClick={() => apply(false)}>恢复本月全部提醒</Button> : null}
        <Button variant="primary" loading={busy} disabled={locked || busy || !chosen.length} onClick={() => apply(tab === 'pending', chosen)}>{tab === 'pending' ? '忽略选中' : '恢复选中'}（{chosen.length} 项）</Button></>}>
      <div className="anomaly-tabs" role="tablist" aria-label="异常处理状态">
        <Button role="tab" aria-selected={tab === 'pending'} disabled={busy} onClick={() => show('pending')}>待核对</Button>
        <Button role="tab" aria-selected={tab === 'ignored'} disabled={busy} onClick={() => show('ignored')}>已忽略 · {ignoredGroups.length}</Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {readError}
      {!current && tab === 'pending' ? <p role="status">正在读取可处理的价格异常…<progress aria-label="读取异常" /></p> : <>
        {groups.length ? <label className="anomaly-select-all"><input type="checkbox" aria-label="全选本列表" disabled={locked || busy} checked={chosen.length === groups.length}
          onChange={event => setSelected(event.target.checked ? new Set(groups.map(item => item.key)) : new Set())} />全选本列表（{groups.length} 项）<span>已选 {chosen.length} 项 · 本月全部店铺</span></label> : tab === 'pending' && current?.error ? null : <p>{tab === 'pending' ? '本月没有可忽略的价格异常。缺少采购数据的项目请补齐成本。' : '本月没有已忽略的异常。'}</p>}
        {visibleGroups.map(item => <div className="anomaly-select-row" key={item.key}>
          <input type="checkbox" aria-label={`选择 ${item.label}`} checked={selected.has(item.key)} disabled={locked || busy}
            onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.key); else next.delete(item.key); return next; })} />
          <div className="anomaly-item-text">{onReview && item.target ? <button className="inline-link" disabled={busy} onClick={() => { setOpen(false); onReview({ inboxId: item.inboxId, warehouseSku: item.warehouseSku, platformSku: item.target.platformSku, store: item.target.store }); }}>{item.label}</button> : <strong>{item.label}</strong>}
            <small>原始采购单价 {[...item.prices].map(price => `¥${price}`).join('、')} · {tab === 'ignored' ? '异常已忽略' : [...item.reasons].join('；')}</small>
            <small>仓库商品 {item.warehouseSku} · 回传批次 {item.batch}</small></div>
          <Button disabled={locked || busy} onClick={() => apply(tab === 'pending', [item])}>{tab === 'pending' ? '忽略此项' : '恢复提醒'}</Button>
        </div>)}
        {groups.length > limit ? <Button onClick={() => setLimit(value => value + 30)}>显示更多</Button> : null}
      </>}
    </Modal>
  </div>;
}
