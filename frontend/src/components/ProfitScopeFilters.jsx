import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SearchInput } from "./UI";

function SupplierMultiSelect({ options, selection, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = useMemo(() => selection === null ? options : (selection ?? []).filter((item) => options.includes(item)), [selection, options]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = selection === null || options.every((item) => selectedSet.has(item));
  const label = allSelected ? "全部供方货号" : selected.length === 0 ? "未选择供方货号" : selected.length === 1 ? selected[0] : `已选 ${selected.length} 个货号`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggle = (supplier) => {
    const next = selectedSet.has(supplier) ? selected.filter((item) => item !== supplier) : [...selected, supplier].toSorted();
    onChange(next.length === options.length && options.every((item) => next.includes(item)) ? null : next);
  };

  return <div className="profit-multi-select" ref={rootRef}>
    <button type="button" className="profit-multi-select-trigger" aria-label="按供方货号筛选" aria-haspopup="listbox" aria-expanded={open} disabled={!options.length} onClick={() => setOpen((value) => !value)}><span>{label}</span><ChevronDown size={16} /></button>
    {open ? <div className="profit-multi-select-menu" role="listbox" aria-multiselectable="true" aria-label="供方货号">
      <div className="profit-multi-select-head"><strong>供方货号</strong><span><button type="button" onClick={() => onChange(null)}>全选</button><button type="button" onClick={() => onChange([])}>清空</button></span></div>
      <div className="profit-multi-select-options">{options.map((supplier) => <label className="profit-multi-select-option" key={supplier}><input type="checkbox" checked={selectedSet.has(supplier)} onChange={() => toggle(supplier)} /><code>{supplier}</code>{selectedSet.has(supplier) ? <Check size={15} /> : null}</label>)}</div>
    </div> : null}
  </div>;
}

export default function ProfitScopeFilters({ filter, stores = [], suppliers = [], onChange, showStore = true }) {
  return <div className="profit-filter-bar profit-scope-filters" role="group" aria-label="台账查询范围">
    {showStore ? <label className="profit-scope-field"><span>店铺</span><select className="select-input" aria-label="查询店铺" value={filter.storeFilter} onChange={(event) => onChange({ storeFilter: event.target.value })}><option value="all">全部店铺</option>{stores.map((store) => <option value={store} key={store}>{store}</option>)}</select></label> : null}
    <div className="profit-scope-field"><span>供方货号</span><SupplierMultiSelect options={suppliers} selection={filter.supplierSelection} onChange={(supplierSelection) => onChange({ supplierSelection })} /></div>
    <div className="profit-scope-field profit-scope-search"><span>SKC / SKU 搜索</span><SearchInput value={filter.query} onChange={(event) => onChange({ query: event.target.value })} label="在当前范围搜索 SKC、SKU" placeholder="搜索 SKC、SKU、属性、供方货号或店铺..." /></div>
    <label className="profit-filter-check"><input type="checkbox" checked={filter.missingOnly} onChange={(event) => onChange({ missingOnly: event.target.checked })} />只看缺成本</label>
    <button className="profit-filter-reset" type="button" onClick={() => onChange({ query: "", storeFilter: "all", supplierSelection: null, missingOnly: false })}>重置筛选</button>
    <p className="profit-scope-help">台账完整保留，搜索与 ERP 采集按当前范围；定稿覆盖本月全部店铺。</p>
  </div>;
}
