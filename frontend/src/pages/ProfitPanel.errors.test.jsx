import 'fake-indexeddb/auto';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import {ProfitWorkspaceContent} from './ProfitPanel';
import {ToastProvider} from '../components/UI';
const state=vi.hoisted(()=>({row:null}));
vi.mock('../hooks/useLatestSalesImport',()=>({useLatestSalesImport:()=>({ledger:{id:'L',workspaceId:'W',period:'2026-08',status:'draft',warehouseRate:0.7},rows:[state.row],costs:[],approvals:[],profitLines:[]})}));
it.each([{penalty:1},{amountExact:'invalid decimal'}])('shows an actionable calculation error instead of old profit for %j',patch=>{
 state.row={workspaceId:'W',ledgerId:'L',store:'甲',platformSku:'SKU',platformSkc:'SKC',quantity:1,amount:10,penalty:0,...patch};
 const html=renderToStaticMarkup(<MemoryRouter><ToastProvider><ProfitWorkspaceContent ledgerId="L" /></ToastProvider></MemoryRouter>);
 expect(html).toContain('本月利润待处理');
 expect(html).toContain('尚未计算商品利润');
 expect(html).toContain('核对月度账本');
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span>预览并定稿/);
 expect(html).not.toContain('profit-summary-total');
});
