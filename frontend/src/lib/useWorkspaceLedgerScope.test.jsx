// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceLedgerScope } from './useWorkspaceLedgerScope';
import WorkspaceLedgerControls from '../components/WorkspaceLedgerControls';
import { buildProfitQuery, filterProfitRowsByScope, readProfitFilter } from './profitFilter';

const mocks = vi.hoisted(() => ({ member: vi.fn(), ledgers: vi.fn(), rows: vi.fn(), error: vi.fn(), targetRows: [] }));
vi.mock('../data/database', () => ({ getActiveMemberContext: mocks.member, listLedgerSummaries: mocks.ledgers }));
vi.mock('../data/repositories/ledgerReadCache', () => ({ readLedgerSalesRows: mocks.rows }));

function Harness() {
  const scope = useWorkspaceLedgerScope(), { search } = useLocation(), params = new URLSearchParams(search);
  const filter = readProfitFilter(params, params.get('ledger'), { workspaceId: 'W' });
  return <><WorkspaceLedgerControls scope={scope} onError={mocks.error} /><output data-search={search} data-scope-error={filter.supplierScopeError}>{JSON.stringify(filterProfitRowsByScope(mocks.targetRows, filter))}</output></>;
}
let root, host;
async function waitForReady() {
  for (let attempt = 0; attempt < 50; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    if (host.querySelector('select[aria-label="首页核算月份"]')) return;
  }
  expect(host.querySelector('select[aria-label="首页核算月份"]')).not.toBeNull();
}
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
async function mount({ failTargetRead = false, initialLedger = 'L1', withScope = true } = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  const rows = [{ store: '甲店', supplierNumber: 'DEMO-X' }, { store: '乙店', supplierNumber: 'DEMO-X' }];
  mocks.targetRows = rows;
  mocks.member.mockResolvedValue({ workspaceId: 'W' });
  mocks.ledgers.mockResolvedValue([{ id: 'L1', workspaceId: 'W', period: '2026-08' }, { id: 'L2', workspaceId: 'W', period: '2026-09' }]);
  mocks.rows.mockImplementation(async (_workspace, id) => {
    if (id === 'L2' && failTargetRead) throw Error('合成读取失败');
    return rows;
  });
  const query = withScope ? buildProfitQuery({ ledgerId: 'L1', workspaceId: 'W', supplierSelection: ['DEMO-X'], supplierStoreSelection: [rows[1]] }) : new URLSearchParams();
  if (initialLedger === null) query.delete('ledger');
  else query.set('ledger', initialLedger);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/workspace?' + query]}><Harness /></MemoryRouter>));
  await waitForReady();
  return rows;
}

it('normalizes the home query and rebinds its actual month picker without widening exclusions', async () => {
  const rows = await mount();
  expect(JSON.parse(host.querySelector('output').textContent)).toEqual([rows[1]]);
  const picker = host.querySelector('select[aria-label="首页核算月份"]');
  expect(picker).not.toBeNull();
  await act(async () => { picker.value = 'L2'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitForReady();
  const output = host.querySelector('output'), params = new URLSearchParams(output.getAttribute('data-search'));
  expect(params.get('ledger')).toBe('L2');
  expect(JSON.parse(output.textContent)).toEqual([rows[1]]);
  expect(readProfitFilter(params, 'L1', { workspaceId: 'W' })).toMatchObject({ supplierSelection: [], supplierScopeError: expect.any(String) });
  expect(mocks.rows).toHaveBeenCalledWith('W', 'L2', { strict: true });
  expect(mocks.error).not.toHaveBeenCalled();
});

it('keeps the previous month and scope when the target month cannot be read', async () => {
  const rows = await mount({ failTargetRead: true });
  expect(JSON.parse(host.querySelector('output').textContent)).toEqual([rows[1]]);
  const picker = host.querySelector('select[aria-label="首页核算月份"]');
  await act(async () => { picker.value = 'L2'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  const output = host.querySelector('output');
  expect(new URLSearchParams(output.getAttribute('data-search')).get('ledger')).toBe('L1');
  expect(JSON.parse(output.textContent)).toEqual([rows[1]]);
  expect(mocks.error).toHaveBeenCalledWith('合成读取失败');
  mocks.rows.mockResolvedValue(rows);
  const store = host.querySelector('select[aria-label="首页店铺"]');
  await act(async () => { store.value = '乙店'; store.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitForReady();
  expect(new URLSearchParams(host.querySelector('output').getAttribute('data-search')).get('ledger')).toBe('L1');
});

it.each([null, ''])('defaults the home ledger with an error and empty scope when the source ledger is %s', async initialLedger => {
  await mount({ initialLedger });
  const output = host.querySelector('output'), params = new URLSearchParams(output.getAttribute('data-search'));
  expect(params.get('ledger')).toBe('L1');
  expect(params.get('supplier_scope')).toBe('unavailable');
  expect(JSON.parse(output.textContent)).toEqual([]);
  expect(output.getAttribute('data-scope-error')).toBe('货号范围引用已失效或不属于当前账本，请重新选择货号。');
});

it('defaults an ordinary home entry to the first ledger and all rows', async () => {
  const rows = await mount({ initialLedger: null, withScope: false });
  const output = host.querySelector('output'), params = new URLSearchParams(output.getAttribute('data-search'));
  expect(params.get('ledger')).toBe('L1');
  expect(params.has('supplier_scope')).toBe(false);
  expect(JSON.parse(output.textContent)).toEqual(rows);
  expect(output.hasAttribute('data-scope-error')).toBe(false);
});
