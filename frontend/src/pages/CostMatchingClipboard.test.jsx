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
async function render(skcs, status = 'ready', { costs = [], initialEntry = '/', ledgerId = 'L', stores = [], contextStore = 'all' } = {}) {
  mocks.snapshot = {
    ledger: { id: ledgerId, workspaceId: 'W', period: '2026-08', status },
    rows: skcs.map((platformSkc, index) => ({ workspaceId: 'W', ledgerId, store: stores[index] ?? '甲', platformSkc, platformSku: `SKU-${index}`, quantity: 1, amount: 10 })),
    costs, approvals: [],
  };
  await act(async () => root.render(<MemoryRouter initialEntries={[initialEntry]}><CostMatchingContent validatedContext={{ workspaceId: 'W', ledgerId, store: contextStore }} /></MemoryRouter>));
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
it('keeps ERP request scope at the full ledger while store filtering changes only the display and copied SKCs', async () => {
  await render(['SKC-A', 'SKC-B'], 'ready', { ledgerId: 'FULL-SCOPE', stores: ['甲', '乙'], contextStore: '甲' });
  expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
    platformSkcs: ['SKC-A', 'SKC-B'],
    expectedSkus: expect.arrayContaining([{ platformSku: 'SKU-0', platformSkc: 'SKC-A' }, { platformSku: 'SKU-1', platformSkc: 'SKC-B' }]),
  }), expect.any(Object));
  expect(container.textContent).toContain('当前查看平台 SKU1');
  await act(async () => button('复制 1 个平台 SKC').click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith('SKC-A');
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
const formalCost = {
  id: 'COST-1', platformSku: 'SKU-0', platformSkc: 'SKC-1', warehouseSku: 'WH-1', unitCost: 10,
  publishedAt: '2026-09-01T00:00:00Z', resolutionStatus: 'resolved', evidenceComplete: true,
  selectedRecordIds: ['P-1'], purchaseRecords: [{ recordId: 'P-1', warehouseSku: 'WH-1', purchaseDate: '2026-08-10', quantity: 1, unitPrice: 10, eligible: true }],
};
it('shows adopted ERP and never offers adoption without a new evidence batch', async () => {
  await render(['SKC-1'], 'ready', { costs: [formalCost], ledgerId: 'ADOPTED' });
  expect(container.textContent).toContain('ERP 已采用');
  expect(container.textContent).toContain('2026/9/1');
  expect(button('采用已匹配 ERP 成本')).toBeUndefined();
  expect(button('完成成本处置后可采用')).toBeUndefined();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it.each([
  { initialEntry: '/?missing=1', costs: [formalCost], title: '本月成本已齐' },
  { initialEntry: '/?q=does-not-exist', costs: [], title: '当前筛选没有匹配明细' },
])('does not mistake an empty filter for missing SKC: $title', async ({ initialEntry, costs, title }) => {
  await render(['SKC-1'], 'ready', { initialEntry, costs, ledgerId: initialEntry });
  expect(container.textContent).toContain(title);
  expect(container.querySelector('.cost-skc-warning')).toBeNull();
  expect(button('检查导入映射')).toBeUndefined();
  expect(button('待补平台 SKC')).toBeUndefined();
});
it('keeps page two after an effective-cost update and leaving and returning', async () => {
  const skcs = Array.from({ length: 20 }, (_, index) => `SKC-${index + 1}`);
  const options = { ledgerId: 'PAGINATION' };
  await render(skcs, 'cost_pending', options);
  await act(async () => container.querySelector('[aria-label="第 2 页"]').click());
  expect(container.textContent).toContain('显示第 13 至 20 条');
  await render(skcs, 'cost_pending', { ...options, costs: [formalCost] });
  expect(container.textContent).toContain('显示第 13 至 20 条');
  await act(async () => root.render(null));
  await render(skcs, 'cost_pending', options);
  expect(container.textContent).toContain('显示第 13 至 20 条');
});
