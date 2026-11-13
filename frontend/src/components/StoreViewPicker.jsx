import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

export default function StoreViewPicker({ stores, selected, onToggle, onClear, disabled }) {
  const [isOpen, setOpen] = useState(false);
  const text = selected.length === 0 ? '全部店铺' : selected.length === 1 ? selected[0] : `已选 ${selected.length} 家店铺`;
  return <div className="store-view-picker">
    <span>查看店铺</span>
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <Button className="board-select-trigger" aria-label={`查看货号店铺：${text}`} isDisabled={disabled}>
        <span>{text}</span><ChevronDown size={16} />
      </Button>
      <Popover className="board-select-popover store-view-popover" offset={4} placement="bottom end">
        <Dialog aria-label="查看货号店铺">
          <div className="store-view-heading"><strong>按店铺查看</strong><Button className="button button-ghost" isDisabled={!selected.length} onPress={() => { onClear(); setOpen(false); }}>查看全部</Button></div>
          <p>可多选；清空后显示全部店铺。</p>
          <div className="store-view-options" role="group" aria-label="查看店铺范围">
            {stores.map(item => <label key={item.store}>
              <input type="checkbox" checked={selected.includes(item.store)} onChange={() => onToggle(item.store)} />
              <span>{item.store}</span><small>{item.selected} / {item.total}</small>
            </label>)}
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  </div>;
}
