import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from './db/clientDatabase';
import { ACTIVE_MEMBER_CONTEXT_KEY, DEFAULT_WORKSPACE_ID } from './db/constants';
import { getLatestLedgerSnapshot } from './repositories/profitRepository';
import { setActiveMemberContext } from './repositories/selectionRepository';

const ledger = (id, workspaceId, updatedAt) => ({ id, workspaceId, updatedAt, period: '2026-08', status: 'draft', warehouseRate: 0.7 });

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { await db.delete(); });

it('opens the latest ledger in the active workspace even when another workspace has a newer update', async () => {
  await setActiveMemberContext({ workspaceId: 'ACTIVE', memberId: 'finance', role: 'finance' });
  await db.ledgers.bulkPut([
    ledger('ACTIVE-OLD', 'ACTIVE', '2026-11-01T00:00:00Z'),
    ledger('ACTIVE-NEW', 'ACTIVE', '2026-11-02T00:00:00Z'),
    ledger('OTHER-NEW', 'OTHER', '2026-11-03T00:00:00Z'),
  ]);
  expect((await getLatestLedgerSnapshot()).ledger.id).toBe('ACTIVE-NEW');
  await setActiveMemberContext({ workspaceId: 'OTHER', memberId: 'finance', role: 'finance' });
  expect((await getLatestLedgerSnapshot()).ledger.id).toBe('OTHER-NEW');
});

it('returns no ledger for an unknown or empty active workspace instead of using a foreign ledger', async () => {
  await db.ledgers.put(ledger('OTHER-NEW', 'OTHER', '2026-11-03T00:00:00Z'));
  await setActiveMemberContext({ workspaceId: 'EMPTY', memberId: 'finance', role: 'finance' });
  expect(await getLatestLedgerSnapshot()).toBeNull();
  await db.settings.put({ key: ACTIVE_MEMBER_CONTEXT_KEY, workspaceId: '', memberId: 'finance', role: 'finance' });
  expect(await getLatestLedgerSnapshot()).toBeNull();
});

it('uses the local default workspace when no member context has been saved and keeps an empty database empty', async () => {
  expect(await getLatestLedgerSnapshot()).toBeNull();
  await db.ledgers.bulkPut([
    ledger('DEFAULT', DEFAULT_WORKSPACE_ID, '2026-11-01T00:00:00Z'),
    ledger('OTHER', 'OTHER', '2026-11-03T00:00:00Z'),
  ]);
  expect((await getLatestLedgerSnapshot()).ledger.id).toBe('DEFAULT');
  expect(await db.settings.get(ACTIVE_MEMBER_CONTEXT_KEY)).toBeUndefined();
});
