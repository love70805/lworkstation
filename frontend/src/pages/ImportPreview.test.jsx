// @vitest-environment happy-dom
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImportPreview from "./ImportPreview";
import { ToastProvider } from "../components/UI";
const mocks = vi.hoisted(() => ({ parse:vi.fn(), inspectPeriod:vi.fn(), validate:vi.fn(), release:vi.fn(), terminate:vi.fn(), preview:vi.fn(), save:vi.fn() }));
vi.mock('../lib/importWorkerClient', () => ({createImportWorkerClient:()=>mocks}));
vi.mock('../data/database', () => ({previewSalesImports:mocks.preview,saveSalesImports:mocks.save}));
let container, root;
const mapping = {platformSku:'SKU',platformSkc:'SKC',quantity:'数量',amount:'金额'};
const summary = {quantity:2,revenue:10,penalty:0};
function button(text) { return [...container.querySelectorAll('button')].find((node)=>node.textContent === text); }
async function click(text) { await act(async()=>button(text).click()); }
async function upload(selectPeriod = true) {
  const input = container.querySelector('input[type=file]');
  const files = [new File(['first'], '甲店.csv'),new File(['second'],'乙店.csv')];
  Object.defineProperty(input,'files',{configurable:true,value:files});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  await act(async()=> { await vi.waitFor(()=>expect(mocks.parse).toHaveBeenCalledTimes(2)); });
  if (selectPeriod) await act(async()=>Simulate.change(container.querySelector('#ledger-period'),{target:{value:'2026-08'}}));
}
beforeEach(async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.release.mockResolvedValue({});
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:1,previewRows:[{SKU:'000123'}],preset:'generic'});
  mocks.inspectPeriod.mockResolvedValue({ evidence: { sourceField:'sourceAddedAt', sourceColumn:'', distribution:[], validCount:0, missingCount:1, invalidCount:0, errorCount:0, eligibleCount:1, suggestedPeriod:null } });
  mocks.validate.mockResolvedValue({rows:[{platformSku:'000123'}],summary:{validRowCount:1,errorCount:0,ignoredCount:0,errors:[]}});
  mocks.preview.mockImplementation(async(input)=>({ledgerId:'L',targetSignature:'snapshot',inputSignature:'input',requiresOverwrite:true,summary,finalSummary:summary,
    items:input.items.map(item=>({...item,status:'ready',validRowCount:1,ignoredRowCount:0,errorCount:0,summary,addedGroupCount:0,replacedGroupCount:1,overlaps:[{groupKey:item.itemId,store:item.storeName,platformSkc:'父商品',before:{...summary,rowCount:1},after:{...summary,rowCount:1}}]}))}));
  mocks.save.mockResolvedValue({items:[],finalSummary:summary,ledgerId:'L'});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(<MemoryRouter><ToastProvider><ImportPreview/></ToastProvider></MemoryRouter>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('validates without per-file checkboxes and clears overwrite approval after configuration edits',async()=>{
  await upload(); await click('统一校验与预览');
  expect(container.querySelector('.batch-store input[type=checkbox]')).toBeNull();
  expect(mocks.validate).toHaveBeenCalledTimes(2);
  expect(button('确认导入').disabled).toBe(true);
  await click('确认导入');expect(mocks.save).not.toHaveBeenCalled();
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  expect(button('确认导入').disabled).toBe(false);
  // Removing a file is a configuration change and releases its Worker job.
  await click('移除');
  expect(container.querySelector('.batch-preview')).toBeNull();
  expect(mocks.release).toHaveBeenCalledTimes(1);
  await click('统一校验与预览');
  expect(button('确认导入').disabled).toBe(true);
});
it('previews without writing and submits once directly without a second confirmation dialog',async()=>{
  await upload();await click('统一校验与预览');
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  expect(mocks.save).not.toHaveBeenCalled();
  expect(container.querySelector('[role=dialog]')).toBeNull();
  let finish;
  mocks.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const submit=button('确认导入');
  await act(async()=>{submit.click();submit.click();});
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(submit.disabled).toBe(true);
  await act(async()=>finish({items:[],finalSummary:summary,ledgerId:'L'}));
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
it('blocks an empty store and invalidates the preview when the month, store or mapping changes',async()=>{
  await upload();
  const store=container.querySelector('.batch-store input');
  await act(async()=>Simulate.change(store,{target:{value:''}}));
  expect(button('统一校验与预览').disabled).toBe(true);
  await click('统一校验与预览');expect(mocks.validate).not.toHaveBeenCalled();
  expect(container.textContent).toContain('请填写所属店铺');
  await act(async()=>Simulate.change(store,{target:{value:'甲店'}}));
  for(const [selector,value] of [['#ledger-period','2026-07'],['.batch-store input','修正店铺'],['select[aria-label="甲店.csv 平台 SKU"]','']]){
    await click('统一校验与预览');
    expect(container.querySelector('.batch-preview')).not.toBeNull();
    const input=container.querySelector(selector);
    expect(input).not.toBeNull();
    await act(async()=>Simulate.change(input,{target:{value}}));
    expect(container.querySelector('.batch-preview')).toBeNull();
    expect(button('确认导入')).toBeUndefined();
  }
});
it('imports a non-overwriting preview with one confirmation and no extra checkbox',async()=>{
  const original=mocks.preview.getMockImplementation();
  mocks.preview.mockImplementationOnce(async input=>({...await original(input),requiresOverwrite:false}));
  await upload();await click('统一校验与预览');
  expect(container.querySelector('input[type=checkbox]')).toBeNull();
  expect(button('确认导入').disabled).toBe(false);
  await click('确认导入');
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role=dialog]')).toBeNull();
  expect(container.textContent).toContain('整批处理完成');
});
it('retains default movement filters and invalidates the preview when a filter changes',async()=>{
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:1,previewRows:[{SKU:'000123'}],preset:'ledger_report',facets:{movementTypes:['平台客单发货','客单发货','盘亏'],supplierNumbers:['货号A','货号B']}});
  await upload();await click('统一校验与预览');
  expect(mocks.validate.mock.calls[0][2]).toMatchObject({movementTypes:['平台客单发货','客单发货'],supplierNumbers:['货号A','货号B'],deriveAmountFromUnitPrice:true});
  expect(container.querySelector('.batch-advanced').open).toBe(false);
  await act(async()=>container.querySelector('.batch-filters input').click());
  expect(container.querySelector('.batch-preview')).toBeNull();
  await click('统一校验与预览');
  expect(mocks.validate.mock.calls[2][2].movementTypes).toEqual(['客单发货']);
});
it.each(['同一店铺不能重复分配','文件含多个店铺，与目标店铺冲突'])('surfaces store validation rejection: %s',async message=>{
  await upload();mocks.preview.mockRejectedValueOnce(new Error(message));
  await click('统一校验与预览');
  expect(container.textContent).toContain(message);
  expect(container.querySelector('.batch-preview')).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.validate.mock.calls[0][2]).toMatchObject({defaultStore:'甲店',enforceSingleStore:true});
});
it('keeps parse failure visible and blocks validation',async()=>{
  mocks.parse.mockRejectedValueOnce(new Error('无法读取文件'));
  await upload();
  expect(container.textContent).toContain('解析失败：无法读取文件');
  expect(button('统一校验与预览').disabled).toBe(true);
  expect(mocks.preview).not.toHaveBeenCalled();
});
it('requires a fresh preview and overwrite approval after an atomic submission fails',async()=>{
  await upload();await click('统一校验与预览');
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  mocks.save.mockRejectedValueOnce(new Error('账本状态已变化'));
  await click('确认导入');
  expect(container.textContent).toContain('整批未写入：账本状态已变化');
  expect(container.querySelector('.batch-preview')).toBeNull();
  await click('统一校验与预览');
  expect(button('确认导入').disabled).toBe(true);
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it('auto-selects a complete single source month and requires an explicit choice after a new conflicting file',async()=>{
  mocks.inspectPeriod.mockResolvedValueOnce({ evidence: { distribution:[{month:'2026-07',count:2}], suggestedPeriod:'2026-07', missingCount:0, invalidCount:0, errorCount:0 } });
  mocks.inspectPeriod.mockResolvedValueOnce({ evidence: { distribution:[{month:'2026-07',count:1}], suggestedPeriod:'2026-07', missingCount:0, invalidCount:0, errorCount:0 } });
  await upload(false);
  expect(container.querySelector('#ledger-period').value).toBe('2026-07');
  expect(button('统一校验与预览').disabled).toBe(false);
  mocks.inspectPeriod.mockResolvedValueOnce({ evidence: { distribution:[{month:'2026-08',count:1}], suggestedPeriod:'2026-08', missingCount:0, invalidCount:0, errorCount:0 } });
  const input=container.querySelector('input[type=file]');
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['third'],'丙店.csv')]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  expect(container.querySelector('#ledger-period').value).toBe('');
  expect(container.textContent).toContain('2026-07');
  expect(container.textContent).toContain('2026-08');
  expect(button('统一校验与预览').disabled).toBe(true);
  await act(async()=>Simulate.change(container.querySelector('#ledger-period'),{target:{value:'2026-08'}}));
  expect(button('统一校验与预览').disabled).toBe(false);
});
it('keeps a user-selected month when later file inspection completes',async()=>{
  await upload();
  mocks.inspectPeriod.mockResolvedValueOnce({ evidence: { distribution:[{month:'2026-06',count:1}], suggestedPeriod:'2026-06', missingCount:0, invalidCount:0, errorCount:0 } });
  const input=container.querySelector('input[type=file]');
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['third'],'丙店.csv')]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  expect(container.querySelector('#ledger-period').value).toBe('2026-08');
});
