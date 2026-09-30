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

async function settled() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); }); }
it('automatically validates and previews all files without any write or product filter', async () => {
  await upload(); await settled();
  expect(mocks.validate).toHaveBeenCalledTimes(2);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(button('统一校验与预览')).toBeUndefined();
  expect(container.querySelector('.batch-filters')).toBeNull();
  expect(button('导入').disabled).toBe(true);
});
it('imports a normal batch with one click and prevents double submits', async () => {
  const original = mocks.preview.getMockImplementation();
  mocks.preview.mockImplementation(async input => ({ ...await original(input), requiresOverwrite:false }));
  await upload(); await settled();
  expect(container.querySelector('input[type=checkbox]')).toBeNull();
  let finish;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { button('导入').click(); button('导入').click(); });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(button('导入').disabled).toBe(true);
  await act(async () => finish({items:[],finalSummary:summary,ledgerId:'L'}));
  expect(container.textContent).toContain('整批处理完成');
});
it('invalidates overwrite approval and automatically rebuilds the preview after a file is removed', async () => {
  await upload(); await settled();
  await act(async () => container.querySelector('.batch-overwrite input').click());
  expect(button('导入').disabled).toBe(false);
  await click('移除');
  expect(container.querySelector('.batch-preview')).toBeNull();
  await settled();
  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(button('导入').disabled).toBe(true);
});
it('retains errors on the corresponding file and allows explicit removal before importing the rest', async () => {
  mocks.validate.mockResolvedValueOnce({rows:[{}],summary:{validRowCount:1,errorCount:1,ignoredCount:2,errors:[{sourceRow:3,messages:['数量不是有效数字']}]}});
  await upload(); await settled();
  expect(container.textContent).toContain('第 3 行：数量不是有效数字');
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  await click('移除'); await settled();
  expect(mocks.preview).toHaveBeenCalledTimes(1);
});
it('uses all supplier numbers with the existing normal shipment business types', async () => {
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:1,previewRows:[{SKU:'000123'}],preset:'ledger_report',facets:{movementTypes:['平台客单发货','客单发货','盘亏'],supplierNumbers:['货号A','货号B']}});
  await upload(); await settled();
  expect(mocks.validate.mock.calls[0][2]).toMatchObject({movementTypes:['平台客单发货','客单发货'],deriveAmountFromUnitPrice:true});
  expect(mocks.validate.mock.calls[0][2].supplierNumbers).toBeUndefined();
  expect(container.textContent).not.toContain('文件筛选');
  expect(mocks.preview.mock.calls[0][0].items[0].sourceCoverage.scope).toBe('full_month');
});
it('keeps parse failure visible while the other file remains parsed', async () => {
  mocks.parse.mockRejectedValueOnce(new Error('无法读取文件'));
  await upload(); await settled();
  expect(container.textContent).toContain('解析失败：无法读取文件');
  expect(mocks.preview).not.toHaveBeenCalled();
  await click('移除'); await settled();
  expect(mocks.preview).toHaveBeenCalledTimes(1);
});
it('blocks cross-month records on their file even when a month was explicitly selected', async () => {
  mocks.inspectPeriod.mockResolvedValueOnce({evidence:{distribution:[{month:'2026-07',count:1},{month:'2026-08',count:1}],suggestedPeriod:null}});
  await upload(); await settled();
  expect(container.textContent).toContain('来源含 2026-07，与账本 2026-08 不一致');
  expect(mocks.preview).not.toHaveBeenCalled();
});
it('auto-selects the reliable source month and requires no extra validation click', async () => {
  mocks.inspectPeriod.mockResolvedValue({evidence:{distribution:[{month:'2026-07',count:1}],suggestedPeriod:'2026-07',missingCount:0,invalidCount:0,errorCount:0}});
  await upload(false); await settled();
  expect(container.querySelector('#ledger-period').value).toBe('2026-07');
  expect(mocks.preview).toHaveBeenCalledTimes(1);
});
it('asks for a sheet only for the ambiguous file and parses the chosen sheet', async () => {
  mocks.parse.mockResolvedValueOnce({type:'sheet-selection-required',sheetCandidates:['明细甲','明细乙']});
  await upload(); await settled();
  const select = container.querySelector('select[id^=sheet-]');
  expect(select).not.toBeNull();
  expect(mocks.preview).not.toHaveBeenCalled();
  await act(async () => Simulate.change(select,{target:{value:'明细乙'}}));
  await settled();
  expect(mocks.parse.mock.calls[2][2]).toBe('明细乙');
  expect(mocks.preview).toHaveBeenCalledTimes(1);
});
it('keeps partial-source and complete-replacement choices explicit and revalidates automatically', async () => {
  await upload(); await settled();
  await act(async () => Simulate.change(container.querySelector('select[id^=source-scope-]'),{target:{value:'partial'}}));
  await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0]).toMatchObject({sourceCoverage:{scope:'partial'},importMode:'append'});
});
it('rejects an empty store before any automatic preview', async () => {
  await upload();
  await act(async () => Simulate.change(container.querySelector('.batch-store input'),{target:{value:''}}));
  await settled();
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(container.textContent).toContain('请填写所属店铺');
});
it('supports cancelling the write through an AbortSignal', async () => {
  await upload(); await settled();
  await act(async () => container.querySelector('.batch-overwrite input').click());
  mocks.save.mockImplementationOnce(({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('导入已取消，整批写入已回滚。')))));
  await click('导入'); await click('取消当前处理');
  expect(mocks.save.mock.calls[0][0].signal.aborted).toBe(true);
  expect(container.textContent).toContain('整批写入已回滚');
});

it('exposes every overlap through pagination and confirms the full affected scope beyond thirty groups', async () => {
  const original = mocks.preview.getMockImplementation();
  mocks.preview.mockImplementation(async input => {
    const preview = await original(input);
    preview.items[0].replacementScope = 'store_month';
    preview.items[0].overlaps = Array.from({length:31},(_,index)=>({groupKey:'group-'+index,store:'甲店',platformSkc:'父-'+index,removed:index===30,before:{...summary,rowCount:1},after:{...summary,rowCount:index===30?0:1}}));
    return preview;
  });
  await upload(); await settled();
  expect(container.textContent).toContain('共 31 组均受影响');
  expect(container.querySelector('.batch-overwrite').textContent).toContain('全部替换范围（含分页内容）');
  expect(container.querySelector('.batch-overwrite').textContent).not.toContain('未列出分组保留');
  expect(container.textContent).not.toContain('父-30');
  await act(async()=>container.querySelector('[aria-label="甲店.csv 下一页覆盖范围"]').click());
  expect(container.textContent).toContain('移除旧分组：甲店 / 父-30');
  expect(container.textContent).toContain('第 2 / 2 页');
});
