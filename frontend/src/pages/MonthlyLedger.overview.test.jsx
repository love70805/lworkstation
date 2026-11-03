// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import MonthlyLedger from './MonthlyLedger';
import { ToastProvider } from '../components/UI';
const mocks = vi.hoisted(() => ({ list: vi.fn(), calculate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../components/AppShell', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../data/database', () => ({ deleteMonthlyLedger: vi.fn(), formatLedgerPeriod: value => value, listLedgerSummaries: mocks.list }));
vi.mock('../data/repositories/ledgerOverviewRepository', () => ({ withCurrentLedgerResults: mocks.calculate }));
vi.mock('../data/repositories/inventoryAccountingRepository', () => ({ readAccountingMode: async () => 'weighted' }));
let root, host;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.resetAllMocks(); });
const ledger = (id, result) => ({ id, workspaceId: 'OVERVIEW-W', period: `${new Date().getFullYear()}-${id}`, operationWorkflow: 2, status: 'ready', summary: {quantity:1}, currentResult: result });
async function mount() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ToastProvider><MonthlyLedger /></ToastProvider>));
}
const settleUntil = async predicate => vi.waitFor(async () => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  predicate();
});
it('shows months while results are pending, then labels current profit and deduction completeness without claiming a saved report', async () => {
  let finish;
  const rows = ['09','08','07'].map(id => ledger(id));
  mocks.list.mockResolvedValue(rows);
  mocks.calculate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  await settleUntil(() => expect(host.querySelectorAll('.ledger-card')).toHaveLength(3));
  expect(host.textContent).toContain('月份已加载');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === '导出归档').disabled).toBe(true);
  await settleUntil(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish(rows.map((row,index) => ({...row,currentResult:{state:'current',profit:10, label:['本月利润','暂计利润','未扣款利润'][index],deductionStatus:['complete','partial','missing'][index],needsAttention:index>0}}))));
  await settleUntil(() => expect(host.textContent).toContain('扣款齐全 1 月 · 部分扣款 1 月 · 未扣款 1 月'));
  expect(host.textContent).toContain('年当前利润');
  expect(host.textContent).not.toContain('已保存利润');
  expect(host.querySelector('.ledger-stat.pending').textContent).toContain(rows[1].period);
  expect(host.querySelector('.ledger-stat.pending').textContent).toContain('待补扣款');
});
it('does not mark a complete month as pending and allows retry after summary failure', async () => {
  const row = ledger('09');
  mocks.list.mockResolvedValue([row]);
  mocks.calculate.mockRejectedValueOnce(Error('摘要读取失败')).mockResolvedValue([{...row,currentResult:{state:'current',profit:10,label:'本月利润',deductionStatus:'complete',needsAttention:false}}]);
  await mount();
  await settleUntil(() => expect(host.textContent).toContain('摘要读取失败'));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent==='重试').click());
  await settleUntil(() => expect(host.querySelector('.ledger-stat.pending')?.textContent).toContain('成本与扣款均已齐全'));
});
