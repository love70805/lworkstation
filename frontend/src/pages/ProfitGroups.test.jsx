// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProfitGroups from './ProfitGroups';

const columns = [{ accessorKey: 'id', header: '平台 SKU', cell: ({ getValue }) => getValue() }];
function makeGroup(index, count = 1) {
  return {
    id: String(index), store: '甲', platformSkc: `SKC${index}`, groupSkc: `SKC${index}`,
    skuCount: count, qty: count, revenue: 10, finalizable: false,
    variants: Array.from({ length: count }, (_, variant) => ({ id: `SKU${index}-${variant + 1}` })),
  };
}

let root, host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const click = element => act(async () => element.click());
const render = props => act(async () => root.render(<ProfitGroups columns={columns} prepareRows={rows => rows} {...props} />));

it('shares a header across groups, keeps collapsed rows unmounted and restores the first page for a missing-cost request', async () => {
  const groups = Array.from({ length: 30 }, (_, index) => makeGroup(index));
  const prepareRows = vi.fn(rows => rows);
  await render({ groups, prepareRows });
  expect(host.querySelectorAll('thead')).toHaveLength(1);
  expect(host.querySelectorAll('tbody')).toHaveLength(12);
  expect(prepareRows).not.toHaveBeenCalled();

  const groupButton = host.querySelector('.profit-group-toggle');
  expect(groupButton.tagName).toBe('BUTTON');
  expect(groupButton.getAttribute('aria-expanded')).toBe('false');
  await click(groupButton);
  expect(groupButton.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('.profit-variant-row').textContent).toBe('SKU0-1');
  const list = host.querySelector('.profit-groups-list');
  list.scrollIntoView = vi.fn();
  const area = list.querySelector('.table-wrap');
  area.scrollLeft = 60;
  const pages = host.querySelector('.profit-groups-pagination');
  expect(pages.textContent).toContain('共 30 个分组');
  await click(pages.querySelector('button:last-child'));
  expect(list.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
  expect(area.scrollLeft).toBe(60);
  expect(host.querySelector('.profit-group-toggle').textContent).toContain('SKC12');
  expect(host.querySelector('.profit-variant-row')).toBeNull();

  await render({ groups, prepareRows, expandRequest: 1 });
  expect(host.querySelector('.profit-group-toggle').textContent).toContain('SKC0');
  expect(host.querySelectorAll('.profit-variant-row')).toHaveLength(12);
  expect(host.querySelectorAll('table')).toHaveLength(1);
  await click(host.querySelector('.profit-group-toggle'));
  expect(host.querySelectorAll('.profit-variant-row')).toHaveLength(11);
  await render({ groups, prepareRows, expandRequest: 2 });
  expect(host.querySelectorAll('.profit-variant-row')).toHaveLength(12);
});

it('pages large groups separately and uses the same column layout for every visible detail', async () => {
  const groups = [makeGroup(1, 43), makeGroup(2, 3)];
  groups[1].platformSkc = '';
  groups[1].supplierNumber = '供方-2';
  const allColumns = [...columns, { id: 'store', header: '店铺', cell: () => '甲' }];
  await render({ groups, columns: allColumns, showAllColumns: true });
  const [first, second] = host.querySelectorAll('tbody');
  expect(host.querySelectorAll('thead th')).toHaveLength(2);
  expect(first.querySelector('th[scope="rowgroup"]').colSpan).toBe(2);
  expect(first.querySelectorAll('.profit-variant-row')).toHaveLength(20);
  expect(second.querySelectorAll('.profit-variant-row')).toHaveLength(3);
  expect(second.querySelector('.profit-group-toggle strong').textContent).toContain('供方货号 供方-2');
  expect(first.querySelector('.profit-variant-row').cells).toHaveLength(2);

  const page = first.querySelector('select');
  first.scrollIntoView = vi.fn();
  await act(async () => { page.value = '2'; page.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(first.querySelectorAll('.profit-variant-row')).toHaveLength(3);
  expect(first.querySelector('.profit-variant-row').cells[0].textContent).toBe('SKU1-41');
  expect(first.textContent).toContain('SKU1-43');
  expect(second.textContent).toContain('SKU2-1');
  expect(first.scrollIntoView).toHaveBeenCalledOnce();

  await render({ groups });
  expect(host.querySelectorAll('thead th')).toHaveLength(1);
  expect(first.querySelector('th[scope="rowgroup"]').colSpan).toBe(1);
  expect(first.querySelector('.profit-variant-row').cells).toHaveLength(1);
});
