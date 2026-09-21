import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { calculateWarehouseCostDecision } from './erpCostResolution';

const sandbox = {};
vm.runInNewContext(readFileSync(new URL('../../../integrations/erp-assistant-extension/src/result-policy.js', import.meta.url), 'utf8'), sandbox);
const policy = sandbox.ShopeersErpResultPolicy;
const record = (id, date, quantity, unitPrice, extra = {}) => ({ recordId: id, warehouseSku: 'WH', purchaseDate: date, quantity, unitPrice, eligible: true, ...extra });
const preview = (records, period) => JSON.parse(JSON.stringify(policy.previewForLedger([{ warehouseSku: 'WH', mappings: [] }], { warehouses: [{ warehouseSku: 'WH', purchaseRecords: records }] }, period)[0]));

describe('ERP extension preview uses the ledger month', () => {
  it('excludes the screenshot September records for August and keeps all evidence', () => {
    const records = [record('SEP15', '2026-09-15', 150, .12), record('SEP11', '2026-09-11', 150, .12), record('JUNE', '2026-06-21', 500, .106), record('MAY', '2026-05-01', 100, .108), record('APRIL', '2026-04-01', 100, .11)];
    const original = structuredClone(records);
    vi.useFakeTimers();
    try {
      for (const now of ['2026-07-01', '2026-09-22', '2027-01-01']) {
        vi.setSystemTime(new Date(now));
        const result = preview(records, '2026-08');
        expect(result).toMatchObject({ ledgerPeriod: '2026-08', selectedRecordIds: ['JUNE', 'MAY', 'APRIL'], unitCost: '0.1068' });
        expect(Number(result.unitCost)).toBe(calculateWarehouseCostDecision({ warehouseSku: 'WH', purchaseRecords: records, period: '2026-08' }).unitCost);
      }
    } finally { vi.useRealTimers(); }
    expect(preview(records, '2026-09')).toMatchObject({ selectedRecordIds: ['SEP15', 'SEP11', 'JUNE'], unitCost: '0.1112' });
    expect(records).toEqual(original);
  });

  it('uses supplier information only from selected records', () => {
    const records = [record('FUTURE', '2026-09-01', 1, 5, { supplierName: '未来', supplier1688Url: 'future' }), record('GOOD', '2026-08-01', 1, 5, { supplierName: '八月', supplier1688Url: 'august' })];
    expect(preview(records, '2026-08')).toMatchObject({ supplierName: '八月', supplier1688Url: 'august' });
    expect(preview(records, null)).toMatchObject({ supplierName: '', supplier1688Url: '' });
  });

  it('does not show a price for unknown month, invalid month or future-only evidence', () => {
    const records = [record('FUTURE', '2026-09-01', 1, 12)];
    for (const period of [null, undefined, '2026-13']) expect(preview(records, period)).toMatchObject({ unitCost: null, totalPrice: null, selectedRecordIds: [], previewStatus: 'period_unknown' });
    expect(preview(records, '2026-08')).toMatchObject({ unitCost: null, selectedRecordIds: [], previewStatus: 'no_purchase' });
  });

  it('shares precise dates, deterministic same-day ordering and month boundaries with formal selection', () => {
    const records = [record('NEXT', '2026-08-31T16:00:00Z', 1, 12), record('LAST', '2026-08-31T15:59:59Z', 1, 4),
      record('R2', '2026-08-31 13:00:00', 2, 4), record('R3', '2026-08-31 13:00:00', 3, 4), record('R1', '2026-08-31 12:00:00', 1, 4), record('INVALID', '2026-02-30', 1, 4)];
    const formal = calculateWarehouseCostDecision({ warehouseSku: 'WH', purchaseRecords: records, period: '2026-08' });
    expect(preview(records.toReversed(), '2026-08').selectedRecordIds).toEqual(formal.selectedRecordIds);
    expect(preview(records, '2026-08').selectedRecordIds).toEqual(['LAST', 'R3', 'R2']);
  });

  it.each([[.009, .01, .0101], [.0007, .0008, .0009], [3.4, 3.6, 3.7]])('truncates only after exact weighting for %j', (...prices) => {
    const records = prices.map((p, i) => record(`R${i}`, `2026-08-0${i + 1}`, (i + 1) / 10, p));
    const formal = calculateWarehouseCostDecision({ warehouseSku: 'WH', purchaseRecords: records, period: '2026-08' });
    expect(Number(preview(records, '2026-08').unitCost)).toBe(formal.unitCost);
  });

  it('keeps real zero distinct from missing, excludes invalid and cancelled purchases', () => {
    const records = [record('CANCEL', '2026-08-31', 2, 10, { statusFields: { status: '状态：已取消' } }), record('FULLWIDTH', '2026-08-31', 2, 10, { statusFields: { status: '１１' } }), record('BAD', '2026-08-30', 0, 12), record('ZERO', '2026-08-29', 2, 0)];
    expect(preview(records, '2026-08')).toMatchObject({ unitCost: '0.0000', selectedRecordIds: ['ZERO'], costWarningCount: 1 });
  });
});
