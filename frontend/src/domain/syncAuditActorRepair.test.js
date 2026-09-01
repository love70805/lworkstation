import { describe, expect, it } from "vitest";
import {
  buildLegacyAuditActorForwardMigrationPatch,
  buildLegacyAuditActorRepairPatch,
} from "./syncAuditActorRepair";
import { auditEventToSyncEvent } from "./syncEnvelope";
import { syncEventContentHash } from "./syncEventHash";

describe("legacy audit actor repair", () => {
  it("moves an unsynced ERP Assistant actor to the authenticated cloud member", () => {
    const patch = buildLegacyAuditActorRepairPatch({
      actorId: "erp-assistant-v8",
      syncState: "pending",
      syncAttempts: 0,
      after: { receivedVia: "local-http" },
    }, {
      activeMemberId: "finance-current",
      cloudConfigured: true,
      repairedAt: "2026-08-28T10:00:00.000Z",
    });
    expect(patch).toMatchObject({
      actorId: "finance-current",
      syncState: "pending",
      syncTerminal: false,
      after: {
        receivedVia: "local-http",
        auditActorRepair: { originalActorId: "erp-assistant-v8", strategy: "active-cloud-member" },
      },
    });
  });

  it("never rewrites a synced or currently in-flight technical actor", () => {
    expect(buildLegacyAuditActorRepairPatch({ actorId: "system-migration", syncState: "synced" }, {
      activeMemberId: "finance-current",
      cloudConfigured: true,
    })).toBeNull();
    expect(buildLegacyAuditActorRepairPatch({ actorId: "system-migration", syncState: "in_flight" }, {
      activeMemberId: "finance-current",
      cloudConfigured: true,
    })).toBeNull();
  });

  it("recognizes the exact legacy v12 reset even when the stale member was written as actor", () => {
    const patch = buildLegacyAuditActorRepairPatch({
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: "erp_test_data_reset_0_2_6_beta_1",
      actorId: "finance-stale",
      syncState: "pending",
      syncAttempts: 0,
      after: { release: "0.2.6-beta.1", counts: { ledgersReset: 3 } },
    }, {
      cloudConfigured: true,
      repairedAt: "2026-08-28T10:00:00.000Z",
      repairMode: "migration",
    });
    expect(patch).toMatchObject({
      syncState: "failed",
      syncErrorCode: "SYNC_ACTOR_REPAIR_REQUIRED",
      after: { auditActorRepair: { originalActorId: "finance-stale", source: "legacy-v12-reset" } },
    });
  });

  it("does not mistake an ordinary member business event for a migration actor", () => {
    expect(buildLegacyAuditActorRepairPatch({
      workspaceId: "workspace-default",
      objectType: "monthly_ledger",
      objectId: "LEDGER-1",
      action: "finalized",
      actorId: "finance-stale",
      syncState: "pending",
      syncAttempts: 0,
      after: { release: "0.2.6-beta.1", counts: {} },
    }, {
      activeMemberId: "finance-current",
      cloudConfigured: true,
      repairMode: "migration",
    })).toBeNull();

    expect(buildLegacyAuditActorRepairPatch({
      workspaceId: "workspace-default",
      objectType: "monthly_ledger",
      objectId: "LEDGER-1",
      action: "finalized",
      actorId: "finance-stale",
      syncState: "pending",
      after: {
        auditActorRepair: {
          originalActorId: "finance-stale",
          strategy: "active-cloud-member",
        },
      },
    }, {
      activeMemberId: "finance-current",
      cloudConfigured: true,
    })).toBeNull();
  });

  it.each(["EVENT_CONFLICT", "INVALID_ERP_VOID_REOPEN_PAIR"])("does not revive a repaired %s terminal event automatically", (syncErrorCode) => {
    const event = {
      actorId: "finance-old",
      syncState: "failed",
      syncTerminal: true,
      syncErrorCode,
      after: {
        auditActorRepair: {
          originalActorId: "system-migration",
          source: "technical-actor",
          strategy: "active-cloud-member",
        },
      },
    };
    expect(buildLegacyAuditActorRepairPatch(event, {
      activeMemberId: "finance-current",
      cloudConfigured: true,
    })).toBeNull();
    expect(buildLegacyAuditActorRepairPatch(event, {
      activeMemberId: "local-user",
      cloudConfigured: false,
    })).toBeNull();
    expect(buildLegacyAuditActorRepairPatch(event, {
      activeMemberId: "",
      cloudConfigured: true,
      repairMode: "migration",
    })).toBeNull();
  });

  it("restores only the old v13 uncertainty marker that can be proven to have been synced", async () => {
    const event = {
      eventId: "EVT-OLD-V13-SYNCED",
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: "erp_test_data_reset_0_2_6_beta_1",
      actorId: "finance-cloud-previous",
      createdAt: "2026-08-20T07:00:00.000Z",
      syncState: "failed",
      syncAttempts: 4,
      syncError: "历史审计可能已提交云端，已保持原始身份与内容并等待原账号重试或人工处置。",
      syncErrorCode: "SYNC_ACTOR_REPAIR_UNCERTAIN",
      syncTerminal: true,
      syncFailedAt: "2026-08-28T12:00:00.000Z",
      syncedAt: "2026-08-20T07:01:00.000Z",
      syncVersion: "cloud-old",
      after: { release: "0.2.6-beta.1", counts: { auditEventsRemoved: 1 } },
    };
    const beforeHash = await syncEventContentHash(auditEventToSyncEvent(event));
    const patch = buildLegacyAuditActorForwardMigrationPatch(event, {
      cloudConfigured: true,
      repairedAt: "2026-08-29T08:00:00.000Z",
    });
    expect(patch).toEqual({
      syncState: "synced",
      syncError: null,
      syncErrorCode: null,
      syncTerminal: false,
      syncClaimedAt: null,
      syncFailedAt: null,
    });
    expect(await syncEventContentHash(auditEventToSyncEvent({ ...event, ...patch }))).toBe(beforeHash);
  });

  it("keeps the actor-repair quarantine terminal unchanged during migrations", () => {
    const event = {
      actorId: "system-migration",
      syncState: "failed",
      syncAttempts: 0,
      syncTerminal: true,
      syncError: "等待当前登录成员修复历史审计身份。",
      syncErrorCode: "SYNC_ACTOR_REPAIR_REQUIRED",
      syncFailedAt: "2026-08-28T12:00:00.000Z",
      after: {
        auditActorRepair: {
          originalActorId: "system-migration",
          source: "technical-actor",
          strategy: "awaiting-cloud-member",
        },
      },
    };
    expect(buildLegacyAuditActorRepairPatch(event, {
      activeMemberId: "",
      cloudConfigured: true,
      repairMode: "migration",
    })).toBeNull();
  });

  it("allows an explicit manual retry to apply the current account correction", () => {
    const patch = buildLegacyAuditActorRepairPatch({
      actorId: "finance-old",
      syncState: "pending",
      syncTerminal: false,
      syncErrorCode: null,
      after: {
        auditActorRepair: {
          originalActorId: "system-migration",
          source: "technical-actor",
          strategy: "active-cloud-member",
        },
      },
    }, {
      activeMemberId: "finance-current",
      cloudConfigured: true,
    });
    expect(patch).toMatchObject({ actorId: "finance-current", syncState: "pending", syncTerminal: false });
  });

  it.each(["pending", "failed"])("does not rewrite a possibly delivered %s repair event when the account changes", async (syncState) => {
    const event = {
      eventId: "EVT-POSSIBLY-DELIVERED",
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: "erp_test_data_reset_0_2_6_beta_1",
      actorId: "finance-old",
      createdAt: "2026-08-28T10:00:00.000Z",
      syncState,
      syncAttempts: 1,
      syncTerminal: false,
      syncErrorCode: syncState === "failed" ? "NETWORK_ERROR" : null,
      syncError: syncState === "failed" ? "回执未收到" : null,
      after: {
        release: "0.2.6-beta.1",
        counts: { ledgersReset: 1 },
        auditActorRepair: {
          originalActorId: "system-migration",
          source: "technical-actor",
          repairedAt: "2026-08-28T10:01:00.000Z",
          strategy: "active-cloud-member",
        },
      },
    };
    const beforeHash = await syncEventContentHash(event);
    const patch = buildLegacyAuditActorRepairPatch(event, {
      activeMemberId: "finance-new",
      cloudConfigured: true,
      repairedAt: "2026-08-28T10:05:00.000Z",
    });
    expect(patch).toBeNull();
    expect(await syncEventContentHash({ ...event, ...(patch ?? {}) })).toBe(beforeHash);
    expect(buildLegacyAuditActorRepairPatch(event, {
      activeMemberId: "local-user",
      cloudConfigured: false,
      repairedAt: "2026-08-28T10:06:00.000Z",
    })).toBeNull();
  });
});
