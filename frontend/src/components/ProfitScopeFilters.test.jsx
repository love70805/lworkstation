// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import ProfitScopeFilters from './ProfitScopeFilters';
import { saveSupplierGroup, rememberSupplierGroupSelection } from '../lib/importSupplierGroups';
import { filterProfitRowsByScope } from '../lib/profitFilter';

let root, container, selection, filterSnapshot;
function Harness({ suppliers = ['A-FFFV', 'B-KPX'], workspaceId = 'W', scopeRows = suppliers.map(supplierNumber => ({ store: '甲店', supplierNumber })) }) {
  const [filter, setFilter] = useState({ storeFilter: 'all', supplierSelection: null, skuQuery: '' });
  selection = filter.supplierSelection;
  filterSnapshot = filter;
  return <ProfitScopeFilters filter={filter} suppliers={suppliers} workspaceId={workspaceId} scopeRows={scopeRows} onChange={update => setFilter(value => ({ ...value, ...update }))} />;
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); saveSupplierGroup('W', { name: 'FFFV', aliases: ['FFFV'], mode: 'fuzzy' }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async props => act(async () => root.render(<Harness {...props} />));
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => act(async () => button(text).click());
const open = async () => act(async () => container.querySelector('[aria-label="按供方货号筛选"]').click());

it('removes stale group feedback on manual all or empty selection while retaining their distinct scope meanings', async () => {
  await render(); await open(); await click('FFFV');
  expect(selection).toEqual(['A-FFFV']);
  expect(container.textContent).toContain('当前范围匹配 1 个');
  await click('全部货号');
  expect(selection).toBeNull();
  expect(button('FFFV').getAttribute('aria-pressed')).toBe('false');
  expect(container.textContent).not.toContain('当前范围匹配 1 个');
  await click('FFFV'); await click('清空选择');
  expect(selection).toEqual([]);
  expect(button('FFFV').getAttribute('aria-pressed')).toBe('false');
});

it('clears old group feedback after a scope change without silently expanding a missing selection', async () => {
  await render(); await open(); await click('FFFV');
  await render({ suppliers: ['B-KPX'] });
  expect(selection).toEqual(['A-FFFV']);
  expect(container.textContent).not.toContain('当前范围匹配 1 个');
  expect(button('FFFV').getAttribute('aria-pressed')).toBe('false');
  expect(container.textContent).toContain('已选但当前店铺/账本未出现 1 个');
  await click('FFFV');
  expect(selection).toEqual([]);
  expect(container.textContent).toContain('保持空选');
});

it('keeps same-number store exceptions through group application and later manual selection', async () => {
  const group = saveSupplierGroup('W',{name:'KPX',aliases:['KPXX'],mode:'fuzzy'});
  rememberSupplierGroupSelection('W',[
    {storeName:'甲店',supplierGroupRule:group,facets:{supplierNumbers:['A-KPX','B-KPX']},filterOptions:{supplierNumbers:[]}},
    {storeName:'乙店',supplierGroupRule:group,facets:{supplierNumbers:['A-KPX','B-KPX']},filterOptions:{supplierNumbers:['A-KPX']}},
  ]);
  const rows = ['甲店','乙店'].flatMap(store=>['A-KPX','B-KPX'].map(supplierNumber=>({store,supplierNumber})));
  await render({suppliers:['A-KPX','B-KPX'],scopeRows:rows}); await open(); await click('KPX');
  expect(filterProfitRowsByScope(rows,filterSnapshot)).toEqual([{store:'乙店',supplierNumber:'A-KPX'}]);
  await act(async()=>Simulate.change(container.querySelector('.supplier-filter-table .search-input input'),{target:{value:'B-KPX'}}));
  await click('选中筛选结果');
  expect(filterProfitRowsByScope(rows,filterSnapshot)).toEqual([{store:'甲店',supplierNumber:'B-KPX'},{store:'乙店',supplierNumber:'A-KPX'},{store:'乙店',supplierNumber:'B-KPX'}]);
  await click('全部货号');
  expect(filterSnapshot.supplierSelection).toBeNull();
  expect(filterSnapshot.supplierStoreSelection).toBeUndefined();
  expect(filterProfitRowsByScope(rows,filterSnapshot)).toEqual(rows);
  await click('KPX'); await click('清空选择');
  expect(filterProfitRowsByScope(rows,filterSnapshot)).toEqual([]);
});
