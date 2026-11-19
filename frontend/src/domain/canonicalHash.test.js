import { describe, expect, it, vi } from 'vitest';
import { canonicalJson, sha256 } from './profitReports';
import { canonicalJsonChunks, hashCanonicalJson, hashCanonicalJsonSync } from './canonicalHash';
import { canonicalReportSourceState, reportSourceFingerprint } from './reportSourceState';
import { REPORT_SOURCE_DIGEST_VERSION, reportSourceDigests } from './reportSourceDigests';

describe('streamed canonical hashes retain persisted report bytes', () => {
  it('uses the caller yield boundary without timers and fails instead of returning a partial digest', async () => {
    const value = { text: '中文😀'.repeat(50000), rows: Array.from({ length: 3000 }, (_, id) => ({ id, amount: '0.0001' })) };
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock += 17);
    const yieldControl = vi.fn(async () => {});
    try {
      expect(await hashCanonicalJson(value, { yieldControl })).toBe(hashCanonicalJsonSync(value));
      expect(yieldControl).toHaveBeenCalled();
      await expect(hashCanonicalJson(value, { yieldControl: async () => { throw new Error('transaction request failed'); } })).rejects.toThrow('transaction request failed');
    } finally { now.mockRestore(); }
  });
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

  it('commits to complete canonical rows across batches, shared references and the large-record fallback', async () => {
    const purchase = { '中文"': ['😀', undefined, , null], amount: 0.0001, skipped: undefined };
    const rows = Array.from({ length: 134 }, (_, id) => ({ id, date: new Date(0), decision: purchase, evidence: purchase }));
    rows.splice(129, 0, { id: 'large', raw: '中'.repeat(2 * 1024 * 1024 + 1) });
    const hashes = await Promise.all(rows.map(row => sha256(canonicalJson(row))));
    const expected = { ordered: await sha256(hashes.join('')), unordered: await sha256(hashes.toSorted().join('')) };
    const source = { erpCosts: rows, salesRows: [] };
    expect((await reportSourceDigests(source, true)).erpCosts).toEqual(expected);
    const reordered = { erpCosts: rows.toReversed(), salesRows: [] };
    const reversed = (await reportSourceDigests(reordered, true)).erpCosts;
    expect(reversed.unordered).toBe(expected.unordered);
    expect(reversed.ordered).not.toBe(expected.ordered);
  });

  it('checks raw evidence changes and duplicate multiplicity even with the same row count and price', async () => {
    const a = { id: 1, unitCost: 0, evidence: { order: 'A' } }, b = { ...a, evidence: { order: 'B' } };
    const input = { fingerprintVersion: REPORT_SOURCE_DIGEST_VERSION, ledger: { id: 'L' },
      salesRows: [], approvals: [], supplementRows: [], erpCosts: [a, a, b] };
    const fingerprint = await reportSourceFingerprint(input);
    expect(await reportSourceFingerprint({ ...input, erpCosts: [structuredClone(a), b, structuredClone(a)] })).toBe(fingerprint);
    expect(await reportSourceFingerprint({ ...input, erpCosts: [a, b, b] })).not.toBe(fingerprint);
    await expect(reportSourceFingerprint({ ...input, fingerprintVersion: 999 })).rejects.toThrow('版本');
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
