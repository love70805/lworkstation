// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfitViewsContent } from './ProfitPanel';
import { ToastProvider } from '../components/UI';
import { saveProfitViewState } from '../lib/profitViewState';
const state=vi.hoisted(()=>({snapshot:{ledger:{id:'L',workspaceId:'W',period:'2026-08',status:'draft',warehouseRate:0.7},rows:[{store:'甲',supplierNumber:'货号A',platformSku:'A',platformSkc:'S',quantity:2,amount:10,sourceAddedDate:'2026-08-01'},{store:'乙',supplierNumber:'货号B',platformSku:'B',platformSkc:'T',quantity:3,amount:30,sourceAddedDate:'2026-08-01'}],costs:[],approvals:[],profitLines:[]}}));
vi.mock('../hooks/useLatestSalesImport',()=>({useLatestSalesImport:()=>state.snapshot}));
vi.mock('./MonthlyReportManager',()=>({default:({onOpenCosts})=><button onClick={onOpenCosts}>补齐本月成本</button>}));
vi.mock('./CostMatching',()=>({CostMatchingContent:({validatedContext,suppliedSnapshot})=>{state.costSnapshot=suppliedSnapshot;return <div data-testid="cost-scope">{validatedContext.store}</div>;}}));
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
  expect(container.querySelectorAll('.profit-summary-products')).toHaveLength(1);
  expect(container.querySelectorAll('.profit-summary-monthly')).toHaveLength(1);
  expect(container.querySelectorAll('.sales-analytics')).toHaveLength(0);
  expect(container.querySelector('.profit-summary-products .profit-summary-item strong').textContent).toBe(`¥${revenue}.00`);
  expect(container.querySelector('.profit-workspace-controls select').value).toBe(store);
  expect(container.querySelector('[aria-label="每日销售店铺"]')).toBeNull();
 }
 expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
});

it('exposes supplier and SKU scope outside collapsed details and shares it across the unified workspace', async () => {
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/profit?ledger=L&view=detail&store=all&missing=0']}><ToastProvider><ProfitViewsContent/></ToastProvider></MemoryRouter>));
 const scope=container.querySelector('[aria-label="台账查询范围"]');
 expect(scope.closest('details')).toBeNull();
 const supplierTrigger=scope.querySelector('[aria-label="按供方货号筛选"]');
 await act(async()=>supplierTrigger.click());
 await act(async()=>scope.querySelector('[aria-label="选择 货号A"]').click());
 await act(async()=>[...scope.querySelectorAll('button')].find(button=>button.textContent==='完成选择').click());
 const search=scope.querySelector('[aria-label="在当前范围搜索 SKC、SKU"]');
 await act(async()=>Simulate.change(search,{target:{value:'T'}}));
 await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));
 expect(container.querySelector('.profit-summary-products .profit-summary-item strong').textContent).toBe('¥30.00');
 expect(state.snapshot.rows).toHaveLength(2);
 await act(async()=>Simulate.change(container.querySelector('.profit-workspace-controls select'),{target:{value:'乙'}}));
 await act(async()=>supplierTrigger.click());
 expect([...scope.querySelectorAll('.supplier-filter-table tbody code')].map(el=>el.textContent)).toEqual(['货号B']);
 await act(async()=>[...scope.querySelectorAll('button')].find(button=>button.textContent==='完成选择').click());
 expect(container.querySelector('[data-testid="cost-scope"]').textContent).toBe('乙');
 expect(state.costSnapshot).toBe(state.snapshot);
 expect(container.querySelector('[aria-label="在当前范围搜索 SKC、SKU"]').value).toBe('T');
 expect(container.querySelector('[aria-label="按供方货号筛选"]').textContent).toBe('货号B');
});

it('keeps export above the unified details for a legacy cost URL while preserving the selected store and search', async () => {
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/profit?ledger=L&view=cost&store=乙&missing=0&q=T']}><ToastProvider><ProfitViewsContent/></ToastProvider></MemoryRouter>));
 expect(container.querySelector('[data-testid="cost-scope"]').textContent).toBe('乙');
 expect(container.querySelector('#monthly-report-section')).not.toBeNull();
 expect(container.querySelector('[data-testid="cost-scope"]')).not.toBeNull();
 expect(container.querySelector('.profit-workspace-controls select').value).toBe('乙');
 expect(container.querySelector('[aria-label="在当前范围搜索 SKC、SKU"]').value).toBe('T');
 expect(container.querySelector('#monthly-report-section').compareDocumentPosition(container.querySelector('[data-testid="cost-scope"]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(container.querySelector('.profit-sales-disclosure')).toBeNull();
 expect(container.querySelector('.sales-analytics')).toBeNull();
});

it('reveals scoped missing rows from the adjacent filter and the whole month from the report action', async () => {
 globalThis.IS_REACT_ACT_ENVIRONMENT=true; localStorage.clear();
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/profit?ledger=L&store=乙&missing=0&q=T']}><ToastProvider><ProfitViewsContent/></ToastProvider></MemoryRouter>));
 const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label);
 await act(async()=>button('只看缺成本').click());
 await act(async()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 expect(container.querySelectorAll('.profit-variant-row')).toHaveLength(1);
 expect(button('只看缺成本').getAttribute('aria-pressed')).toBe('true');
 expect(container.querySelector('.profit-workspace-controls select').value).toBe('乙');
 expect(container.querySelector('[aria-label="在当前范围搜索 SKC、SKU"]').value).toBe('T');
 await act(async()=>button('补齐本月成本').click());
 await act(async()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 expect(container.querySelectorAll('.profit-variant-row')).toHaveLength(2);
 expect(container.querySelectorAll('.profit-table thead')).toHaveLength(1);
 expect(document.activeElement).toBe(button('只看缺成本'));
 expect(container.querySelector('.profit-workspace-controls select').value).toBe('all');
 expect(container.querySelector('[aria-label="在当前范围搜索 SKC、SKU"]').value).toBe('');
 await act(async()=>button('全部').click());
 expect(button('全部').getAttribute('aria-pressed')).toBe('true');
});

it('opens a collapsed detail section at the missing rows of just the dashboard store', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  saveProfitViewState(JSON.stringify(['W', 'L', 'details']), { detailsOpen: false });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/profit?view=detail&ledger=L&store=乙&missing=1#profit-detail-area']}>
      <ToastProvider><ProfitViewsContent /></ToastProvider>
    </MemoryRouter>
  ));
  await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
  const details = container.querySelector('#profit-detail-area');
  expect(details.querySelector('details').open).toBe(true);
  expect(details.querySelectorAll('.profit-variant-row')).toHaveLength(1);
  expect(details.querySelector('.profit-variant-row').textContent).toContain('B');
  expect(container.querySelector('.profit-workspace-controls select').value).toBe('乙');
  expect(document.activeElement).toBe(details.querySelector('.profit-status-switch [aria-pressed="true"]'));
});
