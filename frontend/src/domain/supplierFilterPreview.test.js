import { describe, expect, it } from 'vitest';
import { createSupplierFilterIndex, addSupplierSourceRows, addSupplierEvidence, sealSupplierFilterIndex, supplierFilterCandidates, supplierFilterPreview, filterSupplierCandidates, changeSupplierSelection, supplierRuleSelection, supplierSelectionCsv, expandSupplierScopeGroup } from './supplierFilterPreview';
import { validateSalesRows, collectSalesImportFacets } from '../lib/salesImport';

const mapping = { supplierNumber: '货号', platformSkc: 'SKC', platformSku: 'SKU', quantity: '数量', amount: '金额', sourceAddedAt: '日期', movementType: '类型' };
const raw = (number, skc, sku, date = '2026-09-01', extra = {}) => ({ 货号: number, SKC: skc, SKU: sku, 数量: 1, 金额: 2, 日期: date, 类型: '发货', ...extra });
function file(id, store, source, selected = []) {
  const index = createSupplierFilterIndex(mapping, { workspaceId: 'W', store });
  addSupplierSourceRows(index, source, mapping);
  addSupplierEvidence(index, validateSalesRows(source, mapping, { defaultStore: store, movementTypes: ['发货'] }).rows);
  return { itemId: id, status: 'parsed', storeName: store, supplierPreview: sealSupplierFilterIndex(index), facets: collectSalesImportFacets(source, mapping), filterOptions: { supplierNumbers: selected } };
}
describe('read-only supplier filter preview', () => {
  it('counts full goods codes per store, real source rows and global identifier unions without touching source', () => {
    const first = [raw('0001-LBY', 'ＳＫＣ-1', '００１'), raw('0001-LBY', 'SKC-1', '001'), raw('0002-LBY', 'SKC-1', '002'), raw('0002-LBY', 'ignored', 'ignored', '2026-09-01', { 类型: '盘亏' }), raw('0002-LBY', 'error', 'bad', '2026-09-01', { 数量: '错误' })];
    const files = [file('A', '甲', first), file('B', '乙', [raw('0001-LBY', 'SKC-1', '001')])], snapshot = JSON.stringify(files);
    const candidates = supplierFilterCandidates(files, { workspaceId: 'W', period: '2026-09' });
    const preview = supplierFilterPreview(candidates, { selected: { A: ['0001-LBY','0002-LBY'], B: ['0001-LBY'] }, applied: { A: ['0001-LBY'], B: [] }, rule: { aliases: ['LBY','BY'], mode: 'suffix' } });
    expect(preview.batch).toMatchObject({ total: 3, selected: 3, applied: 1, added: 2, removed: 0, sourceRowCount: 6, skcCount: 1, skuCount: 2 });
    expect(preview.stores.map(row => row.selected)).toEqual([2, 1]);
    expect(preview.aliases.map(row => row.count)).toEqual([3, 3]);
    expect(new Set(preview.rows.map(row => row.key)).size).toBe(3);
    expect(JSON.stringify(files)).toBe(snapshot);
    expect(preview.rows.find(row => row.supplierNumber === '0002-LBY')).toMatchObject({ sourceRowCount: 3, skcCount: 1, skuCount: 1 });
  });
  it('reuses monthly evidence, marks unmapped/undated identities and never assigns an unknown date to a month', () => {
    const files = [file('A', '甲', [raw('货号', 'SEP', '1'), raw('货号', 'AUG', '2', '2026-08-01'), raw('货号', 'UNDATED', '3', '')])];
    const september = supplierFilterCandidates(files, { workspaceId: 'W', period: '2026-09' });
    expect(september[0]).toMatchObject({ sourceRowCount: 3, skcCount: 1, skuCount: 1, skcIncomplete: true, skuIncomplete: true });
    expect(september[0].skcs).toEqual(['SEP']);
    expect(supplierFilterCandidates(files, { period: '2026-08' })[0].skcs).toEqual(['AUG']);
    const unmapped = { ...files[0], supplierPreview: undefined };
    expect(supplierFilterCandidates([unmapped])[0]).toMatchObject({ mappingPending: true, skcIncomplete: true, skuIncomplete: true });
  });
  it('keeps identity strings and leading zeros even when rules fold widths/case', () => {
    const source = [raw('０００１-ｌｂｙ', '父', '００１')];
    const validation = validateSalesRows(source, mapping, { defaultStore: '甲', supplierNumbers: ['０００１-ｌｂｙ'] });
    expect(validation.rows[0]).toMatchObject({ supplierNumber: '０００１-ｌｂｙ', platformSku: '００１' });
    const rows = supplierFilterCandidates([file('A','甲',source)], { workspaceId: 'W', period: '2026-09' });
    const preview = supplierFilterPreview(rows, { rule: { aliases: ['LBY'], mode: 'suffix' }, selected: { A: [] }, applied: { A: [] } });
    expect(preview.rows[0]).toMatchObject({ matched: true, selected: false });
    expect(supplierSelectionCsv([{ ...preview.rows[0], selected: true }])).toContain('"０００１-ｌｂｙ"');
  });
  it('marks missing source identifiers and duplicate mappings instead of presenting inferred counts', () => {
    const missing = supplierFilterCandidates([file('A','甲',[raw('货号','父','')])],{period:'2026-09'});
    expect(missing[0]).toMatchObject({skuIncomplete:true,skuCount:0,sourceRowCount:1});
    const duplicate = createSupplierFilterIndex({...mapping,platformSku:'SKC'},{store:'甲'});
    addSupplierSourceRows(duplicate,[raw('货号','父','1')],mapping);addSupplierEvidence(duplicate,[{supplierNumber:'货号',platformSkc:'父',platformSku:'父'}]);
    const preview = supplierFilterCandidates([{itemId:'A',status:'parsed',storeName:'甲',supplierPreview:sealSupplierFilterIndex(duplicate)}]);
    expect(preview[0]).toMatchObject({mappingPending:true,skcCount:0,skuCount:0});
  });
  it('changes only explicitly targeted page/results and leaves hidden stores selected', () => {
    const files = [file('A','甲',[raw('0001','父','1'),raw('0002','父','2')]),file('B','乙',[raw('0001','父','1')])];
    const selection = { A: ['0001'], B: ['0001'] }, preview = supplierFilterPreview(supplierFilterCandidates(files), { selected: selection, applied: selection });
    const found = filterSupplierCandidates(preview.rows, { query: '0002', store: '甲' });
    expect(selection).toEqual({ A: ['0001'], B: ['0001'] });
    const changed = changeSupplierSelection(selection, found, true);
    expect(changed).toEqual({ A: ['0001','0002'], B: ['0001'] });
    expect(filterSupplierCandidates(preview.rows, { query: 'missing' })).toEqual([]);
    expect(changeSupplierSelection(selection, [], false)).toEqual(selection);
    expect(supplierSelectionCsv(preview.rows).split('\r\n')).toHaveLength(3);
  });
  it('preserves current same-rule exceptions, applies only target-group compatible exceptions, and keeps zero matches empty', () => {
    const choices = ['A-LBY','B-LBY','A-OTHER'], files = [{itemId:'A',status:'parsed',storeName:'甲',facets:{supplierNumbers:choices}}];
    const group = { id:'G',aliases:['LBY'],mode:'suffix' }, other = { id:'O',aliases:['OTHER'],mode:'suffix' };
    const state = {groups:[group,other],overrides:{'甲':{groupId:'G',exclude:['B-LBY'],include:['A-OTHER']}}};
    expect(supplierRuleSelection(files,group,{previousRule:group,selected:{A:['A-LBY','A-OTHER']},savedState:state})).toEqual({A:['A-LBY','A-OTHER']});
    expect(supplierRuleSelection(files,other,{previousRule:group,selected:{A:['A-LBY','A-OTHER']},savedState:state})).toEqual({A:['A-OTHER']});
    expect(supplierRuleSelection(files,{aliases:['NOT-FOUND'],mode:'suffix'},{previousRule:group,selected:{A:choices},savedState:state})).toEqual({A:[]});
    expect(supplierRuleSelection(files,{...group,aliases:['OTHER']},{savedState:state})).toEqual({A:['A-OTHER']});
    expect(supplierRuleSelection(files,group,{savedState:state,preserve:false})).toEqual({A:['A-LBY','B-LBY']});
    expect(supplierRuleSelection([...files,{...files[0],itemId:'NEW',storeName:'乙'}],group,{previousRule:group,selected:{A:['A-LBY']},savedState:state})).toEqual({A:['A-LBY'],NEW:['A-LBY','B-LBY']});
  });
  it('expands profit groups only against current ledger/store and keeps null and empty at the caller boundary', () => {
    const rule = {id:'G',aliases:['LBY'],mode:'suffix'}, state = {groups:[rule],overrides:{'甲':{groupId:'G',exclude:['A-LBY'],include:['MANUAL']}}};
    const rows = [{store:'甲',supplierNumber:'A-LBY'},{store:'甲',supplierNumber:'MANUAL'},{store:'乙',supplierNumber:'B-LBY'}];
    expect(expandSupplierScopeGroup(rows,rule,state,'甲')).toEqual(['MANUAL']);
    expect(expandSupplierScopeGroup(rows,rule,state)).toEqual(['B-LBY','MANUAL']);
    expect(expandSupplierScopeGroup(rows,{aliases:['absent']},state)).toEqual([]);
  });
});
