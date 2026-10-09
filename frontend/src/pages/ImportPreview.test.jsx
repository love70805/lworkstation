// @vitest-environment happy-dom
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImportPreview from "./ImportPreview";
import { ToastProvider } from "../components/UI";
import { suggestLedgerReportMapping, suggestMappings } from "../lib/salesImport";
import { saveSupplierGroup, readSupplierGroups, rememberSupplierGroupSelection } from "../lib/importSupplierGroups";
const mocks = vi.hoisted(() => ({ parse:vi.fn(), inspectPeriod:vi.fn(), validate:vi.fn(), release:vi.fn(), terminate:vi.fn(), preview:vi.fn(), save:vi.fn() }));
vi.mock('../lib/importWorkerClient', () => ({createImportWorkerClient:()=>mocks}));
vi.mock('../data/database', () => ({getActiveMemberContext:async()=>({workspaceId:"W"}),previewSalesImports:mocks.preview,saveSalesImports:mocks.save}));
let container, root;
function LocationProbe() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}</output>; }
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
  await act(async()=>root.render(<MemoryRouter><ToastProvider><ImportPreview/><LocationProbe/></ToastProvider></MemoryRouter>));
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
it('guides a completed import to this ledger cost step and keeps prestorage secondary', async () => {
  mocks.save.mockResolvedValue({ items: [], finalSummary: summary, ledgerId: 'new-ledger',
    catalog: { createdProductCount: 25, addedSkuCount: 80, linkedSkuCount: 0, issues: [] } });
  await upload(); await settled();
  await act(async () => container.querySelector('.batch-overwrite input').click());
  await click('导入');
  const nextStep = container.querySelector('.batch-next-step'), catalog = container.querySelector('.batch-catalog-details');
  expect(nextStep.textContent).toContain('下一步：取得正式成本');
  expect(catalog.open).toBe(false);
  expect(nextStep.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const steps = container.querySelectorAll('.import-flow-guide-steps > span');
  expect(steps[0].textContent).toContain('已完成');
  expect(steps[1].getAttribute('aria-current')).toBe('step');
  await click('下一步：取得正式成本');
  const target = container.querySelector('[data-location]').textContent;
  expect(target.split('?')[0]).toBe('/profit');
  expect(new URLSearchParams(target.split('?')[1]).get('ledger')).toBe('new-ledger');
  expect(new URLSearchParams(target.split('?')[1]).get('view')).toBe('cost');
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
function movementFixture(preset = 'ledger_report') {
  mocks.parse.mockResolvedValue({ headers: ['SKU','SKC','数量','金额','变动类型'], suggestedMapping: { ...mapping, movementType: '变动类型' },
    rowCount: 8, previewRows: [{ SKU: '000123' }], preset,
    facets: { supplierNumbers: ['测试货号'], movementTypes: ['平台客单发货','客单发货','客单签收(POP)','盘亏'],
      movementTypeCounts: { 平台客单发货: 2, 客单发货: 3, '客单签收(POP)': 1, 盘亏: 2 } } });
}
function movementCheckbox(file, type) {
  return [...file.querySelectorAll('.import-movement-options label')].find(label => label.querySelector('span').textContent === type).querySelector('input');
}
it('shows the actual movement choices and defaults POP into each standard ledger file', async () => {
  movementFixture(); await upload(); await settled();
  const files = [...container.querySelectorAll('.batch-file')];
  for (const file of files) {
    expect(movementCheckbox(file, '客单签收(POP)').checked).toBe(true);
    expect(movementCheckbox(file, '盘亏').checked).toBe(false);
    expect(file.querySelector('.import-movement-picker').textContent).toContain('已选 3 / 4 类 · 6 行来源');
  }
  expect(mocks.preview.mock.calls.at(-1)[0].items.every(item => item.filterOptions.movementTypes.includes('客单签收(POP)'))).toBe(true);
});
it('rebuilds the selected file as partial source and revokes overwrite approval when POP is unchecked', async () => {
  movementFixture(); await upload(); await settled();
  await act(async () => container.querySelector('.batch-overwrite input').click());
  expect(button('导入').disabled).toBe(false);
  const files = [...container.querySelectorAll('.batch-file')];
  await act(async () => movementCheckbox(files[0], '客单签收(POP)').click());
  expect(container.querySelector('.batch-preview')).toBeNull();
  expect(button('导入').disabled).toBe(true);
  await settled();
  const items = mocks.preview.mock.calls.at(-1)[0].items;
  expect(items[0]).toMatchObject({ filterOptions: { movementTypes: ['平台客单发货','客单发货'] }, sourceCoverage: { scope: 'partial' }, importMode: 'append' });
  expect(items[1].filterOptions.movementTypes).toContain('客单签收(POP)');
  expect(items[1].sourceCoverage.scope).toBe('full_month');
  expect(container.querySelector('.batch-overwrite input').checked).toBe(false);
  await click('恢复默认'); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0].sourceCoverage.scope).toBe('full_month');
});
it('supports select all, clear and restore while preventing an empty movement selection from importing', async () => {
  movementFixture(); await upload(); await settled();
  await click('全选'); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0].filterOptions.movementTypes).toEqual(['平台客单发货','客单发货','客单签收(POP)','盘亏']);
  await click('清空'); await settled();
  expect(button('导入').disabled).toBe(true);
  expect(container.querySelector('.batch-preview')).toBeNull();
  expect(container.textContent).toContain('请至少选择一种变动类型后再导入');
  await click('恢复默认'); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0].filterOptions.movementTypes).toEqual(['平台客单发货','客单发货','客单签收(POP)']);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('defaults nonstandard mapped movement types to all and marks a narrowed choice as partial', async () => {
  movementFixture('generic'); await upload(); await settled();
  const file = container.querySelector('.batch-file');
  expect(movementCheckbox(file, '盘亏').checked).toBe(true);
  await act(async () => movementCheckbox(file, '客单签收(POP)').click()); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0]).toMatchObject({ sourceCoverage: { scope: 'partial' }, importMode: 'append' });
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
  expect(JSON.parse(localStorage.getItem('lworkstation:import-suppliers:v2:W'))['甲店']).toEqual({selected:['测试货号'],keywords:['NOT-FOUND'],matched:[]});
});
it('keeps keyword edits local to matching and persists latest keywords only after confirmed import', async () => {
  await upload(true,[new File(['source'],'甲店.csv')]); await settled();
  const parseCount=mocks.parse.mock.calls.length, inspectCount=mocks.inspectPeriod.mock.calls.length, previewCount=mocks.preview.mock.calls.length;
  await act(async()=>Simulate.change(container.querySelector('.import-supplier-picker > input'),{target:{value:'测试，new'}}));
  await settled();
  expect(mocks.parse).toHaveBeenCalledTimes(parseCount);
  expect(mocks.inspectPeriod).toHaveBeenCalledTimes(inspectCount);
  expect(mocks.preview).toHaveBeenCalledTimes(previewCount);
  expect(localStorage.getItem('lworkstation:import-suppliers:v2:W')).toBeNull();
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  await click('导入');
  expect(JSON.parse(localStorage.getItem('lworkstation:import-suppliers:v2:W'))['甲店']).toEqual({selected:['测试货号'],keywords:['NEW','测试'],matched:['测试货号']});
});
it('does not save temporary keyword preferences when the atomic import fails', async()=>{
  mocks.save.mockRejectedValueOnce(new Error('transaction failed'));
  await upload(true,[new File(['source'],'甲店.csv')]); await settled();
  await act(async()=>Simulate.change(container.querySelector('.import-supplier-picker > input'),{target:{value:'测试'}}));
  await act(async()=>container.querySelector('.batch-overwrite input').click());
  await click('导入');
  expect(container.textContent).toContain('整批未写入：transaction failed');
  expect(localStorage.getItem('lworkstation:import-suppliers:v2:W')).toBeNull();
});
it('reports preference storage failure after commit without offering a duplicate import', async()=>{
  await upload(true,[new File(['source'],'甲店.csv')]); await settled();
  const spy=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('storage full');});
  try {
    await act(async()=>container.querySelector('.batch-overwrite input').click());
    await click('导入');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('数据已导入，但货号偏好未能保存');
    expect(container.textContent).not.toContain('整批未写入');
    expect(button('导入')).toBeUndefined();
  } finally {spy.mockRestore();}
});

it('applies strict suffix selection across stores only on request, with a local store override', async () => {
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:4,previewRows:[{SKU:'000123'}],preset:'generic',
    facets:{supplierNumbers:['A-HHHX','BhhHx','HHHX-MID','其他'],supplierCounts:{'A-HHHX':1,BhhHx:1,'HHHX-MID':1,其他:1}}});
  await upload(); await settled();
  const count = mocks.preview.mock.calls.length;
  await act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), { target: { value:'ｈｈｈｘ' } }));
  await settled();
  expect(mocks.preview).toHaveBeenCalledTimes(count);
  await click('应用到本批文件'); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items.map(item => item.filterOptions.supplierNumbers)).toEqual([['A-HHHX','BhhHx'],['A-HHHX','BhhHx']]);
  expect([...container.querySelectorAll('.batch-store-suppliers')].every(details => !details.open)).toBe(true);
  expect([...container.querySelectorAll('.batch-impact-details')].every(details => !details.open)).toBe(true);
  expect(container.querySelector('.batch-action-bar').compareDocumentPosition(container.querySelector('.batch-files')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const first = container.querySelector('.batch-store-suppliers');
  first.open = true;
  await act(async () => [...first.querySelectorAll('button')].find(node => node.textContent === '全部货号').click());
  await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items.map(item => item.filterOptions.supplierNumbers)).toEqual([['A-HHHX','BhhHx','HHHX-MID','其他'],['A-HHHX','BhhHx']]);
  expect(container.querySelectorAll('.batch-store-suppliers')[1].open).toBe(false);
});

it('rebuilds the preview after applying the same suffix twice and imports only after fresh overwrite approval', async () => {
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:2,previewRows:[{SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['A-HHHX','OTHER']}});
  await upload(); await settled();
  await act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), {target:{value:'HHHX'}}));
  await click('应用到本批文件'); await settled();
  await act(async () => container.querySelector('.batch-overwrite input').click());
  expect(button('导入').disabled).toBe(false);
  const count = mocks.preview.mock.calls.length;
  await click('应用到本批文件'); await settled();
  expect(mocks.preview).toHaveBeenCalledTimes(count + 1);
  expect(container.querySelector('.batch-preview')).not.toBeNull();
  expect(button('导入').disabled).toBe(true);
  expect(container.querySelector('.batch-action-summary').textContent).toContain('请确认替换范围');
  await act(async () => container.querySelector('.batch-overwrite input').click());
  await click('导入');
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0].items.map(item=>item.filterOptions.supplierNumbers)).toEqual([['A-HHHX'],['A-HHHX']]);
});

it('rebuilds a remembered identical supplier selection on its first batch suffix application', async () => {
  localStorage.setItem('lworkstation:import-suppliers:v2:W', JSON.stringify({'甲店':{selected:['A-HHHX'],keywords:[]}}));
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:1,previewRows:[{SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['A-HHHX']}});
  await upload(true,[new File(['first'],'甲店.csv')]); await settled();
  const count=mocks.preview.mock.calls.length;
  await act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), {target:{value:'hhhx'}}));
  await click('应用到本批文件'); await settled();
  expect(mocks.preview).toHaveBeenCalledTimes(count+1);
  expect(container.querySelector('.batch-preview')).not.toBeNull();
});

it('keeps zero suffix matches unselected and invalidates an earlier overwrite approval', async () => {
  await upload(); await settled();
  await act(async () => container.querySelector('.batch-overwrite input').click());
  expect(button('导入').disabled).toBe(false);
  await act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), { target:{ value:'NOT-FOUND' } }));
  expect(button('导入').disabled).toBe(false);
  await click('应用到本批文件'); await settled();
  expect(container.querySelector('.batch-preview')).toBeNull();
  expect(button('导入').disabled).toBe(true);
  expect(container.textContent).toContain('本店没有命中所选后缀');
  expect([...container.querySelectorAll('.import-supplier-picker')].every(node => node.textContent.includes('已选 0 / 1'))).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('uses an applied batch suffix for newly added files without selecting middle matches', async () => {
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:2,previewRows:[{SKU:'000123'}],preset:'generic',
    facets:{supplierNumbers:['A-HHHX','HHHX-MID']}});
  await act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), { target:{value:'HHHX'} }));
  await click('应用到本批文件');
  const choose = async files => {
    const input = container.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', {configurable:true, value:files});
    await act(async () => input.dispatchEvent(new Event('change', {bubbles:true})));
  };
  await choose([new File(['first'], '甲店.csv')]); await settled();
  await act(async () => Simulate.change(container.querySelector('#ledger-period'), {target:{value:'2026-08'}}));
  await settled();
  await choose([new File(['second'], '乙店.csv')]); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items.map(item => item.filterOptions.supplierNumbers)).toEqual([['A-HHHX'],['A-HHHX']]);
});

it('saves LBYY and LBY together, applies the saved group, and remembers it only after a successful import', async () => {
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:3,previewRows:[{SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['A-LBYY','B-LBY','OTHER']}});
  await upload(); await settled();
  await act(async () => Simulate.change(container.querySelector('#batch-supplier-suffix'), {target:{value:'LBYY、LBY'}}));
  await act(async () => Simulate.change(container.querySelector('#supplier-group-name'), {target:{value:'LBYY / LBY'}}));
  await click('保存货号组');
  const group = readSupplierGroups('W').groups[0];
  expect(group.aliases).toEqual(['LBY','LBYY']);
  expect(readSupplierGroups('W').lastAppliedId).toBe('');
  await click('应用货号组'); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items.map(item => item.filterOptions.supplierNumbers)).toEqual([['A-LBYY','B-LBY'],['A-LBYY','B-LBY']]);
  await act(async () => container.querySelector('.batch-overwrite input').click());
  await click('导入');
  expect(readSupplierGroups('W').lastAppliedId).toBe(group.id);
});

it('restores a group and its store exceptions without a new apply click, including newly seen alias members', async () => {
  const group = saveSupplierGroup('W', { name: '负责组', aliases: ['LBYY','LBY'], mode: 'suffix' });
  rememberSupplierGroupSelection('W', [{storeName:'甲店',supplierGroupRule:group,facets:{supplierNumbers:['A-LBYY','B-LBY']},filterOptions:{supplierNumbers:['A-LBYY']}}]);
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:4,previewRows:[{SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['A-LBYY','B-LBY','NEW-LBY','OTHER']}});
  const input = container.querySelector('input[type=file]');
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['first'],'甲店.csv')]});
  await act(async () => input.dispatchEvent(new Event('change',{bubbles:true})));
  await act(async () => Simulate.change(container.querySelector('#ledger-period'), {target:{value:'2026-08'}}));
  await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0].filterOptions.supplierNumbers).toEqual(['A-LBYY','NEW-LBY']);
  const picker = container.querySelector('.import-supplier-picker');
  await act(async () => [...picker.querySelectorAll('button')].find(node => node.textContent === '未选 (2)').click());
  expect([...picker.querySelectorAll('[role=option] strong')].map(node => node.textContent)).toEqual(['B-LBY','OTHER']);
});

it('switches matching mode only on apply and leaves file selections intact when a saved group is deleted', async () => {
  const group = saveSupplierGroup('W', {name:'负责人',aliases:['LBYY'],mode:'suffix'});
  mocks.parse.mockResolvedValue({headers:['SKU','SKC','数量','金额'],suggestedMapping:mapping,rowCount:3,previewRows:[{SKU:'000123'}],preset:'generic',facets:{supplierNumbers:['LBYY','A-LBYY','LBYY-MID']}});
  await upload(); await settled();
  await act(async () => Simulate.change(container.querySelector('#supplier-group-select'), {target:{value:group.id}}));
  await click('应用货号组'); await settled();
  const count = mocks.preview.mock.calls.length;
  await act(async () => Simulate.change(container.querySelector('[aria-label="货号匹配方式"]'), {target:{value:'exact'}}));
  await settled(); expect(mocks.preview).toHaveBeenCalledTimes(count);
  await click('应用到本批文件'); await settled();
  expect(mocks.preview.mock.calls.at(-1)[0].items[0].filterOptions.supplierNumbers).toEqual(['LBYY']);
  await click('删除货号组'); await settled();
  expect(mocks.preview).toHaveBeenCalledTimes(count + 1);
  expect(readSupplierGroups('W').groups).toEqual([]);
});
