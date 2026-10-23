import { describe, expect, it } from 'vitest';
import { selectionCatalogPlacement } from './selectionCatalogPlacement';

describe('selection catalog placement', () => {
  const product = { id: 'P', platformSkc: 'st900000000000000000008', status: 'active' };
  it('keeps existing SKCs and new branches together without mutating ownership', () => {
    const rows = [{ platformSku: 'OLD', platformSkc: product.platformSkc, productId: 'P', storeNames: ['甲店'] },
      { platformSku: 'NEW', platformSkc: product.platformSkc.toUpperCase(), productId: null, storeNames: ['乙店'] }];
    const before = structuredClone(rows);
    const result = selectionCatalogPlacement({ products: [product], rows });
    expect(result.pendingRows).toEqual([]);
    expect(result.incomingByProduct.get('P')).toEqual([rows[1]]);
    expect(result.storesByProduct.get('P')).toEqual(['甲店', '乙店']);
    expect(rows).toEqual(before);
  });
  it('keeps related stored drafts reachable from the existing catalog', () => {
    const draft = { id: 'D', platformSkc: product.platformSkc, status: 'draft' };
    const result = selectionCatalogPlacement({ products: [product], drafts: [draft], rows: [{ productId: 'D', platformSkc: draft.platformSkc }] });
    expect(result.pendingDrafts).toEqual([]);
    expect(result.pendingRows).toEqual([]);
    expect(result.draftsByProduct.get('P')).toEqual([draft]);
  });
  it('retains new products and real identity/ambiguous-parent conflicts', () => {
    const rows = [{ platformSku: 'NEW', platformSkc: 'OTHER' },
      { platformSku: 'CONFLICT', platformSkc: product.platformSkc, platformSkcConflict: true }];
    expect(selectionCatalogPlacement({ products: [product], rows }).pendingRows).toEqual(rows);
    expect(selectionCatalogPlacement({ products: [product, { ...product, id: 'P2' }], rows: [{ platformSkc: product.platformSkc }] }).pendingRows).toHaveLength(1);
    expect(selectionCatalogPlacement({ products: [{ ...product, status: 'draft' }], rows: [{ platformSkc: product.platformSkc }] }).pendingRows).toHaveLength(1);
  });
});
