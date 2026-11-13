// @vitest-environment happy-dom
import { act, useState } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ImportSupplierWorkbench from './ImportSupplierWorkbench';

const initialRule = { aliases: ['FFFV'], mode: 'fuzzy' };
const initialFiles = [{ itemId: 'F', storeName: '甲店', status: 'parsed', facets: { supplierNumbers: ['A-FFFV', 'B-KPX', 'MANUAL'] }, filterOptions: { supplierNumbers: ['A-FFFV', 'MANUAL'] } }];
let root, container, snapshot, apply, members;
function Harness({ startingEmpty = false, startingFiles = initialFiles }) {
  const [rule, setRule] = useState(startingEmpty ? { aliases: [], mode: 'fuzzy' } : initialRule);
  const [draft, setDraft] = useState({ text: rule.aliases.join('、'), rule });
  const [files, setFiles] = useState(startingFiles), [dirty, onDirtyChange] = useState(false), [viewStore, onViewStore] = useState([]);
  snapshot = { files, rule, dirty };
  return <ImportSupplierWorkbench files={files} workspaceId="W" period="2026-09" draft={draft} onDraftChange={setDraft} initialRule={rule} onDirtyChange={onDirtyChange} viewStore={viewStore} onViewStore={onViewStore} onMembers={members} onApply={(selection, next) => { apply(selection, next); setRule(next); setFiles(files.map(file => ({ ...file, filterOptions: { supplierNumbers: selection[file.itemId] } }))); }} />;
}
beforeEach(async () => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); apply = vi.fn(); members = vi.fn().mockResolvedValue({ rows: [], total: 0 }); await act(async () => root.render(<Harness />)); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => act(async () => button(text).click());
const input = async value => act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), { target: { value } }));

it('toggles multiple store views and clears them without changing goods or applying files', async () => {
  const files = ['甲店', '乙店', '丙店'].map((storeName, i) => ({ ...initialFiles[0], itemId: String(i), storeName }));
  await act(async () => root.render(<Harness key="stores" startingFiles={files} />));
  const stores = container.querySelectorAll('.supplier-store-option');
  const rows = () => container.querySelectorAll('.supplier-filter-table tbody input[type=checkbox]');
  await act(async () => stores[0].click());
  expect(rows()).toHaveLength(3);
  await act(async () => stores[2].click());
  expect(rows()).toHaveLength(6);
  expect(stores[0].getAttribute('aria-pressed')).toBe('true');
  expect(stores[1].getAttribute('aria-pressed')).toBe('false');
  expect(stores[2].getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.store-view-picker button').textContent).toBe('已选 2 家店铺');
  await act(async () => stores[0].click());
  expect(rows()).toHaveLength(3);
  expect(container.querySelector('.store-view-picker button').textContent).toBe('丙店');
  await act(async () => stores[2].click());
  expect(rows()).toHaveLength(9);
  expect(container.querySelector('.store-view-picker button').textContent).toBe('全部店铺');
  await act(async () => { stores[0].click(); });
  await click('查看全部');
  expect(rows()).toHaveLength(9);
  expect(snapshot.dirty).toBe(false);
  expect(snapshot.files).toEqual(files);
  expect(apply).not.toHaveBeenCalled();
});

it('blocks applying stale matches after a rule edit and applies only the newly matched selection', async () => {
  expect(button('应用本次筛选')).toBeUndefined();
  await input('KPX');
  expect(snapshot.dirty).toBe(true);
  expect(button('应用本次筛选')).toBeUndefined();
   expect(apply).not.toHaveBeenCalled();
  expect(snapshot.files[0].filterOptions.supplierNumbers).toEqual(['A-FFFV', 'MANUAL']);
  await click('确认所选货号');
  expect(apply).toHaveBeenCalledWith({ F: ['B-KPX'] }, { aliases: ['KPX'], mode: 'fuzzy' });
  expect(snapshot.dirty).toBe(false);
  expect(button('应用本次筛选')).toBeUndefined();
});

it('clears matching conditions explicitly without clearing manually selected goods and keeps a new unmatched edit pending', async () => {
  await input(''); expect(button('应用本次筛选')).toBeUndefined();
  await click('确认所选货号');
  expect(apply).toHaveBeenCalledWith({ F: ['A-FFFV', 'MANUAL'] }, { aliases: [], mode: 'fuzzy' });
  await input('UNKNOWN');
  expect(button('撤销本次调整')).toBeUndefined();
  expect(snapshot.dirty).toBe(true);
  expect(snapshot.files[0].filterOptions.supplierNumbers).toEqual(['A-FFFV', 'MANUAL']);
});

it('recovers from a synchronous member read failure in the same dialog', async () => {
  members.mockImplementationOnce(() => { throw Error('临时明细读取失败'); }).mockResolvedValue({ rows: [{ platformSkc: 'SKC', platformSku: 'SKU', attribute: '粉色-B', sourceRowCount: 1 }], total: 1 });
  await click('A-FFFV');
  expect(container.querySelector('[role=alert]').textContent).toContain('临时明细读取失败');
  await click('重试读取');
  expect(container.querySelector('[role=dialog]').textContent).toContain('粉色-B');
  expect(members).toHaveBeenCalledTimes(2);
  expect(apply).not.toHaveBeenCalled();
});

it('stages manual selection and the mode without reprocessing files until matching', async () => {
  await act(async () => root.render(<Harness key="empty" startingEmpty />));
  await act(async () => Simulate.change(container.querySelector('[aria-label="货号匹配方式"]'), { target: { value: 'exact' } }));
  expect(snapshot.dirty).toBe(true);
  await act(async () => container.querySelector('[aria-label="选择 甲店 B-KPX"]').click());
  expect(apply).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="选择 甲店 B-KPX"]').checked).toBe(true);
  expect(container.querySelector('.supplier-selected-list')).toBeNull();
  await click('确认所选货号');
  expect(apply).toHaveBeenCalledTimes(1);

  expect(snapshot.files[0].filterOptions.supplierNumbers).toEqual(['A-FFFV', 'B-KPX', 'MANUAL']);
  expect(snapshot.dirty).toBe(false);
});

it('confirms the displayed selection once with Enter and has no remembered-selection or duplicate actions', async () => {
  expect(container.querySelector('.supplier-rules').tagName).toBe('DIV');
  for (const label of ['重新匹配保留逐店人工例外', '恢复上次关键词', '应用选择并校验', '粘贴清单', '导出本批已选']) {
    expect(container.textContent).not.toContain(label);
  }
  await input('KPX');
  await act(async () => Simulate.keyDown(container.querySelector('#batch-supplier-suffix'), { key: 'Enter', nativeEvent: { isComposing: false } }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({ F: ['B-KPX'] }, { aliases: ['KPX'], mode: 'fuzzy' });
});

it('drops a late member response after closing and opening another goods record', async () => {
  let finish;
  members.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ rows: [{ platformSku: 'NEW-SKU', attribute: '蓝色-B' }], total: 1 });
  await click('A-FFFV');
  await act(async () => container.querySelector('[aria-label="关闭对话框"]').click());
  await click('B-KPX');
  await act(async () => finish({ rows: [{ platformSku: 'OLD-SKU' }], total: 1 }));
  expect(container.querySelector('[role=dialog]').textContent).toContain('NEW-SKU');
  expect(container.querySelector('[role=dialog]').textContent).not.toContain('OLD-SKU');
});
