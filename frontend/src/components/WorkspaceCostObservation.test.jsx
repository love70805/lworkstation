// @vitest-environment happy-dom
import { act } from 'react';
import 'fake-indexeddb/auto';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkspaceCostObservation from './WorkspaceCostObservation';
import { getSelectionReferenceSnapshot } from '../data/database';
vi.mock('../data/database', () => ({ getSelectionReferenceSnapshot: vi.fn() }));
let root, host;
const rows = [{ id: 'S', platformSku: '合成SKU', platformSkc: '合成SKC', latestLedgerId: 'L/1', referenceUnitCost: 0.000001, latestProfit: 0 }];
async function open(value) {
  await act(async () => { const details = host.querySelector('details'); details.open = value; details.dispatchEvent(new Event('toggle')); });
}
async function waitFor(selector) {
  await vi.waitFor(async () => {
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    expect(host.querySelector(selector)).toBeTruthy();
  });
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks();
  getSelectionReferenceSnapshot.mockResolvedValue({ computedReferenceRows: rows });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

it('defers heavy reference reads until expanded, releases the view on close and preserves navigation', async () => {
  const navigate = vi.fn();
  await act(async () => root.render(<WorkspaceCostObservation refresh={0} navigate={navigate} />));
  expect(getSelectionReferenceSnapshot).not.toHaveBeenCalled();
  expect(host.querySelector('details').open).toBe(false);
  await open(true);
  await waitFor('.reference-mini-row');
  expect(getSelectionReferenceSnapshot).toHaveBeenCalledWith({ compact: true });
  await act(async () => host.querySelector('.reference-mini-row').click());
  expect(navigate).toHaveBeenCalledWith('/profit?ledger=L%2F1');
  await open(false); expect(host.querySelector('.reference-mini-row')).toBeNull();
  const calls = getSelectionReferenceSnapshot.mock.calls.length;
  await act(async () => root.render(<WorkspaceCostObservation refresh={1} navigate={navigate} />));
  expect(getSelectionReferenceSnapshot).toHaveBeenCalledTimes(calls);
});

it('shows loading and a retryable error without blocking overview rendering', async () => {
  let reject;
  getSelectionReferenceSnapshot.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await act(async () => root.render(<WorkspaceCostObservation refresh={0} navigate={vi.fn()} />));
  await open(true);
  expect(host.querySelector('[role=status]').textContent).toContain('正在读取');
  await vi.waitFor(() => expect(typeof reject).toBe('function'));
  await act(async () => reject(Error('隔离测试读取失败')));
  await waitFor('[role=alert]');
  await act(async () => host.querySelector('[role=alert] button').click());
  await waitFor('.reference-mini-row');
});
