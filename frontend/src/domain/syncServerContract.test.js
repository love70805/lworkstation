import { describe, expect, it } from "vitest";
import { buildSyncEnvelope } from "./syncEnvelope";
import { createSyncEventStore } from "./syncServerContract";

function envelope(after = { status: "active" }) {
  return buildSyncEnvelope({
    workspaceId: "workspace-default",
    cursor: "1",
    events: [{
      eventId: "1",
      workspaceId: "workspace-default",
      objectType: "product",
      objectId: "P-1",
      action: "product_created",
      actorId: "user-1",
      createdAt: "2026-08-07T00:00:00.000Z",
      after,
    }],
  });
}

function legacyVoidReopenEnvelope({ reopenActorId = "finance-1" } = {}) {
  const occurredAt = "2026-08-07T08:00:03.000Z";
  const reason = "成本错误";
  return buildSyncEnvelope({
    workspaceId: "workspace-default",
    cursor: "2",
    events: [{
      eventId: "ERP-VOID-1",
      workspaceId: "workspace-default",
      objectType: "erp_cost_batch",
      objectId: "C-1",
      action: "voided",
      actorId: "finance-1",
      createdAt: occurredAt,
      before: { ledgerStatus: "finalized" },
      after: {
        reason,
        snapshot: {
          costBatch: { id: "C-1", ledgerId: "L-1", status: "voided", voidedAt: occurredAt, voidedBy: "finance-1", voidReason: reason },
          inbox: { id: "INBOX-1", status: "voided", voidedAt: occurredAt, voidedBy: "finance-1", voidReason: reason },
          ledger: { id: "L-1", status: "cost_pending" },
        },
      },
    }, {
      eventId: "ERP-REOPEN-1",
      workspaceId: "workspace-default",
      objectType: "monthly_ledger",
      objectId: "L-1",
      action: "reopened_for_cost_recalculation",
      actorId: reopenActorId,
      createdAt: occurredAt,
      after: { reason, snapshot: { id: "L-1", status: "cost_pending" } },
    }],
  });
}

describe("sync server contract", () => {
  it("accepts a batch and applies the event snapshot", () => {
    const store = createSyncEventStore();
    const ack = store.accept(envelope());
    expect(ack).toMatchObject({ format: "shopeers-sync-ack", workspaceId: "workspace-default", eventIds: ["1"] });
    expect(store.snapshot()).toMatchObject({ eventCount: 1, entityCount: 1 });
  });

  it("treats an identical retry as idempotent", () => {
    const store = createSyncEventStore();
    const first = store.accept(envelope());
    const second = store.accept(envelope());
    expect(second.eventIds).toEqual(first.eventIds);
    expect(store.snapshot().eventCount).toBe(1);
  });

  it("accepts and idempotently replays an unambiguous legacy ERP void/reopen pair", () => {
    const store = createSyncEventStore();
    const payload = legacyVoidReopenEnvelope();
    const first = store.accept(payload);
    const replay = store.accept(payload);
    expect(replay.eventIds).toEqual(first.eventIds);
    expect(store.snapshot().eventCount).toBe(2);
  });

  it("rejects an ambiguous legacy ERP void/reopen pair before staging either event", () => {
    const store = createSyncEventStore();
    expect(() => store.accept(legacyVoidReopenEnvelope({ reopenActorId: "finance-other" }))).toThrowError(expect.objectContaining({
      code: "INVALID_ERP_VOID_REOPEN_PAIR",
      status: 409,
      eventIds: ["ERP-VOID-1", "ERP-REOPEN-1"],
    }));
    expect(store.snapshot().eventCount).toBe(0);
  });

  it("rejects conflicting reuse of an event ID without partial writes", () => {
    const store = createSyncEventStore();
    store.accept(envelope());
    expect(() => store.accept(envelope({ status: "changed" }))).toThrowError(expect.objectContaining({ code: "EVENT_CONFLICT", status: 409 }));
    expect(store.snapshot().eventCount).toBe(1);
    expect(store.snapshot().entities[0].value.status).toBe("active");
  });

  it("enforces workspace authorization before writes", () => {
    const store = createSyncEventStore({ authorize: ({ workspaceId }) => workspaceId === "workspace-allowed" });
    expect(() => store.accept(envelope())).toThrowError(expect.objectContaining({ code: "WORKSPACE_FORBIDDEN", status: 403 }));
    expect(store.snapshot().eventCount).toBe(0);
  });

  it("returns an authorized recovery package with complete business events", () => {
    const store = createSyncEventStore();
    store.accept(envelope({ snapshot: { product: { id: "P-1" }, platformSkus: [], supplierOffers: [] } }));
    expect(store.recovery("workspace-default")).toMatchObject({
      format: "shopeers-sync-recovery",
      workspaceId: "workspace-default",
      currency: "CNY",
      events: [{ eventId: "1", action: "product_created" }],
    });
  });

  it("rejects recovery reads outside the authorized workspace", () => {
    const store = createSyncEventStore({ authorize: ({ operation }) => operation !== "recovery" });
    expect(() => store.recovery("workspace-default")).toThrowError(expect.objectContaining({
      code: "WORKSPACE_FORBIDDEN",
      status: 403,
    }));
  });
});
