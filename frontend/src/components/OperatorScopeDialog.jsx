import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSelectionReferenceSnapshot } from '../data/database';
import { normalizeOperatorPairs, operatorPairKey, parseOperatorNumbers } from '../domain/operatorScope';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import { Button, Modal } from './UI';

export default function OperatorScopeDialog({ operator, onClose }) {
  const [draft, setDraft] = useState(() => ({ ...operator.config, mode: operator.config.activeProfileId ? operator.config.mode : 'mine' }));
  const [profileId, setProfileId] = useState(draft.activeProfileId);
  const initial = draft.profiles.find(p => p.id === profileId);
  const [name, setName] = useState(initial?.name ?? '');
  const [pairs, setPairs] = useState(initial?.pairs ?? []);
  const [store, setStore] = useState('');
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const result = useLiveQuery(async () => {
    try {
      const snapshot = await getSelectionReferenceSnapshot({ compact: true });
      if (snapshot.workspaceId !== operator.workspaceId) throw new Error('工作区已切换，请重新打开设置。');
      return { pairs: normalizeOperatorPairs(buildSelectionReferenceRows(snapshot).flatMap(row => row.operatorPairs ?? [])) };
    } catch (error) { return { error: error.message }; }
  }, [operator.workspaceId], null);
  const choices = result?.pairs ?? [];
  const stores = useMemo(() => [...new Set(choices.map(p => p.store))].sort(), [result]);
  const filtered = choices.filter(p => (!store || p.store === store) && (!query.trim() || p.supplierNumber.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const selected = new Set(pairs.map(operatorPairKey));
  function choose(id) {
    const profile = draft.profiles.find(p => p.id === id);
    setProfileId(id); setName(profile?.name ?? ''); setPairs(profile?.pairs ?? []); setError(''); setMessage('');
  }
  function addPasted() {
    if (!store) { setError('批量添加前请选择店铺。'); return; }
    const numbers = parseOperatorNumbers(paste);
    const found = choices.filter(p => p.store === store && numbers.includes(p.supplierNumber));
    const missing = numbers.filter(number => !found.some(p => p.supplierNumber === number));
    setPairs(current => normalizeOperatorPairs([...current, ...found]));
    setError(''); setMessage(`已匹配 ${found.length} 个货号${missing.length ? `；未找到：${missing.join('、')}` : ''}`);
  }
  function save() {
    if (!name.trim()) { setError('请填写运营方案名称。'); return; }
    if (draft.profiles.some(p => p.id !== profileId && p.name === name.trim())) { setError('方案名称已存在，请换一个名称。'); return; }
    const id = profileId || crypto.randomUUID();
    const profile = { id, name: name.trim(), pairs: normalizeOperatorPairs(pairs) };
    try {
      operator.save({ ...draft, activeProfileId: id, profiles: [...draft.profiles.filter(p => p.id !== id), profile] });
      onClose();
    } catch { setError('本机保存失败，请检查可用空间后重试。'); }
  }
  return <Modal open title="我的负责商品" description="本机运营方案用于筛选商品，可随时切回全部商品。" onClose={onClose} className="operator-scope-dialog" size="large"
    footer={<><span>{pairs.length} 组店铺货号已选</span><Button onClick={onClose}>取消</Button><Button variant="primary" onClick={save} disabled={!operator.workspaceId}>保存并使用</Button></>}>
    <div className="operator-scope-fields">
      <label>运营方案<select aria-label="运营方案" className="select-input" value={profileId} onChange={e => choose(e.target.value)}><option value="">新建方案</option>{draft.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>方案名称<input className="text-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="例如：小林负责商品" /></label>
      <label>查看范围<select aria-label="查看范围" className="select-input" value={draft.mode} onChange={e => setDraft(value => ({ ...value, mode: e.target.value }))}><option value="mine">我的商品</option><option value="all">全部商品</option></select></label>
      <label>店铺<select aria-label="店铺" className="select-input" value={store} onChange={e => setStore(e.target.value)}><option value="">全部店铺（搜索）</option>{stores.map(s => <option key={s}>{s}</option>)}</select></label>
      <label>搜索供方货号<input className="text-input" type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
    </div>
    <label className="operator-scope-paste">批量粘贴供方货号<textarea className="text-input" rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder="每行一个，也支持逗号或空格分隔；按选定店铺匹配" /></label>
    <div className="operator-scope-actions"><Button onClick={addPasted} disabled={!paste.trim() || !result?.pairs}>添加匹配货号</Button><Button onClick={() => setPairs(current => normalizeOperatorPairs([...current, ...filtered]))} disabled={!filtered.length}>全选搜索结果</Button><Button onClick={() => setPairs([])} disabled={!pairs.length}>清空选择</Button></div>
    {error || result?.error ? <p role="alert">{error || `读取货号失败：${result.error}`}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {!result ? <p role="status">正在读取商品货号…</p> : null}
    <div className="operator-scope-list" aria-label="可选店铺货号">{filtered.slice(0, 300).map(pair => { const key = operatorPairKey(pair); return <label key={key}><input type="checkbox" checked={selected.has(key)} onChange={e => setPairs(current => e.target.checked ? normalizeOperatorPairs([...current, pair]) : current.filter(p => operatorPairKey(p) !== key))} /><span>{pair.store}</span><strong>{pair.supplierNumber}</strong></label>; })}</div>
    {filtered.length > 300 ? <p>已显示前 300 项，请搜索缩小范围；全选会包含全部 {filtered.length} 项。</p> : null}
    {result?.pairs && !filtered.length ? <p>没有匹配的店铺货号。</p> : null}
    <details><summary>已选 {pairs.length} 组（可逐项移除）</summary><div className="operator-scope-list">{pairs.map(pair => <label key={operatorPairKey(pair)}><input type="checkbox" checked onChange={() => setPairs(current => current.filter(p => operatorPairKey(p) !== operatorPairKey(pair)))} /><span>{pair.store}</span><strong>{pair.supplierNumber}</strong></label>)}</div></details>
    <p className="operator-scope-help">方案仅保存在这台设备的当前工作区，不是账号权限。空方案在“我的商品”下显示为空；完整台账、历史成本和已定稿结果保留。</p>
  </Modal>;
}
