import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Modal, SearchInput } from './UI';
import SupplierFilterTable from './SupplierFilterTable';
import { readSupplierGroups, matchImportNumberRule } from '../lib/importSupplierGroups';
import { expandSupplierScopeGroup } from '../domain/supplierFilterPreview';

function SupplierMultiSelect({ options, selection, onChange, workspaceId, scopeRows, store }) {
  const [open, setOpen] = useState(false), [rule, setRule] = useState(null), [groupMessage, setGroupMessage] = useState('');
  const scopeKey = JSON.stringify([workspaceId, store, options]);
  useEffect(() => { setRule(null); setGroupMessage(''); }, [scopeKey]);
  const available = useMemo(() => new Set(options), [options]);
  const selectedSet = useMemo(() => new Set(selection === null ? options : selection ?? []), [selection, options]);
  const selected = options.filter(value => selectedSet.has(value)), missing = (selection ?? []).filter(value => !available.has(value));
  const label = selection === null ? '全部供方货号' : selected.length === 0 ? '未选择供方货号' : selected.length === 1 ? selected[0] : `已选 ${selected.length} 个货号`;
  const groupState = useMemo(() => readSupplierGroups(workspaceId), [workspaceId, open]);
  const rows = useMemo(() => {
    const matching = new Set(matchImportNumberRule(options, rule ?? {}));
    return options.map(supplierNumber => ({ key: supplierNumber, supplierNumber, selected: selectedSet.has(supplierNumber), matched: matching.has(supplierNumber) }));
  }, [options, selectedSet, rule]);
  const select = (values, checked) => {
    setRule(null); setGroupMessage('');
    const next = new Set(selection === null ? options : selection ?? []);
    for (const row of values) if (checked) next.add(row.supplierNumber); else next.delete(row.supplierNumber);
    onChange(next.size === options.length && options.every(value => next.has(value)) ? null : [...next].sort());
  };
  return <div className="profit-multi-select">
    <button type="button" className="profit-multi-select-trigger" aria-label="按供方货号筛选" aria-haspopup="dialog" aria-expanded={open} disabled={!options.length && !missing.length} onClick={() => setOpen(true)}><span>{label}</span><ChevronDown size={16} /></button>
    <Modal open={open} size="large" className="profit-supplier-dialog" title="选择供方货号" description={`${store === 'all' ? '全部店铺' : store} · 当前工作区与账本；搜索和查看已选不会改变范围。`} onClose={() => setOpen(false)} footer={<Button variant="primary" onClick={() => setOpen(false)}>完成选择</Button>}>
      <div className="supplier-group-chips"><strong>常用组</strong>{groupState.groups.map(group => <Button key={group.id} aria-pressed={rule?.id === group.id} onClick={() => {
        const values = expandSupplierScopeGroup(scopeRows, group, groupState, store).filter(value => available.has(value));
        onChange(values); setRule(group); setGroupMessage(`${group.name}：当前范围匹配 ${values.length} 个完整货号${!values.length ? '，保持空选' : ''}`);
      }}>{group.name}</Button>)}{!groupState.groups.length && <span>可在导入货号筛选中保存常用组。</span>}</div>
      <div className="supplier-scope-actions"><span role="status">已选 {selected.length} / {options.length} 个完整货号</span><Button onClick={() => { setRule(null); setGroupMessage(''); onChange(null); }}>全部货号</Button><Button onClick={() => { setRule(null); setGroupMessage(''); onChange([]); }}>清空选择</Button></div>
      {groupMessage && <p role="status">{groupMessage}</p>}
      {!!missing.length && <p role="status" className="profit-scope-warning">已选但当前店铺/账本未出现 {missing.length} 个：{missing.slice(0, 30).join('、')}{missing.length > 30 ? '…' : ''}。有效范围仍按原选择，未自动扩大。</p>}
      <SupplierFilterTable compact rows={rows} resetKey={`${workspaceId}/${store}`} onSelect={select} />
    </Modal>
  </div>;
}

export default function ProfitScopeFilters({ filter, stores = [], suppliers = [], onChange, showStore = true, workspaceId, scopeRows = [] }) {
  return <div className="profit-filter-bar profit-scope-filters" role="group" aria-label="台账查询范围">
    {showStore ? <label className="profit-scope-field"><span>店铺</span><select className="select-input" aria-label="查询店铺" value={filter.storeFilter} onChange={event => onChange({ storeFilter: event.target.value })}><option value="all">全部店铺</option>{stores.map(store => <option value={store} key={store}>{store}</option>)}</select></label> : null}
    <div className="profit-scope-field"><span>供方货号</span><SupplierMultiSelect options={suppliers} selection={filter.supplierSelection} onChange={supplierSelection => onChange({ supplierSelection, supplierScopeError: undefined })} workspaceId={workspaceId} scopeRows={scopeRows} store={filter.storeFilter} /></div>
    <div className="profit-scope-field profit-scope-search"><span>SKC / SKU 搜索</span><SearchInput value={filter.query} onChange={event => onChange({ query: event.target.value })} label="在当前范围搜索 SKC、SKU" placeholder="搜索 SKC、SKU、属性、供方货号或店铺..." /></div>
    <label className="profit-filter-check"><input type="checkbox" checked={filter.missingOnly} onChange={event => onChange({ missingOnly: event.target.checked })} />只看缺成本</label>
    <button className="profit-filter-reset" type="button" onClick={() => onChange({ query: '', storeFilter: 'all', supplierSelection: null, missingOnly: false, supplierScopeError: undefined })}>重置筛选</button>
    <p className="profit-scope-help">台账完整保留，搜索与 ERP 采集按当前范围；定稿覆盖本月全部店铺。</p>
    {filter.supplierScopeError && <p role="alert" className="profit-scope-warning">{filter.supplierScopeError}</p>}
  </div>;
}
