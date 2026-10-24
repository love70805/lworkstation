import { expect, it } from 'vitest';
import { prestorageAttemptFingerprint } from './prestorageAttemptFingerprint';

it('retains a fixed-size attempt identity for complete histories and detects equal-count edits', async () => {
  const product = { updatedAt: '2026-10-24', draft: { sourceRecords: Array.from({ length: 1000 }, (_, i) => ({ id: i, note: '完整合成记录'.repeat(40) })) }, prefill: { needsTitleChoice: false } };
  const first = await prestorageAttemptFingerprint(product);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(await prestorageAttemptFingerprint(structuredClone(product))).toBe(first);
  product.draft.sourceRecords[999].note = '相同条数但内容变化';
  expect(await prestorageAttemptFingerprint(product)).not.toBe(first);
  expect(product.draft.sourceRecords).toHaveLength(1000);
});
