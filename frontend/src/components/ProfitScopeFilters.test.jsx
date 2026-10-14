// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import ProfitScopeFilters from './ProfitScopeFilters';
import { saveSupplierGroup } from '../lib/importSupplierGroups';

let root, container, selection;
function Harness({ suppliers = ['A-HHHX', 'B-LBY'], workspaceId = 'W' }) {
  const [filter, setFilter] = useState({ storeFilter: 'all', supplierSelection: null, skuQuery: '' });
  selection = filter.supplierSelection;
  return <ProfitScopeFilters filter={filter} suppliers={suppliers} workspaceId={workspaceId} scopeRows={suppliers.map(supplierNumber => ({ store: '甲店', supplierNumber }))} onChange={update => setFilter(value => ({ ...value, ...update }))} />;
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); saveSupplierGroup('W', { name: 'HHHX', aliases: ['HHHX'], mode: 'suffix' }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async props => act(async () => root.render(<Harness {...props} />));
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => act(async () => button(text).click());
const open = async () => act(async () => container.querySelector('[aria-label="按供方货号筛选"]').click());

it('removes stale group feedback on manual all or empty selection while retaining their distinct scope meanings', async () => {
  await render(); await open(); await click('HHHX');
  expect(selection).toEqual(['A-HHHX']);
  expect(container.textContent).toContain('当前范围匹配 1 个');
  await click('全部货号');
  expect(selection).toBeNull();
  expect(button('HHHX').getAttribute('aria-pressed')).toBe('false');
  expect(container.textContent).not.toContain('当前范围匹配 1 个');
  await click('HHHX'); await click('清空选择');
  expect(selection).toEqual([]);
  expect(button('HHHX').getAttribute('aria-pressed')).toBe('false');
});

it('clears old group feedback after a scope change without silently expanding a missing selection', async () => {
  await render(); await open(); await click('HHHX');
  await render({ suppliers: ['B-LBY'] });
  expect(selection).toEqual(['A-HHHX']);
  expect(container.textContent).not.toContain('当前范围匹配 1 个');
  expect(button('HHHX').getAttribute('aria-pressed')).toBe('false');
  expect(container.textContent).toContain('已选但当前店铺/账本未出现 1 个');
  await click('HHHX');
  expect(selection).toEqual([]);
  expect(container.textContent).toContain('保持空选');
});
