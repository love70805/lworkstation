import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLOUD_SEED_FORMAT, CLOUD_SEED_TABLES, CLOUD_SEED_VERSION } from "../domain/cloudSeed";
import { buildSyncRecoveryPayload } from "../domain/syncRecovery";
import { DEFAULT_WORKSPACE_ID, db, restoreWorkspaceSyncRecoveryPayload } from "./database";
import { claimPendingSyncEnvelope } from "./syncOutbox";

const generatedAt = "2026-08-07T08:00:00.000Z";

function baseline() {
  const tables = Object.fromEntries(CLOUD_SEED_TABLES.map((name) => [name, []]));
  tables.workspaces = [{
    id: DEFAULT_WORKSPACE_ID,
    name: "恢复工作区",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
  }];
  tables.auditEvents = [{
    eventId: "BASELINE-EVENT-1",
    workspaceId: DEFAULT_WORKSPACE_ID,
    objectType: "workspace",
    objectId: DEFAULT_WORKSPACE_ID,
    action: "backup_exported",
    actorId: "finance-cloud-1",
    createdAt: generatedAt,
    before: null,
    after: { recordCount: 1 },
  }];
  return {
    format: CLOUD_SEED_FORMAT,
    formatVersion: CLOUD_SEED_VERSION,
    workspaceId: DEFAULT_WORKSPACE_ID,
    currency: "CNY",
    generatedAt,
    tables,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("sync recovery restore outbox state", () => {
  it("restores baseline audit events as synced instead of re-enqueuing them", async () => {
    const payload = buildSyncRecoveryPayload({
      workspaceId: DEFAULT_WORKSPACE_ID,
      generatedAt,
      cursor: "cloud-baseline-1",
      baseline: baseline(),
      events: [],
    });
    await restoreWorkspaceSyncRecoveryPayload(payload, "finance-cloud-1");

    const restored = await db.auditEvents.where("eventId").equals("BASELINE-EVENT-1").first();
    expect(restored).toMatchObject({
      syncState: "synced",
      syncAttempts: 0,
      syncedAt: generatedAt,
      syncVersion: "cloud-baseline-1",
      syncError: null,
      syncErrorCode: null,
      syncTerminal: false,
    });
    const claimed = await claimPendingSyncEnvelope({ limit: 10, claimedAt: "2026-08-07T09:00:00.000Z" });
    expect(claimed.events.map((event) => event.eventId)).not.toContain("BASELINE-EVENT-1");
  });
});
