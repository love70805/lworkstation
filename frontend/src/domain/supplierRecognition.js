// Comparison keys only: never use these keys as stored goods/SKU identities.
export const supplierMatchKey = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
export const supplierRecognitionMode = mode => mode === 'exact' ? 'exact' : 'fuzzy';
const repeatedLetterKey = value => value.replace(/([A-Z])\1+/g, '$1');

// Compile once per rule/list, rather than normalizing every alias for every row.
// Restrict tolerance to repeated Latin letters. In particular, 0011 is not 01,
// and a short repeated keyword such as AAA must not degenerate into matching A.
export function createSupplierMatcher(aliases = [], mode = 'fuzzy') {
  const exact = supplierRecognitionMode(mode) === 'exact';
  const terms = [...new Set((Array.isArray(aliases) ? aliases : []).map(supplierMatchKey).filter(Boolean))].map(alias => {
    const folded = repeatedLetterKey(alias);
    return { alias, folded, tolerant: (folded.match(/[A-Z]/g) ?? []).length >= 3 };
  });
  const test = (number, folded, term) => exact ? number === term.alias
    : number.includes(term.alias) || term.tolerant && folded.includes(term.folded);
  return {
    matches(value) {
      const number = supplierMatchKey(value), folded = exact ? number : repeatedLetterKey(number);
      return Boolean(number) && terms.some(term => test(number, folded, term));
    },
    hits(value) {
      const number = supplierMatchKey(value), folded = exact ? number : repeatedLetterKey(number);
      return number ? terms.filter(term => test(number, folded, term)).map(term => term.alias) : [];
    },
  };
}
