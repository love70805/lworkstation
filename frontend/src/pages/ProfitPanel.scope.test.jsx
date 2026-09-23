// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfitViewsContent } from './ProfitPanel';
import { ToastProvider } from '../components/UI';
const state=vi.hoisted(()=>({snapshot:{ledger:{id:'L',workspaceId:'W',period:'2026-08',status:'draft',warehouseRate:0.7},rows:[{store:'甲',platformSku:'A',platformSkc:'S',quantity:2,amount:10,sourceAddedDate:'2026-08-01'},{store:'乙',platformSku:'B',platformSkc:'T',quantity:3,amount:30,sourceAddedDate:'2026-08-01'}],costs:[],approvals:[],profitLines:[]}}));
vi.mock('../hooks/useLatestSalesImport',()=>({useLatestSalesImport:()=>state.snapshot}));
vi.mock('./MonthlyReportManager',()=>({default:()=>null}));
let root,container;
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
it('replaces profit scope through all → 甲 → 乙 and never renders sales analytics',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/profit?ledger=L&view=detail&store=all&missing=0']}><ToastProvider><ProfitViewsContent/></ToastProvider></MemoryRouter>));
 for(const [store,revenue] of [['all','40'],['甲','10'],['乙','30']]){
  if(store!=='all')await act(async()=>Simulate.change(container.querySelector('.profit-workspace-controls select'),{target:{value:store}}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  expect(container.querySelectorAll('.profit-summary-strip')).toHaveLength(1);
  expect(container.querySelectorAll('.sales-analytics')).toHaveLength(0);
  expect(container.querySelector('.profit-summary-item strong').textContent).toBe(`¥${revenue}.00`);
  expect(container.querySelector('.profit-workspace-controls select').value).toBe(store);
  expect(container.querySelector('[aria-label="每日销售店铺"]')).toBeNull();
 }
 expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
});
