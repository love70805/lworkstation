import { afterEach, expect, it, vi } from 'vitest';
import { reportSourceFingerprint } from '../domain/reportSourceState';

afterEach(() => vi.unstubAllGlobals());

it('assembles chunked source rows in order and returns the same digest as an unchunked check', async () => {
  const messages = [];
  vi.stubGlobal('self', { postMessage: value => messages.push(value) });
  await import('./derived.worker');
  const input = { ledger: { workspaceId: 'W', id: 'L', period: '2026-10', accountingMode: 'weighted', warehouseRate: '0.7' },
    salesRows: Array.from({ length: 1201 }, (_, id) => ({ id, store: '甲', platformSku: 'SKU-' + id, amount: '0.00001' })),
    erpCosts: [], approvals: [], supplementRows: [], dispatch: null, deduction: null };
  await self.onmessage({ data: { type: 'initialize', jobId: 1, kind: 'report-source-fingerprint', input: { ...input, salesRows: [] } } });
  for (let offset = 0; offset < input.salesRows.length; offset += 500) {
    await self.onmessage({ data: { type: 'append', jobId: 1, field: 'salesRows', rows: input.salesRows.slice(offset, offset + 500) } });
  }
  expect(messages).toEqual([]);
  await self.onmessage({ data: { type: 'compute', jobId: 1 } });
  expect(messages.at(-1)).toEqual({ jobId: 1, value: await reportSourceFingerprint(input) });
  const smaller = { ...input, salesRows: [] };
  await self.onmessage({ data: { jobId: 2, kind: 'report-source-fingerprint', input: smaller } });
  expect(messages.at(-1)).toEqual({ jobId: 2, value: await reportSourceFingerprint(smaller) });
});
