import { useId, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Button, Panel } from "./UI";

export function LibraryFilterField({ label, children }) {
  return <label className="library-filter-field"><span>{label}</span>{children}</label>;
}

export default function LibraryFilterBar({ search, common, advanced, advancedCount = 0, activeFilters = [], onClear, result, actions, tools }) {
  const id = useId();
  const [expanded, setExpanded] = useState(advancedCount > 0);
  return <Panel className="library-filter-panel library-filter-workbench">
    <div className="library-filter-main">
      {search}{common}
      <Button icon={SlidersHorizontal} className="library-more-filters" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>更多筛选{advancedCount > 0 ? `（${advancedCount}）` : ""}<ChevronDown size={14} /></Button>
      {actions}
    </div>
    <div id={id} className="library-filter-advanced" hidden={!expanded}>{advanced}</div>
    <div className="library-filter-meta">
      <span className="reference-filter-count" role="status">{result}</span>
      <div className="library-active-filters" aria-label="当前筛选条件">{activeFilters.map(filter => <button key={filter.key} type="button" title={filter.label} aria-label={`移除筛选：${filter.label}`} onClick={filter.clear}><span>{filter.label}</span><X size={13} aria-hidden="true" /></button>)}</div>
      {activeFilters.length > 0 ? <Button variant="ghost" onClick={onClear}>清空筛选</Button> : null}
      {tools ? <div className="library-filter-tools">{tools}</div> : null}
    </div>
  </Panel>;
}
