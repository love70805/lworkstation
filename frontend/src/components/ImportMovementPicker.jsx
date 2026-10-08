import { useId } from 'react';
import { Button } from './UI';

export default function ImportMovementPicker({ store, choices = [], counts = {}, selected = [], defaults = [], onChange }) {
  const id = useId();
  if (!choices.length) return null;
  const selectedRows = selected.reduce((total, type) => total + (counts[type] ?? 0), 0);
  return <section className="import-movement-picker" aria-labelledby={`${id}-heading`}>
    <div className="import-movement-heading">
      <h3 id={`${id}-heading`}>变动类型</h3>
      <span role="status">已选 {selected.length} / {choices.length} 类 · {selectedRows.toLocaleString('zh-CN')} 行来源</span>
      <div className="import-movement-actions">
        <Button variant="ghost" aria-label={`${store} 全选变动类型`} onClick={() => onChange([...choices])}>全选</Button>
        <Button variant="ghost" aria-label={`${store} 清空变动类型`} onClick={() => onChange([])}>清空</Button>
        <Button variant="ghost" aria-label={`${store} 恢复默认变动类型`} onClick={() => onChange([...defaults])}>恢复默认</Button>
      </div>
    </div>
    <div className="import-movement-options" role="group" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-help`}>
      {choices.map(type => <label key={type}>
        <input type="checkbox" checked={selected.includes(type)} onChange={event => onChange(event.target.checked ? [...selected, type] : selected.filter(value => value !== type))} />
        <span>{type || '未填写变动类型'}</span><small>{(counts[type] ?? 0).toLocaleString('zh-CN')} 行</small>
      </label>)}
    </div>
    <p id={`${id}-help`}>可按本文件实际类型调整；修改后自动重新校验。{choices.some(type => type.includes('盘亏')) ? '盘亏记录仍按业务规则排除。' : ''}</p>
    {!selected.length && <p className="import-error" role="alert">请至少选择一种变动类型后再导入。</p>}
  </section>;
}
