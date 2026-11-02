import { expect, it } from 'vitest';
import { historicalLowestCosts } from './inventoryAccounting';
const record = (recordId, unitPrice, patch = {}) => ({ recordId, warehouseSku: 'WH', quantity: 2, unitPrice, purchaseDate: '2026-01-10', ...patch });
const cost = purchaseRecords => ({ id: 1, platformSku: 'SKU', platformSkc: 'SKC', warehouseSku: 'WH', evidenceComplete: true, purchaseRecords, publishedAt: '2026-10-01' });

it('selects the all-time minimum including purchases after the ledger month without changing source evidence', () => {
  const input = cost([record('old', 4, { purchaseDate: '2024-01-10' }), record('recent', 8), record('later', 2, { purchaseDate: '2027-01-10', eligible: false, exclusionReasons: ['after_ledger_period'] })]);
  const before = structuredClone(input);
  expect(historicalLowestCosts([input])[0]).toMatchObject({ unitCost: 2, selectedRecordIds: ['later'] });
  expect(input).toEqual(before);
});

it('excludes cancelled, invalid, incomplete and unresolved suspicious prices', () => {
  const input = cost([record('valid', 6), record('cancelled', 0.1, { statusFields: { purchaseStatus: '11' } }), record('zero', 0), record('one', 1), record('missing-date', 0.2, { purchaseDate: '' })]);
  expect(historicalLowestCosts([input, { ...cost([record('unverified', 0.01)]), evidenceComplete: false }])[0].unitCost).toBe(6);
});

it('keeps SKU/SKC ownership separate and validates recorded price corrections', () => {
  const input = cost([record('corrected', 0), record('regular', 6)]);
  input.costDecision = { resolutions: [{ recordId: 'corrected', warehouseSku: 'WH', action: 'correct_price', originalUnitPrice: 0, resolvedUnitPrice: 3, resolvedBy: 'finance', resolvedAt: '2026-11-02T12:00:00Z' }] };
  const result = historicalLowestCosts([input, { ...cost([record('other-parent', 2)]), platformSkc: 'OTHER' }]);
  expect(result.map(row => [row.platformSkc, row.unitCost])).toEqual([['SKC', 3], ['OTHER', 2]]);
});
it('does not resurrect old erroneous prices or cancelled records from a superseded evidence snapshot', () => {
  const old = { ...cost([record('same', 2)]), publishedAt: '2026-09-01' };
  const latest = { ...cost([record('same', 8), record('other', 6)]), publishedAt: '2026-10-01' };
  expect(historicalLowestCosts([old, latest])[0].unitCost).toBe(6);
  expect(historicalLowestCosts([old, { ...latest, purchaseRecords: [record('same', 2, { statusFields: { purchaseStatus: '11' } })] }])).toEqual([]);
});
