// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CostAttention from './CostAttention';
import ErpAnomalyActions from './ErpAnomalyActions';

const state = vi.hoisted(() => ({ pending: vi.fn(), ignored: vi.fn(), save: vi.fn(), notify: vi.fn() }));
vi.mock('dexie-react-hooks', async () => {
  const { useState, useEffect } = await import('react');
  return { useLiveQuery(read, deps) {
    const [result, setResult] = useState();
    useEffect(() => {
      let active = true;
      read().then(value => { if (active) setResult(value); });
      return () => { active = false; };
    }, deps);
    return result;
  } };
});
vi.mock('../data/repositories/profitRepository', () => ({
  listErpCostAnomalyReview: async (ledgerId, inboxes) => ({ pending: await state.pending(ledgerId, inboxes), ignored: await state.ignored(ledgerId) }), setErpCostAnomaliesIgnored: state.save,
}));
vi.mock('./UI', async load => ({ ...await load(), useToast: () => ({ notify: state.notify }) }));
let host, root;
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent === label);
const price = (inboxId, warehouseSku, platformSku = 'SKU', originalUnitPrice = 1) => ({ inboxId, warehouseSku, platformSku, originalUnitPrice, reasons: ['unit_price_one'] });
const render = async props => act(async () => root.render(<ErpAnomalyActions ledgerId="L" {...props} />));
const click = async label => act(async () => button(label).click());
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.pending.mockReset().mockResolvedValue([]);
  state.ignored.mockReset().mockResolvedValue([]);
  state.save.mockReset().mockResolvedValue({ changedCount: 1 }); state.notify.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('shows the missing count without a duplicate filter button', async () => {
  await act(async () => root.render(<CostAttention missing={7} />));
  expect(host.querySelector('[role="status"]').textContent).toContain('7 条店铺 SKU');
  expect(host.querySelector('button')).toBeNull();
  await act(async () => root.render(<CostAttention missing={0} />));
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it('counts separate receipts once per warehouse and writes exactly the displayed month selection', async () => {
  state.pending.mockResolvedValue([price('A','W','SKU-1',0), price('A','w','SKU-2'), price('A','W','SKU-2'), price('B','W')]);
  await render();
  expect(button('忽略剩余异常（2）')).toBeUndefined();
  await click('核对价格异常');
  expect(button('忽略剩余异常（2）').closest('[role="dialog"]')).not.toBeNull();
  await click('忽略剩余异常（2）');
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', ignored: true, selectedItems: [{ inboxId: 'A', warehouseSku: 'W' }, { inboxId: 'B', warehouseSku: 'W' }] });
  expect(host.textContent).toContain('含 0 元');
  expect(state.notify).toHaveBeenCalledWith(expect.stringContaining('没有可用采购数据的项目仍待补齐'));
});

it('opens shared warehouse corrections from the list and retains the complete scope label', async () => {
  state.pending.mockResolvedValue([price('I','W','S'), price('I','W','T'), price('I','U','V')]);
  const onReview = vi.fn();
  await render({ onReview, reviewRows: [{ platformSku:'S', store:'甲' }, { platformSku:'S', store:'乙' }, { platformSku:'T', store:'丙' }, { platformSku:'V', store:'乙' }] });
  await click('核对价格异常');
  expect(host.querySelector('.anomaly-select-row').textContent).toContain('S · 甲、S · 乙、T · 丙');
  expect(button('更正同仓成本（3 条店铺 SKU）')).toBeDefined();
  expect(button('S · 甲、S · 乙、T · 丙')).toBeUndefined();
  await click('V · 乙');
  expect(onReview).toHaveBeenCalledWith({ inboxId:'I', warehouseSku:'U', platformSku:'V', store:'乙' });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('groups ignored evidence, opens details and supports individual and full revocation', async () => {
  const inboxes = [{ id:'I', ledgerId:'L', status:'applied', envelope:{ batch:{rows:[{ warehouseSku:'W', platformSku:'SKU' }]} },
    costResolutions:[0,1].map(originalUnitPrice => ({ action:'ignore_anomaly', warehouseSku:'W', originalUnitPrice })) }];
  state.ignored.mockResolvedValue(inboxes[0].costResolutions.map(item => ({...item, inboxId:'I', platformSku:'SKU'})));
  const onReview = vi.fn();
  await render({ inboxes, onReview, reviewRows:[{platformSku:'SKU',store:'甲'}] });
  await click('已忽略异常 · 1');
  expect(host.querySelector('[role="dialog"]').textContent).toContain('¥0、¥1');
  await click('恢复提醒');
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: false, selectedItems: [{ inboxId: 'I', warehouseSku: 'W' }] });
  await click('恢复本月全部提醒');
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: false, selectedItems: [{ inboxId:'I', warehouseSku:'W' }] });
  await click('SKU · 甲');
  expect(onReview).toHaveBeenCalledWith({ inboxId:'I', warehouseSku:'W', platformSku:'SKU', store:'甲' });
});

it('hides stale counts during a new month or receipt read, and offers a safe retry on read errors', async () => {
  const old = [price('old','W')], next = [price('new','W'),price('new','X')];
  state.pending.mockResolvedValueOnce(old).mockRejectedValueOnce(new Error('收件读取失败')).mockResolvedValueOnce(next);
  await render({ inboxes: [] });
  await click('核对价格异常');
  expect(button('忽略剩余异常（1）')).toBeDefined();
  await render({ inboxes: [{ id:'new' }], ledgerId:'N' });
  expect(host.querySelector('[role="alert"]').textContent).toContain('收件读取失败');
  expect(button('忽略剩余异常（1）')).toBeUndefined();
  expect(state.save).not.toHaveBeenCalled();
  await click('重试');
  await click('核对价格异常');
  await click('忽略剩余异常（2）');
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId:'N', ignored:true, selectedItems:[{inboxId:'new',warehouseSku:'W'},{inboxId:'new',warehouseSku:'X'}] });
});

it('retains write failures for retry and disables changes while saving or locked', async () => {
  state.pending.mockResolvedValue([price('I','W')]);
  state.save.mockRejectedValueOnce(new Error('写入失败'));
  await render();
  await click('核对价格异常');
  await click('忽略剩余异常（1）');
  expect(host.querySelector('[role="alert"]').textContent).toBe('写入失败');
  let finish; state.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click('忽略剩余异常（1）');
  expect(button('忽略剩余异常（1）').disabled).toBe(true);
  await act(async () => finish({ changedCount: 1 }));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await render({ locked:true });
  expect(button('忽略剩余异常（1）').disabled).toBe(true);
});

it('ignores only the checked groups and allows a single group directly', async () => {
  state.pending.mockResolvedValue(['W-0','W-1','W-2'].map(sku => price('I',sku)));
  await render();
  await click('核对价格异常');
  expect(button('忽略选中（0 项）').disabled).toBe(true);
  await act(async () => { const boxes = host.querySelectorAll('.anomaly-select-row input'); boxes[0].click(); boxes[2].click(); });
  await click('忽略选中（2 项）');
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: true, selectedItems: [{ inboxId: 'I', warehouseSku: 'W-0' }, { inboxId: 'I', warehouseSku: 'W-2' }] });
  expect(button('忽略选中（0 项）').disabled).toBe(true);
  await act(async () => host.querySelectorAll('.anomaly-select-row button')[1].click());
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: true, selectedItems: [{ inboxId: 'I', warehouseSku: 'W-1' }] });
});

it('shows no actions without anomalies and keeps only history after they are handled', async () => {
  await render();
  expect(host.textContent).toBe('');
  state.ignored.mockResolvedValue([{inboxId:'I',warehouseSku:'W',originalUnitPrice:0}]);
  await render({ inboxes:[{ id:'I', ledgerId:'L', status:'applied', costResolutions:[{ action:'ignore_anomaly', warehouseSku:'W', originalUnitPrice:0 }] }] });
  expect(button('忽略剩余异常（0）')).toBeUndefined();
  expect(button('核对价格异常')).toBeUndefined();
  expect(button('已忽略异常 · 1')).toBeDefined();
});

it('moves corrected items out of the pending count immediately and restores them after revocation', async () => {
  state.pending.mockResolvedValue(Array.from({ length: 7 }, (_, i) => price('I', `W-${i}`, `SKU-${i}`)));
  const rows = Array.from({ length: 7 }, (_, i) => ({ platformSku: `SKU-${i}`, store: '甲', decision: { eligibleForExactProfit: false } }));
  await render({ reviewRows: rows }); await click('核对价格异常');
  expect(button('忽略剩余异常（7）')).toBeDefined();
  const corrected = rows.map((row, i) => i ? row : { ...row, manualOverride: { id: 'M', approvedAmount: 0 }, decision: { eligibleForExactProfit: true } });
  await render({ reviewRows: corrected });
  expect(button('忽略剩余异常（7）')).toBeUndefined();
  expect(button('忽略剩余异常（6）')).toBeDefined();
  await click('忽略剩余异常（6）');
  expect(state.save.mock.lastCall[0].selectedItems).toEqual(Array.from({ length: 6 }, (_, i) => ({ inboxId: 'I', warehouseSku: `W-${i + 1}` })));
  await click('已人工更正 · 1');
  expect(host.querySelectorAll('.anomaly-select-row')).toHaveLength(1);
  expect(host.querySelector('.anomaly-select-row input')).toBeNull();
  expect(button('忽略此项')).toBeUndefined();
  await render({ reviewRows: rows }); await click('待核对 · 7');
  expect(button('忽略剩余异常（7）')).toBeDefined();
});

it('keeps a shared warehouse pending when another store still needs a cost', async () => {
  state.pending.mockResolvedValue([price('I', 'W', 'SHARED')]);
  await render({ reviewRows: [
    { platformSku: 'SHARED', store: '甲', manualOverride: { id: 'M' }, decision: { eligibleForExactProfit: true } },
    { platformSku: 'SHARED', store: '乙', decision: { eligibleForExactProfit: false } },
  ] });
  await click('核对价格异常');
  expect(button('忽略剩余异常（1）')).toBeDefined();
  expect(host.querySelector('.anomaly-select-row').textContent).toContain('其余关联 SKU 仍待核对');
  await click('忽略剩余异常（1）');
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', ignored: true, selectedItems: [{ inboxId: 'I', warehouseSku: 'W' }] });
});

it('selects all groups including rows beyond the first 30 and clears selection across months', async () => {
  state.ignored.mockResolvedValue(Array.from({ length:35 }, (_, i) => price('I-' + i % 2,'W-' + i)));
  await render();
  await click('已忽略异常 · 35');
  expect(host.querySelectorAll('.anomaly-select-row')).toHaveLength(30);
  await act(async () => { const boxes = host.querySelectorAll('.anomaly-select-row input'); boxes[0].click(); boxes[1].click(); });
  await click('恢复选中（2 项）');
  expect(state.save).toHaveBeenLastCalledWith({ ledgerId: 'L', ignored: false, selectedItems: [{ inboxId: 'I-0', warehouseSku: 'W-0' }, { inboxId: 'I-1', warehouseSku: 'W-1' }] });
  await act(async () => host.querySelector('[aria-label="全选本列表"]').click());
  await click('恢复选中（35 项）');
  expect(state.save.mock.lastCall[0].selectedItems).toHaveLength(35);
  await act(async () => host.querySelector('[aria-label="全选本列表"]').click());
  await render({ ledgerId:'NEW' });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click('已忽略异常 · 35');
  expect(button('恢复选中（0 项）').disabled).toBe(true);
});


it('blocks same-tick duplicate submits and stays busy until a durable post-write read finishes', async () => {
  const old = [price('I', 'W')];
  state.pending.mockResolvedValueOnce(old);
  let finishRead, finishWrite;
  state.pending.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  state.save.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
  const staleInboxes = [{ id: 'I' }];
  await render({ inboxes: staleInboxes }); await click('核对价格异常');
  const submit = button('忽略剩余异常（1）');
  await act(async () => { submit.click(); submit.click(); });
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(submit.getAttribute('aria-busy')).toBe('true');
  expect(button('忽略选中（0 项）').hasAttribute('aria-busy')).toBe(false);
  await act(async () => finishWrite({ changedCount: 1 }));
  expect(button('忽略剩余异常（1）').disabled).toBe(true);
  expect(state.pending).toHaveBeenLastCalledWith('L', undefined);
  await click('忽略剩余异常（1）');
  expect(state.save).toHaveBeenCalledTimes(1);
  state.ignored.mockResolvedValue(old);
  await act(async () => finishRead([]));
  expect(button('忽略剩余异常（1）')).toBeUndefined();
  expect(button('已忽略 · 1').disabled).toBe(false);
});

it('groups identical evidence across current partial receipts into one action with every member', async () => {
  state.pending.mockResolvedValue([{ ...price('I', 'W', 'A'), groupKey: 'SAME-EVIDENCE' }, { ...price('J', 'W', 'B'), groupKey: 'SAME-EVIDENCE' }]);
  await render(); await click('核对价格异常');
  expect(host.querySelectorAll('.anomaly-select-row')).toHaveLength(1);
  await click('忽略剩余异常（1）');
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ ledgerId: 'L', ignored: true, selectedItems: [{ inboxId: 'I', warehouseSku: 'W' }, { inboxId: 'J', warehouseSku: 'W' }] });
});

it('reports a failed post-write read and allows retry without resubmitting the completed decision', async () => {
  state.pending.mockResolvedValueOnce([price('I', 'W')]).mockRejectedValueOnce(new Error('刷新失败')).mockResolvedValue([]);
  await render(); await click('核对价格异常'); await click('忽略剩余异常（1）');
  expect(host.querySelector('[role="alert"]').textContent).toContain('刷新失败');
  expect(button('忽略剩余异常（1）')).toBeUndefined();
  await click('重试');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(state.save).toHaveBeenCalledTimes(1);
});
it('keeps missing costs separate from ignorable prices and edits inside the same dialog', async () => {
  const row={id:'ROW',platformSku:'MISSING',store:'甲'};
  const renderEditor=(item,onClose,onSaved)=><div data-editor>{item.platformSku}<button onClick={()=>{onSaved();onClose();}}>模拟保存</button></div>;
  await render({missingRows:[row],renderEditor});await click('核对价格异常');
  const dialog=host.querySelector('[role="dialog"]');expect(button('没有成本 · 1').getAttribute('aria-selected')).toBe('true');
  expect(button('忽略选中（0 项）')).toBeUndefined();expect(host.querySelector('input[type=checkbox]')).toBeNull();
  await click('补录成本');expect(host.querySelector('[role="dialog"]')).toBe(dialog);
  expect(host.querySelector('[data-editor]').textContent).toContain('MISSING');
  await click('模拟保存');expect(host.querySelector('[role="dialog"]')).toBe(dialog);
  expect(host.textContent).toContain('成本已保存');expect(state.save).not.toHaveBeenCalled();
});
