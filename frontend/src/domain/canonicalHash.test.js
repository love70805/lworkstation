import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from './profitReports';
import { canonicalJsonChunks, hashCanonicalJson, hashCanonicalJsonSync } from './canonicalHash';
import { canonicalReportSourceState, reportSourceFingerprint } from './reportSourceState';

describe('streamed canonical hashes retain persisted report bytes', () => {
  it('matches the historical representation across JSON and Unicode boundaries', async () => {
    const values = [null, true, false, 0, -0, 1e30, NaN, Infinity, '', [], {},
      [undefined, , null, '尾'], { z: undefined, b: [3, 2, 1], a: { y: false, x: 0 } },
      'a'.repeat(16383) + '😀' + '\ud800' + 'b'.repeat(65536) + '\udc00',
      { '键"\\\n😀': '\b\f\r\t\u0000\u2028中文', date: new Date('2026-01-01'), negative: -0.0000001 }];
    for (const value of values) {
      expect([...canonicalJsonChunks(value)].join('')).toBe(canonicalJson(value));
      expect(await hashCanonicalJson(value)).toBe(await sha256(canonicalJson(value)));
      expect(hashCanonicalJsonSync(value)).toBe(await sha256(canonicalJson(value)));
    }
  });

  it('hashes large source/file values without producing large serialization chunks', async () => {
    const value = { fileBase64: 'A'.repeat(2 * 1024 * 1024), rawValue: '中文😀'.repeat(50000) };
    let largest = 0;
    for (const part of canonicalJsonChunks(value)) largest = Math.max(largest, part.length);
    expect(largest).toBeLessThanOrEqual(6 * 16384);
    expect(await hashCanonicalJson(value)).toBe(await sha256(canonicalJson(value)));
  });

  it('retains source-state hashes, ignores row order and detects equal-count edits', async () => {
    const source = { ledger: { workspaceId: 'W', id: 'L', period: '2026-09', accountingMode: 'weighted', warehouseRate: 0 },
      salesRows: [{ id: 2, amountExact: '0.0001' }, { id: 1, amountExact: '2' }],
      erpCosts: [{ id: 1, purchaseRecords: [{ quantity: 1, rawValue: { serviceUnitPrice: '0.0001' } }] }],
      approvals: [{ unitCost: 0 }], dispatch: null, deduction: { amountExact: '0' }, supplementRows: [] };
    const fingerprint = await reportSourceFingerprint(source);
    expect(fingerprint).toBe(await sha256(canonicalReportSourceState(source)));
    expect(await reportSourceFingerprint({ ...source, salesRows: [...source.salesRows].reverse() })).toBe(fingerprint);
    for (const mutate of [
      data => { data.salesRows[0].amountExact = '0.0002'; },
      data => { data.erpCosts[0].purchaseRecords[0].rawValue.serviceUnitPrice = '0.0002'; },
      data => { data.approvals[0].unitCost = 0.00001; },
      data => { data.ledger.accountingMode = 'historical_lowest'; },
      data => { data.ledger.workspaceId = 'OTHER'; },
      data => { data.deduction.amountExact = '0.0001'; },
    ]) {
      const changed = structuredClone(source); mutate(changed);
      const actual = await reportSourceFingerprint(changed);
      expect(actual).not.toBe(fingerprint);
      expect(actual).toBe(await sha256(canonicalReportSourceState(changed)));
    }
  });
});
