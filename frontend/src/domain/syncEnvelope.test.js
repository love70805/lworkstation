import { describe, expect, it } from "vitest";
import {
  auditEventToSyncEvent,
  buildSyncEnvelope,
  SYNC_ENVELOPE_FORMAT,
  validateSyncEnvelope,
} from "./syncEnvelope";

describe("sync envelope contract", () => {
  it("builds and validates a workspace-scoped audit envelope", () => {
    const envelope = buildSyncEnvelope({
      workspaceId: "workspace-default",
      cursor: 12,
      events: [{
        id: 12,
        workspaceId: "workspace-default",
        objectType: "product",
        objectId: "P-1",
        action: "product_created",
        createdAt: "2026-08-07T08:00:00.000Z",
      }],
    });

    expect(envelope).toMatchObject({
      format: SYNC_ENVELOPE_FORMAT,
      workspaceId: "workspace-default",
      cursor: "12",
    });
    expect(validateSyncEnvelope(envelope)).toMatchObject({ eventCount: 1, workspaceId: "workspace-default", cursor: "12" });
  });

  it("rejects cross-workspace and duplicate events", () => {
    expect(() => buildSyncEnvelope({
      workspaceId: "workspace-default",
      events: [{ id: 1, workspaceId: "other", objectType: "product", objectId: "P-1", action: "created", createdAt: "2026-08-07" }],
    })).toThrow("不能跨工作区混用");

    expect(() => buildSyncEnvelope({
      workspaceId: "workspace-default",
      events: [
        { id: 1, objectType: "product", objectId: "P-1", action: "created", createdAt: "2026-08-07" },
        { id: 1, objectType: "product", objectId: "P-2", action: "updated", createdAt: "2026-08-07" },
      ],
    })).toThrow("同步事件 ID 重复");
  });

  it("converts an audit row without leaking sync control fields", () => {
    const event = auditEventToSyncEvent({
      id: 4,
      eventId: "EVT-global-4",
      workspaceId: "workspace-default",
      objectType: "backup",
      objectId: "backup.json",
      action: "backup_exported",
      actorId: "local-user",
      createdAt: "2026-08-07T08:00:00.000Z",
      syncState: "pending",
      syncAttempts: 2,
      after: { recordCount: 10 },
    });

    expect(event).toMatchObject({ eventId: "EVT-global-4", action: "backup_exported" });
    expect(event).not.toHaveProperty("syncState");
    expect(event).not.toHaveProperty("syncAttempts");
  });

  it("keeps legacy numeric audit IDs compatible when eventId is absent", () => {
    expect(auditEventToSyncEvent({
      id: 4,
      workspaceId: "workspace-default",
      objectType: "backup",
      objectId: "backup.json",
      action: "backup_exported",
      createdAt: "2026-08-07T08:00:00.000Z",
    }).eventId).toBe("4");
  });
});
