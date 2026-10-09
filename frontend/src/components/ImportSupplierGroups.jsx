import { useEffect, useState } from 'react';
import { Button } from './UI';
import { parseImportKeywords } from '../lib/importSupplierPreferences';
import { readSupplierGroups, saveSupplierGroup, deleteSupplierGroup } from '../lib/importSupplierGroups';

export default function ImportSupplierGroups({ workspaceId, aliasesText, mode, onLoad, onApply }) {
  const [groups, setGroups] = useState([]), [selected, setSelected] = useState(''), [name, setName] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const state = readSupplierGroups(workspaceId), last = state.groups.find(group => group.id === state.lastAppliedId);
    setGroups(state.groups); setSelected(last?.id || ''); setName(last?.name || ''); setMessage(''); setError('');
  }, [workspaceId]);
  const group = groups.find(item => item.id === selected);
  const run = operation => { setError(''); setMessage(''); try { operation(); setGroups(readSupplierGroups(workspaceId).groups); } catch (failure) { setError(failure.message); } };
  return <section className="import-supplier-groups" aria-label="货号组">
    <div className="import-group-controls"><label htmlFor="supplier-group-select">已保存货号组</label><select id="supplier-group-select" value={selected} disabled={!workspaceId} onChange={event => { const value = groups.find(item => item.id === event.target.value); setSelected(value?.id || ''); setName(value?.name || ''); if (value) onLoad(value); setError(''); setMessage(''); }}><option value="">选择货号组</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name} · {item.aliases.join(' / ')}</option>)}</select><Button disabled={!group} onClick={() => { onApply(group); setMessage(`已应用 ${group.name}：${group.aliases.join('、')}`); }}>应用货号组</Button></div>
    <details><summary>保存或管理货号组</summary><p>将上方输入的别名与匹配方式保存为一组，例如 LBYY、LBY。保存不会更改当前已选货号。</p><div className="import-group-controls"><label htmlFor="supplier-group-name">组名称</label><input id="supplier-group-name" className="text-input" value={name} maxLength={80} placeholder="例如 LBYY / LBY" onChange={event => setName(event.target.value)} /><Button disabled={!workspaceId || !name.trim() || !parseImportKeywords(aliasesText).length} onClick={() => run(() => { const value = saveSupplierGroup(workspaceId, { id: selected, name, aliases: parseImportKeywords(aliasesText), mode }); setSelected(value.id); setMessage(`已保存 ${value.name}，可点击“应用货号组”`); })}>{group ? '更新货号组' : '保存货号组'}</Button>{group && <><Button variant="ghost" onClick={() => { setSelected(''); setName(''); }}>新建另一组</Button><Button variant="ghost" onClick={() => run(() => { deleteSupplierGroup(workspaceId, group.id); setSelected(''); setName(''); setMessage('货号组已删除，当前文件的选择保留'); })}>删除货号组</Button></>}</div></details>
    {!workspaceId && <p>添加台账文件后，可保存和使用当前工作区的货号组。</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="import-error">{error}</p>}
  </section>;
}
