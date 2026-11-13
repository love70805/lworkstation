import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Modal, useToast } from './UI';
import { listErpCostAnomalyReview, setErpCostAnomaliesIgnored } from '../data/repositories/profitRepository';
import { canonicalPlatformSku, canonicalWarehouseSku } from '../domain/identifiers';
import { storeSkuKey } from '../domain/manualCostOverride';
import { ERP_COST_ANOMALY_LABELS } from '../domain/erpCostResolution';

const EMPTY = [];
const itemKey = item => JSON.stringify([item.inboxId, canonicalWarehouseSku(item.warehouseSku)]);
function groupAnomalies(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.inboxId || !item.warehouseSku) continue;
    const key = item.groupKey ?? itemKey(item), group = groups.get(key) ?? { key, inboxId: item.inboxId, warehouseSku: item.warehouseSku, members: new Map(), prices: new Set(), reasons: new Set(), skus: new Set() };
    group.members.set(itemKey(item), { inboxId: item.inboxId, warehouseSku: item.warehouseSku });
    group.prices.add(item.originalUnitPrice);
    for (const reason of item.reasons ?? []) group.reasons.add(ERP_COST_ANOMALY_LABELS[reason] ?? reason);
    if (item.platformSku) group.skus.add(item.platformSku);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// The receipt retains its original anomaly after a store-level correction.
// Classify from the current ledger rows, so saving/revoking updates the counts
// without rewriting evidence or waiting for another ERP adoption pass.
function partitionManualCoverage(groups, reviewRows) {
  if (!groups.length) return { pending: EMPTY, manual: EMPTY };
  const bySku = new Map();
  for (const row of reviewRows) {
    const sku = canonicalPlatformSku(row.platformSku);
    if (!bySku.has(sku)) bySku.set(sku, new Map());
    bySku.get(sku).set(storeSkuKey(row.store, sku), row);
  }
  const pending = [], manual = [];
  for (const group of groups) {
    const targets = [...group.skus].flatMap(sku => [...(bySku.get(canonicalPlatformSku(sku))?.values() ?? [])]);
    const completeScope = group.skus.size > 0 && [...group.skus].every(sku => bySku.get(canonicalPlatformSku(sku))?.size);
    const manualCount = targets.filter(row => row.manualOverride && row.decision?.eligibleForExactProfit).length;
    const item = { ...group, manualCount, storeSkuCount: targets.length };
    (completeScope && manualCount === targets.length ? manual : pending).push(item);
  }
  return { pending, manual };
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
    const target = targets[0] ?? null;
    return { ...group, targetCount: targets.length, batch: receipts.get(group.inboxId)?.batchId ?? group.inboxId, label: [...labels].join('、') || group.warehouseSku, target };
  });
}

export default function ErpAnomalyActions(props) {
  return <LedgerAnomalyActions key={props.ledgerId} {...props} />;
}

function LedgerAnomalyActions({ ledgerId, locked = false, blockedReason = '', onReview, renderEditor, missingRows = EMPTY, inboxes, reviewRows = EMPTY }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(null), [error, setError] = useState('');
  const operationRef = useRef(null);
  const [editing, setEditing] = useState(null), [editingBusy, setEditingBusy] = useState(false), [savedMessage, setSavedMessage] = useState('');
  const [tab, setTab] = useState('pending'), [selected, setSelected] = useState(new Set()), [limit, setLimit] = useState(30);
  const [attempt, setAttempt] = useState(0);
  const { notify } = useToast();
  const loaded = useLiveQuery(async () => {
    try {
      // After a write, read durable receipts rather than a parent snapshot that
      // may still be waiting for its own live query to refresh.
      const { pending, ignored } = await listErpCostAnomalyReview(ledgerId, attempt ? undefined : inboxes);
      return { ledgerId, inboxes, attempt, pending, ignored };
    } catch (failure) { return { ledgerId, inboxes, attempt, error: failure.message || '无法读取价格异常。' }; }
  }, [ledgerId, inboxes, attempt]);
  const current = loaded?.ledgerId === ledgerId && loaded.inboxes === inboxes && loaded.attempt === attempt ? loaded : null;
  const ignored = current?.ignored ?? EMPTY;
  const ignoredGroups = useMemo(() => groupAnomalies(ignored), [ignored]);
  const coverage = useMemo(() => partitionManualCoverage(groupAnomalies(current?.pending ?? EMPTY), reviewRows), [current?.pending, reviewRows]);
  const pendingGroups = coverage.pending, manualGroups = coverage.manual;
  const groupedSkus = new Set([...pendingGroups, ...manualGroups, ...ignoredGroups].flatMap(group => [...group.skus].map(canonicalPlatformSku)));
  const manualRows = reviewRows.filter(row => row.manualOverride && row.decision?.eligibleForExactProfit && !groupedSkus.has(canonicalPlatformSku(row.platformSku)));
  const manualCount = manualGroups.length + manualRows.length;
  const groups = tab === 'pending' ? pendingGroups : tab === 'manual' ? manualGroups : ignoredGroups;
  const chosen = groups.filter(item => selected.has(item.key));
  const visibleGroups = useMemo(() => open ? describeGroups(groups.slice(0, limit), inboxes ?? EMPTY, reviewRows) : EMPTY, [open, groups, limit, inboxes, reviewRows]);
  useEffect(() => {
    if (busy?.refreshAttempt == null || busy.refreshAttempt !== current?.attempt) return;
    operationRef.current = null;
    setBusy(null);
  }, [busy, current]);
  function review(item) {
    if (renderEditor && item.target) { setSavedMessage(''); setEditing(item.target); return; }
    setOpen(false); onReview?.({ inboxId: item.inboxId, warehouseSku: item.warehouseSku, platformSku: item.target.platformSku, store: item.target.store });
  }
  function show(nextTab) { setTab(nextTab); setSelected(new Set()); setLimit(30); setError(''); setOpen(true); }
  async function apply(value, items, kind = 'row') {
    if (locked || operationRef.current || !current || current.error || !items?.length) return;
    const operation = { kind, count: items.length, key: items.length === 1 ? items[0].key : null };
    operationRef.current = operation;
    setBusy(operation); setError('');
    try {
      const result = await setErpCostAnomaliesIgnored({ ledgerId, ignored: value,
        selectedItems: items.flatMap(item => [...item.members.values()]) });
      setSelected(new Set());
      setBusy({ ...operation, refreshAttempt: attempt + 1 });
      setAttempt(attempt + 1);
      notify(value ? result.changedCount ? '已忽略价格异常，可用原价参与核算。没有可用采购数据的项目仍待补齐。' : '这些异常已处理，正在刷新列表。' : '已恢复相同采购证据的异常提醒。人工更正保留，ERP 成本已重新核对。');
    } catch (failure) { setError(failure.message); operationRef.current = null; setBusy(null); }
  }
  if (!missingRows.length && !pendingGroups.length && !ignoredGroups.length && !manualCount && !open && !busy && !error && !current?.error) return null;
  const readError = current?.error ? <div role="alert">读取价格异常失败。{current.error} <Button onClick={() => setAttempt(value => value + 1)}>重试</Button></div> : null;
  return <div className="erp-anomaly-actions">
    <div className="page-actions">{pendingGroups.length || missingRows.length ? <Button onClick={() => show(pendingGroups.length ? 'pending' : 'missing')}>{blockedReason ? '查看暂存异常' : '核对价格异常'}</Button> : null}
      {manualCount ? <Button variant="ghost" onClick={() => show('manual')}>已人工更正 · {manualCount}</Button> : null}
      {ignoredGroups.length ? <Button variant="ghost" onClick={() => show('ignored')}>已忽略异常 · {ignoredGroups.length}</Button> : null}</div>
    {!open && readError}
    {error && !open ? <p role="alert">{error}</p> : null}
    <Modal open={open} title="价格异常" description="价格异常可更正或按原价忽略（含 0 元）；没有成本需补录，不能忽略。同月同仓、相同采购证据可一次更正，已有人工值保留。" onClose={() => !busy && !editingBusy && (editing ? setEditing(null) : setOpen(false))}
      footer={editing ? null : <><Button disabled={Boolean(busy)} onClick={() => setOpen(false)}>关闭</Button>
        {tab === 'pending' && (pendingGroups.length > 0 || busy?.kind === 'all') && <Button loading={busy?.kind === 'all'} disabled={locked || Boolean(busy) || !current} onClick={() => apply(true, pendingGroups, 'all')}>忽略剩余异常（{busy?.kind === 'all' ? busy.count : pendingGroups.length}）</Button>}
        {tab === 'ignored' ? <Button loading={busy?.kind === 'all'} disabled={locked || Boolean(busy) || !groups.length} onClick={() => apply(false, groups, 'all')}>恢复本月全部提醒</Button> : null}
        {['pending', 'ignored'].includes(tab) ? <Button variant="primary" loading={busy?.kind === 'selected'} disabled={locked || Boolean(busy) || !chosen.length} onClick={() => apply(tab === 'pending', chosen, 'selected')}>{tab === 'pending' ? '忽略选中' : '恢复选中'}（{busy?.kind === 'selected' ? busy.count : chosen.length} 项）</Button> : null}</>}>
      {editing ? renderEditor(editing, () => setEditing(null), () => { setAttempt(value => value + 1); setSavedMessage('成本已保存。'); }, setEditingBusy) : <>
      <div className="anomaly-tabs" role="tablist" aria-label="异常处理状态">
        <Button role="tab" aria-selected={tab === 'pending'} disabled={Boolean(busy)} onClick={() => show('pending')}>待核对 · {pendingGroups.length}</Button>
        <Button role="tab" aria-selected={tab === 'missing'} disabled={Boolean(busy)} onClick={() => show('missing')}>没有成本 · {missingRows.length}</Button>
        <Button role="tab" aria-selected={tab === 'manual'} disabled={Boolean(busy)} onClick={() => show('manual')}>已人工更正 · {manualCount}</Button>
        <Button role="tab" aria-selected={tab === 'ignored'} disabled={Boolean(busy)} onClick={() => show('ignored')}>已忽略 · {ignoredGroups.length}</Button>
      </div>
      {savedMessage ? <p role="status">{savedMessage}</p> : null}
      {blockedReason ? <p className="cost-correction-help" role="status">{blockedReason}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {readError}
      {manualCount && tab !== 'missing' ? <p className="cost-correction-help">{manualCount} 项已保存人工更正，移出待核对与批量忽略范围；原始采购证据仍保留。撤销更正后可重新核对。</p> : null}
      {tab === 'missing' ? <>
        <p>没有可用采购成本。请按真实单件成本补录，保存后自动计算利润；只有真实零成本才填 0。</p>
        {missingRows.slice(0,limit).map(row => <div className="anomaly-select-row" key={row.id}><div className="anomaly-item-text"><strong>{row.platformSku} · {row.store}</strong><small>{row.attribute}</small></div>
          <Button onClick={() => review({target:row})}>{locked ? '查看详情' : '补录成本'}</Button></div>)}
        {!missingRows.length ? <p>本月没有缺成本的 SKU。</p> : null}
        {limit < missingRows.length ? <Button onClick={() => setLimit(value => value + 30)}>显示更多</Button> : null}
      </> : !current ? <p role="status">正在读取价格异常…<progress aria-label="读取异常" /></p> : <>
        {groups.length && tab !== 'manual' ? <label className="anomaly-select-all"><input type="checkbox" aria-label="全选本列表" disabled={locked || Boolean(busy)} checked={chosen.length === groups.length}
          onChange={event => setSelected(event.target.checked ? new Set(groups.map(item => item.key)) : new Set())} />全选本列表（{groups.length} 项）<span>已选 {chosen.length} 项 · 本月全部店铺</span></label> : groups.length || tab === 'manual' && manualRows.length || current?.error ? null : <p>{tab === 'pending' ? '本月没有可忽略的价格异常。缺少采购数据的项目请补齐成本。' : tab === 'manual' ? '本月没有已人工更正的异常项目。' : '本月没有已忽略的异常。'}</p>}
        {visibleGroups.map(item => <div className="anomaly-select-row" key={item.key}>
          {tab !== 'manual' ? <input type="checkbox" aria-label={`选择 ${item.label}`} checked={selected.has(item.key)} disabled={locked || Boolean(busy)}
            onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.key); else next.delete(item.key); return next; })} /> : null}
          <div className="anomaly-item-text">{(onReview || renderEditor) && item.target ? <button className="inline-link" disabled={Boolean(busy)} onClick={() => review(item)}>{item.targetCount > 1 ? `更正同仓成本（${item.targetCount} 条店铺 SKU）` : item.label}</button> : <strong>{item.label}</strong>}{item.targetCount > 1 ? <small>{item.label}</small> : null}
            <small>原始采购单价 {[...item.prices].map(price => `¥${price}`).join('、')} · {tab === 'ignored' ? '异常已忽略' : [...item.reasons].join('；')}</small>
            {item.manualCount ? <small>{item.manualCount} 条店铺 SKU 已人工更正{tab === 'pending' ? '，其余关联 SKU 仍待核对；忽略不会覆盖人工值。' : '，原始异常仅供追溯。'}</small> : null}
            <small>仓库商品 {item.warehouseSku} · 回传批次 {item.batch}</small></div>
          {tab !== 'manual' ? <Button loading={busy?.kind === 'row' && busy.key === item.key} disabled={locked || Boolean(busy)} onClick={() => apply(tab === 'pending', [item])}>{tab === 'pending' ? '忽略此项' : '恢复提醒'}</Button> : null}
        </div>)}
        {tab === 'manual' ? manualRows.slice(0,limit).map(row => <div className="anomaly-select-row" key={row.id ?? storeSkuKey(row.store,row.platformSku)}><div className="anomaly-item-text"><strong>{row.platformSku} · {row.store}</strong><small>人工成本 ¥{row.manualOverride.approvedAmount} / 件</small></div><Button onClick={() => review({target:row})}>查看更正</Button></div>) : null}
        {Math.max(groups.length, tab === 'manual' ? manualRows.length : 0) > limit ? <Button onClick={() => setLimit(value => value + 30)}>显示更多</Button> : null}
      </>}
      </>}
    </Modal>
  </div>;
}
