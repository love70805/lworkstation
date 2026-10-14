// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import MonthlyLedger from './MonthlyLedger';
import { ToastProvider } from '../components/UI';
const mocks=vi.hoisted(()=>({sources:vi.fn(),confirm:vi.fn(),ledgers:vi.fn()}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
vi.mock('../components/AppShell',()=>({default:({children})=><div>{children}</div>}));
vi.mock('../data/database',()=>({deleteMonthlyLedger:vi.fn(),formatLedgerPeriod:value=>value,listLedgerSummaries:mocks.ledgers}));
vi.mock('../data/repositories/ledgerOverviewRepository',()=>({withCurrentLedgerResults:async items=>items}));
vi.mock('../data/repositories/salesSourceCoverageRepository',()=>({listSalesSourceConfirmations:mocks.sources,confirmSalesSourceCoverage:mocks.confirm}));
let host,root;
const button=text=>[...host.querySelectorAll('button')].find(node=>node.textContent===text||node.getAttribute('aria-label')===text);
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});}
async function open(index=0){await act(async()=>[...host.querySelectorAll('button')].filter(node=>node.textContent==='台账来源')[index].click());await settle();}
const source=id=>({id:'B-'+id,fileName:id+'-来源.csv',period:id,store:'甲店',rowCount:1,eligible:true});
beforeEach(async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();
 mocks.ledgers.mockResolvedValue(['2026-09','2026-08'].map(period=>({id:period,period,status:'draft',summary:{}})));
 mocks.sources.mockImplementation(async id=>[source(id)]);mocks.confirm.mockResolvedValue({});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<ToastProvider><MonthlyLedger/></ToastProvider>));await settle();
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
it('shows loading before a real empty result instead of claiming there are no sources',async()=>{
 let finish;mocks.sources.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await open();
 expect(host.querySelector('[role=dialog]').textContent).toContain('正在读取本月台账来源');
 expect(host.querySelector('[role=dialog]').textContent).not.toContain('当前来源已确认');
 await act(async()=>finish([]));await settle();expect(host.querySelector('[role=dialog]').textContent).toContain('当前来源已确认');
});
it('contains a source read failure and retries in the selected month before explicit confirmation',async()=>{
 mocks.sources.mockRejectedValueOnce(new Error('来源读取失败样例'));await open();
 expect(host.querySelector('[role=dialog] [role=alert]').textContent).toContain('来源读取失败样例');
 expect(host.querySelectorAll('.ledger-card')).toHaveLength(2);
 await act(async()=>button('重试读取来源').click());await settle();
 expect(host.querySelector('[role=dialog]').textContent).toContain('2026-09-来源.csv');
 await act(async()=>button('确认此来源包含本店整月全部商品').click());await settle();
 expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({ledgerId:'2026-09',batchId:'B-2026-09',confirmed:true});
});
it('does not show a previous month while reading another month or after a stale response resolves',async()=>{
 let finish;mocks.sources.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await open();
 await act(async()=>button('关闭对话框').click());await open(1);
 expect(host.querySelector('[role=dialog]').textContent).toContain('2026-08-来源.csv');
 await act(async()=>finish([source('2026-09')]));await settle();
 expect(host.querySelector('[role=dialog]').textContent).not.toContain('2026-09-来源.csv');
 expect(host.querySelector('[role=dialog]').textContent).toContain('2026-08-来源.csv');
});
