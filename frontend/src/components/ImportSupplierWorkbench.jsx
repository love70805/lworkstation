import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from './UI';
import ImportSupplierGroups from './ImportSupplierGroups';
import SupplierFilterTable from './SupplierFilterTable';
import StoreViewPicker from './StoreViewPicker';
import { parseImportKeywords } from '../lib/importSupplierPreferences';
import { changeSupplierSelection, supplierFilterCandidates, supplierFilterPreview, supplierRuleKey, supplierRuleSelection, supplierViewStores } from '../domain/supplierFilterPreview';

const fileSelections = files => Object.fromEntries(files.filter(file => file.status === 'parsed').map(file => [file.itemId, file.filterOptions?.supplierNumbers ?? []]));
const modeName = { fuzzy: '模糊识别', exact: '精准识别' };
export default function ImportSupplierWorkbench({ files, workspaceId, period, draft, onDraftChange, initialRule, confirmed, onApply, onDirtyChange, onMembers, viewStore, onViewStore, disabled }) {
  const { rule, text: aliasesText } = draft;
  const { mode } = rule;
  const appliedKey = JSON.stringify(fileSelections(files));
  const applied = useMemo(() => fileSelections(files), [appliedKey]);
  const [selection, setSelection] = useState(() => fileSelections(files));
  const [message, setMessage] = useState(''), [member, setMember] = useState(null), [memberPage, setMemberPage] = useState(0), [memberData, setMemberData] = useState(null), [memberRetry, setMemberRetry] = useState(0);
  const memberSequence = useRef(0), previousApplied = useRef(applied);
  const applyingRef = useRef(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (JSON.stringify(applied) !== JSON.stringify(previousApplied.current)) {
      const previous = previousApplied.current;
      setSelection(current => Object.fromEntries(Object.entries(applied).map(([id, values]) => [id, JSON.stringify(previous[id]) === JSON.stringify(values) ? current[id] ?? values : values]))); previousApplied.current = applied;
    }
  }, [applied]);
  const indexKey = JSON.stringify(files.map(file => [file.itemId, file.storeName, file.status, file.supplierPreview?.scope?.requestId, file.supplierPreview ? null : file.facets?.supplierNumbers]));
  const candidates = useMemo(() => supplierFilterCandidates(files, { workspaceId, period }), [indexKey, workspaceId, period]);
  const preview = useMemo(() => supplierFilterPreview(candidates, { selected: selection, applied, rule, store: viewStore }), [candidates, selection, applied, rule, viewStore]);
  const viewedStores = supplierViewStores(viewStore);
  const toggleViewStore = store => onViewStore(viewedStores.includes(store) ? viewedStores.filter(value => value !== store) : [...viewedStores, store]);
  const selectionDirty = preview.batch.added > 0 || preview.batch.removed > 0;
  const ruleDirty = supplierRuleKey(rule) !== supplierRuleKey(initialRule);
  const dirty = selectionDirty || ruleDirty || applying;
  const canConfirm = preview.batch.total > 0 && (preview.batch.selected > 0 || selectionDirty || ruleDirty);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const confirmSelection = async () => {
    if (disabled || applyingRef.current || !canConfirm) return;
    applyingRef.current = true; setApplying(true);
    try {
      const success = await onApply(selection, rule);
      setMessage(success === false ? '筛选未应用，请检查上方提示后重试。' : '');
    } catch (error) {
      setMessage(`筛选未应用：${error.message}`);
    } finally { applyingRef.current = false; setApplying(false); }
  };
  const stageRule = (next, text = next.aliases.join('、')) => {
    if (disabled || applyingRef.current) return;
    onDraftChange({ rule: next, text });
    if (!next.aliases.length) { setMessage(''); return; }
    const selected = supplierRuleSelection(files, next);
    setSelection(selected);
    const hasMatches = Object.values(selected).some(numbers => numbers.length > 0);
    setMessage(preview.batch.total && !hasMatches ? '未找到符合条件的货号，请调整关键词或手动勾选。' : '');
  };
  useEffect(() => {
    const sequence = ++memberSequence.current;
    if (!member) { setMemberData(null); return; }
    setMemberData({ loading: true });
    Promise.resolve().then(() => onMembers(member, memberPage)).then(result => { if (sequence === memberSequence.current) setMemberData(result); }).catch(error => { if (sequence === memberSequence.current) setMemberData({ error: error.message }); });
    return () => { memberSequence.current += 1; };
  }, [member, memberPage, onMembers, memberRetry]);
  const count = value => value.toLocaleString('zh-CN');
  return <section className="supplier-workbench" aria-label="货号筛选工作台">
    <div className="supplier-workbench-heading"><div><h2>货号筛选</h2><p>切换常用组会替换本批选择。可以再手动勾选或取消货号。</p></div><StoreViewPicker stores={preview.stores} selected={viewedStores} onToggle={toggleViewStore} onClear={() => onViewStore([])} disabled={disabled} /></div>
    <div className="supplier-stats" aria-label="当前查看店铺统计">{[['当前范围货号', preview.scope.total, '货号按店铺计数'], ['规则匹配', preview.scope.matched, rule?.aliases?.length ? modeName[rule.mode] : '尚未生成规则选择'], ['当前已选', preview.scope.selected, `${preview.scope.skcIncomplete ? '待补 SKC' : `${count(preview.scope.skcCount)} 个 SKC`} · ${preview.scope.skuIncomplete ? '待补 SKU' : `${count(preview.scope.skuCount)} 个 SKU`}`], ['尚未选择', preview.scope.total - preview.scope.selected, `${count(preview.scope.sourceRowCount)} 来源行`]].map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{count(value)}</strong><small>{detail}</small></div>)}</div>
    <div className="supplier-rules">
      <ImportSupplierGroups disabled={disabled || applying} workspaceId={workspaceId} aliasesText={aliasesText} mode={mode} activeId={rule.id} onApply={stageRule} />
      <div className="supplier-rule-fields"><label htmlFor="batch-supplier-suffix">货号关键词</label><input id="batch-supplier-suffix" className="text-input" value={aliasesText} placeholder="例如 KPXX，多个用顿号、逗号或换行分隔" onChange={event => stageRule({ aliases: parseImportKeywords(event.target.value), mode }, event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void confirmSelection(); } }} /><label htmlFor="supplier-match-mode">识别方式</label><select id="supplier-match-mode" aria-label="货号匹配方式" value={mode} onChange={event => stageRule({ aliases: rule.aliases, mode: event.target.value }, aliasesText)}><option value="fuzzy">模糊识别</option><option value="exact">精准识别</option></select><Button variant="primary" disabled={disabled || applying || !canConfirm} onClick={() => void confirmSelection()}>确认所选货号</Button><span>{mode === 'exact' ? '完整货号一致；忽略大小写与全半角' : '包含关键词，兼容字母连写，如 KPX / KPXX'}；多个关键词任一命中即可预选</span></div>
    </div>
    <div className="supplier-workbench-grid"><SupplierFilterTable rows={preview.rows} store={viewStore} mode={mode} disabled={disabled || applying} resetKey={`${workspaceId}/${period}`} onSelect={(rows, checked) => { setSelection(current => changeSupplierSelection(current, rows, checked)); setMessage(''); }} onInspect={row => { setMemberPage(0); setMember(row); }} />
      <aside className="supplier-apply-preview" aria-label="筛选结果"><div className="supplier-preview-heading"><h3>筛选结果</h3><span>{applying ? '正在确认…' : dirty ? '待确认' : !preview.batch.selected ? '尚未选择' : confirmed ? '已确认' : '待确认'}</span></div><p>本批全部店铺 · 查看筛选不改变应用范围</p>
        <dl><div><dt>当前已应用</dt><dd>{count(preview.batch.applied)}</dd></div><div><dt>本次新增选择</dt><dd className="supplier-positive">+ {count(preview.batch.added)}</dd></div><div><dt>本次取消选择</dt><dd className="supplier-negative">− {count(preview.batch.removed)}</dd></div><div className="supplier-preview-total"><dt>本批已选</dt><dd>{count(preview.batch.selected)}</dd></div></dl>
        {dirty || !preview.batch.selected ? <p>{applying ? '正在匹配与校验待导入文件…' : preview.batch.selected ? '请确认所选货号。' : '请选择常用组、输入关键词或手动勾选货号。'}</p> : null}
        {message && <p role="status">{message}</p>}
        <div className="supplier-store-breakdown"><div className="supplier-store-heading"><h4>各店预选货号</h4>{viewedStores.length > 0 && <button type="button" className="supplier-store-clear" onClick={() => onViewStore([])}>查看全部</button>}</div><p>点击店铺可多选，再次点击取消。</p>{preview.stores.map(item => <button type="button" className="supplier-store-option" key={item.store} onClick={() => toggleViewStore(item.store)} aria-pressed={viewedStores.includes(item.store)}><span><span className="supplier-store-check" aria-hidden="true">{viewedStores.includes(item.store) ? '✓' : ''}</span>{item.store}</span><strong>{item.selected} / {item.total}</strong>{!item.selected && <small>未选货号，本次跳过</small>}</button>)}</div>
        <details><summary>规则命中明细</summary>{preview.aliases.map(item => <p key={item.alias}>{item.alias}：{item.count} 个{!item.count ? ' · 未命中' : ''}</p>)}<p>SKC / SKU 汇总去重；缺映射或日期证据显示待补。来源行数包含业务排除与错误，有效行数见正式校验。</p></details>
      </aside>
    </div>
    <Modal open={Boolean(member)} title={member ? `${member.store} / ${member.supplierNumber}` : '货号成员'} description={`${period || '月份待确认'} · 通过基础业务校验的 SKC / SKU 成员，来源重复只累计行数。`} onClose={() => setMember(null)} footer={<><Button disabled={!memberPage || memberData?.loading} onClick={() => setMemberPage(page => page - 1)}>上一页成员</Button><span>第 {memberPage + 1} 页 · {memberData?.total ?? 0} 个成员</span><Button disabled={memberData?.loading || (memberPage + 1) * 30 >= (memberData?.total ?? 0)} onClick={() => setMemberPage(page => page + 1)}>下一页成员</Button></>}>
      {memberData?.loading ? <p role="status">正在读取成员…</p> : memberData?.error ? <><p role="alert">{memberData.error}</p><Button onClick={() => setMemberRetry(value => value + 1)}>重试读取</Button></> : <div className="table-wrap"><table className="data-table"><thead><tr><th>平台 SKC</th><th>平台 SKU</th><th>属性</th><th>来源行数</th></tr></thead><tbody>{(memberData?.rows ?? []).map((row, index) => <tr key={index}><td>{row.platformSkc || '待补'}</td><td>{row.platformSku}</td><td>{row.attribute}</td><td>{row.sourceRowCount}</td></tr>)}</tbody></table>{!memberData?.total && <p>当前月份没有可展示成员；请检查日期、映射或变动类型。</p>}</div>}
    </Modal>
  </section>;
}
