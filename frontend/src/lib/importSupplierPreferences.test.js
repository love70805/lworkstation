// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { matchImportNumbers, matchImportNumberSuffixes, parseImportKeywords, parseImportNumbers, readImportNumbers, readImportPreference, restoreImportPreference, saveImportNumbers } from './importSupplierPreferences';
beforeEach(() => localStorage.clear());
it('selects normalized suffixes only at the end without changing goods identities or falling back on zero matches', () => {
  expect(matchImportNumberSuffixes(['Ｓ－ｈｈｈｘ', 'A-LYYY', 'HHHX-MID', 'none'], ['hhHx', 'ＬＹＹＹ'])).toEqual(['Ｓ－ｈｈｈｘ', 'A-LYYY']);
  expect(matchImportNumberSuffixes(['A'], ['ZZ'])).toEqual([]);
  expect(matchImportNumberSuffixes(['A'], [])).toEqual([]);
});
it('persists only explicit successful choices, isolated by workspace and store', () => {
  expect(readImportNumbers('W', '甲')).toEqual([]);
  saveImportNumbers('W', [{ storeName: '甲', filterOptions: { supplierNumbers: ['A','B','A'] } }, { storeName: '乙', filterOptions: { supplierNumbers: ['A'] } }]);
  expect(readImportNumbers('W', '甲')).toEqual(['A','B']);
  expect(readImportNumbers('W', '乙')).toEqual(['A']);
  expect(readImportNumbers('OTHER', '甲')).toEqual([]);
  expect(parseImportNumbers(' A，B\nA; C ')).toEqual(['A','B','C']);
});
it('matches any normalized keyword without rewriting original supplier identities', () => {
  const words = parseImportKeywords('ｈｈｈｘ，LYYY\nhhhx; ＬＹＹＹ');
  expect(words).toEqual(['HHHX','LYYY']);
  expect(matchImportNumbers(['Ｓ－ｈｈｈｘ','a-LYYY','HHHX-LYYY','none'], words)).toEqual(['Ｓ－ｈｈｈｘ','a-LYYY','HHHX-LYYY']);
  expect(matchImportNumbers(['any'], [])).toEqual([]);
});
it('restores explicit selections, identifies new matches and remembers deliberately excluded matches', () => {
  saveImportNumbers('W', [{storeName:'甲', filterOptions:{supplierNumbers:['HHHX-1','gone']}, supplierKeywords:['hhHx'], facets:{supplierNumbers:['HHHX-1','HHHX-2','gone']}}]);
  const preference = readImportPreference('W','甲');
  expect(restoreImportPreference(preference,['HHHX-1','HHHX-2','HHHX-3'])).toEqual({selected:['HHHX-1'],missing:['gone'],newMatches:['HHHX-3']});
  expect(restoreImportPreference(readImportPreference('W','乙'),['HHHX-1'])).toEqual({selected:[],missing:[],newMatches:[]});
});
it('unions successful same-store files while replacing only that stores previous preference', () => {
  saveImportNumbers('W',[{storeName:'甲',filterOptions:{supplierNumbers:['old']}},{storeName:'乙',filterOptions:{supplierNumbers:['keep']}}]);
  saveImportNumbers('W',[
    {storeName:'甲', filterOptions:{supplierNumbers:['A-1']}, supplierKeywords:['a'], facets:{supplierNumbers:['A-1','A-2']}},
    {storeName:'甲', filterOptions:{supplierNumbers:['B-1']}, supplierKeywords:['b'], facets:{supplierNumbers:['B-1','B-2']}},
  ]);
  expect(readImportPreference('W','甲')).toEqual({selected:['A-1','B-1'],keywords:['A','B'],matched:['A-1','A-2','B-1','B-2'],hasSaved:true});
  expect(readImportNumbers('W','乙')).toEqual(['keep']);
});
it('reads legacy preferences without writing or deleting them and tolerates invalid storage', () => {
  localStorage.setItem('lworkstation:import-suppliers:v1:W',JSON.stringify({'甲':['A']}));
  expect(readImportPreference('W','甲')).toEqual({selected:['A'],keywords:[],matched:[],hasSaved:true});
  expect(localStorage.getItem('lworkstation:import-suppliers:v2:W')).toBeNull();
  const broken = {getItem(){ throw Error('denied'); },setItem(){ throw Error('denied'); }};
  expect(readImportNumbers('W','甲',broken)).toEqual([]);
  expect(()=>saveImportNumbers('W',[],broken)).toThrow('denied');
});
