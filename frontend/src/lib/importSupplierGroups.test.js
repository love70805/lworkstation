// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { matchImportNumberRule, saveSupplierGroup, readSupplierGroups, deleteSupplierGroup, rememberSupplierGroupSelection, restoreSupplierGroupSelection } from './importSupplierGroups';
beforeEach(() => localStorage.clear());
const choices = ['A-LBYY', 'B-LBY', 'LBYY-MIDDLE', '其他'];
const create = () => saveSupplierGroup('W', { name: '负责人货号', aliases: ['lbYY', 'ＬＢＹ'], mode: 'suffix' });
const file = (group, selected, storeName = '甲') => ({ storeName, supplierGroupRule: group, facets: { supplierNumbers: choices }, filterOptions: { supplierNumbers: selected } });

it('matches explicit aliases with three modes and retains original numbers', () => {
  const group = create();
  expect(matchImportNumberRule(choices, group)).toEqual(['A-LBYY', 'B-LBY']);
  expect(matchImportNumberRule(choices, { ...group, mode: 'contains' })).toEqual(choices.slice(0, 3));
  expect(matchImportNumberRule(['ｌｂｙｙ', ...choices], { ...group, mode: 'exact' })).toEqual(['ｌｂｙｙ']);
  expect(matchImportNumberRule(choices, { aliases: ['UNKNOWN'] })).toEqual([]);
  expect(readSupplierGroups('OTHER').groups).toEqual([]);
  expect(readSupplierGroups('W').lastAppliedId).toBe('');
});

it('restores new members and per-store manual exceptions after successful use', () => {
  const group = create();
  rememberSupplierGroupSelection('W', [file(group, ['A-LBYY', '其他']), file(group, ['B-LBY'], '乙')]);
  const state = readSupplierGroups('W'), next = [...choices, 'NEW-LBY'];
  expect(state.lastAppliedId).toBe(group.id);
  expect(restoreSupplierGroupSelection(next, group, state, '甲')).toEqual(['A-LBYY', '其他', 'NEW-LBY']);
  expect(restoreSupplierGroupSelection(next, group, state, '乙')).toEqual(['B-LBY', 'NEW-LBY']);
  expect(restoreSupplierGroupSelection(next, group, state, '新店')).toEqual(['A-LBYY', 'B-LBY', 'NEW-LBY']);
  expect(restoreSupplierGroupSelection(['其他'], group, state, '新店')).toEqual([]);
});

it('unions same-store files and does not change another workspace or legacy selections', () => {
  localStorage.setItem('lworkstation:import-suppliers:v1:W', '{"甲":["旧货号"]}');
  const group = create(), other = saveSupplierGroup('OTHER', { name: '另一工作区', aliases: ['X'] });
  rememberSupplierGroupSelection('W', [file(group, ['A-LBYY']), file(group, ['B-LBY'])]);
  expect(readSupplierGroups('W').overrides['甲'].exclude).toEqual([]);
  expect(readSupplierGroups('OTHER').groups).toEqual([other]);
  expect(localStorage.getItem('lworkstation:import-suppliers:v1:W')).toBe('{"甲":["旧货号"]}');
  expect(localStorage.getItem('lworkstation:import-suppliers:v2:W')).toBeNull();
});

it('keeps a rule snapshot stable, clears outdated exceptions on edit, and removes deleted groups', () => {
  const group = create();
  rememberSupplierGroupSelection('W', [file(group, ['A-LBYY'])]);
  const changed = saveSupplierGroup('W', { ...group, aliases: ['LBY'], mode: 'exact' });
  expect(group.aliases).toEqual(['LBY', 'LBYY']);
  expect(readSupplierGroups('W')).toMatchObject({ lastAppliedId: '', overrides: {} });
  rememberSupplierGroupSelection('W', [file(group, ['A-LBYY'])]);
  expect(readSupplierGroups('W').lastAppliedId).toBe('');
  deleteSupplierGroup('W', changed.id);
  expect(readSupplierGroups('W')).toEqual({ groups: [], lastAppliedId: '', overrides: {} });
});

it('mixed or ordinary rules stop automatically applying the previous group', () => {
  const group = create();
  rememberSupplierGroupSelection('W', [file(group, ['A-LBYY'])]);
  rememberSupplierGroupSelection('W', [file(group, ['A-LBYY']), file(null, ['其他'], '乙')]);
  expect(readSupplierGroups('W').lastAppliedId).toBe('');
});

it('reports storage and invalid names explicitly instead of silently truncating an oversized alias set', () => {
  create();
  expect(() => saveSupplierGroup('W', { name: '负责人货号', aliases: ['X'] })).toThrow('同名');
  expect(() => saveSupplierGroup('W', { name: '', aliases: ['X'] })).toThrow('组名称');
  expect(() => saveSupplierGroup('W', { name: '过多', aliases: Array.from({ length: 65 }, (_, i) => String(i)) })).toThrow('64');
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  expect(readSupplierGroups('W', denied)).toEqual({ groups: [], lastAppliedId: '', overrides: {} });
  expect(() => saveSupplierGroup('W', { name: '组', aliases: ['X'] }, denied)).toThrow('denied');
});
