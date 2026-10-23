// @vitest-environment happy-dom
import { act, useState } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ImportSupplierWorkbench from './ImportSupplierWorkbench';

const initialRule = { aliases: ['FFFV'], mode: 'fuzzy' };
const initialFiles = [{ itemId: 'F', storeName: '甲店', status: 'parsed', facets: { supplierNumbers: ['A-FFFV', 'B-KPX', 'MANUAL'] }, filterOptions: { supplierNumbers: ['A-FFFV', 'MANUAL'] } }];
let root, container, snapshot, apply, members;
function Harness({ startingEmpty = false }) {
  const [aliasesText, onAliasesChange] = useState(startingEmpty ? '' : 'FFFV'), [mode, onModeChange] = useState('fuzzy'), [files, setFiles] = useState(initialFiles), [rule, setRule] = useState(startingEmpty ? { aliases: [], mode: 'fuzzy' } : initialRule), [dirty, onDirtyChange] = useState(false), [viewStore, onViewStore] = useState('all');
  snapshot = { aliasesText, files, rule, dirty };
  return <ImportSupplierWorkbench files={files} workspaceId="W" period="2026-09" aliasesText={aliasesText} mode={mode} onAliasesChange={onAliasesChange} onModeChange={onModeChange} initialRule={rule} onDirtyChange={onDirtyChange} viewStore={viewStore} onViewStore={onViewStore} onMembers={members} onApply={(selection, next) => { apply(selection, next); setRule(next); setFiles(files.map(file => ({ ...file, filterOptions: { supplierNumbers: selection[file.itemId] } }))); }} />;
}
beforeEach(async () => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); apply = vi.fn(); members = vi.fn().mockResolvedValue({ rows: [], total: 0 }); await act(async () => root.render(<Harness />)); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => act(async () => button(text).click());
const input = async value => act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), { target: { value } }));

it('blocks applying stale matches after a rule edit and applies only the newly matched selection', async () => {
  expect(button('应用本次筛选').disabled).toBe(true);
  await input('KPX');
  expect(snapshot.dirty).toBe(true);
  expect(button('应用本次筛选').disabled).toBe(true);
  await click('应用本次筛选'); expect(apply).not.toHaveBeenCalled();
  expect(snapshot.files[0].filterOptions.supplierNumbers).toEqual(['A-FFFV', 'MANUAL']);
  await click('匹配货号'); await click('应用本次筛选');
  expect(apply).toHaveBeenCalledWith({ F: ['B-KPX'] }, { aliases: ['KPX'], mode: 'fuzzy' });
  expect(snapshot.dirty).toBe(false);
  expect(button('应用本次筛选').disabled).toBe(true);
});

it('clears matching conditions explicitly without clearing manually selected goods and can undo an unmatched edit', async () => {
  await input(''); expect(button('应用本次筛选').disabled).toBe(true);
  await click('清除匹配条件'); await click('应用本次筛选');
  expect(apply).toHaveBeenCalledWith({ F: ['A-FFFV', 'MANUAL'] }, { aliases: [], mode: 'fuzzy' });
  await input('UNKNOWN'); await click('撤销本次调整');
  expect(snapshot.aliasesText).toBe('');
  expect(snapshot.dirty).toBe(false);
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

it('does not block manual selection when the match mode changes with no keywords', async () => {
  await act(async () => root.render(<Harness key="empty" startingEmpty />));
  await act(async () => Simulate.change(container.querySelector('[aria-label="货号匹配方式"]'), { target: { value: 'exact' } }));
  expect(snapshot.dirty).toBe(false);
  await act(async () => container.querySelector('[aria-label="选择 甲店 B-KPX"]').click());
  expect(button('应用本次筛选').disabled).toBe(false);
  await click('应用本次筛选');
  expect(snapshot.files[0].filterOptions.supplierNumbers).toEqual(['A-FFFV', 'B-KPX', 'MANUAL']);
  expect(snapshot.dirty).toBe(false);
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
