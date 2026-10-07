// @vitest-environment happy-dom
import { act, useState } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import ImportSupplierPicker from './ImportSupplierPicker';
let root, container, state;
function Harness(props) {
  const [selected, setSelected] = useState(props.selected ?? []), [keywords, setKeywords] = useState(props.keywords ?? []);
  state = {selected,keywords};
  return <ImportSupplierPicker {...props} store="甲店" selected={selected} keywords={keywords} onChange={setSelected} onKeywordsChange={setKeywords} />;
}
beforeEach(()=>{ globalThis.IS_REACT_ACT_ENVIRONMENT=true; container=document.createElement('div');document.body.append(container);root=createRoot(container); });
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button = text => [...container.querySelectorAll('button')].find(node=>node.textContent===text);
async function click(text) {await act(async()=>button(text).click());}
async function input(value) {await act(async()=>Simulate.change(container.querySelector('.import-supplier-picker > input'),{target:{value}}));}
it('edits keywords without changing selections and explicitly adds/removes deduplicated matching goods', async()=>{
  await act(async()=>root.render(<Harness choices={['HHHX-1','LYYY-1','HHHX-LYYY','other']} selected={['other']} />));
  expect(button('选中匹配货号').disabled).toBe(true);
  await input('ｈｈｈｘ，lyyy');
  expect(state.selected).toEqual(['other']);
  expect(container.textContent).toContain('匹配 3 个');
  await click('选中匹配货号');
  expect(state.selected).toEqual(['HHHX-1','HHHX-LYYY','LYYY-1','other']);
  await input('HHHX'); await click('取消匹配货号');
  expect(state.selected).toEqual(['LYYY-1','other']);
  await input(''); expect(button('取消匹配货号').disabled).toBe(true);
});
it('shows new matches separately and does not recommend previously excluded goods', async()=>{
  await act(async()=>root.render(<Harness choices={['A-1','A-2','A-3']} selected={['A-1']} keywords={['A']} previousMatches={['A-1','A-2']} hasSaved />));
  expect(container.textContent).toContain('发现 1 个新增匹配');
  await click('一键加入新增匹配项');
  expect(state.selected).toEqual(['A-1','A-3']);
  expect(button('一键加入新增匹配项')).toBeUndefined();
});
it('keeps a bounded DOM for 10000 goods and reaches final goods with keyboard navigation', async()=>{
  const choices=Array.from({length:10000},(_,i)=>`GOODS-${String(i).padStart(5,'0')}`);
  await act(async()=>root.render(<Harness choices={choices} />));
  expect(container.querySelectorAll('[role=option]').length).toBeLessThan(20);
  const list=container.querySelector('[role=listbox]');
  await act(async()=>Simulate.keyDown(list,{key:'End'}));
  expect(container.querySelector(`#${CSS.escape(list.getAttribute('aria-activedescendant'))}`).textContent).toContain('GOODS-09999');
  await act(async()=>Simulate.keyDown(list,{key:' '}));
  expect(state.selected).toEqual(['GOODS-09999']);
  await click('已选 (1)');
  expect(container.querySelectorAll('[role=option]')).toHaveLength(1);
});
it('pastes exact full identities, reports absent goods, and does not interpret complete codes as keywords', async()=>{
  await act(async()=>root.render(<Harness choices={['A-1','A-2']} />));
  await act(async()=>Simulate.change(container.querySelector('textarea'),{target:{value:'A-1\nA; absent'}}));
  await click('添加匹配货号');
  expect(state.selected).toEqual(['A-1']);
  expect(container.textContent).toContain('文件中未找到：A、absent');
  expect(state.keywords).toEqual([]);
});
