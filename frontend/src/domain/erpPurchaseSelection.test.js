import { expect, it } from 'vitest';
import { purchaseTimestamp, selectLatestPurchaseRecords } from './erpPurchaseSelection';

// Original ordering is the contract, including numeric Chinese tie breaks and
// stable equal keys. This reference deliberately retains the slower comparator.
function reference(records, limit = 3) {
  return records.filter(record => record.eligible !== false && (record.exclusionReasons ?? []).length === 0
    && purchaseTimestamp(record) > 0 && Number.isFinite(Number(record.quantity)) && Number(record.quantity) > 0
    && record.unitPrice != null && Number.isFinite(Number(record.unitPrice)) && Number(record.unitPrice) >= 0)
    .toSorted((a, b) => purchaseTimestamp(b) - purchaseTimestamp(a)
      || String(b.purchaseOrderId ?? '').localeCompare(String(a.purchaseOrderId ?? ''), 'zh-CN', { numeric: true })
      || String(b.recordId ?? '').localeCompare(String(a.recordId ?? ''), 'zh-CN', { numeric: true })).slice(0, limit);
}

it('keeps recent-three selection identical for large histories, zones, ties and invalid evidence', () => {
  const dates = ['2026-09-29 09:28:40', '2026-09-29T01:28:40Z', '2026-09-28', '2026/09/29 09:28:40', 'invalid', '2026-02-30'];
  const records = Array.from({ length: 240 }, (_, i) => ({ recordId: `采购-${i % 13}`, purchaseOrderId: `单-${i % 17}`,
    purchaseDate: dates[i % dates.length], quantity: i % 19 ? 2 : 0, unitPrice: i % 23 ? 1.2 : null,
    eligible: i % 29 !== 0, exclusionReasons: i % 31 ? [] : ['cancelled_or_closed'] }));
  for (const limit of [0, 1, 3, 20, 300]) {
    const expected = reference(records, limit), actual = selectLatestPurchaseRecords(records, limit);
    expect(actual).toEqual(expected);
    actual.forEach((record, index) => expect(record).toBe(expected[index]));
  }
  expect(records[0].recordId).toBe('采购-0');
});

it('rereads evidence changes between independent validations', () => {
  const rows = [1, 2, 3, 4].map(day => ({ recordId: String(day), purchaseDate: `2026-09-0${day}`, quantity: 1, unitPrice: 1 }));
  expect(selectLatestPurchaseRecords(rows).map(row => row.recordId)).toEqual(['4', '3', '2']);
  rows[0].purchaseDate = '2026-09-30';
  rows[3].eligible = false;
  expect(selectLatestPurchaseRecords(rows).map(row => row.recordId)).toEqual(['1', '3', '2']);
});
