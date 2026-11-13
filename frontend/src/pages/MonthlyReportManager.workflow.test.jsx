// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import MonthlyReportManager from './MonthlyReportManager';
import MonthlyProfitSummary from './MonthlyProfitSummary';
import {monthlyProfitSummary} from '../domain/monthlyProfitSummary';
import { ToastProvider } from '../components/UI';

const mock=vi.hoisted(()=>({state:null,preview:vi.fn(),save:vi.fn(),read:vi.fn(),download:vi.fn()}));
vi.mock('dexie-react-hooks',()=>({useLiveQuery:()=>mock.state}));
vi.mock('../data/repositories/profitReportRepository',()=>({readMonthlyReportState:vi.fn(),readProfitReportDownload:mock.read,previewMonthlySupplement:vi.fn(),adoptMonthlySupplement:vi.fn(),previewProfitReport:mock.preview,saveProfitReport:mock.save,createCurrentProfitReport:mock.save}));
vi.mock('../lib/profitReportWorkbook',()=>({downloadReportFile:mock.download}));
const ledger={id:'L',workspaceId:'W',period:'2026-09',status:'cost_pending',warehouseRate:'0.7'};
const scope={workspaceId:'W',ledgerId:'L',period:'2026-09'};
const dispatch={...scope,id:'D',status:'adopted',adoptedQuantityExact:'10',revision:1};
const deduction={...scope,id:'K',status:'adopted',signedAmountExact:'2',revision:1,coveredStores:['甲'],missingStores:[]};
const base={...scope,id:'B',kind:'pre_deduction',revision:1,createdAt:'2026-10-17',warehouseRateExact:'0.7',totalsExact:{productProfitExact:'93',dispatchQuantityExact:'10',dispatchAmountExact:'7'},displayTotals:{profit:'100.00'}};
const formal={...base,id:'F',kind:'financial',baseReportId:'B',adoptedBatchIds:['D','K'],registrantNames:['张三'],displayTotals:{profit:'98.00'},totalsExact:{productProfitExact:'93',dispatchAmountExact:'7',deductionExact:'2'}};
let root,container;
const button=name=>[...document.querySelectorAll('button')].find(node=>node.textContent===name);
async function mount(patch={},controls={}){
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 for(const name of ['preview','save','read','download'])mock[name].mockReset();
 mock.state={ledgerId:'L',workspaceId:'W',data:{ledger,stores:['甲'],dispatch,deduction,adoptedRows:[],reports:[],...patch}};
 mock.preview.mockResolvedValue({report:formal,fingerprint:'checked'});mock.save.mockResolvedValue(formal);mock.read.mockResolvedValue({report:formal,dispatchRows:[{ownerMarker:'张三'}]});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<ToastProvider><MonthlyReportManager ledgerId="L" workspaceId="W" missingCostCount={0} editor={controls.editor} onEdit={controls.onEdit??vi.fn()}/></ToastProvider>));
}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();root=null;});
it('directly exports the checked current report in one click without a finalization dialog',async()=>{
 await mount();expect(button('导出利润表').disabled).toBe(false);await act(async()=>button('导出利润表').click());
 expect(mock.preview).not.toHaveBeenCalled();expect(mock.save).toHaveBeenCalledWith({ledgerId:'L',kind:'financial'},expect.objectContaining({onProgress:expect.any(Function)}));expect(mock.download).toHaveBeenCalledWith(formal);
 expect(document.querySelector('[role=dialog]')).toBeNull();expect(container.textContent).not.toMatch(/定稿|重开/);
});
it('exports without optional dispatch or pending deductions and keeps both source entries available',async()=>{
 await mount({deduction:null,dispatch:null});expect(button('导出未扣款报告').disabled).toBe(false);expect(button('登记代发')).toBeDefined();expect(button('登记扣款')).toBeDefined();
 await act(async()=>button('导出未扣款报告').click());expect(mock.save).toHaveBeenCalledWith({ledgerId:'L',kind:'pre_deduction'},expect.any(Object));
});
it('uses current data for legacy finalized ledgers and permits source updates directly',async()=>{
 const onEdit=vi.fn();await mount({ledger:{...ledger,status:'finalized',currentBaseReportId:'B'},reports:[base]},{onEdit});
 expect(button('导出利润表').disabled).toBe(false);await act(async()=>button('更新代发').click());expect(onEdit).toHaveBeenCalledWith('dispatch');
 await act(async()=>button('导出利润表').click());expect(mock.save).toHaveBeenCalledWith({ledgerId:'L',kind:'financial'},expect.any(Object));
});
it('keeps historical downloads separate from the direct current export and allows regenerating after data edits',async()=>{
 await mount({ledger:{...ledger,status:'finalized',currentBaseReportId:'B'},reports:[formal,base]});
 expect(button('导出利润表')).toBeDefined();expect(container.textContent).toContain('历史导出（2）');expect(button('更新扣款')).toBeDefined();
 await act(async()=>button('下载此报告').click());expect(mock.read).toHaveBeenCalledWith('F');expect(mock.download).toHaveBeenCalledWith(formal,{dispatchRows:[{ownerMarker:'张三'}],deductionRows:undefined,useStoredFile:true});
});
it('does not close a source editor when a prior report exists',async()=>{
 const onEdit=vi.fn();await mount({ledger:{...ledger,status:'locked',currentBaseReportId:'B'},reports:[base,formal]},{editor:'deduction',onEdit});
 expect(onEdit).not.toHaveBeenCalledWith(null);expect(document.querySelector('[role=dialog]')).not.toBeNull();
});
it('keeps the monthly summary source entry editable for the operating workflow',async()=>{
 await mount();const onEdit=vi.fn(),target={...ledger,status:'ready',operationWorkflow:2};
 const summary=monthlyProfitSummary({ledger:target,missingCostCount:0,productProfitExact:'93',reportState:{ledgerId:'L',workspaceId:'W',data:{ledger:target,stores:['甲'],dispatch,deduction,reports:[formal]}}});
 await act(async()=>root.render(<MonthlyProfitSummary summary={summary} ledger={target} onEdit={onEdit}/>));
 expect(button('更新扣款')).toBeDefined();await act(async()=>button('更新扣款').click());expect(onEdit).toHaveBeenCalledWith('deduction');
});
it('reports a stale snapshot without downloading a file or claiming success',async()=>{
 await mount();mock.save.mockRejectedValue(new Error('报告预览已过期，请重新核对。'));await act(async()=>button('导出利润表').click());
 expect(container.querySelector('[role=alert]').textContent).toContain('预览已过期');expect(mock.download).not.toHaveBeenCalled();
});
it('guards double clicks while a report is being prepared',async()=>{
 await mount();let finish;mock.save.mockImplementationOnce((_input,{onProgress})=>{onProgress('正在核对台账与成本…');return new Promise(resolve=>{finish=resolve;});});
 await act(async()=>{button('导出利润表').click();button('导出利润表').click();});expect(mock.save).toHaveBeenCalledTimes(1);expect(mock.preview).not.toHaveBeenCalled();expect(container.textContent).toContain('正在核对台账与成本…');
 await act(async()=>finish(formal));expect(mock.save).toHaveBeenCalledTimes(1);expect(mock.download).toHaveBeenCalledTimes(1);
});
