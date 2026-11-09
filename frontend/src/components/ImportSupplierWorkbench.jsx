import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from './UI';
import ImportSupplierGroups from './ImportSupplierGroups';
import SupplierFilterTable from './SupplierFilterTable';
import BoardSelect from './BoardSelect';
import { parseImportKeywords } from '../lib/importSupplierPreferences';
import { readSupplierGroups } from '../lib/importSupplierGroups';
import { changeSupplierSelection, supplierFilterCandidates, supplierFilterPreview, supplierRuleKey, supplierRuleSelection } from '../domain/supplierFilterPreview';

const fileSelections = files => Object.fromEntries(files.filter(file => file.status === 'parsed').map(file => [file.itemId, file.filterOptions?.supplierNumbers ?? []]));
const modeName = { fuzzy: '模糊识别', exact: '精准识别' };
export default function ImportSupplierWorkbench({ files, workspaceId, period, aliasesText, mode, onAliasesChange, onModeChange, initialRule, onApply, onDirtyChange, onMembers, viewStore, onViewStore, disabled, validated = false, onSelectionCount }) {
  const appliedKey = JSON.stringify(fileSelections(files));
  const applied = useMemo(() => fileSelections(files), [appliedKey]);
  const [selection, setSelection] = useState(() => fileSelections(files)), [rule, setRule] = useState(initialRule);
  const [preserve, setPreserve] = useState(true), [message, setMessage] = useState(''), [member, setMember] = useState(null), [memberPage, setMemberPage] = useState(0), [memberData, setMemberData] = useState(null), [memberRetry, setMemberRetry] = useState(0);
  const overridesRef = useRef(new Map()), memberSequence = useRef(0), previousApplied = useRef(applied);
  const applyingRef = useRef(false);
  const previousRuleKey = useRef(supplierRuleKey(initialRule));
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    const key = supplierRuleKey(initialRule);
    if (previousRuleKey.current !== key) { previousRuleKey.current = key; setRule(initialRule); }
  }, [initialRule]);
  useEffect(() => {
    if (JSON.stringify(applied) !== JSON.stringify(previousApplied.current)) {
      const previous = previousApplied.current;
      setSelection(current => Object.fromEntries(Object.entries(applied).map(([id, values]) => [id, JSON.stringify(previous[id]) === JSON.stringify(values) ? current[id] ?? values : values]))); previousApplied.current = applied;
    }
  }, [applied]);
  const indexKey = JSON.stringify(files.map(file => [file.itemId, file.storeName, file.status, file.supplierPreview?.scope?.requestId, file.supplierPreview ? null : file.facets?.supplierNumbers]));
  const candidates = useMemo(() => supplierFilterCandidates(files, { workspaceId, period }), [indexKey, workspaceId, period]);
  const preview = useMemo(() => supplierFilterPreview(candidates, { selected: selection, applied, rule, store: viewStore }), [candidates, selection, applied, rule, viewStore]);
  useEffect(() => { onSelectionCount?.(preview.batch.selected); }, [preview.batch.selected, onSelectionCount]);
  const ruleEdited = Boolean(parseImportKeywords(aliasesText).length || rule?.aliases?.length) && supplierRuleKey({ ...rule, aliases: parseImportKeywords(aliasesText), mode }) !== supplierRuleKey(rule);
  const selectionDirty = preview.batch.added > 0 || preview.batch.removed > 0;
  const ruleDirty = supplierRuleKey(rule) !== supplierRuleKey(initialRule);
  const dirty = selectionDirty || ruleDirty || ruleEdited || applying;
  const selectionState = applying ? "正在匹配与校验…" : !preview.batch.selected ? "请选择货号" : dirty || !validated ? "已选待匹配" : "已校验可导入";
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const apply = async (selected, next) => {
    if (disabled || applyingRef.current) return;
    applyingRef.current = true; setApplying(true);
    setSelection(selected); setRule(next);
    try {
      if (await onApply(selected, next) === false) {
        setSelection(applied); setRule(initialRule); setMessage('筛选未应用，请检查上方提示后重试。');
      } else setMessage('');
    } catch (error) {
      setSelection(applied); setRule(initialRule); setMessage(`筛选未应用：${error.message}`);
    } finally { applyingRef.current = false; setApplying(false); }
  };
  const stageRule = next => {
    if (disabled || applyingRef.current) return;
    if (!next.aliases.length) { setRule(next); return; }
    const currentKey = supplierRuleKey(rule), nextKey = supplierRuleKey(next);
    overridesRef.current.set(currentKey, selection);
    const previousSelection = overridesRef.current.get(nextKey);
    const selected = supplierRuleSelection(files, next, { previousRule: previousSelection ? next : rule, selected: previousSelection ?? selection, savedState: readSupplierGroups(workspaceId), preserve });
    const count = supplierFilterPreview(candidates, { selected }).batch.selected;
    setSelection(selected); setRule(next);
    setMessage(count ? `已按${modeName[next.mode]}预选 ${count} 个店铺货号，点击“匹配货号”后直接校验。` : '未找到符合条件的货号，请调整关键词或手工勾选。');
  };
  const selectGroup = group => {
    stageRule(group); onAliasesChange(group.aliases.join('、')); onModeChange(group.mode);
  };
  const match = async () => {
    if (ruleEdited) {
      const next = { aliases: parseImportKeywords(aliasesText), mode };
      const selected = next.aliases.length ? supplierRuleSelection(files, next, { previousRule: rule, selected: selection, savedState: readSupplierGroups(workspaceId), preserve }) : selection;
      await apply(selected, next); return;
    }
    await apply(selection, rule ?? { aliases: [], mode });
  };
  const undo = () => {
    setSelection(applied); setRule(initialRule); onAliasesChange((initialRule?.aliases ?? []).join('、')); onModeChange(initialRule?.mode ?? 'fuzzy'); overridesRef.current.clear(); setMessage('已恢复本批最近应用的文件筛选。');
  };
  useEffect(() => {
    const sequence = ++memberSequence.current;
    if (!member) { setMemberData(null); return; }
    setMemberData({ loading: true });
    Promise.resolve().then(() => onMembers(member, memberPage)).then(result => { if (sequence === memberSequence.current) setMemberData(result); }).catch(error => { if (sequence === memberSequence.current) setMemberData({ error: error.message }); });
    return () => { memberSequence.current += 1; };
  }, [member, memberPage, onMembers, memberRetry]);
  const count = value => value.toLocaleString('zh-CN');
  const missing = files.flatMap(file => (file.missingNumbers ?? []).map(value => `${file.storeName} / ${value}`));
  return <section className="supplier-workbench" aria-label="货号筛选工作台">
    <div className="supplier-workbench-heading"><div><h2>货号筛选</h2><p>先搜索或勾选，点击“匹配货号”后直接校验；未选数据自动排除。</p></div><BoardSelect label="查看店铺" ariaLabel="查看货号店铺" value={viewStore} onChange={onViewStore} options={[{ id: 'all', label: '全部店铺' }, ...preview.stores.map(item => ({ id: item.store, label: item.store }))]} /></div>
    <p className="supplier-scope-summary" aria-label="当前查看店铺统计">当前查看范围已选：{preview.scope.skcIncomplete ? '待补 SKC' : `${count(preview.scope.skcCount)} 个 SKC`} · {preview.scope.skuIncomplete ? '待补 SKU' : `${count(preview.scope.skuCount)} 个 SKU`}<span>当前范围共 {count(preview.scope.sourceRowCount)} 来源行</span></p>
    <div className="supplier-rules">
      <ImportSupplierGroups disabled={disabled || applying} workspaceId={workspaceId} aliasesText={aliasesText} mode={mode} activeId={ruleEdited ? '' : rule?.id} onApply={selectGroup} />
      <div className="supplier-rule-fields"><label htmlFor="batch-supplier-suffix">货号关键词</label><input id="batch-supplier-suffix" className="text-input" value={aliasesText} placeholder="例如 KPXX，多个用顿号、逗号或换行分隔" onChange={event => { onAliasesChange(event.target.value); stageRule({ aliases: parseImportKeywords(event.target.value), mode }); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void match(); } }} /><label htmlFor="supplier-match-mode">识别方式</label><select id="supplier-match-mode" aria-label="货号匹配方式" value={mode} onChange={event => { onModeChange(event.target.value); stageRule({ aliases: parseImportKeywords(aliasesText), mode: event.target.value }); }}><option value="fuzzy">模糊识别</option><option value="exact">精准识别</option></select><Button variant="primary" disabled={disabled || applying || !preview.batch.selected && !parseImportKeywords(aliasesText).length} onClick={() => void match()}>匹配货号</Button><span>{mode === 'exact' ? '完整货号一致；忽略大小写与全半角' : '包含关键词，兼容字母连写，如 KPX / KPXX'}；多个关键词任一命中即可预选</span></div>
      {ruleEdited && <p role="status" className="supplier-rule-pending">{parseImportKeywords(aliasesText).length ? '关键词或匹配方式已修改。点击“匹配货号”后直接校验。' : '关键词已清空。点击“匹配货号”后按当前勾选直接校验。'}</p>}
    </div>
    <div className="supplier-workbench-grid"><SupplierFilterTable rows={preview.rows} store={viewStore} mode={mode} disabled={disabled || applying} resetKey={`${workspaceId}/${period}`} onSelect={(rows, checked) => { setSelection(current => changeSupplierSelection(current, rows, checked)); setMessage('已更新预选，点击“匹配货号”后直接校验。'); }} onInspect={row => { setMemberPage(0); setMember(row); }} />
      <aside className="supplier-apply-preview" aria-label="筛选结果"><div className="supplier-preview-heading"><h3>筛选结果</h3><span>{selectionState}</span></div><p>本批全部店铺 · 查看筛选不改变应用范围</p>
        <dl><div className="supplier-preview-total"><dt>本批已选</dt><dd>{count(preview.batch.selected)}</dd></div>{selectionDirty ? <div><dt>当前已应用</dt><dd>{count(preview.batch.applied)}</dd></div> : null}{preview.batch.added > 0 ? <div><dt>本次新增选择</dt><dd className="supplier-positive">+ {count(preview.batch.added)}</dd></div> : null}{preview.batch.removed > 0 ? <div><dt>本次取消选择</dt><dd className="supplier-negative">− {count(preview.batch.removed)}</dd></div> : null}</dl>
        <label className="supplier-preserve"><input type="checkbox" checked={preserve} onChange={event => setPreserve(event.target.checked)} />重新匹配保留逐店人工例外</label>
        <Button variant="ghost" disabled={disabled || applying || !dirty} onClick={undo}>恢复上次关键词</Button><p>{applying ? '正在匹配与校验待导入文件…' : dirty ? '货号已预选，点击“匹配货号”后直接校验。' : validated ? '已校验，核对上方导入范围后可导入。' : preview.batch.selected ? '选择尚未校验，请点击“匹配货号”。' : '先勾选要导入的货号。'}</p>
        {message && <p role="status">{message}</p>}
        <div className="supplier-store-breakdown"><h4>各店预选货号</h4>{preview.stores.map(item => <button type="button" key={item.store} onClick={() => onViewStore(item.store)} aria-pressed={viewStore === item.store}><span>{item.store}</span><strong>{item.selected} / {item.total}</strong>{!item.selected && <small>未选，本次跳过</small>}</button>)}</div>
        <details><summary>规则命中明细</summary>{preview.aliases.map(item => <p key={item.alias}>{item.alias}：{item.count} 个{!item.count ? ' · 未命中' : ''}</p>)}<p>SKC / SKU 汇总去重；缺映射或日期证据显示待补。来源行数包含业务排除与错误，有效行数见正式校验。</p></details>
        {!!missing.length && <details><summary>上次选择中，本文件未找到 · {missing.length} 个</summary><p>{missing.join('、')}</p></details>}
      </aside>
    </div>
    <Modal open={Boolean(member)} title={member ? `${member.store} / ${member.supplierNumber}` : '货号成员'} description={`${period || '月份待确认'} · 通过基础业务校验的 SKC / SKU 成员，来源重复只累计行数。`} onClose={() => setMember(null)} footer={<><Button disabled={!memberPage || memberData?.loading} onClick={() => setMemberPage(page => page - 1)}>上一页成员</Button><span>第 {memberPage + 1} 页 · {memberData?.total ?? 0} 个成员</span><Button disabled={memberData?.loading || (memberPage + 1) * 30 >= (memberData?.total ?? 0)} onClick={() => setMemberPage(page => page + 1)}>下一页成员</Button></>}>
      {memberData?.loading ? <p role="status">正在读取成员…</p> : memberData?.error ? <><p role="alert">{memberData.error}</p><Button onClick={() => setMemberRetry(value => value + 1)}>重试读取</Button></> : <div className="table-wrap"><table className="data-table"><thead><tr><th>平台 SKC</th><th>平台 SKU</th><th>属性</th><th>来源行数</th></tr></thead><tbody>{(memberData?.rows ?? []).map((row, index) => <tr key={index}><td>{row.platformSkc || '待补'}</td><td>{row.platformSku}</td><td>{row.attribute}</td><td>{row.sourceRowCount}</td></tr>)}</tbody></table>{!memberData?.total && <p>当前月份没有可展示成员；请检查日期、映射或变动类型。</p>}</div>}
    </Modal>
  </section>;
}
