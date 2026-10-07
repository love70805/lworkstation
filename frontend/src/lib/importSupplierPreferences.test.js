// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { parseImportNumbers, readImportNumbers, saveImportNumbers } from './importSupplierPreferences';
beforeEach(() => localStorage.clear());
it('persists only explicit successful choices, isolated by workspace and store', () => {
  expect(readImportNumbers('W', '甲')).toEqual([]);
  saveImportNumbers('W', [{ storeName: '甲', filterOptions: { supplierNumbers: ['A','B','A'] } }, { storeName: '乙', filterOptions: { supplierNumbers: ['A'] } }]);
  expect(readImportNumbers('W', '甲')).toEqual(['A','B']);
  expect(readImportNumbers('W', '乙')).toEqual(['A']);
  expect(readImportNumbers('OTHER', '甲')).toEqual([]);
  expect(parseImportNumbers(' A，B\nA; C ')).toEqual(['A','B','C']);
});
