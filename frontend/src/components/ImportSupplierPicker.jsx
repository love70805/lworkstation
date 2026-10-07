import { useId, useState } from 'react';
import { Button } from './UI';
import { normalizeImportNumbers, parseImportNumbers } from '../lib/importSupplierPreferences';

export default function ImportSupplierPicker({ choices = [], counts = {}, selected = [], missing = [], onChange, store }) {
  const id = useId();
  const [query, setQuery] = useState(''), [paste, setPaste] = useState(''), [message, setMessage] = useState('');
  const filtered = choices.filter(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const chosen = new Set(selected);
  const change = values => onChange(normalizeImportNumbers(values));
  const addPasted = () => {
    const numbers = parseImportNumbers(paste), matched = numbers.filter(value => choices.includes(value)), absent = numbers.filter(value => !choices.includes(value));
    change([...selected, ...matched]);
    setMessage(`匹配 ${matched.length} 个货号${absent.length ? `；文件中未找到：${absent.join('、')}` : ''}`);
  };
  return <section className="import-supplier-picker" aria-label={`${store} 导入货号`}>
    <div className="import-supplier-heading"><h3>选择本次负责货号</h3><span role="status">已选 {selected.length} / {choices.length} 个货号</span></div>
    <label htmlFor={id}>搜索供方货号</label><input id={id} className="text-input" value={query} placeholder="输入货号搜索，已选项不会被清除" onChange={event => setQuery(event.target.value)} />
    <div className="import-supplier-actions"><Button onClick={() => change(choices)}>全部货号</Button><Button onClick={() => change([...selected, ...filtered])}>全选搜索结果</Button><Button onClick={() => change([])}>清空选择</Button></div>
    <div className="import-supplier-options">{filtered.map(value => <label key={value}><input type="checkbox" checked={chosen.has(value)} onChange={event => change(event.target.checked ? [...selected, value] : selected.filter(item => item !== value))} /><strong>{value}</strong><small>{counts[value] ?? 0} 行</small></label>)}{!filtered.length && <p>{choices.length ? '没有匹配货号。' : '未识别到供方货号，请检查字段映射或来源文件。'}</p>}</div>
    {selected.length > 0 && <p className="import-supplier-selection" title={selected.join('、')}>已选：{selected.join('、')}</p>}
    {!!missing.length && <p role="status">上次选择中，本文件未找到：{missing.join('、')}。新出现货号需手动勾选。</p>}
    {!selected.length && <p className="import-error">请至少选择一个货号后导入。</p>}
    <details><summary>批量粘贴货号</summary><label htmlFor={`${id}-paste`}>每行一个，也可使用空格、逗号或分号分隔</label><textarea id={`${id}-paste`} className="text-input" rows={3} value={paste} onChange={event => setPaste(event.target.value)} /><Button onClick={addPasted} disabled={!paste.trim()}>添加匹配货号</Button><p role="status">{message}</p></details>
  </section>;
}
