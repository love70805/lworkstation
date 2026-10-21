// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ErpInboxReviewDialog, { ErpPendingSkuList } from './ErpInboxReviewPanel';
const entry = (index, extra = {}) => ({ id:'E-'+index, reviewRowId:'R-'+index, inboxId:'I-'+index, batchIndex:index, platformSku:'SKU-'+index, platformSkc:'SKC-'+index, store:'甲店', attribute:'黑色 / 6个装', unitCost:1.8316, reasonText:index===2?'近期采购价明显低于历史区间，请核实是否正常降价':'采购单价为1，请核实真实采购价', currentMissing:true, ...extra });
const makeReview = () => {
 const batches=Array.from({length:6},(_,index)=>({id:'I-'+(index+1),index:index+1,batchId:'B-'+(index+1),skcCount:20,automaticCount:50,currentMissingCount:index<3?1:0,coveredCount:0,historicalExceptionCount:index<3?1:0,inbox:{id:'I-'+(index+1),status:index<3?'pending':'applied',receivedAt:'2026-10-14T00:00:00Z',appliedBatchId:'C-'+index},entries:index<3?[entry(index+1)]:[]}));
 return {batches,exceptions:batches.flatMap(batch=>batch.entries)};
};
let root,container;
const button = text => [...container.querySelectorAll('button')].find(node=>node.textContent===text);
let onLoad,onReview;
function Harness({review=makeReview(),readOnly=false}) {
 const [open,setOpen]=useState(true);
 return <><button onClick={()=>setOpen(true)}>打开总览</button><ErpInboxReviewDialog open={open} review={review} inboxQueue={{items:review.batches.map(batch=>({inbox:batch.inbox,scopeMatched:true}))}} loadedInboxId="I-1" accountingReadOnly={readOnly} ledgerLocked={readOnly} selectedPendingInboxIds={new Set()} onClose={()=>setOpen(false)} onManualImport={()=>{}} onTogglePending={()=>{}} onDeleteSelected={()=>{}} onDeleteOne={()=>{}} onVoid={()=>{}} onLoadInbox={onLoad} onReviewItem={onReview}/></>;
}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);onLoad=vi.fn();onReview=vi.fn();});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
it('shows all six batches, views the already loaded batch and returns to the overview without loading or losing records',async()=>{
 await act(async()=>root.render(<Harness/>));
 expect(container.querySelectorAll('.erp-review-batch')).toHaveLength(6);
 await act(async()=>button('查看第 1 批待处理 SKU').click());
 expect(container.textContent).toContain('第 1 / 6 批回传');
 expect(container.querySelector('.erp-review-sku').textContent).toContain('SKU-1');
 expect(onLoad).not.toHaveBeenCalled();
 await act(async()=>button('返回全部 6 批次').click());
 expect(container.querySelectorAll('.erp-review-batch')).toHaveLength(6);
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
 expect(container.querySelector('[aria-modal="true"]')).toBeNull();
 await act(async()=>button('打开总览').click());
 expect(container.textContent).toContain('ERP 回传总览（6 批）');
 expect(container.querySelectorAll('.erp-review-batch')).toHaveLength(6);
});
it('displays history-price reasons directly with correctly scoped evidence and correction actions',async()=>{
 const review=makeReview();await act(async()=>root.render(<Harness review={review}/>));
 await act(async()=>button('查看第 2 批待处理 SKU').click());
 expect(container.textContent).toContain('近期采购价明显低于历史区间');
 await act(async()=>button('查看证据').click());expect(onReview).toHaveBeenCalledWith(review.batches[1].entries[0],'details');
 await act(async()=>button('人工更正').click());expect(onReview).toHaveBeenLastCalledWith(review.batches[1].entries[0],'edit');
 expect(onLoad).not.toHaveBeenCalled();
});
it('separates a covered historical anomaly from other missing costs without mutating the saved source',async()=>{
 const review=makeReview();review.batches[0]={...review.batches[0],currentMissingCount:0,coveredCount:1,entries:[entry(1,{currentMissing:false})]};review.exceptions=review.batches.slice(1).flatMap(batch=>batch.entries);const before=JSON.stringify(review);
 await act(async()=>root.render(<Harness review={review}/>));
 expect(container.querySelector('.erp-review-batch').textContent).toContain('本批当前无待补项 · 原异常记录保留');
 await act(async()=>button('查看第 1 批记录').click());
 expect(container.querySelectorAll('.erp-review-sku')).toHaveLength(0);
 expect(container.querySelector('.erp-review-covered').textContent).toContain('原核验原因');
 expect(JSON.stringify(review)).toBe(before);
});
it('permits navigation and evidence browsing while a finalized ledger stays read-only',async()=>{
 await act(async()=>root.render(<Harness readOnly/>));await act(async()=>button('查看第 2 批待处理 SKU').click());
 expect(button('人工更正')).toBeUndefined();expect(button('打开本批核对表').disabled).toBe(true);expect(button('撤回本次采用').disabled).toBe(true);
 await act(async()=>button('返回全部 6 批次').click());expect(container.querySelectorAll('.erp-review-batch')).toHaveLength(6);
});
it('explains missing evidence without inventing a source batch and prevents amount correction for ambiguous identity',async()=>{
 await act(async()=>root.render(<ErpPendingSkuList entries={[entry(1,{batchIndex:null,canCorrect:false})]} batchCount={6} onOverview={()=>{}} onReviewItem={onReview}/>));
 expect(container.textContent).toContain('尚无可用回传');expect(container.textContent).not.toContain('第 null 批');expect(button('人工更正')).toBeUndefined();
});

it('bounds large pending lists, keeps all pages accessible and resets only when the filter scope changes', async () => {
 const entries=Array.from({length:101},(_,index)=>entry(index+1));
 const render=async(items=entries,key='all')=>act(async()=>root.render(<ErpPendingSkuList entries={items} paginationResetKey={key} onReviewItem={onReview}/>));
 await render();
 expect(container.querySelectorAll('.erp-review-sku')).toHaveLength(30);
 expect(container.textContent).toContain('共 101 条');
 await act(async()=>container.querySelector('button[aria-label="第 4 页"]').click());
 expect(container.querySelectorAll('.erp-review-sku')).toHaveLength(11);
 expect(container.querySelector('.erp-review-sku').dataset.platformSku).toBe('SKU-91');
 expect(document.activeElement).toBe(container.querySelector('.erp-review-skus'));
 await act(async()=>container.querySelector('button[aria-label="甲店 · SKU-91 · 查看异常详情"]').click());
 expect(onReview).toHaveBeenLastCalledWith(entries[90],'details');
 await render(entries.slice(0,65));
 expect(container.querySelector('.erp-review-sku').dataset.platformSku).toBe('SKU-61');
 await render(entries.slice(0,65),'other-filter');
 expect(container.querySelector('.erp-review-sku').dataset.platformSku).toBe('SKU-1');
 await render(entries.slice(0,29),'small');
 expect(container.querySelectorAll('.erp-review-sku')).toHaveLength(29);
 expect(container.querySelector('.pagination')).toBeNull();
});

