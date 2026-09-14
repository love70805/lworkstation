// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {ProfitWorkspaceContent} from './ProfitPanel';
import {ToastProvider} from '../components/UI';
const state=vi.hoisted(()=>({snapshot:null}));
vi.mock('../hooks/useLatestSalesImport',()=>({useLatestSalesImport:()=>state.snapshot}));
let container,root;
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it.each([{penalty:1},{amountExact:'invalid decimal'}])('shows an actionable calculation error instead of old profit for %j',async patch=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 state.snapshot={ledger:{id:'L',workspaceId:'W',period:'2026-08',status:'draft',warehouseRate:0.7},rows:[{workspaceId:'W',ledgerId:'L',store:'甲',platformSku:'SKU',platformSkc:'SKC',quantity:1,amount:10,penalty:0,...patch}],costs:[],approvals:[],profitLines:[]};
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<MemoryRouter><ToastProvider><ProfitWorkspaceContent /></ToastProvider></MemoryRouter>));
 expect(container.textContent).toContain('本月利润待处理');
 expect(container.textContent).toContain('尚未计算商品利润');
 expect(container.textContent).toContain('核对月度账本');
 expect([...container.querySelectorAll('button')].find(button=>button.textContent==='预览并定稿').disabled).toBe(true);
 expect(container.querySelector('.profit-summary-total')).toBeNull();
});
