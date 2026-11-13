// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ProfitWorkspacePage from './ProfitWorkspacePage';
import { ToastProvider } from '../components/UI';
import { buildProfitQuery, filterProfitRowsByScope, readProfitFilter } from '../lib/profitFilter';

const mocks = vi.hoisted(() => ({ member: vi.fn(), ledgers: vi.fn(), rows: vi.fn(), targetRows: [] }));
vi.mock('../data/database', () => ({ getActiveMemberContext: mocks.member, listLedgerSummaries: mocks.ledgers }));
vi.mock('../data/repositories/ledgerReadCache', () => ({ readLedgerSalesRows: mocks.rows }));
vi.mock('../components/AppShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('./ProfitPanel', () => ({ ProfitViewsContent: ({ monthControl }) => <>{monthControl}<ScopeResult /></> }));

function ScopeResult() {
  const { search } = useLocation(), params = new URLSearchParams(search);
  const filter = readProfitFilter(params, params.get('ledger'), { workspaceId: 'W' });
  return <output data-search={search}>{JSON.stringify({ rows: filterProfitRowsByScope(mocks.targetRows, filter), error: filter.supplierScopeError })}</output>;
}
let root, host;
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

it.each([true, false])('month picker keeps per-store selection when the selected pair exists: %s', async present => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear();
  const excluded = { store: '甲店', supplierNumber: 'DEMO-X' }, included = { store: '乙店', supplierNumber: 'DEMO-X' };
  mocks.targetRows = present ? [excluded, included] : [excluded];
  mocks.member.mockResolvedValue({ workspaceId: 'W' });
  mocks.ledgers.mockResolvedValue([{ id: 'L1', workspaceId: 'W', period: '2026-08' }, { id: 'L2', workspaceId: 'W', period: '2026-09' }]);
  mocks.rows.mockResolvedValue(mocks.targetRows);
  const query = buildProfitQuery({ ledgerId: 'L1', workspaceId: 'W', supplierSelection: ['DEMO-X'], supplierStoreSelection: [included] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/profit?' + query]}><ToastProvider><ProfitWorkspacePage /></ToastProvider></MemoryRouter>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  const picker = host.querySelector('select[aria-label="核算月份"]');
  expect(picker).not.toBeNull();
  await act(async () => { picker.value = 'L2'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  const output = host.querySelector('output');
  expect(JSON.parse(output.textContent)).toEqual({ rows: present ? [included] : [] });
  const next = new URLSearchParams(output.getAttribute('data-search'));
  expect(next.get('ledger')).toBe('L2');
  expect(next.get('supplier_scope')).not.toBe(query.get('supplier_scope'));
  expect(readProfitFilter(next, 'L1', { workspaceId: 'W' })).toMatchObject({ supplierSelection: [], supplierScopeError: expect.any(String) });
  expect(mocks.rows).toHaveBeenCalledWith('W', 'L2', { strict: true });
});

it.each([
  { ledger: null, withScope: true },
  { ledger: '', withScope: true },
  { ledger: null, withScope: false },
])('defaults the profit ledger safely for entry %j', async ({ ledger, withScope }) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  const rows = [{ store: '甲店', supplierNumber: 'DEMO-X' }, { store: '乙店', supplierNumber: 'DEMO-X' }];
  mocks.targetRows = rows;
  mocks.member.mockResolvedValue({ workspaceId: 'W' });
  mocks.ledgers.mockResolvedValue([{ id: 'L1', workspaceId: 'W', period: '2026-08' }, { id: 'L2', workspaceId: 'W', period: '2026-09' }]);
  const query = withScope ? buildProfitQuery({ ledgerId: 'L1', workspaceId: 'W', supplierSelection: ['DEMO-X'], supplierStoreSelection: [rows[1]] }) : new URLSearchParams();
  if (ledger === null) query.delete('ledger');
  else query.set('ledger', ledger);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/profit?' + query]}><ToastProvider><ProfitWorkspacePage /></ToastProvider></MemoryRouter>));
  for (let attempt = 0; attempt < 50; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    if (host.querySelector('select[aria-label="核算月份"]')) break;
  }
  expect(host.querySelector('select[aria-label="核算月份"]')).not.toBeNull();
  const output = host.querySelector('output'), params = new URLSearchParams(output.getAttribute('data-search'));
  expect(params.get('ledger')).toBe('L1');
  expect(params.get('supplier_scope')).toBe(withScope ? 'unavailable' : null);
  expect(JSON.parse(output.textContent)).toEqual(withScope
    ? { rows: [], error: '货号范围引用已失效或不属于当前账本，请重新选择货号。' }
    : { rows });
});
