import { createSyncProvider } from "./syncProvider";
import { DEFAULT_WORKSPACE_ID } from "./db/constants";
import {
  claimPendingSyncEnvelope,
  markSyncEventsFailed,
  markSyncEventsSynced,
  repairLegacyTechnicalAuditActors,
  releaseSyncEventsPending,
  releaseStaleSyncClaims,
} from "./syncOutbox";

export function validateSyncRunResult(result, { workspaceId, eventCount } = {}) {
  if (!result || result.status !== "synced") throw new Error("同步服务未返回成功回执。");
  if (Number(result.eventCount) !== Number(eventCount)) {
    throw new Error("同步服务回执未覆盖本次领取的全部事件。");
  }
  if (String(result.workspaceId ?? "") !== String(workspaceId ?? "")) {
    throw new Error("同步服务回执工作区不一致。");
  }
  return result;
}

function retryDisposition(error) {
  if (error?.retryable === true) return "retry";
  if (error?.retryable === false) return "terminal";
  const status = Number(error?.status);
  if (status === 408 || status === 429 || status >= 500) return "retry";
  if (status === 400 || status === 409) return "terminal";
  return "retry";
}

function affectedEventIds(error, claimedEventIds) {
  const claimed = new Set(claimedEventIds.map(String));
  const reported = Array.isArray(error?.eventIds)
    ? [...new Set(error.eventIds.map(String).filter(Boolean))]
    : [];
  if (reported.length === 0) return claimedEventIds;
  return reported.filter((eventId) => claimed.has(eventId));
}

export async function runSyncOnce({ workspaceId, limit = 100, provider = null, now = new Date().toISOString() } = {}) {
  const syncProvider = provider ?? createSyncProvider();
  await releaseStaleSyncClaims({ workspaceId, now });
  let activeMemberId = "";
  try {
    activeMemberId = typeof syncProvider.resolveActorId === "function" ? await syncProvider.resolveActorId() : "";
  } catch {
    activeMemberId = "";
  }
  await repairLegacyTechnicalAuditActors({
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    activeMemberId,
    cloudConfigured: syncProvider.kind !== "local",
    repairedAt: now,
  });
  if (syncProvider.kind === "local") return { status: "skipped", reason: "local_only", eventCount: 0 };

  let envelope;
  try {
    envelope = await claimPendingSyncEnvelope({ workspaceId, limit, claimedAt: now });
  } catch (error) {
    const eventIds = Array.isArray(error?.eventIds) ? error.eventIds : [];
    if (eventIds.length > 0) {
      await markSyncEventsFailed(eventIds, error.message, {
        failedAt: now,
        terminal: true,
        errorCode: error.code ?? "INVALID_SYNC_EVENT_GROUP",
      });
    }
    return { status: "blocked", eventCount: eventIds.length, error: error.message, code: error.code ?? "INVALID_SYNC_EVENT_GROUP" };
  }
  if (envelope.events.length === 0) return { status: "idle", eventCount: 0, cursor: envelope.cursor };

  const resolvedWorkspaceId = workspaceId ?? envelope.workspaceId;
  const eventIds = envelope.events.map((event) => event.eventId);
  try {
    const result = await syncProvider.push(envelope);
    validateSyncRunResult(result, { workspaceId: resolvedWorkspaceId, eventCount: eventIds.length });
    await markSyncEventsSynced(eventIds, { syncedAt: now, syncVersion: result.syncVersion });
    return { status: "synced", eventCount: eventIds.length, cursor: result.cursor ?? envelope.cursor, syncVersion: result.syncVersion ?? null };
  } catch (error) {
    if (error?.code === "AUTH_REQUIRED" || error?.code === "WORKSPACE_FORBIDDEN") {
      await releaseSyncEventsPending(eventIds, { reason: error.message });
      return { status: "blocked", eventCount: eventIds.length, error: error.message, code: error.code };
    }
    if (retryDisposition(error) === "terminal") {
      const terminalEventIds = affectedEventIds(error, eventIds);
      const terminalSet = new Set(terminalEventIds);
      const releasedEventIds = eventIds.filter((eventId) => !terminalSet.has(eventId));
      await markSyncEventsFailed(terminalEventIds, error.message, {
        failedAt: now,
        terminal: true,
        errorCode: error.code ?? "SYNC_CONTRACT_REJECTED",
      });
      if (releasedEventIds.length > 0) {
        await releaseSyncEventsPending(releasedEventIds, { reason: "同批其他事件已隔离，等待重新同步。" });
      }
      return {
        status: "blocked",
        eventCount: eventIds.length,
        terminalEventCount: terminalEventIds.length,
        error: error.message,
        code: error.code ?? "SYNC_CONTRACT_REJECTED",
      };
    }
    await markSyncEventsFailed(eventIds, error.message, { failedAt: now });
    return { status: "failed", eventCount: eventIds.length, error: error.message };
  }
}
