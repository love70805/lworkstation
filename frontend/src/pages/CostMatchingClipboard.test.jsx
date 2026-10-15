// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CostMatchingContent } from './CostMatching';
import { costDraftKey } from '../lib/costMatchingDraft';
import { buildErpCostBatchEnvelope } from '../domain/erpCostBatchEnvelope';
import { buildErpCostInboxEnvelope } from '../domain/erpInboxContract';

const mocks = vi.hoisted(() => ({ snapshot: null, inboxRecords: [], requests: [], notify: vi.fn(), register: vi.fn(), cancel: vi.fn(), publish: vi.fn(), retry: vi.fn(), switchInbox: vi.fn(), readInbox: vi.fn(), saveManual: vi.fn(), revokeManual: vi.fn() }));
vi.mock('../data/repositories/profitRepository', async importOriginal => ({ ...await importOriginal(), saveManualCostOverride: mocks.saveManual, revokeManualCostOverride: mocks.revokeManual }));
vi.mock('../hooks/useErpCollectionTasks', () => ({ useErpCollectionTasks: () => ({ tasks: mocks.tasks ?? [], loading: false, error: '', refresh: () => {} }) }));
vi.mock('../hooks/useLatestSalesImport', () => ({ useLatestSalesImport: () => mocks.snapshot }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query, _deps, initial) => query.toString().includes('listErpCostInbox') ? mocks.inboxRecords : query.toString().includes('listErpCostRequests') ? mocks.requests : initial }));
vi.mock('../components/UI', async importOriginal => ({ ...await importOriginal(), useToast: () => ({ notify: mocks.notify }) }));
vi.mock('../lib/autoErpRequest', async importOriginal => ({ ...await importOriginal(), ensureAutoErpRequest: mocks.register, cancelAutoErpRequest: mocks.cancel }));
vi.mock('../data/repositories/erpCatalogRepository', () => ({ registerCostCatalogCompanion: vi.fn(async () => {}) }));
vi.mock('../data/database', async importOriginal => {
  const original = await importOriginal();
  return { ...original, savePublishedErpCostBatch: mocks.publish, processErpCostInboxAdoption: mocks.retry,
    switchLoadedErpCostInbox: (...args) => mocks.switchInbox.getMockImplementation() ? mocks.switchInbox(...args) : original.switchLoadedErpCostInbox(...args),
    getErpCostInbox: (...args) => mocks.readInbox.getMockImplementation() ? mocks.readInbox(...args) : original.getErpCostInbox(...args),
  };
});

let container, root, writeText;
const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text);
function ScopeControls() {
  const [params, setParams] = useSearchParams();
  return <input aria-label="测试查询范围" value={params.get('q') ?? ''} onChange={event => { const next = new URLSearchParams(params); next.set('q', event.target.value); setParams(next); }} />;
}
async function render(skcs, status = 'ready', { costs = [], approvals = [], initialEntry = '/', ledgerId = 'L', stores = [], contextStore = 'all', skuIds = [] } = {}) {
  mocks.snapshot = {
    ledger: { id: ledgerId, workspaceId: 'W', period: '2026-08', status },
    rows: skcs.map((platformSkc, index) => ({ workspaceId: 'W', ledgerId, store: stores[index] ?? '甲', platformSkc, platformSku: skuIds[index] ?? `SKU-${index}`, quantity: 1, amount: 10 })),
    costs, approvals,
  };
  await act(async () => root.render(<MemoryRouter initialEntries={[initialEntry]}><ScopeControls /><CostMatchingContent validatedContext={{ workspaceId: 'W', ledgerId, store: contextStore }} /></MemoryRouter>));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  mocks.inboxRecords = [];
  mocks.tasks = [];
  mocks.requests = [];
  mocks.switchInbox.mockReset(); mocks.readInbox.mockReset();
  mocks.saveManual.mockReset().mockResolvedValue({});
  mocks.revokeManual.mockReset().mockResolvedValue({});
  mocks.notify.mockReset(); mocks.publish.mockReset(); mocks.retry.mockReset().mockResolvedValue({ adoption: { state: 'partial', items: [{ canonicalPlatformSku: 'SKU-0', state: 'anomaly_pending' }] } }); mocks.cancel.mockReset().mockResolvedValue(null);
  mocks.register.mockReset().mockImplementation(async input => ({ id: `REG-${input.ledger.id}`, workspaceId: input.ledger.workspaceId, ledgerId: input.ledger.id, ledgerPeriod: input.ledger.period, platformSkcs: input.platformSkcs, expectedSkus: input.expectedSkus }));
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
it('registers the selected store using exactly the displayed SKCs and expected SKUs while preserving the full ledger', async () => {
  await render(['SKC-A', 'SKC-B'], 'ready', { ledgerId: 'FULL-SCOPE', stores: ['甲', '乙'], contextStore: '甲' });
  expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
    platformSkcs: ['SKC-A'],
    expectedSkus: [{ platformSku: 'SKU-0', platformSkc: 'SKC-A', store: '甲' }],
  }), expect.any(Object));
  expect(container.textContent).toContain('当前查看平台 SKU1');
  await act(async () => button('复制 1 个平台 SKC').click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith('SKC-A');
  expect(mocks.snapshot.rows).toHaveLength(2);
});

it('keeps the running task scope when display search changes or missing-cost rows shrink', async () => {
  const request = { id: 'ACTIVE', workspaceId: 'W', ledgerId: 'TASK-L', ledgerPeriod: '2026-08', ledgerVersion: '[]', platformSkcs: ['SKC-A', 'SKC-B'], expectedSkus: [{ platformSku: 'SKU-0', platformSkc: 'SKC-A', store: '甲' }, { platformSku: 'SKU-1', platformSkc: 'SKC-B', store: '甲' }] };
  mocks.requests = [request];
  mocks.tasks = [{ taskId: 'TASK', requestId: request.id, workspaceId: 'W', ledgerId: 'TASK-L', ledgerPeriod: request.ledgerPeriod, ledgerVersion: '[]', status: 'running', requestSnapshot: request, batches: [], createdAt: new Date().toISOString() }];
  await render(['SKC-A', 'SKC-B'], 'ready', { ledgerId: 'TASK-L' });
  await act(async () => Simulate.change(container.querySelector('[aria-label="测试查询范围"]'), { target: { value: 'SKC-B' } }));
  await act(async () => new Promise(resolve => setTimeout(resolve, 350)));
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(container.textContent).toContain('查看筛选不改变此任务');
  expect(button('复制 1 个平台 SKC').disabled).toBe(false);
});

it('cancels the old scope immediately and registers only the final query after rapid typing', async () => {
  await render(['SKC-A', 'SKC-B'], 'ready', { ledgerId: 'TYPING-SCOPE' });
  mocks.register.mockClear(); mocks.cancel.mockClear();
  const changeQuery = async value => act(async () => Simulate.change(container.querySelector('[aria-label="测试查询范围"]'), { target: { value } }));
  await changeQuery('SKC-A');
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(button('复制 1 个平台 SKC').disabled).toBe(true);
  await changeQuery('SKC');
  await changeQuery('SKC-B');
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.cancel).toHaveBeenCalledOnce();
  await act(async () => new Promise(resolve => setTimeout(resolve, 350)));
  expect(mocks.register).toHaveBeenCalledOnce();
  expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ platformSkcs: ['SKC-B'], expectedSkus: [{ platformSku: 'SKU-1', platformSkc: 'SKC-B', store: '甲' }] }), expect.any(Object));
  expect(button('复制 1 个平台 SKC').disabled).toBe(false);
  await act(async () => button('复制 1 个平台 SKC').click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith('SKC-B');
  await changeQuery('empty-range');
  expect(mocks.cancel).toHaveBeenCalledTimes(2);
  await act(async () => new Promise(resolve => setTimeout(resolve, 350)));
  expect(mocks.register).toHaveBeenCalledOnce();
  expect(button('当前范围无明细').disabled).toBe(true);
  expect(mocks.snapshot.rows).toHaveLength(2);
});

it('does not guess a SKU parent by filtering away conflicting ledger rows', async () => {
  const costs=[{platformSku:'SAME-SKU',platformSkc:'SKC-A',unitCost:5,resolutionStatus:'resolved',purchaseRecords:[{recordId:'R',purchaseDate:'2026-08-01',quantity:1,unitPrice:5}],selectedRecordIds:['R']}];
  await render(['SKC-A', 'SKC-B'], 'ready', { ledgerId: 'CONFLICT-SCOPE', stores: ['甲', '乙'], contextStore: '甲', skuIds: ['SAME-SKU', 'SAME-SKU'],costs });
  expect(container.textContent).toContain('当前 SKU 在完整台账中对应多个平台 SKC');
  expect(mocks.register).not.toHaveBeenCalled();
  expect(button('复制 1 个平台 SKC').disabled).toBe(true);
  expect(mocks.snapshot.rows).toHaveLength(2);
  expect(container.querySelector('.match-stat.match-success').textContent).toContain('当前有效成本0');
  expect(container.textContent).toContain('归属待核对');
  expect(button('逐项更正')).toBeUndefined();
  await act(async()=>button('详情').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('人工金额不能消除多 SKC 冲突');
  expect(button('人工更正')).toBeUndefined();
});

it('skips conflicting parents in the direct next-item correction flow',async()=>{
  await render(['SKC-A','SKC-X','SKC-Y','SKC-Z'],'ready',{ledgerId:'NEXT-IDENTITY',skuIds:['A','B','B','C']});
  await act(async()=>button('人工更正').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('甲 · A');
  await act(async()=>{
    Simulate.change(container.querySelector('#manual-cost-value'),{target:{value:'0'}});
    Simulate.change(container.querySelector('#manual-cost-reason'),{target:{value:'核实零值'}});
  });
  await act(async()=>button('保存并下一项').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('甲 · C');
  expect(mocks.saveManual).toHaveBeenCalledExactlyOnceWith({ledgerId:'NEXT-IDENTITY',store:'甲',platformSku:'A',unitCost:'0',reason:'核实零值'});
});

it('stops new amount edits when an open correction receives a conflicting identity',async()=>{
  await render(['SKC-A'],'ready',{ledgerId:'OPEN-IDENTITY',skuIds:['A']});
  await act(async()=>button('人工更正').click());
  expect(container.querySelector('#manual-cost-value')).not.toBeNull();
  await render(['SKC-A','SKC-B'],'ready',{ledgerId:'OPEN-IDENTITY',skuIds:['A','A']});
  expect(container.querySelector('#manual-cost-value')).toBeNull();
  expect(container.querySelector('[role="dialog"]').textContent).toContain('对应多个平台 SKC');
  expect(button('保存更正')).toBeUndefined();
  expect(mocks.saveManual).not.toHaveBeenCalled();
});

it('retains revocation of an existing manual zero while a parent conflict blocks new amounts',async()=>{
  const ledgerId='REVOKE-IDENTITY',approval={id:'M',workspaceId:'W',ledgerId,platformSku:'A',status:'approved',currency:'CNY',approvedAmount:0,approvedBy:'finance',approvedAt:'2026-08-31T00:00:00Z',reason:'真实零值',referenceCost:{kind:'manual_override',store:'甲'}};
  await render(['SKC-A','SKC-B'],'ready',{ledgerId,skuIds:['A','A'],approvals:[approval]});
  await act(async()=>button('详情').click());
  await act(async()=>button('撤销人工更正').click());
  expect(container.querySelector('#manual-cost-value')).toBeNull();
  expect(button('保存更正')).toBeUndefined();
  await act(async()=>button('撤销当前更正').click());
  expect(mocks.revokeManual).toHaveBeenCalledExactlyOnceWith({ledgerId,approvalId:'M'});
  expect(mocks.saveManual).not.toHaveBeenCalled();
});

it('ignores a late registration acknowledgement from the previous search range', async () => {
  let finishPrevious;
  mocks.register.mockImplementationOnce(input => new Promise(resolve => { finishPrevious = () => resolve({ id: 'STALE-REQUEST', ...input.ledger }); }));
  await render(['SKC-A', 'SKC-B'], 'ready', { ledgerId: 'ACK-SCOPE' });
  const previousIsCurrent = mocks.register.mock.calls[0][1].isCurrent;
  expect(button('复制 2 个平台 SKC').disabled).toBe(true);
  await act(async () => Simulate.change(container.querySelector('[aria-label="测试查询范围"]'), { target: { value: 'SKC-B' } }));
  expect(previousIsCurrent()).toBe(false);
  await act(async () => finishPrevious());
  expect(button('复制 1 个平台 SKC').disabled).toBe(true);
  await act(async () => new Promise(resolve => setTimeout(resolve, 350)));
  expect(button('复制 1 个平台 SKC').disabled).toBe(false);
  expect(mocks.register.mock.calls.at(-1)[0].expectedSkus).toEqual([{ platformSku: 'SKU-1', platformSkc: 'SKC-B', store: '甲' }]);
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
function incomingFixture(ledgerId) {
  const request = { id: `REQ-${ledgerId}`, workspaceId: 'W', ledgerId, ledgerPeriod: '2026-08', platformSkcs: ['SKC-1'], expectedSkus: [{ platformSku: 'SKU-0', platformSkc: 'SKC-1' }] };
  const batch = buildErpCostBatchEnvelope({ batchId: `B-${ledgerId}`, workspaceId: 'W', ledgerId, requestId: request.id, platformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus,
    generatedAt: '2026-09-01T00:00:00Z', results: [{ warehouseSku: 'WH-1', mappings: request.expectedSkus, unitCost: 10 }],
    warehouseEvidence: [{ warehouseSku: 'WH-1', evidenceComplete: true, purchaseRecords: [{ recordId: 'P-1', purchaseDate: '2026-08-10', quantity: 1, unitPrice: 10 }] }],
  });
  return { request, inbox: { id: `INBOX-${ledgerId}`, workspaceId: 'W', ledgerId, requestId: request.id, batchId: batch.batchId, status: 'pending', envelope: buildErpCostInboxEnvelope({ batch, deliveryId: `D-${ledgerId}`, sentAt: batch.generatedAt }) } };
}
function exceptionReceipt(ledgerId, number, platformSku, records) {
  const request = { id: `REQ-${ledgerId}-${number}`, workspaceId: 'W', ledgerId, ledgerPeriod: '2026-08', platformSkcs: ['SKC-1'], expectedSkus: [{ platformSku, platformSkc: 'SKC-1' }] };
  const batch = buildErpCostBatchEnvelope({ batchId: `B-${ledgerId}-${number}`, workspaceId: 'W', ledgerId, requestId: request.id, platformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus,
    generatedAt: `2026-09-0${number}T00:00:00Z`, results: [{ warehouseSku: `WH-${number}`, mappings: request.expectedSkus, previewUnitCost: 1 }],
    warehouseEvidence: [{ warehouseSku: `WH-${number}`, evidenceComplete: true, purchaseRecords: records }],
  });
  return { request, inbox: { id: `INBOX-${ledgerId}-${number}`, workspaceId: 'W', ledgerId, requestId: request.id, batchId: batch.batchId, status: 'pending', receivedAt: batch.generatedAt,
    envelope: buildErpCostInboxEnvelope({ batch, deliveryId: `D-${ledgerId}-${number}`, sentAt: batch.generatedAt }),
    adoption: { version: 'erp-auto-adoption@1', state: 'partial', summary: { adoptedCount: 0, remainingCount: 1, anomalyCount: 1 }, items: [{ platformSku, canonicalPlatformSku: platformSku, state: 'anomaly_pending' }] },
  } };
}
it('opens one procurement-price dialog at a time and preserves an entered manual correction on return', async () => {
  const ledgerId = 'SINGLE-PRICE-DIALOG', { request, inbox } = exceptionReceipt(ledgerId, 1, 'SKU-0', [{ recordId: 'ONE', purchaseDate: '2026-08-10', quantity: 10, unitPrice: 1 }]);
  mocks.requests = [request]; mocks.inboxRecords = [{ ...inbox, status: 'loaded' }];
  mocks.switchInbox.mockResolvedValue({});
  await render(['SKC-1'], 'cost_pending', { ledgerId });
  const first = name => [...container.querySelectorAll('button')].find(item => item.textContent === name);
  await act(async () => first('查看证据').click());
  await act(async () => first('确认真实价格').click());
  expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  expect(container.querySelector('[role="dialog"]').textContent).toContain('确认真实采购价');
  await act(async () => first('取消').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('成本详情');
  await act(async () => container.querySelector('.cost-detail-modal .modal-footer button:last-child').click());
  await act(async () => {
    Simulate.change(container.querySelector('#manual-cost-value'), { target: { value: '9.3' } });
    Simulate.change(container.querySelector('#manual-cost-reason'), { target: { value: '手动核实保留草稿' } });
    first('确认真实价格').click();
  });
  expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  await act(async () => first('确认并自动采用').click());
  expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  expect(container.querySelector('#manual-cost-value').value).toBe('9.3');
  expect(container.querySelector('#manual-cost-reason').value).toBe('手动核实保留草稿');
  expect(container.querySelector('.cost-detail-evidence').textContent).toContain('采购价已确认');
  expect(mocks.retry).toHaveBeenCalledWith({ inboxId: inbox.id, resolutions: [expect.objectContaining({ recordId: 'ONE', action: 'confirm_true_price', resolvedUnitPrice: 1 })] });
  expect(mocks.saveManual).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('confirms procurement directly from an unloaded receipt without switching or creating a cost draft', async () => {
  const ledgerId = 'DIRECT-CONFIRM', { request, inbox } = exceptionReceipt(ledgerId, 1, 'SKU-0', [{ recordId: 'ONE', purchaseDate: '2026-08-10', quantity: 10, unitPrice: 1 }]);
  mocks.requests = [request]; mocks.inboxRecords = [inbox];
  mocks.retry.mockResolvedValue({ status: 'applied', adoption: { state: 'applied', items: [{ canonicalPlatformSku: 'SKU-0', state: 'adopted' }] } });
  await render(['SKC-1'], 'cost_pending', { ledgerId });
  await act(async () => button('查看证据').click());
  expect(container.textContent).not.toContain('载入此批采购证据');
  await act(async () => button('确认真实价格').click());
  await act(async () => button('确认并自动采用').click());
  expect(mocks.retry).toHaveBeenCalledExactlyOnceWith({ inboxId: inbox.id, resolutions: [expect.objectContaining({ recordId: 'ONE', resolvedUnitPrice: 1 })] });
  expect(mocks.switchInbox).not.toHaveBeenCalled();
  expect(localStorage.getItem(costDraftKey(ledgerId))).toBeNull();
  expect(mocks.saveManual).not.toHaveBeenCalled();
  expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('已自动采用'), 'success');
});
it('confirms all positive anomalous procurement prices for one SKU together', async () => {
  const ledgerId = 'CONFIRM-SKU';
  const records = [1, 2, 3].map(index => ({ recordId: 'ONE-' + index, purchaseDate: '2026-08-0' + index, quantity: index, unitPrice: 1 }));
  const { request, inbox } = exceptionReceipt(ledgerId, 1, 'SKU-0', records);
  mocks.requests = [request]; mocks.inboxRecords = [inbox];
  await render(['SKC-1'], 'cost_pending', { ledgerId });
  await act(async () => button('查看证据').click());
  await act(async () => button('确认本 SKU 全部真实采购价').click());
  expect(container.querySelector('.cost-resolution-prices').textContent).toContain('以下 3 笔');
  await act(async () => button('确认并自动采用').click());
  expect(mocks.retry.mock.calls[0][0].resolutions.map(row => row.recordId)).toEqual(['ONE-3', 'ONE-2', 'ONE-1']);
});
it('keeps the confirmation dialog and reason when adoption fails, allowing a retry', async () => {
  const ledgerId = 'CONFIRM-RETRY', { request, inbox } = exceptionReceipt(ledgerId, 1, 'SKU-0', [{ recordId: 'ONE', purchaseDate: '2026-08-10', quantity: 10, unitPrice: 1 }]);
  mocks.requests = [request]; mocks.inboxRecords = [inbox];
  mocks.retry.mockRejectedValueOnce(new Error('隔离写入失败'));
  await render(['SKC-1'], 'cost_pending', { ledgerId });
  await act(async () => button('查看证据').click());
  await act(async () => button('确认真实价格').click());
  await act(async () => Simulate.change(container.querySelector('.cost-resolution-form textarea'), { target: { value: '已核对供应商账单' } }));
  await act(async () => button('确认并自动采用').click());
  expect(container.querySelector('.cost-resolution-form textarea').value).toBe('已核对供应商账单');
  expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  expect(mocks.notify).toHaveBeenCalledWith('采购核价保存失败：隔离写入失败', 'error');
  await act(async () => button('确认并自动采用').click());
  expect(mocks.retry).toHaveBeenCalledTimes(2);
  expect(container.querySelector('.cost-resolution-form')).toBeNull();
});
it('binds the next missing SKU to its own receipt and skips healthy siblings in the direct exception list', async () => {
  const ledgerId = 'NEXT-RECEIPT';
  const first = exceptionReceipt(ledgerId, 1, 'SKU-0', [{ recordId: 'ONE', purchaseDate: '2026-08-10', quantity: 10, unitPrice: 1 }]);
  const records = [...Array.from({ length: 6 }, (_, i) => ({ recordId: `OLD-${i}`, purchaseDate: `2026-07-0${i + 1}`, quantity: 10, unitPrice: 2.3 })),
    ...[1, 2, 3].map(i => ({ recordId: `LOW-${i}`, purchaseDate: `2026-08-0${i}`, quantity: 10, unitPrice: 1.55 }))];
  const second = exceptionReceipt(ledgerId, 2, 'SKU-2', records);
  mocks.requests = [first.request, second.request]; mocks.inboxRecords = [first.inbox, second.inbox];
  await render(['SKC-1', 'SKC-1', 'SKC-1'], 'cost_pending', { ledgerId, costs: [{ ...formalCost, platformSku: 'SKU-1' }] });
  await act(async () => container.querySelector('.erp-review-panel .erp-review-sku button:last-child').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('甲 · SKU-0');
  await act(async () => {
    Simulate.change(container.querySelector('#manual-cost-value'), { target: { value: '0' } });
    Simulate.change(container.querySelector('#manual-cost-reason'), { target: { value: '真实零值' } });
  });
  await act(async () => button('保存并下一项').click());
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain('甲 · SKU-2');
  expect(dialog.textContent).toContain('近期采购价格相比历史下降');
  expect(dialog.textContent).toContain('仓库 SKU：WH-2');
  expect(dialog.textContent).toContain('10 件 × ¥1.5500');
  expect(dialog.textContent).not.toContain('仓库 SKU：WH-1');
  expect(button('保存并下一项')).toBeUndefined();
  expect(mocks.saveManual).toHaveBeenCalledExactlyOnceWith({ ledgerId, store: '甲', platformSku: 'SKU-0', unitCost: '0', reason: '真实零值' });
  expect(mocks.switchInbox).not.toHaveBeenCalled();
});
it('waits for automatic receipt adoption and shows adopted costs without loading a draft or a red error', async () => {
  const ledgerId = 'RECEIPT-PENDING', { request, inbox } = incomingFixture(ledgerId);
  mocks.requests = [request]; mocks.inboxRecords = [{ ...inbox, adoptionPending: true }];
  mocks.switchInbox.mockRejectedValue(new Error('page must not load the receipt'));
  await render(['SKC-1'], 'ready', { ledgerId });
  expect(mocks.switchInbox).not.toHaveBeenCalled();
  mocks.inboxRecords = [{ ...inbox, adoptionPending: false, status: 'applied', adoption: { version: 'erp-auto-adoption@1', state: 'applied', summary: { adoptedCount: 1, remainingCount: 0 } } }];
  await render(['SKC-1'], 'ready', { ledgerId, costs: [formalCost] });
  expect(container.textContent).toContain('ERP 已采用');
  expect(container.textContent).not.toContain('当前载入状态已变化');
  expect(mocks.switchInbox).not.toHaveBeenCalled();
  expect(localStorage.getItem(costDraftKey(ledgerId))).toBeNull();
});
it('ignores only a stale load of the same receipt that was already adopted', async () => {
  const ledgerId = 'RECEIPT-STALE', { request, inbox } = incomingFixture(ledgerId);
  mocks.requests = [request]; mocks.inboxRecords = [inbox];
  mocks.readInbox.mockResolvedValue({ ...inbox, status: 'applied' });
  mocks.switchInbox.mockRejectedValue(Object.assign(new Error('当前载入状态已变化，请刷新待处理列表后重试。'), { code: 'ERP_INBOX_STATE_CHANGED' }));
  await render(['SKC-1'], 'ready', { ledgerId, costs: [formalCost] });
  expect(mocks.switchInbox).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('ERP 已采用');
  expect(container.textContent).not.toContain('当前载入状态已变化');
  expect(mocks.notify.mock.calls.some(([, kind]) => kind === 'error')).toBe(false);
  expect(localStorage.getItem(costDraftKey(ledgerId))).toBeNull();
});
it('keeps genuine stale or failed loads visible when the receipt was not adopted', async () => {
  const ledgerId = 'RECEIPT-REJECTED', { request, inbox } = incomingFixture(ledgerId);
  mocks.requests = [request]; mocks.inboxRecords = [inbox];
  mocks.readInbox.mockResolvedValue({ ...inbox, status: 'rejected' });
  mocks.switchInbox.mockRejectedValue(Object.assign(new Error('当前载入状态已变化，请刷新待处理列表后重试。'), { code: 'ERP_INBOX_STATE_CHANGED' }));
  await render(['SKC-1'], 'ready', { ledgerId });
  expect(container.textContent).toContain('当前载入状态已变化');
  expect(mocks.notify.mock.calls.some(([, kind]) => kind === 'error')).toBe(true);
});
it('does not start a second automatic load when receipt queries refresh during an existing load', async () => {
  const ledgerId = 'RECEIPT-INFLIGHT', { request, inbox } = incomingFixture(ledgerId);
  mocks.requests = [request]; mocks.inboxRecords = [inbox];
  let rejectLoad;
  mocks.switchInbox.mockImplementation(() => new Promise((_resolve, reject) => { rejectLoad = reject; }));
  mocks.readInbox.mockResolvedValue({ ...inbox, status: 'applied' });
  await render(['SKC-1'], 'ready', { ledgerId });
  mocks.inboxRecords = [{ ...inbox }];
  await render(['SKC-1'], 'ready', { ledgerId, costs: [formalCost] });
  expect(mocks.switchInbox).toHaveBeenCalledOnce();
  await act(async () => rejectLoad(Object.assign(new Error('当前载入状态已变化'), { code: 'ERP_INBOX_STATE_CHANGED' })));
  expect(container.textContent).not.toContain('当前载入状态已变化');
  expect(localStorage.getItem(costDraftKey(ledgerId))).toBeNull();
});
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
it('corrects only missing store SKUs directly without loading a receipt, accepting zero and tiny real costs', async () => {
  await render(['SKC-1', 'SKC-2', 'SKC-3'], 'ready', { ledgerId: 'DIRECT', stores: ['甲', '乙', '丙'], costs: [formalCost] });
  await act(async () => button('逐项更正').click());
  const dialog = () => container.querySelector('[role="dialog"]');
  expect(dialog().textContent).toContain('乙 · SKU-1');
  expect(dialog().textContent).toContain('第 1 / 2 项');
  expect(container.querySelector('#manual-cost-value').value).toBe('');
  expect(container.querySelector('.cost-correction-evidence').open).toBe(false);
  const form = [...container.querySelector('.modal-body').children];
  expect(form.indexOf(container.querySelector('#manual-cost-value').parentElement)).toBeLessThan(form.indexOf(container.querySelector('.cost-correction-evidence')));
  const fill = async amount => act(async () => {
    Simulate.change(container.querySelector('#manual-cost-value'), { target: { value: amount } });
    Simulate.change(container.querySelector('#manual-cost-reason'), { target: { value: '核实异常后更正' } });
  });
  await fill('0');
  await act(async () => button('保存并下一项').click());
  expect(mocks.saveManual).toHaveBeenNthCalledWith(1, { ledgerId: 'DIRECT', store: '乙', platformSku: 'SKU-1', unitCost: '0', reason: '核实异常后更正' });
  expect(dialog().textContent).toContain('丙 · SKU-2');
  expect(dialog().textContent).toContain('第 2 / 2 项');
  expect(container.querySelector('#manual-cost-reason').value).toBe('');
  await fill('0.00001');
  await act(async () => button('保存并完成').click());
  expect(mocks.saveManual).toHaveBeenNthCalledWith(2, { ledgerId: 'DIRECT', store: '丙', platformSku: 'SKU-2', unitCost: '0.00001', reason: '核实异常后更正' });
  expect(dialog()).toBeNull();
  expect(mocks.switchInbox).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('counts only the anomalous SKU and keeps healthy siblings out of the missing-cost correction queue', async () => {
  const ledgerId = 'SIBLING-CORRECTION';
  const siblingCosts = [1.9791, 1.0323].map((price, index) => ({
    ...formalCost, id: `C-${index}`, platformSku: `SKU-${index + 1}`, unitCost: price,
    purchaseRecords: formalCost.purchaseRecords.map(record => ({ ...record, unitPrice: price })),
  }));
  mocks.inboxRecords = [{ id: 'SIBLING-INBOX', ledgerId, workspaceId: 'W', status: 'pending', receivedAt: '2026-09-01T00:00:00Z',
    adoption: { version: 'erp-auto-adoption@1', state: 'partial', summary: { adoptedCount: 2, anomalyCount: 1, remainingCount: 1 },
      items: [{ platformSku: 'SKU-0', canonicalPlatformSku: 'SKU-0', state: 'anomaly_pending' }, ...['SKU-1', 'SKU-2'].map(platformSku => ({ platformSku, canonicalPlatformSku: platformSku, state: 'adopted' }))] },
  }];
  await render(['SKC-1', 'SKC-1', 'SKC-1'], 'cost_pending', { ledgerId, costs: siblingCosts });
  expect(container.querySelector('.match-correction strong').textContent).toBe('1 条店铺 SKU');
  for (const sku of ['SKU-1', 'SKU-2']) expect(container.querySelector(`[data-platform-sku="${sku}"] .cost-match-current-cell`).textContent).toContain('ERP 已采用');
  await act(async () => button('逐项更正').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('甲 · SKU-0');
  expect(container.querySelector('[role="dialog"]').textContent).toContain('第 1 / 1 项');
  expect(button('保存并下一项')).toBeUndefined();
});
it('keeps direct correction within the selected store even when a SKU is shared across stores', async () => {
  await render(['SKC-1', 'SKC-1'], 'ready', { ledgerId: 'STORE-CORRECTION', stores: ['甲', '乙'], skuIds: ['SHARED', 'SHARED'], contextStore: '乙' });
  await act(async () => button('逐项更正').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('乙 · SHARED');
  expect(container.querySelector('[role="dialog"]').textContent).toContain('第 1 / 1 项');
  expect(button('保存并下一项')).toBeUndefined();
});
it('skips a queued row that becomes effective while the previous correction is saving', async () => {
  let finishSave;
  mocks.saveManual.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
  await render(['SKC-1', 'SKC-2', 'SKC-3'], 'ready', { ledgerId: 'SKIP-CORRECTION' });
  await act(async () => button('逐项更正').click());
  await act(async () => {
    Simulate.change(container.querySelector('#manual-cost-value'), { target: { value: '8.5' } });
    Simulate.change(container.querySelector('#manual-cost-reason'), { target: { value: '已核实' } });
  });
  await act(async () => button('保存并下一项').click());
  await render(['SKC-1', 'SKC-2', 'SKC-3'], 'ready', { ledgerId: 'SKIP-CORRECTION', costs: [{ ...formalCost, platformSku: 'SKU-1', platformSkc: 'SKC-2' }] });
  await act(async () => finishSave({}));
  expect(container.querySelector('[role="dialog"]').textContent).toContain('甲 · SKU-2');
  expect(button('保存并完成')).toBeDefined();
});
it('keeps a failed direct correction and entered amount open for retry', async () => {
  mocks.saveManual.mockRejectedValue(new Error('隔离保存故障'));
  await render(['SKC-1'], 'ready', { ledgerId: 'CORRECTION-FAILURE' });
  await act(async () => button('逐项更正').click());
  await act(async () => {
    Simulate.change(container.querySelector('#manual-cost-value'), { target: { value: '3.5' } });
    Simulate.change(container.querySelector('#manual-cost-reason'), { target: { value: '已核实' } });
  });
  await act(async () => button('保存并完成').click());
  expect(container.querySelector('[role="dialog"]').textContent).toContain('隔离保存故障');
  expect(container.querySelector('#manual-cost-value').value).toBe('3.5');
});
it('shows current cost coverage instead of requesting another correction from historical exception metadata', async () => {
  const adoption = { version: 'erp-auto-adoption@1', state: 'partial', summary: { adoptedCount: 0, remainingCount: 1 }, items: [{ canonicalPlatformSku: 'SKU-0', platformSku: 'SKU-0', state: 'anomaly_pending' }] };
  mocks.inboxRecords = [{ id: 'HISTORICAL-ANOMALY', ledgerId: 'COST-COVERED', workspaceId: 'W', status: 'pending', adoption, receivedAt: '2026-10-09T00:00:00Z' }];
  await render(['SKC-1'], 'ready', { ledgerId: 'COST-COVERED', costs: [formalCost] });
  expect(container.querySelector('.cost-flow-guide').textContent).toContain('本月成本已齐');
  expect(container.querySelector('.cost-exception-groups')).toBeNull();
  expect(container.querySelector('.cost-anomaly-warning')).toBeNull();
  expect(mocks.inboxRecords[0].adoption).toBe(adoption);
});
it.each(['finalized', 'locked'])('shows only details and preserves read-only cost evidence for %s', async status => {
  await render(['SKC-1'], status, { ledgerId: `DETAILS-${status}`, costs: [formalCost] });
  expect(container.querySelectorAll('.cost-match-row-actions button')).toHaveLength(1);
  await act(async () => button('详情').click());
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('已定稿或锁定');
  expect(container.querySelector('#manual-cost-value')).toBeNull();
  expect(button('人工更正')).toBeUndefined();
  expect(button('逐项更正')).toBeUndefined();
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
