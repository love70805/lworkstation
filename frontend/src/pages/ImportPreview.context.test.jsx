// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ImportPreview from './ImportPreview';
import { ToastProvider } from '../components/UI';
import { importReturnHref } from '../lib/importNavigation';
import { buildProfitQuery, filterProfitRowsByScope, readProfitFilter } from '../lib/profitFilter';
const mocks = vi.hoisted(() => ({ member: vi.fn(), ledgers: vi.fn() }));
vi.mock('../data/database', () => ({ getActiveMemberContext: mocks.member, listLedgerSummaries: mocks.ledgers, previewSalesImports: vi.fn(), saveSalesImports: vi.fn() }));
vi.mock('../lib/importWorkerClient', () => ({ createImportWorkerClient: () => ({ terminate() {} }) }));
let root, host;
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
async function mount(id, search = '?ledger=' + id + '&store=A&q=sku') {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.member.mockResolvedValue({ workspaceId: 'w' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <ToastProvider><ImportPreview /><Location /></ToastProvider> }], { initialEntries: [{ pathname: '/import-preview', search, state: { importReturnTo: '/workspace' + search } }] })} />));
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
it('holds the selected ledger month and returns to the original page and filters', async () => {
  mocks.ledgers.mockResolvedValue([{ id: 'june', workspaceId: 'w', period: '2026-06', status: 'cost_pending' }]);
  await mount('june');
  expect(host.querySelector('#ledger-period').value).toBe('2026-06');
  expect(host.querySelector('#ledger-period').disabled).toBe(true);
  await act(async () => host.querySelector('.wizard-topbar button').click());
  expect(host.querySelector('output').textContent).toBe('/workspace?ledger=june&store=A&q=sku');
});
it.each([[], [{ id: 'june', workspaceId: 'other', period: '2026-06' }], [{ id: 'june', workspaceId: 'w', period: '2026-06', status: 'finalized' }]])('blocks invalid or frozen ledger context without falling back', async ledgers => {
  mocks.ledgers.mockResolvedValue(ledgers);
  await mount('june');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector('#ledger-period').value).toBe('');
  expect(host.querySelector('.batch-fieldset').disabled).toBe(true);
});
it('only accepts internal return destinations and replaces the new ledger id', () => {
  expect(importReturnHref('ledger=june&store=A', 'https://example.com', 'new')).toBe('/profit?ledger=new&store=A');
  expect(importReturnHref('ledger=june', '/workspace?ledger=june&store=A&supplier=X', 'new')).toBe('/workspace?ledger=new&store=A&supplier=X');
});

it('returns from a cancelled import with the verified per-store selection intact', async () => {
  const rows = [{ store: '甲店', supplierNumber: 'DEMO-X' }, { store: '乙店', supplierNumber: 'DEMO-X' }];
  const query = buildProfitQuery({ ledgerId: 'june', workspaceId: 'w', supplierSelection: ['DEMO-X'], supplierStoreSelection: [rows[1]] });
  mocks.ledgers.mockResolvedValue([{ id: 'june', workspaceId: 'w', period: '2026-06', status: 'cost_pending' }]);
  await mount('june', '?' + query);
  await act(async () => host.querySelector('.wizard-topbar button').click());
  const target = new URL(host.querySelector('output').textContent, 'https://example.invalid');
  expect(target.pathname).toBe('/workspace');
  expect(target.searchParams.get('supplier_scope')).toBe(query.get('supplier_scope'));
  expect(filterProfitRowsByScope(rows, readProfitFilter(target.searchParams, 'june', { workspaceId: 'w' }))).toEqual([rows[1]]);
});
