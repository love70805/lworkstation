import { expect, it } from 'vitest';
import { indexErpAnomalyEvidence } from './erpAnomalyEvidence';

const purchase = { recordId: 'R', warehouseSku: 'W', purchaseDate: '2026-08-01', quantity: 2, unitPrice: 1, statusFields: { orderStatus: '完成', paymentStatus: '已付' } };
const batch = () => ({ formatVersion: 2, sourceFormatVersion: 2, batchId: 'B', rows: [{ ledgerScopeRole: 'expected', platformSku: 'S', warehouseSku: 'W' }],
  warehouseEvidence: [{ warehouseSku: 'W', evidenceComplete: true, purchaseRecords: [structuredClone(purchase)] }] });
const key = value => indexErpAnomalyEvidence(value, '2026-08').get('W')?.key;

it('compares complete purchase facts independently of delivery identity, ordering and catalog decoration', () => {
  const first = batch(), second = batch();
  first.warehouseEvidence[0].purchaseRecords.push({ ...purchase, recordId: 'R-2' });
  second.warehouseEvidence[0].purchaseRecords.unshift({ ...purchase, recordId: 'R-2' });
  second.batchId = 'OTHER'; second.generatedAt = '2026-10-01';
  Object.assign(second.warehouseEvidence[0].purchaseRecords[1], { productName: '新商品名', imageUrl: 'https://example.test/image.png', statusFields: { paymentStatus: '已付', orderStatus: '完成' } });
  expect(key(first)).toBeTruthy();
  expect(key(second)).toBe(key(first));
});

it.each([
  ['record identity', row => { row.recordId = 'R2'; }],
  ['raw price precision', row => { row.unitPrice = 1.00000001; }],
  ['quantity', row => { row.quantity = 3; }],
  ['date', row => { row.purchaseDate = '2026-08-02'; }],
  ['total', row => { row.totalPrice = 2.00001; }],
  ['order', row => { row.purchaseOrderNo = 'P2'; }],
  ['status', row => { row.statusFields.orderStatus = '已取消'; }],
  ['eligibility', row => { row.eligible = false; }],
  ['exclusion', row => { row.exclusionReasons = ['source_error']; }],
])('does not equate changed %s with a previously reviewed purchase', (_name, mutate) => {
  const changed = batch(); mutate(changed.warehouseEvidence[0].purchaseRecords[0]);
  expect(key(changed)).not.toBe(key(batch()));
});

it('includes non-selected history and excluded records in evidence identity', () => {
  const first = batch(), second = batch();
  for (let i = 0; i < 10; i++) {
    for (const value of [first, second]) value.warehouseEvidence[0].purchaseRecords.push({ ...purchase, recordId: `H-${i}`, purchaseDate: '2026-07-01', unitPrice: 30 });
  }
  second.warehouseEvidence[0].purchaseRecords.at(-1).unitPrice = 31;
  expect(key(first)).not.toBe(key(second));
  const excluded = batch(); excluded.warehouseEvidence[0].excludedRecords = [{ ...purchase, recordId: 'EXCLUDED', eligible: false, exclusionReasons: ['cancelled_or_closed'] }];
  expect(key(excluded)).not.toBe(key(batch()));
});

it('distinguishes new purchase-total evidence from legacy evidence even when totals agree', () => {
  const fresh = batch();
  Object.assign(fresh.warehouseEvidence[0].purchaseRecords[0], { amountBasis: 'purchase_total', totalPrice: 2, purchaseUnitPrice: 1, serviceUnitPrice: 0 });
  expect(key(fresh)).toBeTruthy();
  expect(key(fresh)).not.toBe(key(batch()));
});

it.each(['purchaseUnitPrice', 'serviceUnitPrice'])('requires review when %s changes despite an unchanged total', field => {
  const first = batch();
  Object.assign(first.warehouseEvidence[0].purchaseRecords[0], { amountBasis: 'purchase_total', totalPrice: 2, purchaseUnitPrice: 0.8, serviceUnitPrice: 0.2 });
  const second = structuredClone(first);
  second.warehouseEvidence[0].purchaseRecords[0][field] += 0.01;
  expect(key(first)).toBeTruthy();
  expect(key(second)).not.toBe(key(first));
  expect(key(structuredClone(first))).toBe(key(first));
});

it.each([
  value => { value.warehouseEvidence[0].evidenceComplete = false; },
  value => { value.warehouseEvidence[0].sourceWarnings = ['incomplete']; },
  value => { value.warehouseEvidence.push(structuredClone(value.warehouseEvidence[0])); },
  value => { value.sourceMeta = { completenessScope: 'source' }; },
  value => { value.sourceMeta = { mappingFailures: [{ platformSku: 'S' }] }; },
  value => { value.rows[0].mappingFallback = true; },
])('does not provide a reusable identity for incomplete or ambiguous evidence %#', mutate => {
  const value = batch(); mutate(value);
  expect(key(value)).toBeUndefined();
});
