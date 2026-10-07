import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from './UI';
import { matchImportNumbers, normalizeImportNumbers, parseImportKeywords, parseImportNumbers } from '../lib/importSupplierPreferences';

const ROW_HEIGHT = 44, VIEW_HEIGHT = 264, OVERSCAN = 3;
export default function ImportSupplierPicker({ choices = [], counts = {}, selected = [], missing = [], keywords = [], previousMatches = [], hasSaved = false, onKeywordsChange, onChange, store }) {
  const id = useId(), listRef = useRef(null);
  const [query, setQuery] = useState(keywords.join('、')), [paste, setPaste] = useState(''), [message, setMessage] = useState('');
  const [view, setView] = useState('all'), [scrollTop, setScrollTop] = useState(0), [active, setActive] = useState(0);
  useEffect(() => { if (JSON.stringify(parseImportKeywords(query)) !== JSON.stringify(keywords)) setQuery(keywords.join('、')); }, [keywords]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const matched = useMemo(() => matchImportNumbers(choices, keywords), [choices, keywords]);
  const newMatches = useMemo(() => {
    const previous = new Set(previousMatches);
    return hasSaved ? matched.filter(value => !previous.has(value) && !chosen.has(value)) : [];
  }, [matched, previousMatches, hasSaved, chosen]);
  const filtered = useMemo(() => view === 'matches' ? matched : view === 'selected' ? choices.filter(value => chosen.has(value)) : choices, [choices, matched, chosen, view]);
  useEffect(() => { setScrollTop(0); setActive(0); if (listRef.current) listRef.current.scrollTop = 0; }, [filtered]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visible = filtered.slice(start, start + Math.ceil(VIEW_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2);
  const change = values => onChange(normalizeImportNumbers(values));
  const toggle = value => change(chosen.has(value) ? selected.filter(item => item !== value) : [...selected, value]);
  const editKeywords = text => { setQuery(text); onKeywordsChange?.(parseImportKeywords(text)); };
  const addPasted = () => {
    const numbers = parseImportNumbers(paste), available = new Set(choices);
    const found = numbers.filter(value => available.has(value)), absent = numbers.filter(value => !available.has(value));
    change([...selected, ...found]);
    setMessage(`匹配 ${found.length} 个货号${absent.length ? `；文件中未找到：${absent.join('、')}` : ''}`);
  };
  const handleKeys = event => {
    if (!filtered.length || event.currentTarget.closest('fieldset:disabled')) return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(filtered[active]); return; }
    const next = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: filtered.length - 1, PageDown: active + 6, PageUp: active - 6 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(filtered.length - 1, next));
    setActive(index);
    const top = index * ROW_HEIGHT, current = listRef.current.scrollTop;
    if (top < current || top + ROW_HEIGHT > current + VIEW_HEIGHT) {
      listRef.current.scrollTop = Math.max(0, top - (top > current ? VIEW_HEIGHT - ROW_HEIGHT : 0));
      setScrollTop(listRef.current.scrollTop);
    }
  };
  return <section className="import-supplier-picker" aria-label={`${store} 导入货号`}>
    <div className="import-supplier-heading"><h3>选择本次负责货号</h3><span role="status">已选 {selected.length} / {choices.length} 个货号 · 匹配 {matched.length} 个</span></div>
    <label htmlFor={id}>关键词批量匹配</label>
    <input id={id} className="text-input" value={query} placeholder="例如 HHHX、LYYY；包含任意关键词即匹配" aria-describedby={`${id}-help`} onChange={event => editKeywords(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); editKeywords(`${keywords.join('、')}、`); } }} onPaste={event => { const text = event.clipboardData.getData('text'); if (/[\r\n]/.test(text)) { event.preventDefault(); editKeywords(`${query}${query ? '、' : ''}${text}`); } }} />
    <p id={`${id}-help`}>用回车、逗号或分号分隔，忽略英文大小写及全半角差异。编辑关键词不会更改已选货号。</p>
    <div className="import-supplier-keywords" aria-label="当前关键词">{keywords.map(keyword => <button key={keyword} type="button" aria-label={`移除关键词 ${keyword}`} onClick={() => editKeywords(keywords.filter(value => value !== keyword).join('、'))}>{keyword}<span aria-hidden="true"> ×</span></button>)}</div>
    <div className="import-supplier-actions"><Button disabled={!keywords.length || !matched.length} onClick={() => change([...selected, ...matched])}>选中匹配货号</Button><Button disabled={!keywords.length || !matched.length} onClick={() => { const matching = new Set(matched); change(selected.filter(value => !matching.has(value))); }}>取消匹配货号</Button><Button onClick={() => change(choices)}>全部货号</Button><Button disabled={!selected.length} onClick={() => change([])}>清空选择</Button></div>
    {!!newMatches.length && <div className="import-supplier-new"><p role="status">发现 {newMatches.length} 个新增匹配货号，尚未选择。</p><Button onClick={() => change([...selected, ...newMatches])}>一键加入新增匹配项</Button></div>}
    <div className="import-supplier-views" role="group" aria-label="查看货号"><Button aria-pressed={view === 'all'} onClick={() => setView('all')}>全部 ({choices.length})</Button><Button aria-pressed={view === 'matches'} onClick={() => setView('matches')}>匹配 ({matched.length})</Button><Button aria-pressed={view === 'selected'} onClick={() => setView('selected')}>已选 ({selected.length})</Button></div>
    <p id={`${id}-keys`} className="import-supplier-key-help">列表可用方向键定位，空格勾选；Home / End 跳至首尾。</p>
    <div ref={listRef} className="import-supplier-options" role="listbox" tabIndex={0} aria-label={`${store} 货号列表`} aria-multiselectable="true" aria-describedby={`${id}-keys`} aria-activedescendant={filtered.length && active >= start && active < start + visible.length ? `${id}-option-${active}` : undefined} style={{ height: Math.min(VIEW_HEIGHT, Math.max(ROW_HEIGHT, filtered.length * ROW_HEIGHT)) }} onKeyDown={handleKeys} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>{visible.map((value, offset) => <div key={value} id={`${id}-option-${start + offset}`} role="option" aria-selected={chosen.has(value)} aria-posinset={start + offset + 1} aria-setsize={filtered.length} className={`import-supplier-option${active === start + offset ? ' is-active' : ''}`} style={{ position: 'absolute', top: (start + offset) * ROW_HEIGHT, height: ROW_HEIGHT, width: '100%' }} onClick={event => { if (event.currentTarget.closest('fieldset:disabled')) return; setActive(start + offset); listRef.current.focus(); toggle(value); }}><span className="import-supplier-check" aria-hidden="true">{chosen.has(value) ? '✓' : ''}</span><strong title={value}>{value}</strong><small>{counts[value] ?? 0} 行</small></div>)}</div>
      {!filtered.length && <p>{choices.length ? '此视图没有货号。' : '未识别到供方货号，请检查字段映射或来源文件。'}</p>}
    </div>
    {!!missing.length && <p role="status" className="import-supplier-selection">上次选择中，本文件未找到：{missing.join('、')}。新出现货号需手动勾选。</p>}
    {!selected.length && <p className="import-error">请至少选择一个货号后导入。</p>}
    <details><summary>粘贴完整货号清单</summary><label htmlFor={`${id}-paste`}>精确匹配完整货号，每行一个，也可使用空格、逗号或分号分隔</label><textarea id={`${id}-paste`} className="text-input" rows={3} value={paste} onChange={event => setPaste(event.target.value)} /><Button onClick={addPasted} disabled={!paste.trim()}>添加匹配货号</Button><p role="status" className="import-supplier-selection">{message}</p></details>
  </section>;
}
