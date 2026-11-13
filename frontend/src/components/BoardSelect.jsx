import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';
import { Check, ChevronDown } from 'lucide-react';

// BoardUI Select and SelectItem, with React Aria handling typeahead, focus,
// outside dismissal and native form/autofill. Theme tokens live in board-controls.css.
export default function BoardSelect({ label, ariaLabel, value, onChange, options, disabled, className = '' }) {
  return <Select className={`board-select ${className}`.trim()} aria-label={ariaLabel || label}
    name={ariaLabel || label} selectedKey={value} onSelectionChange={key => { if (key != null) onChange(String(key)); }} isDisabled={disabled}>
    <Label className="board-select-label">{label}</Label>
    <Button className="board-select-trigger">
      <SelectValue /><ChevronDown size={16} aria-hidden="true" />
    </Button>
    <Popover offset={4} className="board-select-popover">
      <ListBox className="board-select-menu" items={options}>
        {option => <ListBoxItem id={option.id} textValue={option.label} className="board-select-option">
          {({ isSelected }) => <><span>{option.label}</span>{isSelected && <Check size={16} aria-hidden="true" />}</>}
        </ListBoxItem>}
      </ListBox>
    </Popover>
  </Select>;
}
