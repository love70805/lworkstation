import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { calculateWarehouseCostDecision } from './erpCostResolution';

const sandbox = { window: {}, URL };
vm.runInNewContext(readFileSync(new URL('../../../integrations/erp-assistant-extension/src/result-policy.js', import.meta.url), 'utf8'), sandbox);
const policy = sandbox.window.ShopeersErpResultPolicy;
const purchase = (price, index, extra = {}) => ({ recordId: `R-${index}`, warehouseSku: 'WH', purchaseDate: `2026-${index < 6 ? '07' : '08'}-${String(index + 1).padStart(2, '0')}`, quantity: index + 1, unitPrice: price, ...extra });

it.each([
  ['zero and one', [0, 1, 1]],
  ['low shift', [...Array(6).fill(2.3), 1.55, 1.59, 1.58]],
  ['high shift', [...Array(6).fill(2.3), 3.7, 3.6, 3.5]],
  ['extreme single', [...Array(8).fill(3), 8]],
  ['insufficient history', [3, 3, 8]],
  ['varying history', [1.1, 4.4, 2.2, 5.5, 3.3, 6.6, 1.2, 2.2, 3.2]],
  ['tolerance boundary', [...Array(6).fill(10), 7, 7, 10]],
  ['micro cost', [0.0003, 0.0003, 0.0003]],
])('uses the same anomaly decision and selected purchases as the workbench: %s', (_name, prices) => {
  const records = prices.map((price, index) => purchase(price, index));
  records.push(purchase(1, 20, { purchaseDate: '2026-09-01' }));
  records.push(purchase(99, 21, { statusFields: { orderStatus: '已取消' } }));
  records.push(purchase(99, 22, { quantity: 0 }));
  records.push(purchase(99, 23, { unitPrice: null }));
  records.push(purchase(99, 24, { eligible: false, exclusionReasons: ['invalid_purchase_detail'] }));
  const evidence = { warehouses: [{ warehouseSku: 'WH', evidenceComplete: true, purchaseRecords: records }] };
  const original = JSON.stringify(evidence);
  const preview = policy.previewForLedger([{ warehouseSku: 'WH' }], evidence, '2026-08')[0];
  const formal = calculateWarehouseCostDecision({ warehouseSku: 'WH', purchaseRecords: records, period: '2026-08' });
  expect(Array.from(preview.selectedRecordIds)).toEqual(formal.selectedRecordIds);
  expect(preview.unitCost == null ? null : Number(preview.unitCost)).toBe(formal.unitCost);
  expect(JSON.parse(JSON.stringify(preview.costWarnings.records)).map(row => ({ recordId: row.recordId, reasons: row.reasons })))
    .toEqual(formal.anomalies.map(row => ({ recordId: row.recordId, reasons: row.reasons })));
  expect(JSON.stringify(evidence)).toBe(original);
});

it('re-evaluates old month-cutoff flags without including a cancelled purchase', () => {
  const records = [purchase(1, 0, { eligible: false, exclusionReasons: ['on_or_after_ledger_period'] }), purchase(99, 1, { eligible: false, exclusionReasons: ['on_or_after_ledger_period'], statusFields: { orderStatus: '已取消' } })];
  const preview = policy.previewForLedger([{ warehouseSku: 'WH' }], { warehouses: [{ warehouseSku: 'WH', purchaseRecords: records }] }, '2026-08')[0];
  expect(Array.from(preview.selectedRecordIds)).toEqual(['R-0']);
  expect(preview.costWarnings.count).toBe(1);
});
