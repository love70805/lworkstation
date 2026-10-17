// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import MonthlyReportManager from './MonthlyReportManager';
import { ToastProvider } from '../components/UI';

const mock=vi.hoisted(()=>({state:null,preview:vi.fn(),save:vi.fn(),read:vi.fn(),download:vi.fn()}));
vi.mock('dexie-react-hooks',()=>({useLiveQuery:()=>mock.state}));
vi.mock('../data/repositories/profitReportRepository',()=>({readMonthlyReportState:vi.fn(),readProfitReportDownload:mock.read,previewMonthlySupplement:vi.fn(),adoptMonthlySupplement:vi.fn(),previewProfitReport:mock.preview,saveProfitReport:mock.save}));
vi.mock('../lib/profitReportWorkbook',()=>({downloadReportFile:mock.download}));
const ledger={id:'L',workspaceId:'W',period:'2026-09',status:'cost_pending',warehouseRate:'0.7'};
const scope={workspaceId:'W',ledgerId:'L',period:'2026-09'};
const dispatch={...scope,id:'D',status:'adopted',adoptedQuantityExact:'10',revision:1};
const deduction={...scope,id:'K',status:'adopted',signedAmountExact:'2',revision:1,coveredStores:['甲'],missingStores:[]};
const base={...scope,id:'B',kind:'pre_deduction',revision:1,createdAt:'2026-10-17',displayTotals:{profit:'100.00'}};
const formal={...base,id:'F',kind:'financial',baseReportId:'B',adoptedBatchIds:['D','K'],registrantNames:['张三'],displayTotals:{profit:'98.00'},totalsExact:{productProfitExact:'93',dispatchAmountExact:'7',deductionExact:'2'}};
let root,container;
const button=name=>[...document.querySelectorAll('button')].find(node=>node.textContent===name);
async function mount(patch={}){
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 for(const name of ['preview','save','read','download'])mock[name].mockReset();
 mock.state={ledgerId:'L',workspaceId:'W',data:{ledger,stores:['甲'],dispatch,deduction,adoptedRows:[],reports:[],...patch}};
 mock.preview.mockResolvedValue({report:formal,fingerprint:'checked'});mock.save.mockResolvedValue(formal);mock.read.mockResolvedValue({report:formal,dispatchRows:[{ownerMarker:'张三'}]});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<ToastProvider><MonthlyReportManager ledgerId="L" workspaceId="W" missingCostCount={0} onEdit={vi.fn()}/></ToastProvider>));
}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();root=null;});
it('provides one direct formal action and saves the checked preview with the ledger-month export name',async()=>{
 await mount();expect(button('预览正式利润表').disabled).toBe(false);expect(button('预览未扣款报告')).toBeUndefined();
 await act(async()=>button('预览正式利润表').click());
 expect(mock.preview).toHaveBeenCalledWith({ledgerId:'L',kind:'financial',baseReportId:undefined});
 expect(document.querySelector('[role=dialog]').textContent).toContain('张三2026年9月利润表.xlsx');
 await act(async()=>button('保存正式利润表并下载').click());
 expect(mock.save).toHaveBeenCalledWith({ledgerId:'L',kind:'financial',baseReportId:undefined},{expectedFingerprint:'checked'});expect(mock.download).toHaveBeenCalledWith(formal);
 expect(document.querySelector('[role=dialog]')).toBeNull();expect(container.textContent).toContain('正式利润表已保存');
});
it('offers the unreceived-deduction path and disables it until dispatch exists',async()=>{
 await mount({deduction:null,dispatch:null});expect(button('预览正式利润表')).toBeUndefined();expect(button('预览未扣款报告').disabled).toBe(true);
 expect(button('登记代发')).toBeDefined();expect(button('登记扣款')).toBeDefined();
});
it('uses the current frozen base when deductions arrive and makes the pending result explicit',async()=>{
 await mount({ledger:{...ledger,status:'finalized',currentBaseReportId:'B'},reports:[base]});
 expect(button('预览正式利润表').disabled).toBe(false);expect(button('更新代发')).toBeUndefined();
 expect(container.textContent).toContain('扣款已更新，待生成');expect(container.textContent).toContain('已保存的未扣款基础');
 await act(async()=>button('预览正式利润表').click());expect(mock.preview).toHaveBeenCalledWith({ledgerId:'L',kind:'financial',baseReportId:'B'});
});
it('makes the saved formal download primary, hides duplicate generation and lists only other reports in history',async()=>{
 await mount({ledger:{...ledger,status:'finalized',currentBaseReportId:'B'},reports:[formal,base]});
 expect(container.textContent).toContain('正式版已保存');expect(button('预览正式利润表')).toBeUndefined();expect(button('预览未扣款报告')).toBeUndefined();
 expect(button('下载正式利润表').classList.contains('button-primary')).toBe(true);expect(container.textContent).toContain('历史报告与基础（1）');
 await act(async()=>button('下载正式利润表').click());expect(mock.read).toHaveBeenCalledWith('F');expect(mock.download).toHaveBeenCalledWith(formal,{dispatchRows:[{ownerMarker:'张三'}]});
});
it('requires a new explicit formal save after deduction replacement and blocks changes while locked',async()=>{
 await mount({ledger:{...ledger,status:'locked',currentBaseReportId:'B'},reports:[formal,base]});
 expect(button('下载正式利润表')).toBeDefined();expect(button('预览正式利润表')).toBeUndefined();expect(button('更新扣款')).toBeUndefined();
 await act(async()=>root.unmount());container.remove();root=null;
 await mount({ledger:{...ledger,status:'finalized',currentBaseReportId:'B'},reports:[formal,base],deduction:{...deduction,id:'NEW'}});
 expect(button('预览正式利润表').disabled).toBe(false);expect(button('下载正式利润表')).toBeUndefined();expect(container.textContent).not.toContain('正式版已保存');
});
it('reports stale preview failures without starting a download or claiming a formal save',async()=>{
 await mount();mock.save.mockRejectedValue(new Error('报告预览已过期，请重新核对。'));
 await act(async()=>button('预览正式利润表').click());await act(async()=>button('保存正式利润表并下载').click());
 expect(container.querySelector('[role=alert]').textContent).toContain('预览已过期');expect(mock.download).not.toHaveBeenCalled();expect(container.textContent).not.toContain('正式版已保存');
});
