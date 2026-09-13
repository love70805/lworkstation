// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfitViewsContent } from './ProfitPanel';
import { ToastProvider } from '../components/UI';
import { aggregateDailySales } from '../domain/salesAnalytics';
const state=vi.hoisted(()=>({snapshot:{ledger:{id:'L',workspaceId:'W',period:'2026-08',status:'draft',warehouseRate:0.7},rows:[{store:'甲',platformSku:'A',platformSkc:'S',quantity:2,amount:10,sourceAddedDate:'2026-08-01'},{store:'乙',platformSku:'B',platformSkc:'T',quantity:3,amount:30,sourceAddedDate:'2026-08-01'}],costs:[],approvals:[],profitLines:[]}}));
vi.mock('../hooks/useLatestSalesImport',()=>({useLatestSalesImport:()=>state.snapshot}));
vi.mock('../data/repositories/salesAnalyticsRepository',()=>({readLedgerSalesAnalytics:async({store})=>aggregateDailySales(state.snapshot.rows.filter(row=>store==='all'||row.store===store),{period:'2026-08'}),readLedgerDailySalesDetails:vi.fn()}));
vi.mock('./MonthlyReportManager',()=>({default:()=>null}));
let root,container;
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
it('replaces scoped siblings through all → 甲 → 乙 without retaining prior profit or sales DOM',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/profit?ledger=L&view=detail&store=all&missing=0']}><ToastProvider><ProfitViewsContent/></ToastProvider></MemoryRouter>));
 for(const [store,revenue,quantity] of [['all','40','5'],['甲','10','2'],['乙','30','3']]){
  if(store!=='all')await act(async()=>Simulate.change(container.querySelector('[aria-label="每日销售店铺"]'),{target:{value:store}}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  expect(container.querySelectorAll('.profit-summary-strip')).toHaveLength(1);
  expect(container.querySelectorAll('.sales-analytics')).toHaveLength(1);
  expect(container.querySelector('.profit-summary-item strong').textContent).toBe(`¥${revenue}.00`);
  expect(container.querySelector('#profit-store').value).toBe(store);
  expect(container.querySelector('.sales-analytics').textContent).toContain(`销售原额 ¥${revenue} · 销量 ${quantity} 件`);
  expect(container.querySelector('[aria-label="每日销售店铺"]').value).toBe(store);
 }
 expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
});
