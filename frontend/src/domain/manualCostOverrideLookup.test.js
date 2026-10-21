import { it, expect } from 'vitest';
import { createManualOverrideLookup, selectManualOverride } from './manualCostOverride';

const approval = (id, extra = {}) => ({ id, workspaceId: 'W', ledgerId: 'L', platformSku: 'SKU', status: 'approved', currency: 'CNY',
  approvedAmount: 0, approvedBy: 'finance', approvedAt: '2026-10-20T00:00:00Z', reason: '实价', referenceCost: { kind: 'manual_override', store: '甲店' }, ...extra });
it('is equivalent to the existing selector across scopes, revoked/invalid entries, zero and tiny amounts', () => {
  const records = Array.from({ length: 1200 }, (_, i) => approval('A' + i, {
    workspaceId: 'W' + i % 2, ledgerId: 'L' + Math.floor(i / 2) % 2, platformSku: 'SKU-' + i % 37,
    approvedAmount: [0, 0.00000001, 4, null][i % 4], currency: i % 7 ? 'CNY' : 'USD', status: i % 5 ? 'approved' : 'revoked',
    approvedAt: '2026-10-' + String(i % 28 + 1).padStart(2, '0') + 'T00:00:00Z',
    referenceCost: { kind: i % 11 ? 'manual_override' : 'reference', store: i % 3 ? '甲店' : '乙店' },
  }));
  const lookup = createManualOverrideLookup(records);
  for (const workspaceId of ['W0', 'W1', 'FOREIGN']) for (const ledgerId of ['L0', 'L1']) for (const store of ['甲店', '乙店']) for (let i = 0; i < 37; i++) {
    const scope = { workspaceId, ledgerId, store, platformSku: 'sku-' + i };
    expect(lookup(scope)).toBe(selectManualOverride(records, scope));
  }
});
it('keeps the first equal-time winner and honors referenceSnapshot precedence', () => {
  const first = approval('FIRST'), second = approval('SECOND', { approvedAmount: 0.00001 });
  const legacy = approval('LEGACY', { referenceSnapshot: { kind: 'manual_override', store: '乙店' } });
  const lookup = createManualOverrideLookup([first, second, legacy]);
  expect(lookup({ workspaceId: 'W', ledgerId: 'L', store: '甲店', platformSku: 'sku' })).toBe(first);
  expect(lookup({ workspaceId: 'W', ledgerId: 'L', store: '乙店', platformSku: 'SKU' })).toBe(legacy);
  expect(lookup({ workspaceId: 'W', ledgerId: 'OTHER', store: '甲店', platformSku: 'SKU' })).toBeNull();
});
it('does not rescan all approval amounts for each of many requested SKUs', () => {
  let reads = 0;
  const records = Array.from({ length: 1000 }, (_, i) => ({ ...approval('A' + i, { platformSku: 'SKU-' + i }), get approvedAmount() { reads++; return 0; } }));
  const lookup = createManualOverrideLookup(records), preparedReads = reads;
  for (let i = 0; i < 1000; i++) expect(lookup({ workspaceId: 'W', ledgerId: 'L', store: '甲店', platformSku: 'SKU-' + i }).id).toBe('A' + i);
  expect(preparedReads).toBe(1000); expect(reads).toBe(preparedReads);
});

it('does not let a malformed foreign approval break an unrelated ledger lookup', () => {
  const valid = approval('CURRENT');
  const lookup = createManualOverrideLookup([approval('FOREIGN', { workspaceId: 'OTHER', platformSku: '　' }), valid]);
  expect(lookup({ workspaceId: 'W', ledgerId: 'L', store: '甲店', platformSku: 'SKU' })).toBe(valid);
});
