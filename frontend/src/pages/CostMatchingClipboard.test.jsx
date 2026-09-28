// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CostMatchingContent } from './CostMatching';
import { costDraftKey } from '../lib/costMatchingDraft';

const mocks = vi.hoisted(() => ({ snapshot: null, inboxRecords: [], notify: vi.fn(), register: vi.fn(), publish: vi.fn(), retry: vi.fn() }));
vi.mock('../hooks/useLatestSalesImport', () => ({ useLatestSalesImport: () => mocks.snapshot }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query, _deps, initial) => query.toString().includes('listErpCostInbox') ? mocks.inboxRecords : initial }));
vi.mock('../components/UI', async importOriginal => ({ ...await importOriginal(), useToast: () => ({ notify: mocks.notify }) }));
vi.mock('../lib/autoErpRequest', async importOriginal => ({ ...await importOriginal(), ensureAutoErpRequest: mocks.register }));
vi.mock('../data/database', async importOriginal => ({ ...await importOriginal(), savePublishedErpCostBatch: mocks.publish, processErpCostInboxAdoption: mocks.retry }));

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
  mocks.inboxRecords = [];
  mocks.notify.mockReset(); mocks.publish.mockReset(); mocks.retry.mockReset(); mocks.register.mockReset().mockResolvedValue(null);
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
it('refreshes an open cost dialog when the formal ERP cost is adopted', async () => {
  await render(['SKC-1'], 'ready', { ledgerId: 'DIALOG-FRESH' });
  await act(async () => button('详情').click());
  expect(container.querySelector('.cost-detail-current')?.textContent).toContain('缺少有效成本');
  await render(['SKC-1'], 'ready', { ledgerId: 'DIALOG-FRESH', costs: [formalCost] });
  expect(container.querySelector('.cost-detail-current')?.textContent).toContain('10.0000 · ERP');
  expect(container.querySelector('.cost-detail-current')?.textContent).toContain('正式成本已生效');
});
it('opens adopted cost details without a correction form and offers correction as a separate action', async () => {
  await render(['SKC-1'], 'ready', { ledgerId: 'DETAILS-ONLY', costs: [formalCost] });
  await act(async () => button('详情').click());
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('成本详情');
  expect(container.querySelector('#manual-cost-value')).toBeNull();
  await act(async () => container.querySelector('.modal-footer button:last-child').click());
  expect(container.querySelector('#manual-cost-value')?.value).toBe('10');
  expect(container.querySelector('#manual-cost-reason')).not.toBeNull();
});
it.each(['finalized', 'locked'])('shows only details and preserves read-only cost evidence for %s', async status => {
  await render(['SKC-1'], status, { ledgerId: `DETAILS-${status}`, costs: [formalCost] });
  expect(container.querySelectorAll('.cost-match-row-actions button')).toHaveLength(1);
  await act(async () => button('详情').click());
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('已定稿或锁定');
  expect(container.querySelector('#manual-cost-value')).toBeNull();
  expect(button('人工更正')).toBeUndefined();
  expect(button('撤销当前更正')).toBeUndefined();
});
it('recognizes a restored draft already in the automatic inbox and explains its block', async () => {
  const ledgerId = 'RESTORED-INBOX';
  localStorage.setItem(costDraftKey(ledgerId), JSON.stringify({
    sourceText: '{}', batchEnvelope: { batchId: 'B-RESTORED', summary: { outputRowCount: 0, warehouseSkuCount: 0 } }, resolutions: [], updatedAt: Date.now(),
  }));
  mocks.inboxRecords = [{
    id: 'I-RESTORED', batchId: 'B-RESTORED', ledgerId, workspaceId: 'W',
    status: 'pending', receivedVia: 'restored-cost-draft', receivedAt: '2026-09-24T00:00:00Z',
    adoption: { version: 'erp-auto-adoption@1', state: 'blocked', reason: 'legacy_request_scope_missing', summary: { adoptedCount: 0, remainingCount: 1 } },
  }];
  await render(['SKC-1'], 'ready', { ledgerId });
  expect(container.textContent).toContain('旧请求无法从当前账本重建平台 SKU 范围');
  expect(button('采用手动批次成本')).toBeUndefined();
  expect(button('重试已处理异常')).toBeDefined();
});

it('shows durable automatic-adoption failures and retries through the validated backend without manual resolutions', async () => {
  const ledgerId = 'FAILED-AUTO';
  localStorage.setItem(costDraftKey(ledgerId), JSON.stringify({ sourceText: '{}', batchEnvelope: { batchId: 'B-FAILED', summary: { outputRowCount: 0, warehouseSkuCount: 0 } }, resolutions: [], updatedAt: Date.now() }));
  mocks.inboxRecords = [{ id: 'I-FAILED', batchId: 'B-FAILED', ledgerId, workspaceId: 'W', status: 'pending', receivedVia: 'desktop-inbox', receivedAt: '2026-09-28T00:00:00Z', adoptionFailure: { message: '隔离采用故障' } }];
  mocks.retry.mockResolvedValue({ status: 'pending', adoption: { summary: { adoptedCount: 0, remainingCount: 1 } } });
  await render(['SKC-1'], 'ready', { ledgerId });
  expect(container.textContent).toContain('ERP 自动采用未完成');
  expect(container.textContent).toContain('隔离采用故障');
  expect(button('重试自动采用').disabled).toBe(false);
  await act(async () => button('详情').click());
  expect(container.querySelector('.cost-detail-current').textContent).toContain('回传证据已保存');
  await act(async () => button('重试自动采用').click());
  expect(mocks.retry).toHaveBeenCalledExactlyOnceWith({ inboxId: 'I-FAILED', resolutions: [] });
  expect(mocks.publish).not.toHaveBeenCalled();
});

it.each(['rejected', 'voided'])('does not promise recovery or retry in details after a failed receipt becomes %s', async status => {
  const ledgerId = `FAILED-${status}`;
  localStorage.setItem(costDraftKey(ledgerId), JSON.stringify({ sourceText: '{}', batchEnvelope: { batchId: 'B-FAILED', summary: { outputRowCount: 0, warehouseSkuCount: 0 } }, resolutions: [], updatedAt: Date.now() }));
  mocks.inboxRecords = [{ id: 'I-FAILED', batchId: 'B-FAILED', ledgerId, workspaceId: 'W', status, receivedAt: '2026-09-28T00:00:00Z', adoptionFailure: { message: '历史故障' } }];
  await render(['SKC-1'], 'ready', { ledgerId });
  expect(button('重试自动采用')).toBeUndefined();
  await act(async () => button('详情').click());
  const detail = container.querySelector('.cost-detail-current').textContent;
  expect(detail).not.toContain('自动采用未完成');
  expect(detail).not.toContain('继续重试');
  expect(detail).not.toContain('历史故障');
  expect(mocks.retry).not.toHaveBeenCalled();
});

it('keeps a newer failed receipt visible while reviewing an older draft', async () => {
  const ledgerId = 'OLD-DRAFT-NEW-FAILURE';
  localStorage.setItem(costDraftKey(ledgerId), JSON.stringify({ sourceText: '{}', batchEnvelope: { batchId: 'B-OLD', summary: { outputRowCount: 0, warehouseSkuCount: 0 } }, resolutions: [], updatedAt: Date.now() }));
  mocks.inboxRecords = [
    { id: 'I-OLD', batchId: 'B-OLD', ledgerId, workspaceId: 'W', status: 'pending', receivedVia: 'desktop-inbox', receivedAt: '2026-09-27T00:00:00Z' },
    { id: 'I-NEW', batchId: 'B-NEW', ledgerId, workspaceId: 'W', status: 'pending', receivedVia: 'desktop-inbox', receivedAt: '2026-09-28T00:00:00Z', adoptionFailure: { message: '新批次隔离故障' } },
  ];
  await render(['SKC-1'], 'ready', { ledgerId });
  expect(container.textContent).toContain('较新的 ERP 回传自动采用未完成：新批次隔离故障');
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

it.each([{ skcs: [] }, { skcs: ['SKC-1'] }])('removes repeated desktop extension controls in empty and normal states: $skcs', async ({ skcs }) => {
  window.shopeersDesktopRuntime = { desktop: true };
  try {
    await render(skcs);
    expect(container.textContent).not.toContain('ERP 扩展状态');
    expect(container.textContent).not.toContain('安装 ERP 助手');
    expect(container.querySelector('.erp-assistant-modal')).toBeNull();
  } finally { delete window.shopeersDesktopRuntime; }
});

it.each([{ skcs: [] }, { skcs: ['SKC-1'] }])('preserves browser extension installation in empty and normal states: $skcs', async ({ skcs }) => {
  await render(skcs);
  expect(button('安装 ERP 助手')).toBeDefined();
  await act(async () => button('安装 ERP 助手').click());
  expect(container.querySelector('.erp-assistant-modal')).not.toBeNull();
});
