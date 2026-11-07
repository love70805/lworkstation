// BoardUI ButtonGroup and ButtonGroupItem, adapted to the local tokens.
export function BoardButtonGroup({ label, children }) {
  return <div role="group" aria-label={label} className="board-button-group">{children}</div>;
}

export function BoardButtonGroupItem({ selected, children, onClick }) {
  return <button type="button" aria-pressed={selected} onClick={onClick}><span>{children}</span></button>;
}
