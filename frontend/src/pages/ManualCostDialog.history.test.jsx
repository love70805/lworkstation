// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ManualCostDialog from './ManualCostDialog';
const mocks = vi.hoisted(() => ({ preview: vi.fn(), historySave: vi.fn(), manualSave: vi.fn(), revoke: vi.fn(), guard: { blocked: false } }));
vi.mock('../hooks/useCostEditingGuard', () => ({ useCostEditingGuard: () => mocks.guard }));
vi.mock('../data/repositories/profitRepository', () => ({ saveManualCostOverride: mocks.manualSave, revokeManualCostOverride: mocks.revoke }));
vi.mock('../data/repositories/warehouseHistoryRecoveryRepository', () => ({ previewRecoveredWarehouseCost: mocks.preview, saveRecoveredWarehouseCost: mocks.historySave }));
const ledger = { id: 'L', period: '2026-09' }, row = { store: '甲店', platformSku: 'SKU-A', unitCost: null, decision: { eligibleForExactProfit: false } };
const candidate = { unitCost: 0.35, warehouseSku: 'WH-A', inboxId: 'INBOX', reason: '确认历史采购，不恢复当前映射',
  historyEvidence: { warehouseEvidence: { decision: { selectedRecords: [{ recordId: 'R', purchaseDate: '2026-09-20', quantity: 2, unitPrice: 0.35 }] } } } };
let root, host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; mocks.guard = { blocked: false };
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
it('opens adopted ERP costs for inspection and only accepts Enter after an explicit edit', async () => {
  const onClose = vi.fn();
  const props = { ledger, onClose, formFirst: true, viewFirst: true, hasEffectiveErpCost: true, children: <p>采购单 DEMO-56</p> };
  const adopted = { ...row, unitCost: 5, decision: { eligibleForExactProfit: true } };
  await render({ ...props, row: adopted });
  expect(document.querySelector('[role="dialog"]').textContent).toContain('采购单 DEMO-56');
  expect(document.querySelector('.cost-correction-evidence')).toBeNull();
  expect(document.querySelector('#manual-cost-value')).toBeNull();
  expect(saveButton()).toBeUndefined();
  await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(mocks.manualSave).not.toHaveBeenCalled();

  // A new ERP return while browsing must be the amount presented for editing.
  await act(async () => root.render(<ManualCostDialog {...props} row={{ ...adopted, unitCost: 4.6 }} />));
  const correction = [...document.querySelectorAll('button')].find(button => button.textContent === '人工更正');
  await act(async () => correction.click());
  const input = document.querySelector('#manual-cost-value');
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.value).toBe('4.6');
  expect(document.querySelector('.cost-correction-evidence')).toBeNull();
  expect(document.querySelector('[role="dialog"]').textContent).toContain('采购单 DEMO-56');
  await edit('#manual-cost-value', '0.0000001');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.manualSave).toHaveBeenCalledExactlyOnceWith({
    ledgerId: 'L', store: '甲店', platformSku: 'SKU-A', unitCost: '0.0000001', reason: '人工输入单件成本并确认更正',
  });
  expect(onClose).toHaveBeenCalledOnce();
});
it('shows the automatically collected suggestion in the existing correction dialog and waits for Save', async () => {
  await render();
  expect(document.body.textContent).toContain('已自动补查历史仓库采购');
  expect(document.querySelector('#manual-cost-value').value).toBe('0.35');
  expect(document.querySelector('#manual-cost-reason')).toBeNull();
  expect(mocks.historySave).not.toHaveBeenCalled(); expect(mocks.manualSave).not.toHaveBeenCalled();
  await act(async () => saveButton().click());
  expect(mocks.historySave).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', store: '甲店', platformSku: 'SKU-A', inboxId: 'INBOX',
    expectedUnitCost: '0.35', reason: candidate.reason });
  expect(mocks.manualSave).not.toHaveBeenCalled();
});
it('keeps an explicit different amount as an ordinary manual correction', async () => {
  await render(); await edit('#manual-cost-value', '0');
  await act(async () => saveButton().click());
  expect(mocks.manualSave).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', store: '甲店', platformSku: 'SKU-A', unitCost: '0', reason: '人工输入单件成本并确认更正' });
  expect(mocks.historySave).not.toHaveBeenCalled();
});
it('does not overwrite a typed amount when the historical lookup finishes later', async () => {
  let resolve; mocks.preview.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(); await edit('#manual-cost-value', '0.0000001');
  await act(async () => resolve(candidate));
  expect(document.querySelector('#manual-cost-value').value).toBe('0.0000001');
  expect(document.querySelector('#manual-cost-reason')).toBeNull();
});

it('keeps inspection, inline editing and purchase confirmation in one dialog and guards duplicate saves', async () => {
  let finish;
  const onConfirm = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  await render({ viewFirst: true, purchaseConfirmation: { onConfirm, description: '确认 3 笔原价' }, children: <p>完整采购证据</p> });
  const dialog = document.querySelector('[role="dialog"]');
  const button = label => [...dialog.querySelectorAll('button')].find(node => node.textContent === label);
  await act(async () => button('人工更正').click());
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.querySelector('h2').textContent).toBe('成本详情');
  expect(dialog.textContent).toContain('完整采购证据');
  await act(async () => { button('确认采购价正确').click(); button('确认采购价正确').click(); });
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(saveButton().disabled).toBe(true);
  await act(async () => finish());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(mocks.manualSave).not.toHaveBeenCalled();
});

it('protects an already open correction when collection begins and discards its interim draft', async () => {
  const onConfirm = vi.fn();
  const adopted = { ...row, unitCost: 5, costSource: 'erp', decision: { eligibleForExactProfit: true }, manualOverride: { id: 'M' } };
  const props = { ledger, row: adopted, onClose: () => {}, viewFirst: true, purchaseConfirmation: { onConfirm } };
  await render(props);
  const button = label => [...document.querySelectorAll('button')].find(n => n.textContent === label);
  await act(async () => button('人工更正').click());
  await edit('#manual-cost-value', '99');
  mocks.guard = { blocked: true, title: '成本正在采集，当前为临时结果', message: '暂不可用' };
  await act(async () => root.render(<ManualCostDialog {...props} />));
  expect(document.querySelector('#manual-cost-value')).toBeNull();
  for (const label of ['保存更正', '人工更正', '撤销当前更正', '确认采购价正确']) expect(button(label)).toBeUndefined();
  expect(document.querySelector('[role="dialog"]').textContent).toContain('当前为临时结果');
  expect(mocks.manualSave).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
  mocks.guard = { blocked: false };
  await act(async () => root.render(<ManualCostDialog {...props} row={{ ...adopted, unitCost: 4 }} />));
  expect(document.querySelector('#manual-cost-value')).toBeNull();
  await act(async () => button('人工更正').click());
  expect(document.querySelector('#manual-cost-value').value).toBe('4');
});
it('uses the parent guard consistently and shows save-time rejection instead of swallowing a click', async () => {
  const confirmation={onConfirm:vi.fn().mockRejectedValue(new Error('正在确认成本核算状态，请稍后重试。'))};
  const props={ledger,row,onClose:()=>{},viewFirst:true,purchaseConfirmation:confirmation};
  await render({...props,editingGuard:{blocked:true,title:'成本已送达，正在完成本机核算',message:'当前只读'}});
  expect(document.body.textContent).toContain('当前只读');
  expect([...document.querySelectorAll('button')].some(n=>n.textContent==='确认采购价正确')).toBe(false);
  await act(async()=>root.render(<ManualCostDialog {...props} editingGuard={{blocked:false}} />));
  const confirm=[...document.querySelectorAll('button')].find(n=>n.textContent==='确认采购价正确');
  await act(async()=>confirm.click());
  expect(confirmation.onConfirm).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alert"]').textContent).toContain('请稍后重试');
});
