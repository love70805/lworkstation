import { expect, it } from 'vitest';
import { productPrestorageReadiness } from './productPrestorage';
const draft = { name: '商品', imageUrl: 'https://example.com/image.png', platformSkc: 'S', store: '店', sourceUrl: 'https://detail.1688.com/offer/1.html', variants: [{ platformSku: 'A', attribute: '红', salePrice: 0 }] };
const historicalRows = [{ canonicalPlatformSku: 'A', platformSku: 'A', referenceUnitCost: 0, referenceKind: 'erp_history' }];
it('distinguishes valid explicit zero and tiny costs from empty prices, and does not use a readiness percentage', () => {
  expect(productPrestorageReadiness({ draft, historicalRows }).ready).toBe(true);
  expect(productPrestorageReadiness({ draft: { ...draft, variants: [{ ...draft.variants[0], salePrice: '' }] }, historicalRows }).labels).toContain('售价');
  expect(productPrestorageReadiness({ draft, historicalRows: [{ ...historicalRows[0], referenceUnitCost: 0.00001 }] }).ready).toBe(true);
});
it('blocks placeholder titles, invalid links, unresolved sources and title choices', () => {
  const result = productPrestorageReadiness({ draft: { ...draft, name: '未命名商品', imageUrl: 'javascript:alert(1)', sourceUrl: 'abc', identityConflicts: [{ platformSku: 'A' }] }, historicalRows, prefill: { needsTitleChoice: true, conflicts: [{ platformSku: 'A', field: 'attribute' }] } });
  expect(result.labels).toEqual(expect.arrayContaining(['商品名称', '商品图片', '供应商来源链接', '商品身份冲突', '商品名称待选择', '资料来源冲突']));
});
it('requires every retained variant and honors explicit source resolution', () => {
  const result = productPrestorageReadiness({ draft: { ...draft, variants: [...draft.variants, { platformSku: 'B' }] }, historicalRows });
  expect(result.missing.filter(item => item.platformSku === 'B').map(item => item.label)).toEqual(['属性/规格', '售价', '参考成本']);
  expect(productPrestorageReadiness({ draft: { ...draft, fieldEdits: { name: true, variants: { A: { attribute: true } } } }, historicalRows, prefill: { needsTitleChoice: true, conflicts: [{ platformSku: 'A', field: 'attribute' }] } }).ready).toBe(true);
});
