import { expect, it } from 'vitest';
import { historicalLowestCosts } from './inventoryAccounting';
import { resolveFormalCostDecision } from './costPolicy';
import { reconcileErpCostRows } from './erpCosts';
const record = (recordId, unitPrice, patch = {}) => ({ recordId, warehouseSku: 'WH', quantity: 2, unitPrice, purchaseDate: '2026-01-10', ...patch });
const cost = purchaseRecords => ({ id: 1, platformSku: 'SKU', platformSkc: 'SKC', warehouseSku: 'WH', evidenceComplete: true, purchaseRecords, publishedAt: '2026-10-01' });

it('selects the all-time minimum including purchases after the ledger month without changing source evidence', () => {
  const input = cost([record('old', 4, { purchaseDate: '2024-01-10' }), record('recent', 8), record('later', 2, { purchaseDate: '2027-01-10', eligible: false, exclusionReasons: ['after_ledger_period'] })]);
  const before = structuredClone(input);
  expect(historicalLowestCosts([input])[0]).toMatchObject({ unitCost: 2, selectedRecordIds: ['later'] });
  expect(input).toEqual(before);
});

it('accepts one-yuan and extreme positive prices while excluding cancelled, invalid and incomplete evidence', () => {
  const input = cost([record('valid', 6), record('cancelled', 0.1, { statusFields: { purchaseStatus: '11' } }), record('zero', 0), record('one', 1), record('missing-date', 0.2, { purchaseDate: '' })]);
  expect(historicalLowestCosts([input, { ...cost([record('unverified', 0.01)]), evidenceComplete: false }])[0].unitCost).toBe(1);
  expect(historicalLowestCosts([cost([record('low', 0.001), record('high', 100000)])])[0].unitCost).toBe(0.001);
});
it('recovers date-only exclusions kept in the separate evidence list without admitting cancelled purchases', () => {
  const input = { ...cost([record('ordinary', 6)]), excludedRecords: [
    record('after-month', 1, { purchaseDate: '2027-01-01', eligible: false, exclusionReasons: ['after_ledger_period'], purchaseOrderNo: 'FUTURE-PO' }),
    record('cancelled', 0.01, { eligible: false, exclusionReasons: ['cancelled'], statusFields: { purchaseStatus: '11' } }),
  ] };
  expect(historicalLowestCosts([input])[0]).toMatchObject({ unitCost: 1, selectedRecordIds: ['after-month'], orderNumber: 'FUTURE-PO' });
});

it('keeps the minimum price attached to its actual 1688 or purchase order number', () => {
  expect(historicalLowestCosts([cost([record('min',1,{order1688:'QA-1688'}),record('other',8,{purchaseOrderNo:'QA-PO'})])])[0]).toMatchObject({unitCost:1,orderNumber:'QA-1688',orderType:'1688'});
  expect(historicalLowestCosts([cost([record('min',2,{purchaseOrderNo:'QA-PO'})])])[0]).toMatchObject({orderNumber:'QA-PO',orderType:'purchase_order'});
});

it('preserves a tiny positive minimum through formal profit cost resolution', () => {
  const minimum = historicalLowestCosts([cost([record('tiny', 0.000001, { purchaseOrderNo: 'QA-TINY' })])])[0];
  expect(minimum.unitCost).toBe(0.000001);
  expect(resolveFormalCostDecision({ platformSku: 'SKU', erpCost: minimum })).toMatchObject({ eligibleForExactProfit: true, unitCost: 0.000001 });
  expect(resolveFormalCostDecision({ platformSku: 'SKU', erpCost: { ...minimum, accountingMode: 'weighted' } }).eligibleForExactProfit).toBe(false);
  expect(reconcileErpCostRows({ workspaceId: 'W', expectedSkus: [{ platformSku: 'SKU', platformSkc: 'SKC' }], costRows: [minimum] }).matches[0]).toMatchObject({ status: 'matched', unitCost: 0.000001 });
});

it('keeps the one-yuan minimum ready in cost review and leaves ordinary price review intact', () => {
  const minimum = historicalLowestCosts([cost([record('one', 1)])])[0];
  const scope = { workspaceId: 'W', expectedSkus: [{ platformSku: 'SKU', platformSkc: 'SKC' }], costRows: [minimum] };
  expect(reconcileErpCostRows(scope).matches[0].status).toBe('matched');
  expect(reconcileErpCostRows({ ...scope, period: '2026-10', costRows: [{ ...cost([record('one', 1)]), publishedAt: null }] }).matches[0].status).toBe('anomaly_pending');
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

it('does not let delayed adoption of older evidence replace a newer captured history', () => {
  const old = { ...cost([record('old', 8)]), sourceOrder: [Date.parse('2026-09-01'), Date.parse('2026-10-01'), 'OLD'], publishedAt: '2026-10-05' };
  const fresh = { ...cost([record('fresh', 3)]), sourceOrder: [Date.parse('2026-09-02'), Date.parse('2026-10-02'), 'NEW'], publishedAt: '2026-10-03' };
  expect(historicalLowestCosts([old, fresh])[0]).toMatchObject({ unitCost: 3, selectedRecordIds: ['fresh'] });
});

it('keeps corrected newer history even when an old snapshot arrives late', () => {
  const old = { ...cost([record('old-wrong-price', 1)]), sourceOrder: [1, Date.parse('2026-10-01'), 'OLD'], publishedAt: '2026-10-05' };
  const fresh = { ...cost([record('corrected', 6)]), sourceOrder: [2, Date.parse('2026-10-02'), 'NEW'], publishedAt: '2026-10-03' };
  expect(historicalLowestCosts([fresh, old])[0]).toMatchObject({ unitCost: 6, selectedRecordIds: ['corrected'] });
});
it('orders complete snapshots by generation even when a long-running request started earlier', () => {
  const earlierRequest = { ...cost([record('fresh', 6)]), sourceOrder: [Date.parse('2026-09-01'), Date.parse('2026-11-03'), 'FRESH'] };
  const laterRequest = { ...cost([record('stale', 1)]), sourceOrder: [Date.parse('2026-10-01'), Date.parse('2026-11-02'), 'STALE'] };
  expect(historicalLowestCosts([earlierRequest, laterRequest])[0].selectedRecordIds).toEqual(['fresh']);
});
it('preserves a recorded correction when the same raw snapshot is delivered again', () => {
  const raw = { ...cost([record('price', 1)]), sourceGeneratedAt: '2026-11-02T00:00:00Z', sourceOrder: [1, 2, 'SAME'], evidenceOrigin: 'receipt', publishedAt: '2026-11-04' };
  const published = { ...raw, evidenceOrigin: 'published', publishedAt: '2026-11-03', costDecision: { resolutions: [
    { recordId: 'price', warehouseSku: 'WH', action: 'correct_price', originalUnitPrice: 1, resolvedUnitPrice: 3, resolvedBy: 'finance', resolvedAt: '2026-11-03T00:00:00Z' },
  ] } };
  expect(historicalLowestCosts([published, raw])[0].unitCost).toBe(3);
});
it('compares fallback timestamps by their instant rather than ISO text ordering', () => {
  const fresh = { ...cost([record('fresh', 4)]), publishedAt: '2026-11-02T00:30:00Z' };
  const stale = { ...cost([record('stale', 1)]), publishedAt: '2026-11-02T08:00:00+08:00' };
  expect(historicalLowestCosts([fresh, stale])[0].unitCost).toBe(4);
});
