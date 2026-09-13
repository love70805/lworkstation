// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CostMatchingContent } from './CostMatching';

const mocks = vi.hoisted(() => ({ snapshot: null, notify: vi.fn(), register: vi.fn(), publish: vi.fn() }));
vi.mock('../hooks/useLatestSalesImport', () => ({ useLatestSalesImport: () => mocks.snapshot }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (_query, _deps, initial) => initial }));
vi.mock('../components/UI', async importOriginal => ({ ...await importOriginal(), useToast: () => ({ notify: mocks.notify }) }));
vi.mock('../lib/autoErpRequest', async importOriginal => ({ ...await importOriginal(), ensureAutoErpRequest: mocks.register }));
vi.mock('../data/database', async importOriginal => ({ ...await importOriginal(), savePublishedErpCostBatch: mocks.publish }));

let container, root, writeText;
const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text);
async function render(skcs, status = 'ready') {
  mocks.snapshot = {
    ledger: { id: 'L', workspaceId: 'W', period: '2026-08', status },
    rows: skcs.map((platformSkc, index) => ({ store: '甲', platformSkc, platformSku: `SKU-${index}`, quantity: 1, amount: 10 })),
    costs: [], approvals: [],
  };
  await act(async () => root.render(<MemoryRouter><CostMatchingContent validatedContext={{ workspaceId: 'W', ledgerId: 'L', store: 'all' }} /></MemoryRouter>));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  mocks.notify.mockReset(); mocks.publish.mockReset(); mocks.register.mockReset().mockResolvedValue(null);
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
it.each([
  { skcs: [' 001234567890123456789 '], expected: '001234567890123456789', count: 1 },
  { skcs: ['SKC-Z', 'SKC-A', 'skc-z', ' SKC-A '], expected: 'SKC-Z\nSKC-A', count: 2 },
])('copies the actual single/multiple string list: $expected', async ({ skcs, expected, count }) => {
  await render(skcs);
  await act(async () => button(`复制 ${count} 个平台 SKC`).click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
  expect(mocks.notify).toHaveBeenCalledWith(`已复制 ${count} 个平台 SKC。`);
});
it.each(['finalized', 'locked'])('allows read-only copy in %s while cost writes and registration remain blocked', async status => {
  await render(['SKC-1'], status);
  expect(button('复制 1 个平台 SKC').disabled).toBe(false);
  await act(async () => button('复制 1 个平台 SKC').click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith('SKC-1');
  expect(button('账本已定稿').disabled).toBe(true);
  expect(container.querySelector('#manual-cost-actions')).toBeNull();
  await act(async () => button('手动导入').click());
  expect(container.querySelector('.cost-manual-textarea').disabled).toBe(true);
  expect(button('解析并核对').disabled).toBe(true);
  expect(button('导入成本文件').disabled).toBe(true);
  await act(async () => { button('账本已定稿').click(); button('解析并核对').click(); });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
});
it('reports failure and restores the copy button if both clipboard paths reject', async () => {
  writeText.mockRejectedValue(new Error('denied'));
  const fallback = vi.fn(() => false);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback });
  await render(['SKC-1']);
  await act(async () => button('复制 1 个平台 SKC').click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith('SKC-1');
  expect(fallback).toHaveBeenCalledWith('copy');
  expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('复制 SKC 失败'), 'error');
  expect(mocks.notify).not.toHaveBeenCalledWith('已复制 1 个平台 SKC。');
  expect(button('复制 1 个平台 SKC').disabled).toBe(false);
  delete document.execCommand;
});
