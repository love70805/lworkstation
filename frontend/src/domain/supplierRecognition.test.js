import { expect, it } from 'vitest';
import { createSupplierMatcher, supplierRecognitionMode } from './supplierRecognition';
import { matchImportNumberRule } from '../lib/importSupplierGroups';
import { matchImportNumbers, parseImportKeywords } from '../lib/importSupplierPreferences';
import { supplierFilterPreview, filterSupplierCandidates, supplierRuleSelection } from './supplierFilterPreview';

const choices = ['0001-LBY', '0002-LBYY', 'LBY-MIDDLE', '０００３-ｌｂｙ', '0004-LBZ', '0005-LYB', '0006-OTHER'];
it('uses the same fuzzy rule for selection, preview, search and legacy keyword preferences', () => {
  const rule = { aliases: ['LBYY'], mode: 'fuzzy' }, expected = choices.slice(0, 4);
  const rows = choices.map(supplierNumber => ({ supplierNumber, itemIds: ['F'], skcs: [], skus: [] }));
  expect(matchImportNumberRule(choices, rule)).toEqual(expected);
  expect(matchImportNumberRule(choices, { aliases: ['LBY'] })).toEqual(expected);
  expect(matchImportNumbers(choices, rule.aliases)).toEqual(expected);
  expect(supplierFilterPreview(rows, { rule }).rows.filter(row => row.matched).map(row => row.supplierNumber)).toEqual(expected);
  expect(filterSupplierCandidates(rows, { query: 'lbYY' }).map(row => row.supplierNumber)).toEqual(expected);
  expect(supplierRuleSelection([{ status: 'parsed', itemId: 'F', facets: { supplierNumbers: choices } }], rule)).toEqual({ F: expected });
  expect(choices[3]).toBe('０００３-ｌｂｙ');
});
it('keeps exact recognition, empty input, zero matches and numeric identities strict', () => {
  const match = createSupplierMatcher(['０００１-lby'], 'exact');
  expect(choices.filter(match.matches)).toEqual(['0001-LBY']);
  expect(createSupplierMatcher(['LBYY'], 'exact').matches('LBY')).toBe(false);
  expect(createSupplierMatcher(['LBY'], 'exact').matches('LBYY')).toBe(false);
  expect(createSupplierMatcher(['LBYY-0011']).matches('LBY-01')).toBe(false);
  expect(createSupplierMatcher(['AAA']).matches('A')).toBe(false);
  expect(createSupplierMatcher(['ZZZ']).matches('0001-LBY')).toBe(false);
  expect(createSupplierMatcher([]).matches('LBY')).toBe(false);
  expect(createSupplierMatcher([' ']).matches('')).toBe(false);
  expect(filterSupplierCandidates(choices.map(supplierNumber => ({ supplierNumber })), { query: '0001-LBY', mode: 'exact' })).toHaveLength(1);
});
it('normalizes only two modes and preserves spaces inside existing complete goods codes', () => {
  expect(['suffix', 'contains', undefined, 'fuzzy', 'exact'].map(supplierRecognitionMode)).toEqual(['fuzzy','fuzzy','fuzzy','fuzzy','exact']);
  expect(parseImportKeywords(' ＬＢＹＹ，LBY\nOTHER，LBYY ')).toEqual(['LBY','LBYY','OTHER']);
  expect(parseImportKeywords(' CODE WITH SPACE ')).toEqual(['CODE WITH SPACE']);
});
