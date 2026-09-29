// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {afterEach,expect,it,vi} from 'vitest';
import {SupplementEditor} from './MonthlyReportManager';
import {ToastProvider} from '../components/UI';
import {normalizeSupplementCandidate} from '../domain/monthlySupplements';
const mock=vi.hoisted(()=>({preview:vi.fn(),adopt:vi.fn(),read:vi.fn()}));
vi.mock('../data/repositories/profitReportRepository',()=>({previewMonthlySupplement:mock.preview,adoptMonthlySupplement:mock.adopt}));
vi.mock('../lib/monthlySupplementImport',()=>({readSupplementWorkbook:mock.read}));
const base={ledger:{id:'L',workspaceId:'W',period:'2026-08'},stores:['甲'],adoptedRows:[]};
const source=(hash='NEW',cells=[['登记人','店铺','订单号','数量'],['甲人','甲','A',3],['乙人','甲','B',7]])=>({fileHash:hash,fileName:`${hash}.csv`,sheetName:'CSV',sourceFormat:'csv',headerRow:1,cells,sourceRows:cells.map((_,i)=>i+1),recordRows:cells.map((_,i)=>i+1)});
let root,container;
function check(input,state=base){return {candidate:normalizeSupplementCandidate(input,{ledger:state.ledger,stores:state.stores}),inputSignature:'signature',expectedBatchId:state.dispatch?.id??null};}
async function mount(state=base,kind='dispatch'){
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;mock.preview.mockReset();mock.adopt.mockReset();mock.read.mockReset();
 mock.read.mockImplementation(async file=>file.sources??[source()]);mock.preview.mockImplementation(async input=>check(input,state));mock.adopt.mockResolvedValue({id:'saved'});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 const close=vi.fn();await act(async()=>root.render(<ToastProvider><SupplementEditor state={state} kind={kind} onClose={close}/></ToastProvider>));return close;
}
const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
const field=text=>[...container.querySelectorAll('label')].find(node=>node.firstChild?.textContent===text)?.querySelector('input,select');
async function change(node,value){await act(async()=>Simulate.change(node,{target:{value}}));}
async function upload(sources){await act(async()=>Simulate.change(container.querySelector('input[type=file]'),{target:{files:[{sources}]}}));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();root=null;});
it('defaults to no registrant, searches identified names and previews append/replacement totals without mutating prior sources',async()=>{
 const prior=Object.freeze({fileHash:'OLD',fileName:'old.xlsx',sheetName:'旧来源'});
 const state={...base,dispatch:{id:'OLD',sources:Object.freeze([prior]),adoptedQuantityExact:'10',revision:1,rowCount:1},adoptedRows:[{kind:'dispatch',fileHash:'OLD',sourceSheet:'旧来源',sourceRow:2,ownerMarker:'此前人员',quantityExact:'10'}]};
 await mount(state);await upload([source()]);expect(mock.preview).not.toHaveBeenCalled();expect(field('登记人').value).toBe('');
 expect(container.textContent).not.toContain('预览采用');expect(container.querySelector('.report-source input[type=checkbox]')).toBeNull();
 await change(field('搜索登记人'),'甲人');expect([...field('登记人').options].map(option=>option.text)).not.toContain('乙人');
 await change(field('登记人'),'甲人');expect(container.textContent).toContain('本次筛选新增 1 行 / 3 件；保留已有 1 行');expect(container.textContent).toContain('整月 10 → 13 件');
 await upload([source()]);expect(container.textContent).toContain('重复文件/工作表已跳过');expect(container.querySelectorAll('.report-source')).toHaveLength(1);
 await change(field('已有来源处理'),'replace');expect(container.textContent).toContain('整月 10 → 3 件');expect(container.textContent).toContain('全部已有来源将被本次内容替换');
 expect(state.dispatch.sources).toHaveLength(1);await act(async()=>button('导入并更新本月来源').click());expect(mock.adopt).toHaveBeenCalledTimes(1);expect(mock.adopt.mock.calls[0][0].rows).toHaveLength(1);
});
it('keeps an explicit old manual aggregate when adding file records',async()=>{
 await mount({...base,dispatch:{mode:'manual',adoptedQuantityExact:'10',revision:1,rowCount:0,sources:[]}});await upload([source()]);await change(field('登记人'),'甲人');
 expect(container.textContent).toContain('整月 10 → 13 件');
});
it('ignores out-of-order preview responses and can only adopt the latest registrant selection',async()=>{
 await mount();const pending=[];mock.preview.mockImplementation(input=>new Promise(resolve=>pending.push({input,resolve})));
 await upload([source()]);await change(field('登记人'),'甲人');expect(button('导入本月来源').disabled).toBe(true);
 await change(field('登记人'),'乙人');expect(pending).toHaveLength(2);
 await act(async()=>pending[1].resolve(check(pending[1].input)));expect(container.textContent).toContain('采用 7 件');
 await act(async()=>pending[0].resolve(check(pending[0].input)));expect(container.textContent).toContain('采用 7 件');
 await act(async()=>button('导入本月来源').click());expect(mock.adopt.mock.calls[0][0].rows.map(row=>row.ownerMarker)).toEqual(['乙人']);
});
it('shows empty skipped selections and mapping failures without making a zero-value import',async()=>{
 await mount();await upload([source('EMPTY',[['登记人','店铺','订单号','数量'],['甲人','甲','EMPTY',' ']])]);await change(field('登记人'),'甲人');
 expect(container.textContent).toContain('已跳过 1 条无数量记录');expect(container.textContent).toContain('没有有效记录');expect(mock.preview).not.toHaveBeenCalled();expect(button('导入本月来源').disabled).toBe(true);
 await upload([source('BROKEN',[['姓名','订单号','未知'],['乙人','BROKEN',2]])]);expect(container.textContent).toContain('未识别数量列');
});
it('resolves only real cross-file conflicts in place and refreshes automatically after keeping or excluding rows',async()=>{
 await mount();await upload([source('ONE'),source('TWO')]);await change(field('登记人'),'甲人');
 expect(container.textContent).toContain('跨文件相似记录');expect(button('导入本月来源').disabled).toBe(true);
 await act(async()=>button('保留全部记录').click());expect(button('导入本月来源').disabled).toBe(false);expect(mock.preview.mock.calls.at(-1)[0].reviewedCrossFileConflicts).toBe(true);
 await act(async()=>button('排除此条').click());expect(container.textContent).not.toContain('跨文件相似记录');expect(container.textContent).toContain('采用 3 件');expect(mock.preview.mock.calls.at(-1)[0].sources[1].excludedRows).toMatchObject([{sourceRow:2,businessId:'A'}]);
});
it('keeps signed deduction and supplier substring selection with automatic preview',async()=>{
 await mount(base,'deduction');await upload([source('DEDUCTION',[['供方货号','店铺','订单号','分摊金额'],['CODE-X','甲','ORDER','-0.899'],['CODE-Y','甲','ORDER','0']])]);
 await change(container.querySelector('[aria-label="供方货号或标记"]'),'CODE');expect(button('导入本月来源').disabled).toBe(true);
 await change(field('货号匹配方式'),'contains');expect(container.textContent).toContain('有符号扣款合计 -0.899 元');expect(mock.preview.mock.calls.at(-1)[0].rows).toHaveLength(2);
});
it('does not ask again about previously reviewed conflicts when adding unrelated records',async()=>{
 const row={kind:'dispatch',fileHash:'OLD-A',sourceName:'old-a.csv',sourceSheet:'CSV',sourceRow:2,store:'甲',businessId:'OLD-ORDER',quantityExact:'2'};
 await mount({...base,dispatch:{adoptedQuantityExact:'4',rowCount:2,revision:1,sources:[],reviewedCrossFileConflicts:true},adoptedRows:[row,{...row,fileHash:'OLD-B',sourceName:'old-b.csv'}]});
 await upload([source()]);await change(field('登记人'),'甲人');expect(container.textContent).not.toContain('跨文件相似记录');expect(button('导入并更新本月来源').disabled).toBe(false);
});
