// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useErpInboxEvidence } from './useErpInboxEvidence';

const read = vi.hoisted(() => vi.fn());
vi.mock('../data/database', () => ({ getErpCostInbox: read }));
let root, container;
const summary = (id, extra = {}) => ({ id, workspaceId: 'W', ledgerId: 'L', displayOnly: true, ...extra });
function Probe({ receipt }) {
  const value = useErpInboxEvidence(receipt);
  return <div>{value.loading ? 'loading' : value.error ?? value.inbox?.evidence ?? 'closed'}</div>;
}
const render = receipt => act(async () => { root.render(<Probe receipt={receipt} />); await new Promise(resolve => setTimeout(resolve, 20)); });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  read.mockReset(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('does not read any evidence until opened, and does not retain a previous receipt while switching', async () => {
  await render(null); expect(read).not.toHaveBeenCalled();
  let finishA;
  read.mockImplementation(id => id === 'A' ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve({ id, workspaceId: 'W', ledgerId: 'L', evidence: 'B original' }));
  await render(summary('A')); expect(container.textContent).toBe('loading');
  await render(summary('B'));
  await act(async () => { finishA({ id: 'A', workspaceId: 'W', ledgerId: 'L', evidence: 'stale A' }); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(container.textContent).toBe('B original');
  await render(null); expect(container.textContent).toBe('closed'); expect(read).toHaveBeenCalledTimes(2);
});

it('rereads equal-ID changes and surfaces read failures or foreign originals', async () => {
  read.mockResolvedValue({ id: 'A', workspaceId: 'W', ledgerId: 'L', evidence: 'first' });
  await render(summary('A')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(container.textContent).toBe('first');
  read.mockRejectedValue(new Error('synthetic read failure'));
  await render(summary('A', { status: 'applied' })); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(container.textContent).toBe('synthetic read failure');
  read.mockResolvedValue({ id: 'B', workspaceId: 'OTHER', ledgerId: 'L', evidence: 'foreign' });
  await render(summary('B')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(container.textContent).toContain('不属于当前账本');
});
