// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {expect,it,vi} from 'vitest';
import {SupplementEditor} from './MonthlyReportManager';
import {ToastProvider} from '../components/UI';
const mock=vi.hoisted(()=>({preview:vi.fn()}));
vi.mock('../data/repositories/profitReportRepository',()=>({previewMonthlySupplement:mock.preview}));
vi.mock('../lib/monthlySupplementImport',()=>({readSupplementWorkbook:async()=>[{fileHash:'NEW',fileName:'new.xlsx',sheetName:'新来源',headerRow:1,cells:[['姓名','数量'],['测试',3]],sourceRows:[1,2]}]}));
it('repeat/cancel previews do not mutate adopted sources or reset an explicitly adopted quantity',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const prior=Object.freeze({fileHash:'OLD',fileName:'old.xlsx',sheetName:'旧来源'});
 const state={ledger:{id:'L',workspaceId:'W',period:'2026-08'},stores:[],dispatch:{sources:Object.freeze([prior]),adoptedQuantityExact:'100',revision:1,rowCount:1},adoptedRows:[{kind:'dispatch',fileHash:'OLD',sourceSheet:'旧来源',sourceRow:2,quantityExact:'10'}]};
 mock.preview.mockImplementation(async input=>({candidate:{...input,missingStores:[]},inputSignature:'preview',expectedBatchId:'OLD'}));
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
 async function mount(){await act(async()=>root.render(<ToastProvider><SupplementEditor state={state} kind="dispatch" onClose={()=>{}} /></ToastProvider>));await act(async()=>Simulate.change(container.querySelector('input[type=file]'),{target:{files:[{}]}}));const checks=container.querySelectorAll('.report-source input[type=checkbox]');await act(async()=>Simulate.change(checks[0],{target:{checked:true}}));await act(async()=>Simulate.change(checks[1],{target:{checked:true}}));}
 await mount();
 for(let i=0;i<2;i++)await act(async()=>button('预览采用').click());
 expect(mock.preview).toHaveBeenCalledTimes(2);
 for(const [input] of mock.preview.mock.calls){expect(input.sources).toHaveLength(2);expect(input.adoptedQuantityExact).toBe('100');}
 expect(state.dispatch.sources).toHaveLength(1);
 await act(async()=>button('取消').click());await act(async()=>root.render(null));await mount();await act(async()=>button('预览采用').click());
 expect(mock.preview.mock.calls.at(-1)[0].sources).toHaveLength(2);expect(mock.preview.mock.calls.at(-1)[0].adoptedQuantityExact).toBe('100');
 await act(async()=>root.unmount());container.remove();
});
