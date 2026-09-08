// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImportPreview from "./ImportPreview";
import { ToastProvider } from "../components/UI";
const mocks = vi.hoisted(() => ({ parse:vi.fn(), validate:vi.fn(), release:vi.fn(), terminate:vi.fn(), preview:vi.fn(), save:vi.fn() }));
vi.mock('../lib/importWorkerClient', () => ({createImportWorkerClient:()=>mocks}));
vi.mock('../data/database', () => ({previewSalesImports:mocks.preview,saveSalesImports:mocks.save}));
let container, root;
const mapping = {platformSku:'SKU',platformSkc:'SKC',quantity:'数量',amount:'金额'};
const summary = {quantity:2,revenue:10,penalty:0};
function button(text) { return [...container.querySelectorAll('button')].find((node)=>node.textContent === text); }
async function click(text) { await act(async()=>button(text).click()); }
async function upload() {
  const input = container.querySelector('input[type=file]');
  const files = [new File(['first'], '甲店.csv'),new File(['second'],'乙店.csv')];
  Object.defineProperty(input,'files',{configurable:true,value:files});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  await act(async()=> { await vi.waitFor(()=>expect(mocks.parse).toHaveBeenCalledTimes(2)); });
  await act(async()=> { for (const box of container.querySelectorAll('.batch-store input[type=checkbox]')) box.click(); });
}
beforeEach(async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.release.mockResolvedValue({});
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:1,previewRows:[{SKU:'000123'}],preset:'generic'});
  mocks.validate.mockResolvedValue({rows:[{platformSku:'000123'}],summary:{validRowCount:1,errorCount:0,ignoredCount:0,errors:[]}});
  mocks.preview.mockImplementation(async(input)=>({ledgerId:'L',targetSignature:'snapshot',inputSignature:'input',requiresOverwrite:true,summary,finalSummary:summary,
    items:input.items.map(item=>({...item,status:'ready',validRowCount:1,ignoredRowCount:0,errorCount:0,summary,addedGroupCount:0,replacedGroupCount:1,overlaps:[{groupKey:item.itemId,store:item.storeName,platformSkc:'父商品',before:{...summary,rowCount:1},after:{...summary,rowCount:1}}]}))}));
  mocks.save.mockResolvedValue({items:[],finalSummary:summary,ledgerId:'L'});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(<MemoryRouter><ToastProvider><ImportPreview/></ToastProvider></MemoryRouter>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('requires per-file store confirmation and clears overwrite approval after configuration edits',async()=>{
  await upload(); await click('统一校验与预览');
  expect(mocks.validate).toHaveBeenCalledTimes(2);
  expect(button('确认整批导入').disabled).toBe(true);
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  expect(button('确认整批导入').disabled).toBe(false);
  // Removing a file is a configuration change and releases its Worker job.
  await click('移除');
  expect(container.querySelector('.batch-preview')).toBeNull();
  expect(mocks.release).toHaveBeenCalledTimes(1);
  await click('统一校验与预览');
  expect(button('确认整批导入').disabled).toBe(true);
});
it('cancels without writing and submits exactly one atomic payload after explicit approval',async()=>{
  await upload();await click('统一校验与预览');
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  await click('确认整批导入'); await click('取消');
  expect(mocks.save).not.toHaveBeenCalled();
  await click('确认整批导入');await click('确认导入');
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0]).toMatchObject({overwriteSignature:'snapshot',items:[{storeName:'甲店'},{storeName:'乙店'}]});
});
it('keeps errors visible per file and blocks the entire preview when any file has error rows',async()=>{
  await upload();
  mocks.validate.mockResolvedValueOnce({rows:[{}],summary:{errorCount:1,ignoredCount:2,errors:[{sourceRow:3,messages:['数量不是有效数字']} ]}});
  await click('统一校验与预览');
  expect(mocks.preview).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
  expect(container.textContent).toContain('第 3 行：数量不是有效数字');
  expect(container.textContent).toContain('整批尚未写入');
});
