// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import WarehouseHistoryDialog from './WarehouseHistoryDialog';
const mock=vi.hoisted(()=>({preview:vi.fn(),save:vi.fn()}));
vi.mock('../data/repositories/profitRepository',()=>({previewWarehouseHistoryCosts:mock.preview,saveWarehouseHistoryCosts:mock.save}));
let root,host;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();root=null;vi.clearAllMocks();});
it('imports once and applies all eligible missing items in one action',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 mock.preview.mockResolvedValue({warehouseCount:1,ready:[{store:'甲店',platformSku:'SKU-A',warehouseSku:'WH-A',unitCost:0.35}],pending:[]});
 mock.save.mockResolvedValue({savedCount:1,pending:[]});
 const onClose=vi.fn(),onSaved=vi.fn();host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<WarehouseHistoryDialog ledger={{id:'L',period:'2026-09'}} onClose={onClose} onSaved={onSaved}/>));
 const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{value:[{name:'history.json',size:10,text:async()=>JSON.stringify({format:'fixture'})}]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(document.body.textContent).toContain('可补齐 1 项');
 const apply=[...document.querySelectorAll('button')].find(x=>x.textContent==='补齐 1 项成本');
 await act(async()=>apply.click());
 expect(mock.save).toHaveBeenCalledExactlyOnceWith({ledgerId:'L',history:{format:'fixture'},sourceName:'history.json'});
 expect(onSaved).toHaveBeenCalledWith({savedCount:1,pending:[]});expect(onClose).toHaveBeenCalledOnce();
});
