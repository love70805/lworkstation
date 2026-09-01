import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildErpVoidTransitionId } from "../domain/syncLifecycleGroup";
import { SYNC_STATES } from "../domain/syncEnvelope";
import { DEFAULT_WORKSPACE_ID, db } from "./database";
import {
  claimPendingSyncEnvelope,
  markSyncEventsFailed,
  markSyncEventsSynced,
  retryFailedSyncEvents,
} from "./syncOutbox";

const occurredAt = "2026-08-07T08:00:00.000Z";

function ordinaryEvent(index) {
  return {
    workspaceId: DEFAULT_WORKSPACE_ID,
    eventId: `E-NORMAL-${index}`,
    objectType: "workspace",
    objectId: DEFAULT_WORKSPACE_ID,
    action: "selection_status_definitions_updated",
    actorId: "user-1",
    createdAt: occurredAt,
    before: null,
    after: { snapshot: { id: DEFAULT_WORKSPACE_ID, name: "工作区" } },
    syncState: SYNC_STATES.PENDING,
  };
}

function voidReopenEvents() {
  const batchId = "CB-VOID";
  const ledgerId = "L-1";
  const reason = "成本批次错误";
  const transitionId = buildErpVoidTransitionId({ batchId, ledgerId, voidedAt: occurredAt });
  return [{
    workspaceId: DEFAULT_WORKSPACE_ID,
    eventId: "E-VOID",
    objectType: "erp_cost_batch",
    objectId: batchId,
    action: "voided",
    actorId: "finance-1",
    createdAt: occurredAt,
    before: { ledgerStatus: "finalized" },
    after: {
      reason,
      transitionId,
      voidedBatchId: batchId,
      snapshot: {
        costBatch: { id: batchId, voidedAt: occurredAt, voidedBy: "finance-1", voidReason: reason },
        inbox: { voidedAt: occurredAt, voidedBy: "finance-1", voidReason: reason },
        ledger: { id: ledgerId },
      },
    },
    syncState: SYNC_STATES.PENDING,
  }, {
    workspaceId: DEFAULT_WORKSPACE_ID,
    eventId: "E-REOPEN",
    objectType: "monthly_ledger",
    objectId: ledgerId,
    action: "reopened_for_cost_recalculation",
    actorId: "finance-1",
    createdAt: occurredAt,
    before: { status: "finalized" },
    after: {
      reason,
      transitionId,
      voidedBatchId: batchId,
      snapshot: { id: ledgerId, status: "cost_pending" },
    },
    syncState: SYNC_STATES.PENDING,
  }];
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.auditEvents.clear();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("ERP void/reopen sync outbox grouping", () => {
  it("claims a two-event lifecycle atomically even when limit is one", async () => {
    await db.auditEvents.bulkAdd(voidReopenEvents());
    const envelope = await claimPendingSyncEnvelope({ limit: 1, claimedAt: occurredAt });
    expect(envelope.events.map((event) => event.eventId)).toEqual(["E-VOID", "E-REOPEN"]);
    expect(await db.auditEvents.toArray()).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: "E-VOID", syncState: SYNC_STATES.IN_FLIGHT, syncAttempts: 1 }),
      expect.objectContaining({ eventId: "E-REOPEN", syncState: SYNC_STATES.IN_FLIGHT, syncAttempts: 1 }),
    ]));
  });

  it("extends a normal batch boundary to include the matching reopen", async () => {
    await db.auditEvents.bulkAdd([
      ...Array.from({ length: 99 }, (_, index) => ordinaryEvent(index)),
      ...voidReopenEvents(),
    ]);
    const envelope = await claimPendingSyncEnvelope({ limit: 100, claimedAt: occurredAt });
    expect(envelope.events).toHaveLength(101);
    expect(envelope.events.slice(-2).map((event) => event.eventId)).toEqual(["E-VOID", "E-REOPEN"]);
  });

  it("reserves hard-limit capacity instead of producing 501 events", async () => {
    await db.auditEvents.bulkAdd([
      ...Array.from({ length: 499 }, (_, index) => ordinaryEvent(index)),
      ...voidReopenEvents(),
    ]);
    const first = await claimPendingSyncEnvelope({ limit: 500, claimedAt: occurredAt });
    expect(first.events).toHaveLength(499);
    expect(first.events.at(-1).eventId).toBe("E-NORMAL-498");
    await markSyncEventsFailed(first.events.map((event) => event.eventId), "模拟失败后重试");

    const retry = await claimPendingSyncEnvelope({ limit: 500, claimedAt: "2026-08-07T08:01:00.000Z" });
    expect(retry.events).toHaveLength(499);
    await markSyncEventsSynced(retry.events.map((event) => event.eventId), { syncedAt: "2026-08-07T08:01:30.000Z" });

    const second = await claimPendingSyncEnvelope({ limit: 500, claimedAt: "2026-08-07T08:02:00.000Z" });
    expect(second.events.map((event) => event.eventId)).toEqual(["E-VOID", "E-REOPEN"]);
  });

  it("never exceeds 500 while draining consecutive lifecycle groups", async () => {
    const secondPair = voidReopenEvents().map((event) => ({
      ...structuredClone(event),
      eventId: `${event.eventId}-2`,
      objectId: event.action === "voided" ? "CB-VOID-2" : "L-2",
      after: {
        ...structuredClone(event.after),
        transitionId: buildErpVoidTransitionId({ batchId: "CB-VOID-2", ledgerId: "L-2", voidedAt: occurredAt }),
        voidedBatchId: "CB-VOID-2",
        snapshot: event.action === "voided"
          ? {
            costBatch: { id: "CB-VOID-2", voidedAt: occurredAt, voidedBy: "finance-1", voidReason: "成本批次错误" },
            inbox: { voidedAt: occurredAt, voidedBy: "finance-1", voidReason: "成本批次错误" },
            ledger: { id: "L-2" },
          }
          : { id: "L-2", status: "cost_pending" },
      },
    }));
    await db.auditEvents.bulkAdd([
      ...Array.from({ length: 498 }, (_, index) => ordinaryEvent(index)),
      ...voidReopenEvents(),
      ...secondPair,
    ]);
    const first = await claimPendingSyncEnvelope({ limit: 500, claimedAt: occurredAt });
    expect(first.events).toHaveLength(500);
    expect(first.events.slice(-2).map((event) => event.eventId)).toEqual(["E-VOID", "E-REOPEN"]);
    await db.auditEvents.where("syncState").equals(SYNC_STATES.IN_FLIGHT).modify({ syncState: SYNC_STATES.SYNCED });
    const second = await claimPendingSyncEnvelope({ limit: 500, claimedAt: "2026-08-07T08:03:00.000Z" });
    expect(second.events.map((event) => event.eventId)).toEqual(["E-VOID-2", "E-REOPEN-2"]);
  });

  it("uses the complete hard limit for 500 ordinary events", async () => {
    await db.auditEvents.bulkAdd(Array.from({ length: 500 }, (_, index) => ordinaryEvent(index)));
    const envelope = await claimPendingSyncEnvelope({ limit: 500, claimedAt: occurredAt });
    expect(envelope.events).toHaveLength(500);
  });

  it("keeps safe legacy pending or failed pairs together without rewriting their payload", async () => {
    const legacy = voidReopenEvents().map((event) => {
      const copy = structuredClone(event);
      delete copy.after.transitionId;
      delete copy.after.voidedBatchId;
      copy.syncState = SYNC_STATES.FAILED;
      copy.syncAttempts = 1;
      return copy;
    });
    await db.auditEvents.bulkAdd(legacy);
    const envelope = await claimPendingSyncEnvelope({ limit: 1, claimedAt: occurredAt });
    expect(envelope.events.map((event) => event.eventId)).toEqual(["E-VOID", "E-REOPEN"]);
    expect(envelope.events[0].after).not.toHaveProperty("transitionId");
    expect(envelope.events[1].after).not.toHaveProperty("voidedBatchId");
    expect(await db.auditEvents.toArray()).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: "E-VOID", syncAttempts: 2, syncState: SYNC_STATES.IN_FLIGHT }),
      expect.objectContaining({ eventId: "E-REOPEN", syncAttempts: 2, syncState: SYNC_STATES.IN_FLIGHT }),
    ]));
  });

  it("keeps a failed lifecycle pair together on retry instead of starving the reopen", async () => {
    await db.auditEvents.bulkAdd(voidReopenEvents());
    const first = await claimPendingSyncEnvelope({ limit: 1, claimedAt: occurredAt });
    await markSyncEventsFailed(first.events.map((event) => event.eventId), "远端暂时失败");

    const retry = await claimPendingSyncEnvelope({ limit: 1, claimedAt: "2026-08-07T08:01:00.000Z" });
    expect(retry.events.map((event) => event.eventId)).toEqual(["E-VOID", "E-REOPEN"]);
    expect(await db.auditEvents.toArray()).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: "E-VOID", syncState: SYNC_STATES.IN_FLIGHT, syncAttempts: 2 }),
      expect.objectContaining({ eventId: "E-REOPEN", syncState: SYNC_STATES.IN_FLIGHT, syncAttempts: 2 }),
    ]));
  });

  it("skips terminal contract failures until an explicit manual retry", async () => {
    await db.auditEvents.bulkAdd(voidReopenEvents());
    await markSyncEventsFailed(["E-VOID", "E-REOPEN"], "需要人工修复后重试", {
      terminal: true,
      errorCode: "INVALID_ERP_VOID_REOPEN_PAIR",
    });
    await expect(claimPendingSyncEnvelope({ limit: 10, claimedAt: occurredAt })).resolves.toMatchObject({ events: [] });
    await expect(retryFailedSyncEvents()).resolves.toBe(2);
    const retry = await claimPendingSyncEnvelope({ limit: 10, claimedAt: "2026-08-07T08:04:00.000Z" });
    expect(retry.events.map((event) => event.eventId)).toEqual(["E-VOID", "E-REOPEN"]);
  });
});
