import { beforeEach, describe, expect, it, vi } from "vitest";

const outbox = vi.hoisted(() => ({
  claimPendingSyncEnvelope: vi.fn(),
  markSyncEventsFailed: vi.fn(),
  markSyncEventsSynced: vi.fn(),
  repairLegacyTechnicalAuditActors: vi.fn(),
  releaseSyncEventsPending: vi.fn(),
  releaseStaleSyncClaims: vi.fn(),
}));

vi.mock("./syncOutbox", () => outbox);

import { runSyncOnce, validateSyncRunResult } from "./syncRunner";

const envelope = {
  workspaceId: "workspace-default",
  cursor: "13",
  events: [{ eventId: "12" }, { eventId: "13" }],
};

describe("sync runner contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outbox.releaseStaleSyncClaims.mockResolvedValue(0);
    outbox.claimPendingSyncEnvelope.mockResolvedValue(envelope);
    outbox.markSyncEventsSynced.mockResolvedValue(2);
    outbox.markSyncEventsFailed.mockResolvedValue(2);
    outbox.repairLegacyTechnicalAuditActors.mockResolvedValue(0);
    outbox.releaseSyncEventsPending.mockResolvedValue(2);
  });

  it("accepts only a complete success result for the claimed workspace", () => {
    expect(validateSyncRunResult({ status: "synced", workspaceId: "workspace-default", eventCount: 2 }, {
      workspaceId: "workspace-default",
      eventCount: 2,
    })).toMatchObject({ status: "synced" });

    expect(() => validateSyncRunResult({ status: "synced", workspaceId: "workspace-default", eventCount: 1 }, {
      workspaceId: "workspace-default",
      eventCount: 2,
    })).toThrow("未覆盖");
    expect(() => validateSyncRunResult({ status: "synced", workspaceId: "workspace-other", eventCount: 2 }, {
      workspaceId: "workspace-default",
      eventCount: 2,
    })).toThrow("工作区不一致");
  });

  it("marks the claimed events synced only after a complete provider result", async () => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => ({
        status: "synced",
        workspaceId: "workspace-default",
        eventCount: 2,
        cursor: "13",
        syncVersion: "cloud-42",
      })),
    };

    await expect(runSyncOnce({ workspaceId: "workspace-default", provider, now: "2026-08-07T08:00:00.000Z" })).resolves.toMatchObject({
      status: "synced",
      eventCount: 2,
      syncVersion: "cloud-42",
    });
    expect(outbox.markSyncEventsSynced).toHaveBeenCalledWith(["12", "13"], {
      syncedAt: "2026-08-07T08:00:00.000Z",
      syncVersion: "cloud-42",
    });
    expect(outbox.markSyncEventsFailed).not.toHaveBeenCalled();
  });

  it("uses the workspace carried by the claimed envelope when the caller omits it", async () => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => ({
        status: "synced",
        workspaceId: "workspace-default",
        eventCount: 2,
      })),
    };

    await expect(runSyncOnce({ provider })).resolves.toMatchObject({ status: "synced", eventCount: 2 });
    expect(outbox.markSyncEventsSynced).toHaveBeenCalled();
  });

  it("keeps events retryable when a provider returns an incomplete result", async () => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => ({ status: "synced", workspaceId: "workspace-default", eventCount: 1 })),
    };

    await expect(runSyncOnce({ workspaceId: "workspace-default", provider, now: "2026-08-07T08:00:00.000Z" })).resolves.toMatchObject({
      status: "failed",
      eventCount: 2,
    });
    expect(outbox.markSyncEventsSynced).not.toHaveBeenCalled();
    expect(outbox.markSyncEventsFailed).toHaveBeenCalledWith(
      ["12", "13"],
      "同步服务回执未覆盖本次领取的全部事件。",
      { failedAt: "2026-08-07T08:00:00.000Z" },
    );
  });

  it("does not turn a missing login into a permanent sync failure", async () => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => {
        const error = new Error("请先登录云端工作区，再同步本机审计事件。");
        error.code = "AUTH_REQUIRED";
        error.retryable = false;
        throw error;
      }),
    };

    await expect(runSyncOnce({ workspaceId: "workspace-default", provider })).resolves.toMatchObject({ status: "blocked", code: "AUTH_REQUIRED" });
    expect(outbox.releaseSyncEventsPending).toHaveBeenCalledWith(["12", "13"], { reason: "请先登录云端工作区，再同步本机审计事件。" });
    expect(outbox.markSyncEventsFailed).not.toHaveBeenCalled();
  });

  it("repairs legacy technical actors with the authenticated member before claiming", async () => {
    const provider = {
      kind: "http",
      resolveActorId: vi.fn(async () => "finance-cloud-2"),
      push: vi.fn(async () => ({ status: "synced", workspaceId: "workspace-default", eventCount: 2 })),
    };

    await runSyncOnce({ workspaceId: "workspace-default", provider, now: "2026-08-28T08:00:00.000Z" });

    expect(outbox.repairLegacyTechnicalAuditActors).toHaveBeenCalledWith({
      workspaceId: "workspace-default",
      activeMemberId: "finance-cloud-2",
      cloudConfigured: true,
      repairedAt: "2026-08-28T08:00:00.000Z",
    });
    expect(outbox.repairLegacyTechnicalAuditActors.mock.invocationCallOrder[0])
      .toBeLessThan(outbox.claimPendingSyncEnvelope.mock.invocationCallOrder[0]);
  });

  it("repairs legacy technical actors as a local baseline before skipping network sync", async () => {
    const provider = {
      kind: "local",
      resolveActorId: vi.fn(async () => "local-user"),
    };

    await expect(runSyncOnce({ provider, now: "2026-08-28T08:00:00.000Z" })).resolves.toMatchObject({
      status: "skipped",
      reason: "local_only",
    });
    expect(outbox.repairLegacyTechnicalAuditActors).toHaveBeenCalledWith({
      workspaceId: "workspace-default",
      activeMemberId: "local-user",
      cloudConfigured: false,
      repairedAt: "2026-08-28T08:00:00.000Z",
    });
    expect(outbox.claimPendingSyncEnvelope).not.toHaveBeenCalled();
  });

  it("quarantines an ambiguous local lifecycle group so later claims can progress", async () => {
    const error = new Error("ERP 作废与重开事件不一致");
    error.code = "INVALID_ERP_VOID_REOPEN_PAIR";
    error.retryable = false;
    error.eventIds = ["12", "13"];
    outbox.claimPendingSyncEnvelope.mockRejectedValueOnce(error);

    await expect(runSyncOnce({ workspaceId: "workspace-default", provider: { kind: "http", push: vi.fn() }, now: "2026-08-07T08:00:00.000Z" })).resolves.toMatchObject({
      status: "blocked",
      code: "INVALID_ERP_VOID_REOPEN_PAIR",
      eventCount: 2,
    });
    expect(outbox.markSyncEventsFailed).toHaveBeenCalledWith(["12", "13"], error.message, {
      failedAt: "2026-08-07T08:00:00.000Z",
      terminal: true,
      errorCode: "INVALID_ERP_VOID_REOPEN_PAIR",
    });
  });

  it("does not automatically retry a non-retryable server contract rejection", async () => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => {
        const error = new Error("旧生命周期事件无法安全配对");
        error.code = "INVALID_ERP_VOID_REOPEN_PAIR";
        error.status = 409;
        error.retryable = false;
        throw error;
      }),
    };

    await expect(runSyncOnce({ workspaceId: "workspace-default", provider, now: "2026-08-07T08:00:00.000Z" })).resolves.toMatchObject({
      status: "blocked",
      code: "INVALID_ERP_VOID_REOPEN_PAIR",
    });
    expect(outbox.markSyncEventsFailed).toHaveBeenCalledWith(["12", "13"], "旧生命周期事件无法安全配对", {
      failedAt: "2026-08-07T08:00:00.000Z",
      terminal: true,
      errorCode: "INVALID_ERP_VOID_REOPEN_PAIR",
    });
  });

  it.each([
    ["explicit retryable 409", { status: 409, retryable: true }],
    ["request timeout", { status: 408 }],
    ["rate limited", { status: 429 }],
    ["server error", { status: 500 }],
    ["service unavailable", { status: 503 }],
  ])("keeps %s failures available for automatic retry", async (_label, errorDetails) => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => {
        const error = new Error("暂时无法同步");
        Object.assign(error, errorDetails);
        throw error;
      }),
    };

    await expect(runSyncOnce({ workspaceId: "workspace-default", provider, now: "2026-08-07T08:00:00.000Z" })).resolves.toMatchObject({
      status: "failed",
      eventCount: 2,
    });
    expect(outbox.markSyncEventsFailed).toHaveBeenCalledWith(["12", "13"], "暂时无法同步", {
      failedAt: "2026-08-07T08:00:00.000Z",
    });
    expect(outbox.releaseSyncEventsPending).not.toHaveBeenCalled();
  });

  it.each(["EVENT_CONFLICT", "INVALID_ERP_VOID_REOPEN_PAIR"])("quarantines only affected events for %s and releases the rest", async (code) => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => {
        const error = new Error("单条事件合同冲突");
        error.code = code;
        error.status = 409;
        error.retryable = false;
        error.eventIds = ["13"];
        throw error;
      }),
    };

    await expect(runSyncOnce({ workspaceId: "workspace-default", provider, now: "2026-08-07T08:00:00.000Z" })).resolves.toMatchObject({
      status: "blocked",
      eventCount: 2,
      terminalEventCount: 1,
    });
    expect(outbox.markSyncEventsFailed).toHaveBeenCalledWith(["13"], "单条事件合同冲突", {
      failedAt: "2026-08-07T08:00:00.000Z",
      terminal: true,
      errorCode: code,
    });
    expect(outbox.releaseSyncEventsPending).toHaveBeenCalledWith(["12"], { reason: "同批其他事件已隔离，等待重新同步。" });
  });

  it("does not quarantine claimed events when a structured error only names unrelated IDs", async () => {
    const provider = {
      kind: "http",
      push: vi.fn(async () => {
        const error = new Error("服务端返回了不属于本批的事件 ID");
        error.code = "EVENT_CONFLICT";
        error.status = 409;
        error.retryable = false;
        error.eventIds = ["outside-envelope"];
        throw error;
      }),
    };
    await expect(runSyncOnce({ workspaceId: "workspace-default", provider, now: "2026-08-07T08:00:00.000Z" })).resolves.toMatchObject({
      status: "blocked",
      terminalEventCount: 0,
    });
    expect(outbox.markSyncEventsFailed).toHaveBeenCalledWith([], expect.any(String), expect.objectContaining({ terminal: true }));
    expect(outbox.releaseSyncEventsPending).toHaveBeenCalledWith(["12", "13"], { reason: "同批其他事件已隔离，等待重新同步。" });
  });
});
