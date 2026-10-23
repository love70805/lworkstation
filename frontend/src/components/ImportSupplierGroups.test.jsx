// @vitest-environment happy-dom
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ImportSupplierGroups from './ImportSupplierGroups';
import { readSupplierGroups, saveSupplierGroup, rememberSupplierGroupSelection } from '../lib/importSupplierGroups';

let root, container, onApply;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); onApply = vi.fn(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => act(async () => button(text).click());
const change = async (node, value) => act(async () => Simulate.change(node, { target: { value } }));
const render = async props => act(async () => root.render(<ImportSupplierGroups workspaceId="W" aliasesText="HHHX" mode="fuzzy" onApply={onApply} {...props} />));

it('uses the keyword as the default name and keeps saving separate from applying the group', async () => {
  await render();
  expect(container.querySelector('#supplier-group-name')).toBeNull();
  await click('保存为常用组');
  expect(container.querySelector('#supplier-group-name').value).toBe('HHHX');
  await click('保存货号组');
  const group = readSupplierGroups('W').groups[0];
  expect(group).toMatchObject({ name: 'HHHX', aliases: ['HHHX'], mode: 'fuzzy' });
  expect(readSupplierGroups('W').lastAppliedId).toBe('');
  expect(onApply).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('HHHX · HHHX');
  await click('HHHX');
  expect(onApply).toHaveBeenCalledWith(group);
});

it('keeps group identity and successful store exceptions when only renaming, and cancels edits without writing', async () => {
  const group = saveSupplierGroup('W', { name: 'HHHX', aliases: ['HHHX'], mode: 'fuzzy' });
  rememberSupplierGroupSelection('W', [{ storeName: '甲店', supplierGroupRule: group, facets: { supplierNumbers: ['A-HHHX', 'B-HHHX'] }, filterOptions: { supplierNumbers: ['A-HHHX'] } }]);
  const before = readSupplierGroups('W');
  await render({ activeId: group.id });
  await click('管理常用组');
  expect([...container.querySelectorAll('option')].map(node => node.textContent)).toContain('HHHX');
  await change(container.querySelector('#supplier-group-name'), '负责货号');
  await click('取消');
  expect(readSupplierGroups('W')).toEqual(before);
  await click('管理常用组'); await change(container.querySelector('#supplier-group-name'), '负责货号'); await click('保存修改');
  expect(readSupplierGroups('W')).toEqual({ ...before, groups: [{ ...group, name: '负责货号' }] });
  expect(onApply).not.toHaveBeenCalled();
  expect(button('负责货号').getAttribute('aria-pressed')).toBe('true');
});

it('retains inputs on duplicate or storage failure and requires an explicit delete without touching current selections', async () => {
  const group = saveSupplierGroup('W', { name: 'HHHX', aliases: ['HHHX'], mode: 'fuzzy' });
  await render(); await click('保存为常用组'); await click('保存货号组');
  expect(container.querySelector('[role=alert]').textContent).toContain('同名');
  await change(container.querySelector('#supplier-group-name'), '新名称');
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  await click('保存货号组');
  expect(container.querySelector('[role=alert]').textContent).toContain('填写内容和本次选择已保留');
  expect(container.querySelector('#supplier-group-name').value).toBe('新名称');
  write.mockRestore(); await click('取消');
  await click('管理常用组'); await click('删除这个组'); await click('保留这个组');
  expect(readSupplierGroups('W').groups).toEqual([group]);
  await click('删除这个组'); await click('确认删除');
  expect(readSupplierGroups('W').groups).toEqual([]);
  expect(onApply).not.toHaveBeenCalled();
});

it('isolates management from the active match and closes a stale editor when the workspace changes', async () => {
  const group = saveSupplierGroup('W', { name: '原组', aliases: ['HHHX'], mode: 'fuzzy' });
  await render({ activeId: group.id }); await click('管理常用组');
  await change(container.querySelector('.supplier-group-editor details input'), 'LBY'); await click('保存修改');
  expect(readSupplierGroups('W').groups[0].aliases).toEqual(['LBY']);
  expect(button('原组').getAttribute('aria-pressed')).toBe('false');
  expect(onApply).not.toHaveBeenCalled();
  await click('管理常用组'); await change(container.querySelector('#supplier-group-name'), '未保存');
  await render({ workspaceId: 'OTHER' });
  expect(container.querySelector('[role=dialog]')).toBeNull();
  expect(readSupplierGroups('OTHER').groups).toEqual([]);
  expect(readSupplierGroups('W').groups[0].name).toBe('原组');
});
