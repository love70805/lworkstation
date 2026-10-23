import { useEffect, useId, useState } from 'react';
import { Button, Modal } from './UI';
import { parseImportKeywords } from '../lib/importSupplierPreferences';
import { readSupplierGroups, saveSupplierGroup, deleteSupplierGroup } from '../lib/importSupplierGroups';

const modeName = { fuzzy: '模糊识别', exact: '精准识别' };
const suggestedName = aliases => {
  const full = aliases.join(' / ');
  return full.length <= 80 ? full : `${aliases[0].slice(0, 50)} 等 ${aliases.length} 个关键词`;
};
const editGroup = group => ({ id: group.id, name: group.name, aliasesText: group.aliases.join('、'), mode: group.mode });

export default function ImportSupplierGroups({ workspaceId, aliasesText, mode, activeId, onApply }) {
  const id = useId();
  const [groups, setGroups] = useState([]), [editor, setEditor] = useState(null);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setGroups(readSupplierGroups(workspaceId).groups);
    setEditor(null); setMessage(''); setError(''); setDeleting(false);
  }, [workspaceId]);
  const openEditor = value => { setEditor(value); setDeleting(false); setError(''); setMessage(''); };
  const closeEditor = () => { setEditor(null); setDeleting(false); setError(''); };
  const run = operation => {
    setError('');
    try { operation(); setGroups(readSupplierGroups(workspaceId).groups); closeEditor(); }
    catch (failure) { setError(failure.name === 'QuotaExceededError' ? '本机存储空间不足，未保存。填写内容和本次选择已保留。' : failure.message || '无法保存常用组，请重试。'); }
  };
  const aliases = parseImportKeywords(editor?.aliasesText ?? '');
  const currentAliases = parseImportKeywords(aliasesText);
  const saved = groups.find(group => group.id === editor?.id);
  return <section className="import-supplier-groups" aria-label="常用货号组">
    <div className="supplier-group-chips">
      <strong>常用组</strong>
      {groups.map(group => <Button key={group.id} aria-pressed={activeId === group.id && group.mode === mode && JSON.stringify(group.aliases) === JSON.stringify(currentAliases)} title={`${modeName[group.mode]}：${group.aliases.join('、')}`} onClick={() => { setMessage(''); onApply(group); }}>{group.name}</Button>)}
      {!groups.length && <span>保存一次，下次直接点组名。</span>}
      <div className="supplier-group-actions">
        <Button variant="ghost" disabled={!workspaceId || !parseImportKeywords(aliasesText).length} onClick={() => openEditor({ id: '', name: suggestedName(parseImportKeywords(aliasesText)), aliasesText, mode })}>保存为常用组</Button>
        {!!groups.length && <Button variant="ghost" onClick={() => openEditor(editGroup(groups.find(group => group.id === activeId) ?? groups[0]))}>管理常用组</Button>}
      </div>
    </div>
    {!workspaceId && <p>添加台账文件后，可保存和使用当前工作区的常用组。</p>}
    {message && <p role="status">{message}</p>}
    <Modal open={Boolean(editor)} title={saved ? '管理常用组' : '保存常用组'} description="只保存名称和匹配条件，本次勾选及待导入文件保持不变。" onClose={closeEditor} footer={deleting ? <><Button onClick={() => setDeleting(false)}>保留这个组</Button><Button onClick={() => run(() => { deleteSupplierGroup(workspaceId, saved.id); setMessage(`已删除常用组 ${saved.name}，本次选择保留。`); })}>确认删除</Button></> : <><Button onClick={closeEditor}>取消</Button><Button variant="primary" disabled={!workspaceId || !editor?.name.trim() || !aliases.length} onClick={() => run(() => { const value = saveSupplierGroup(workspaceId, { id: editor.id, name: editor.name, aliases, mode: editor.mode }); setMessage(`已保存常用组 ${value.name}。点击组名匹配货号，再应用筛选。`); })}>{saved ? '保存修改' : '保存货号组'}</Button></>}>
      {editor && <div className="supplier-group-editor">
        {saved && <label htmlFor={`${id}-select`}>要管理的组<select id={`${id}-select`} value={editor.id} disabled={deleting} onChange={event => { const group = groups.find(item => item.id === event.target.value); if (group) openEditor(editGroup(group)); }}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
        <label htmlFor="supplier-group-name">组名<input id="supplier-group-name" className="text-input" value={editor.name} maxLength={80} disabled={deleting} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
        <p>默认取货号关键词，也可以改成方便记忆的名称。</p>
        {saved ? <details><summary>修改匹配条件</summary>
          <label htmlFor={`${id}-keywords`}>货号关键词<input id={`${id}-keywords`} className="text-input" value={editor.aliasesText} disabled={deleting} onChange={event => setEditor({ ...editor, aliasesText: event.target.value })} /></label>
          <label htmlFor={`${id}-mode`}>匹配方式<select id={`${id}-mode`} value={editor.mode} disabled={deleting} onChange={event => setEditor({ ...editor, mode: event.target.value })}>{Object.entries(modeName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </details> : null}
        <p className="supplier-group-rule">{modeName[editor.mode]}：{aliases.join('、') || '请填写货号关键词'}</p>
        {saved && !deleting && <Button variant="ghost" className="supplier-group-delete" onClick={() => setDeleting(true)}>删除这个组</Button>}
        {deleting && <p role="status">删除“{saved.name}”？本次勾选和已导入数据会保留。</p>}
        {error && <p role="alert" className="import-error">{error}</p>}
      </div>}
    </Modal>
  </section>;
}
