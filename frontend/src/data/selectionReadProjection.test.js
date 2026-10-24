import { expect, it } from 'vitest';
import { projectSelectionErpCost } from './repositories/selectionReadProjection';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import { erpProductCatalogFixture } from '../testFixtures/erpProductCatalog';

it('keeps every reference field and purchase/supplier pairing while omitting financial raw duplicates from UI inputs', () => {
  const cost = { ...erpProductCatalogFixture(), id: 1, unitCost: 0.000001, currency: 'CNY', resolutionStatus: 'resolved',
    publishedAt: '2026-09-28', createdAt: '2026-09-28', evidence: { raw: 'original'.repeat(10000) },
    costDecision: { raw: 'retained' }, raw: { only: 'source' }, purchaseRecords: erpProductCatalogFixture().purchaseRecords.map(row => ({ ...row, raw: { large: 'original' }, quantity: 4, unitPrice: 7 })) };
  const before = structuredClone(cost), projected = projectSelectionErpCost(cost);
  expect(buildSelectionReferenceRows({ erpCosts: [projected], compactEvidence: true, includeStoreTags: true }))
    .toEqual(buildSelectionReferenceRows({ erpCosts: [cost], compactEvidence: true, includeStoreTags: true }));
  expect(projected.evidence).toBeUndefined(); expect(projected.raw).toBeUndefined();
  expect(projected.purchaseRecords.every(row => row.raw === undefined && row.unitPrice === undefined)).toBe(true);
  expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(cost).length / 5);
  expect(cost).toEqual(before);
});
