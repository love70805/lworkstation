import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from './db/clientDatabase';
import { setActiveMemberContext, getSelectionPrestorageAutomationSnapshot } from './repositories/selectionRepository';
import { readTrustedErpCostInboxCatalogRecords } from './repositories/erpCatalogRepository';
import * as identities from '../domain/identifiers';
import * as envelopes from '../domain/erpInboxContract';
import { recoverErpCostInboxAdoptions } from './repositories/profitRepository';

beforeEach(async () => { await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId: 'W', memberId: 'M' }); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

it('does not read sales or purchase history when no visible automatic prestorage candidate exists', async () => {
  await db.products.bulkPut([{ id: 'ACTIVE', workspaceId: 'W', status: 'active' }, { id: 'MANUAL', workspaceId: 'W', status: 'draft' },
    { id: 'OTHER', workspaceId: 'OTHER', status: 'draft', attributes: { catalogOrigin: 'ledger_import' } }]);
  const sales = vi.spyOn(db.salesRows, 'where'), inbox = vi.spyOn(db.erpCostInbox, 'where'), costs = vi.spyOn(db.erpCostBatches, 'toArray');
  expect(await getSelectionPrestorageAutomationSnapshot()).toEqual({ workspaceId: 'W', products: [] });
  expect(sales).not.toHaveBeenCalled(); expect(inbox).not.toHaveBeenCalled(); expect(costs).not.toHaveBeenCalled();
});

it('excludes sources already projected from published batches before loading or validating envelopes', async () => {
  await db.erpCostInbox.bulkPut(Array.from({ length: 47 }, (_, i) => ({ id: `I-${i}`, workspaceId: 'W', batchId: `B-${i}`, status: 'applied', envelope: { privateHistory: 'fixture-only'.repeat(1000) } })));
  const validate = vi.spyOn(envelopes, 'validateErpCostInboxEnvelope'), reads = vi.spyOn(db.salesRows, 'where');
  expect(await readTrustedErpCostInboxCatalogRecords({ workspaceId: 'W' }, null, { excludedBatchIds: new Set(Array.from({ length: 47 }, (_, i) => `B-${i}`)) })).toEqual([]);
  expect(validate).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled();
});

it('does not hydrate applied purchase envelopes during automatic recovery', async () => {
  await db.erpCostInbox.bulkPut(Array.from({ length: 47 }, (_, i) => ({ id: `I-${i}`, workspaceId: 'W', batchId: `B-${i}`, status: 'applied', envelope: { privateHistory: 'fixture-only'.repeat(1000) } })));
  const hydrated = [];
  const observe = row => { hydrated.push(row.id); return row; };
  db.erpCostInbox.hook('reading', observe);
  try { expect(await recoverErpCostInboxAdoptions({ workspaceId: 'W' })).toEqual([]); expect(hydrated).toEqual([]); }
  finally { db.erpCostInbox.hook('reading').unsubscribe(observe); }
});

it('checks each request identity once using an index, retaining conflict rejection', async () => {
  const count = 200, expected = Array.from({ length: count }, (_, i) => ({ platformSku: `SKU-${i}`, platformSkc: `SKC-${i}` }));
  const snapshot = { products: [], platformSkus: [], salesRows: expected.map(row => ({ ...row, workspaceId: 'W', ledgerId: 'L', batchId: 'IMPORT' })),
    importBatches: [{ id: 'IMPORT', workspaceId: 'W', ledgerId: 'L', status: 'completed' }], ledgers: [{ id: 'L', workspaceId: 'W', period: '2026-09' }] };
  await db.erpCostRequests.put({ id: 'R', workspaceId: 'W', ledgerId: 'L', ledgerPeriod: '2026-09', expectedSkus: expected });
  await db.erpCostInbox.bulkPut(Array.from({ length: 20 }, (_, i) => ({ id: `I-${i}`, batchId: `B-${i}`, workspaceId: 'W', ledgerId: 'L', requestId: 'R', status: 'pending', envelope: {} })));
  const normalize = vi.spyOn(identities, 'canonicalPlatformSku'), validate = vi.spyOn(envelopes, 'validateErpCostInboxEnvelope');
  await readTrustedErpCostInboxCatalogRecords({ workspaceId: 'W' }, snapshot);
  expect(validate).toHaveBeenCalledTimes(20);
  expect(normalize.mock.calls.length).toBeLessThan(count * 8);
  validate.mockClear(); snapshot.salesRows.push({ ...snapshot.salesRows[0], platformSkc: 'CONTRADICTORY-SKC' });
  await readTrustedErpCostInboxCatalogRecords({ workspaceId: 'W' }, snapshot);
  expect(validate).not.toHaveBeenCalled();
});
