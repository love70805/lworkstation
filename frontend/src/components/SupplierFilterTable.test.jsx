// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import SupplierFilterTable from './SupplierFilterTable';
let root, container, selected;
const numbers = ['0001-KPX', '０００２-ｋｐｘｘ', '0003-OTHER'];
function Harness() {
  const [choices, setChoices] = useState([]); selected = choices;
  return <SupplierFilterTable compact rows={numbers.map(supplierNumber => ({ key: supplierNumber, supplierNumber, selected: choices.includes(supplierNumber) }))} onSelect={(rows, checked) => setChoices(previous => checked ? [...new Set([...previous, ...rows.map(row => row.supplierNumber)])] : previous.filter(value => !rows.some(row => row.supplierNumber === value)))} />;
}
beforeEach(async () => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(<Harness />)); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const change = async (node, value) => act(async () => Simulate.change(node, { target: { value } }));
const click = async text => act(async () => [...container.querySelectorAll('button')].find(node => node.textContent === text).click());
it('searches without changing selection, selects matching original codes and respects exact mode', async () => {
  await change(container.querySelector('.search-input input'), 'KPXX');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(selected).toEqual([]);
  await click('选中筛选结果');
  expect(selected).toEqual(numbers.slice(0, 2));
  await change(container.querySelector('[aria-label="货号清单识别方式"]'), 'exact');
  expect(container.textContent).toContain('没有匹配货号');
  expect(selected).toEqual(numbers.slice(0, 2));
  await change(container.querySelector('.search-input input'), '０００１-kpx');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
});
