// @vitest-environment happy-dom
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImportPreview from "./ImportPreview";
import { ToastProvider } from "../components/UI";
import { suggestLedgerReportMapping, suggestMappings } from "../lib/salesImport";
const mocks = vi.hoisted(() => ({ parse:vi.fn(), inspectPeriod:vi.fn(), validate:vi.fn(), release:vi.fn(), terminate:vi.fn(), preview:vi.fn(), save:vi.fn() }));
vi.mock('../lib/importWorkerClient', () => ({createImportWorkerClient:()=>mocks}));
vi.mock('../data/database', () => ({getActiveMemberContext:async()=>({workspaceId:"W"}),previewSalesImports:mocks.preview,saveSalesImports:mocks.save}));
let container, root;
const mapping = {platformSku:'SKU',platformSkc:'SKC',quantity:'数量',amount:'金额'};
const summary = {quantity:2,revenue:10,penalty:0};
function button(text) { return [...container.querySelectorAll('button')].find((node)=>node.textContent === text); }
async function click(text) { await act(async()=>button(text).click()); }
async function upload(selectPeriod = true, files = [new File(['first'], '甲店.csv'),new File(['second'],'乙店.csv')]) {
  const input = container.querySelector('input[type=file]');
  Object.defineProperty(input,'files',{configurable:true,value:files});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  await act(async()=> { await vi.waitFor(()=>expect(mocks.parse).toHaveBeenCalledTimes(files.length)); });
  for (const node of [...container.querySelectorAll('button')].filter(node=>node.textContent === '全部货号')) await act(async()=>node.click());
  if (selectPeriod) await act(async()=>Simulate.change(container.querySelector('#ledger-period'),{target:{value:'2026-08'}}));
}
beforeEach(async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks(); mocks.release.mockResolvedValue({});
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:1,previewRows:[{SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['测试货号'],supplierCounts:{测试货号:1}}});
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
it('shows standard calculated revenue and filename store separately from optional absent source columns', async () => {
  const headers = ['变动类型','结算类型','供方货号','SKC','平台SKU','商家SKU','属性集','数量','单价','金额','币种','业务单号','单据号','添加时间','商家ID','商家名称','销售商家ID','销售商家名称','备注','活动信息'];
  const suggestedMapping = suggestLedgerReportMapping(headers);
  mocks.parse.mockResolvedValue({ headers, suggestedMapping, rowCount: 1, previewRows: [{平台SKU:'000123',业务单号:'测试订单'}], preset:'ledger_report', facets:{movementTypes:['平台客单发货'],supplierNumbers:['测试货号']} });
  await upload(); await settled();
  const file = container.querySelector('.batch-file');
  expect(file.querySelectorAll('.batch-mapping-main .mapping-row')).toHaveLength(8);
  expect(file.querySelector('.batch-mapping-extra').open).toBe(false);
  expect(file.querySelector('[data-field=amount]').textContent).toContain('由数量 × 单价计算');
  expect(file.querySelector('[data-field=amount] select')).toBeNull();
  expect(file.querySelector('[data-field=store]').textContent).toContain('使用文件名店铺');
  expect(file.querySelector('[data-field=platformSku]').textContent).toContain('已自动映射');
  expect(file.querySelector('[data-field=orderId] select').value).toBe('业务单号');
  for (const key of ['orderDate','order1688','directUnitCost','directPenalty','customerShipmentQuantity','platformOrderQuantity']) {
    expect(file.querySelector(`[data-field=${key}]`).textContent).toContain('可选 · 源表无该列');
  }
  expect(file.querySelectorAll('[aria-invalid=true]')).toHaveLength(0);
  expect(file.textContent).not.toContain('-- 未映射 --');
  expect(mocks.preview.mock.calls[0][0].items).toHaveLength(2);
  expect(mocks.preview.mock.calls[0][0].items[0].mapping).toMatchObject({ amount:'', directUnitCost:'', orderId:'业务单号' });
});
it('keeps a single legacy template usable with optional blank fields and shows its quantity and amount fallbacks', async () => {
  const headers = ['供方货号','平台SKU','客单发货','平台客单','客单金额','平台金额'];
  mocks.parse.mockResolvedValue({headers,suggestedMapping:suggestMappings(headers),rowCount:1,previewRows:[{平台SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['测试货号'],supplierCounts:{测试货号:1}}});
  await upload(true, [new File(['legacy'], '旧模板.csv')]); await settled();
  const file = container.querySelector('.batch-file');
  expect(file.querySelector('[data-field=quantity]').textContent).toContain('使用备用数量列');
  expect(file.querySelector('[data-field=amount]').textContent).toContain('使用备用金额列');
  expect(file.querySelector('[data-field=orderDate]').textContent).toContain('可选 · 源表无该列');
  expect(file.querySelectorAll('.mapping-required')).toHaveLength(0);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  await act(async()=>Simulate.change(file.querySelector('.batch-store input'),{target:{value:'确认店铺'}}));
  expect(file.querySelector('[data-field=store]').textContent).toContain('使用填写的店铺');
});
it('marks an actually missing required SKU and prevents automatic preview until it is mapped', async () => {
  mocks.parse.mockResolvedValue({headers:['SKC','数量','金额','自定义SKU'],suggestedMapping:{platformSkc:'SKC',quantity:'数量',amount:'金额'},rowCount:1,previewRows:[{自定义SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['测试货号'],supplierCounts:{测试货号:1}}});
  await upload(true, [new File(['custom'], '自定义店.csv')]); await settled();
  const row = container.querySelector('[data-field=platformSku]');
  expect(row.textContent).toContain('必需字段未映射');
  expect(row.querySelector('select').getAttribute('aria-invalid')).toBe('true');
  expect(mocks.preview).not.toHaveBeenCalled();
  await act(async()=>Simulate.change(row.querySelector('select'),{target:{value:'自定义SKU'}}));
  await settled();
  expect(row.textContent).toContain('已手动映射');
  expect(mocks.preview).toHaveBeenCalledTimes(1);
});
it('shares a delayed reparse while rapidly editing a store and only inspects the latest configuration', async () => {
  await upload(); await settled();
  const parseCount = mocks.parse.mock.calls.length, inspectCount = mocks.inspectPeriod.mock.calls.length;
  let finish;
  mocks.parse.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const input = container.querySelector('.batch-store input');
  for (const value of ['新', '新店', '新店铺']) await act(async () => Simulate.change(input, { target: { value } }));
  expect(mocks.parse).toHaveBeenCalledTimes(parseCount + 1);
  expect(mocks.inspectPeriod).toHaveBeenCalledTimes(inspectCount);
  await act(async () => finish({ type: 'parsed' }));
  expect(mocks.inspectPeriod).toHaveBeenCalledTimes(inspectCount + 2);
  expect(mocks.inspectPeriod.mock.calls.at(-1)[2].defaultStore).toBe('新店铺');
});
it('reuses sealed validation after correcting the selected month without retaining workbook jobs', async () => {
  mocks.inspectPeriod.mockResolvedValue({ rowSource: { id: 'sealed', rowCount: 1, chunkCount: 1 }, evidence: {
    distribution: [{ month: '2026-08', count: 1 }], suggestedPeriod: '2026-08', missingCount: 0, invalidCount: 0, errorCount: 0,
    validationSummary: { sourceRowCount: 1, validRowCount: 1, errorCount: 0, ignoredCount: 0, errors: [] },
  } });
  await upload(); await settled();
  await act(async () => Simulate.change(container.querySelector('#ledger-period'), { target: { value: '2026-07' } }));
  await settled(); expect(container.textContent).toContain('与账本 2026-07 不一致');
  await act(async () => Simulate.change(container.querySelector('#ledger-period'), { target: { value: '2026-08' } }));
  await settled();
  expect(mocks.parse).toHaveBeenCalledTimes(4);
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0]).toMatchObject({ rowSource: { id: 'sealed' }, summary: { errorCount: 0 } });
  expect(container.querySelector('.batch-preview')).not.toBeNull();
});
it('automatically validates and previews all files after explicit supplier choice without any write', async () => {
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
  expect(container.querySelector('.batch-overwrite input')).toBeNull();
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
  expect(mocks.release).toHaveBeenCalled();
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
  expect(mocks.validate.mock.calls[0][2].supplierNumbers).toEqual(['货号A','货号B']);
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
  mocks.inspectPeriod.mockResolvedValue({evidence:{distribution:[{month:'2026-07',count:1},{month:'2026-08',count:1}],suggestedPeriod:null}});
  await upload(); await settled();
  expect(container.textContent).toContain('来源含 2026-07，与账本 2026-08 不一致');
  expect(mocks.preview).not.toHaveBeenCalled();
});
it('auto-selects the reliable source month and requires no extra validation click', async () => {
  mocks.inspectPeriod.mockResolvedValue({evidence:{distribution:[{month:'2026-07',count:1}],suggestedPeriod:'2026-07',missingCount:0,invalidCount:0,errorCount:0}});
  await upload(false); await settled();
  expect(container.querySelector('#ledger-period').value).toBe('2026-07');
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector('.batch-overwrite input').click());
  await click('导入');
  expect(container.querySelector('.batch-preview h2').textContent).toBe('整批处理完成 · 2026-07');
});
it('asks for a sheet only for the ambiguous file and parses the chosen sheet', async () => {
  mocks.parse.mockResolvedValueOnce({type:'sheet-selection-required',sheetCandidates:['明细甲','明细乙']});
  await upload(); await settled();
  const select = container.querySelector('select[id^=sheet-]');
  expect(select).not.toBeNull();
  expect(mocks.preview).not.toHaveBeenCalled();
  await act(async () => Simulate.change(select,{target:{value:'明细乙'}}));
  await settled();
  expect(mocks.parse.mock.calls.some(call=>call[2]==='明细乙')).toBe(true);
  for (const node of [...container.querySelectorAll('button')].filter(node=>node.textContent === '全部货号')) await act(async()=>node.click());
  await settled();
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

it('starts with no goods, preserves selected goods through search and remembers only after commit', async () => {
  const input = container.querySelector('input[type=file]');
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['source'],'甲店.csv')]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  await settled();
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(container.textContent).toContain('已选 0 / 1');
  await click('全部货号');
  await act(async()=>Simulate.change(container.querySelector('#ledger-period'),{target:{value:'2026-08'}}));
  await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0]).toMatchObject({ filterOptions:{supplierNumbers:['测试货号']}, sourceCoverage:{version:2,supplierNumbers:['测试货号'],scope:'full_month'}, importMode:'replace_store_month' });
  const search=container.querySelector('.import-supplier-picker input[type=text], .import-supplier-picker > input');
  await act(async()=>Simulate.change(search,{target:{value:'not-found'}}));
  expect(container.textContent).toContain('已选 1 / 1');
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  await click('导入');
  expect(JSON.parse(localStorage.getItem('lworkstation:import-suppliers:v1:W'))['甲店']).toEqual(['测试货号']);
});
