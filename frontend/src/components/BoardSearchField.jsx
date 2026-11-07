import { useRef } from "react";
import { Input, SearchField } from "react-aria-components";
import { Search, X } from "lucide-react";
import "./BoardSearchField.css";

// BoardUI SearchField (MIT), adapted to React 18 and the workstation's CSS
// tokens. React Aria supplies the search semantics and Escape handling.
export default function BoardSearchField({ value, onValueChange, placeholder, label = placeholder, className = "", shortcut }) {
  const inputRef = useRef(null);
  return <SearchField aria-label={label} value={value} onChange={onValueChange} className={`search-input board-search-field ${className}`.trim()}>
    {({ isEmpty }) => <>
      <Search size={18} aria-hidden="true" className="board-search-icon" />
      <Input ref={inputRef} placeholder={placeholder} aria-label={label} />
      {shortcut && isEmpty ? <kbd>{shortcut}</kbd> : null}
      <button type="button" className="board-search-clear" aria-label="清除搜索" aria-hidden={isEmpty || undefined} disabled={isEmpty} tabIndex={-1}
        onMouseDown={event => event.preventDefault()} onClick={() => { onValueChange(""); inputRef.current?.focus(); }}>
        <X size={12} aria-hidden="true" />
      </button>
    </>}
  </SearchField>;
}
