// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ErpAnomalyActions from './ErpAnomalyActions';

const state = vi.hoisted(() => ({ rows: [], save: vi.fn(), notify: vi.fn() }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => state.rows }));
vi.mock('../data/repositories/profitRepository', () => ({ listIgnoredErpCostAnomalies: vi.fn(), setErpCostAnomaliesIgnored: state.save }));
vi.mock('./UI', async load => ({ ...await load(), useToast: () => ({ notify: state.notify }) }));
let host, root;
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent === label);
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.rows = []; state.save.mockReset().mockResolvedValue({ changedCount: 1 }); state.notify.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('ignores the whole displayed month with one click without describing prices as verified', async () => {
  await act(async () => root.render(<ErpAnomalyActions ledgerId="L" />));
  await act(async () => button('一键忽略异常').click());
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', ignored: true });
  expect(host.textContent).toContain('含 0 元');
  expect(host.textContent).not.toContain('确认真实价格');
  expect(state.notify).toHaveBeenCalledWith(expect.stringContaining('没有可用采购数据的项目仍待补齐'));
});
it('groups ignored evidence, opens details and supports individual and full revocation', async () => {
  state.rows = [0, 1].map((price, i) => ({ inboxId: 'I', warehouseSku: 'W', recordId: String(i), originalUnitPrice: price }));
  const review = vi.fn();
  await act(async () => root.render(<ErpAnomalyActions ledgerId="L" onReview={review} />));
  await act(async () => button('已忽略异常 · 1').click());
  expect(host.querySelector('[role="dialog"]').textContent).toContain('¥0、¥1');
  await act(async () => button('恢复提醒').click());
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: false, selectedItems: [{ inboxId: 'I', warehouseSku: 'W' }] });
  await act(async () => button('恢复本月全部提醒').click());
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: false });
  await act(async () => button('W').click());
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ inboxId: 'I', warehouseSku: 'W' }));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('retains failures for retry and disables changes while saving or locked', async () => {
  state.save.mockRejectedValueOnce(new Error('写入失败'));
  await act(async () => root.render(<ErpAnomalyActions ledgerId="L" />));
  await act(async () => button('一键忽略异常').click());
  expect(host.querySelector('[role="alert"]').textContent).toBe('写入失败');
  let finish; state.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => button('一键忽略异常').click());
  expect(button('一键忽略异常').disabled).toBe(true);
  await act(async () => finish({ changedCount: 1 }));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.render(<ErpAnomalyActions ledgerId="L" locked />));
  expect(button('一键忽略异常').disabled).toBe(true);
});

it('ignores only the checked items and allows a single item directly', async () => {
  const readPending = () => [0, 1, 2].map(i => ({ inboxId: 'I', platformSku: `SKU-${i}`, match: { costDecision: { anomalies: [
    { warehouseSku: `W-${i}`, recordId: `R-${i}`, status: 'pending', originalUnitPrice: i ? 1 : 0, reasons: ['unit_price_one'] },
  ] } } }));
  await act(async () => root.render(<ErpAnomalyActions ledgerId="L" readPending={readPending} />));
  await act(async () => button('选择忽略').click());
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
  expect(button('忽略选中（0 项）').disabled).toBe(true);
  await act(async () => { const boxes = host.querySelectorAll('.anomaly-select-row input'); boxes[0].click(); boxes[2].click(); });
  await act(async () => button('忽略选中（2 项）').click());
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: true, selectedItems: [{ inboxId: 'I', warehouseSku: 'W-0' }, { inboxId: 'I', warehouseSku: 'W-2' }] });
  expect(button('忽略选中（0 项）').disabled).toBe(true);
  await act(async () => host.querySelectorAll('.anomaly-select-row button')[1].click());
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: true, selectedItems: [{ inboxId: 'I', warehouseSku: 'W-1' }] });
});

it('restores multiple selected items, makes select-all include unloaded rows, and clears selection across months', async () => {
  state.rows = Array.from({ length: 35 }, (_, i) => ({ inboxId: `I-${i % 2}`, warehouseSku: `W-${i}`, originalUnitPrice: 0 }));
  await act(async () => root.render(<ErpAnomalyActions ledgerId="L" />));
  await act(async () => button('已忽略异常 · 35').click());
  expect(host.querySelectorAll('.anomaly-select-row')).toHaveLength(30);
  await act(async () => { const boxes = host.querySelectorAll('.anomaly-select-row input'); boxes[0].click(); boxes[1].click(); });
  await act(async () => button('恢复选中（2 项）').click());
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: false, selectedItems: [{ inboxId: 'I-0', warehouseSku: 'W-0' }, { inboxId: 'I-1', warehouseSku: 'W-1' }] });
  await act(async () => host.querySelector('[aria-label="全选本列表"]').click());
  await act(async () => button('恢复选中（35 项）').click());
  expect(state.save.mock.lastCall[0].selectedItems).toHaveLength(35);
  await act(async () => host.querySelector('[aria-label="全选本列表"]').click());
  await act(async () => root.render(<ErpAnomalyActions ledgerId="NEW" />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button('已忽略异常 · 35').click());
  expect(button('恢复选中（0 项）').disabled).toBe(true);
});
