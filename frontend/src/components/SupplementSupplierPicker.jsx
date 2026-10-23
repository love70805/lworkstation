import { Button } from './UI';

export const ALL_SUPPLEMENT_MARKERS = '__all_source_records__';

export default function SupplementSupplierPicker({ markers, selection, search, onSearch, onChange, disabled }) {
  const query = search.trim().normalize('NFKC');
  const matches = markers.filter(marker => marker.includes(query));
  const selected = new Set(selection === ALL_SUPPLEMENT_MARKERS ? markers : selection);
  const count = markers.filter(marker => selected.has(marker)).length;
  function toggle(marker, checked) {
    const next = new Set(selected);
    if (checked) next.add(marker); else next.delete(marker);
    onChange(markers.filter(value => next.has(value)));
  }
  return <>
    <label>搜索货号<input type="search" value={search} disabled={disabled} placeholder="例如 FFFV，自动全选匹配货号" onChange={event => {
      const value = event.target.value, term = value.trim().normalize('NFKC');
      onSearch(value);
      if (term) onChange(markers.filter(marker => marker.includes(term)));
    }} /></label>
    <div className="report-supplier-actions">
      <Button disabled={disabled || !matches.length} onClick={() => onChange(matches)}>全选搜索结果</Button>
      <Button disabled={disabled || !count} onClick={() => onChange([])}>清空选择</Button>
      <Button disabled={disabled || selection === ALL_SUPPLEMENT_MARKERS} onClick={() => onChange(ALL_SUPPLEMENT_MARKERS)}>采用全部货号</Button>
    </div>
    <p role="status">已选 {count} / {markers.length} 个完整货号{query ? `，搜索匹配 ${matches.length} 个` : ''}。搜索自动全选匹配货号；清空搜索保留已选，可逐项取消。</p>
    <div className="report-supplier-options" role="group" aria-label="选择扣款货号">
      {matches.map(marker => <label className="report-supplier-option" key={marker}>
        <input type="checkbox" checked={selected.has(marker)} disabled={disabled} onChange={event => toggle(marker, event.target.checked)} /><span>{marker}</span>
      </label>)}
      {!matches.length && <p>没有匹配货号，请调整搜索或来源字段映射。</p>}
    </div>
  </>;
}
