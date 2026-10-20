// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ManualCostDialog from './ManualCostDialog';
const mocks = vi.hoisted(() => ({ preview: vi.fn(), historySave: vi.fn(), manualSave: vi.fn(), revoke: vi.fn() }));
vi.mock('../data/repositories/profitRepository', () => ({ saveManualCostOverride: mocks.manualSave, revokeManualCostOverride: mocks.revoke }));
vi.mock('../data/repositories/warehouseHistoryRecoveryRepository', () => ({ previewRecoveredWarehouseCost: mocks.preview, saveRecoveredWarehouseCost: mocks.historySave }));
const ledger = { id: 'L', period: '2026-09' }, row = { store: '甲店', platformSku: 'SKU-A', unitCost: null, decision: { eligibleForExactProfit: false } };
const candidate = { unitCost: 0.35, warehouseSku: 'WH-A', inboxId: 'INBOX', reason: '确认历史采购，不恢复当前映射',
  historyEvidence: { warehouseEvidence: { decision: { selectedRecords: [{ recordId: 'R', purchaseDate: '2026-09-20', quantity: 2, unitPrice: 0.35 }] } } } };
let root, host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.preview.mockResolvedValue(candidate); mocks.historySave.mockResolvedValue({ id: 'APPROVAL' }); mocks.manualSave.mockResolvedValue({});
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); root = null; vi.resetAllMocks(); });
async function render(props = {}) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ManualCostDialog ledger={ledger} row={row} onClose={() => {}} {...props} />));
}
async function edit(selector, value) {
  const input = document.querySelector(selector);
  const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const saveButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === '保存更正');
it('shows the automatically collected suggestion in the existing correction dialog and waits for Save', async () => {
  await render();
  expect(document.body.textContent).toContain('已自动补查历史仓库采购');
  expect(document.querySelector('#manual-cost-value').value).toBe('0.35');
  expect(document.querySelector('#manual-cost-reason').value).toBe(candidate.reason);
  expect(mocks.historySave).not.toHaveBeenCalled(); expect(mocks.manualSave).not.toHaveBeenCalled();
  await act(async () => saveButton().click());
  expect(mocks.historySave).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', store: '甲店', platformSku: 'SKU-A', inboxId: 'INBOX',
    expectedUnitCost: '0.35', reason: candidate.reason });
  expect(mocks.manualSave).not.toHaveBeenCalled();
});
it('keeps an explicit different amount as an ordinary manual correction', async () => {
  await render(); await edit('#manual-cost-value', '0'); await edit('#manual-cost-reason', '确认真实零成本');
  await act(async () => saveButton().click());
  expect(mocks.manualSave).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', store: '甲店', platformSku: 'SKU-A', unitCost: '0', reason: '确认真实零成本' });
  expect(mocks.historySave).not.toHaveBeenCalled();
});
it('does not overwrite a typed amount when the historical lookup finishes later', async () => {
  let resolve; mocks.preview.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(); await edit('#manual-cost-value', '0.0000001'); await edit('#manual-cost-reason', '已核实单价');
  await act(async () => resolve(candidate));
  expect(document.querySelector('#manual-cost-value').value).toBe('0.0000001');
  expect(document.querySelector('#manual-cost-reason').value).toBe('已核实单价');
});
