import { DEFAULT_WORKSPACE_ID, db } from "./database";
import {
  auditEventToSyncEvent,
  buildSyncEnvelope,
  SYNC_EVENT_MAX_BATCH,
  SYNC_STATES,
} from "../domain/syncEnvelope";
import { selectAtomicSyncEventSelection } from "../domain/syncLifecycleGroup";
import { buildLegacyAuditActorRepairPatch } from "../domain/syncAuditActorRepair";

function isRetryableEvent(event) {
  const state = event.syncState ?? SYNC_STATES.PENDING;
  return state === SYNC_STATES.PENDING || (state === SYNC_STATES.FAILED && event.syncTerminal !== true);
}

function normalizedEventIds(eventIds = []) {
  return new Set(eventIds.map((eventId) => String(eventId ?? "").trim()).filter(Boolean));
}

function syncedRows(events, eventIds) {
  const ids = eventIds instanceof Set ? eventIds : normalizedEventIds(eventIds);
  if (ids.size === 0) return [];
  return events.filter((event) => ids.has(String(event.eventId ?? event.id)));
}

function compareEventIds(a, b) {
  return Number(a.id ?? 0) - Number(b.id ?? 0);
}

export async function repairLegacyTechnicalAuditActors({
  workspaceId = DEFAULT_WORKSPACE_ID,
  activeMemberId = "",
  cloudConfigured = false,
  repairedAt = new Date().toISOString(),
} = {}) {
  return db.transaction("rw", db.auditEvents, async () => {
    const events = await db.auditEvents.where("workspaceId").equals(workspaceId).toArray();
    let repaired = 0;
    for (const event of events) {
      const patch = buildLegacyAuditActorRepairPatch(event, { activeMemberId, cloudConfigured, repairedAt });
      if (!patch) continue;
      await db.auditEvents.update(event.id, patch);
      repaired += 1;
    }
    return repaired;
  });
}

export async function getSyncStatusSnapshot({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
  const events = await db.auditEvents.where("workspaceId").equals(workspaceId).toArray();
  const counts = {
    pending: 0,
    inFlight: 0,
    synced: 0,
    failed: 0,
    terminalFailed: 0,
  };
  for (const event of events) {
    const state = event.syncState ?? SYNC_STATES.PENDING;
    if (state === SYNC_STATES.IN_FLIGHT) counts.inFlight += 1;
    else if (state === SYNC_STATES.SYNCED) counts.synced += 1;
    else if (state === SYNC_STATES.FAILED) {
      counts.failed += 1;
      if (event.syncTerminal === true) counts.terminalFailed += 1;
    }
    else counts.pending += 1;
  }
  const latestSynced = events
    .filter((event) => event.syncState === SYNC_STATES.SYNCED)
    .toSorted((a, b) => String(b.syncedAt ?? "").localeCompare(String(a.syncedAt ?? "")))[0] ?? null;
  const oldestPending = events
    .filter(isRetryableEvent)
    .toSorted((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))[0] ?? null;
  const latestFailure = events
    .filter((event) => event.syncState === SYNC_STATES.FAILED)
    .toSorted((a, b) => String(b.syncClaimedAt ?? "").localeCompare(String(a.syncClaimedAt ?? "")))[0] ?? null;

  return {
    workspaceId,
    totalEvents: events.length,
    pendingCount: counts.pending,
    inFlightCount: counts.inFlight,
    syncedCount: counts.synced,
    failedCount: counts.failed,
    terminalFailedCount: counts.terminalFailed,
    retryableCount: counts.pending + counts.failed - counts.terminalFailed,
    oldestPendingAt: oldestPending?.createdAt ?? null,
    latestSyncedAt: latestSynced?.syncedAt ?? null,
    latestError: latestFailure?.syncError ?? null,
  };
}

export async function claimPendingSyncEnvelope({ workspaceId = DEFAULT_WORKSPACE_ID, limit = 100, claimedAt = new Date().toISOString() } = {}) {
  const safeLimit = Math.max(1, Math.min(SYNC_EVENT_MAX_BATCH, Number(limit) || 100));
  return db.transaction("rw", db.auditEvents, async () => {
    const events = await db.auditEvents.where("workspaceId").equals(workspaceId).toArray();
    const retryable = events
      .filter(isRetryableEvent)
      .sort(compareEventIds);
    const candidates = selectAtomicSyncEventSelection(retryable, safeLimit, SYNC_EVENT_MAX_BATCH);

    for (const event of candidates) {
      await db.auditEvents.update(event.id, {
        syncState: SYNC_STATES.IN_FLIGHT,
        syncAttempts: Number(event.syncAttempts ?? 0) + 1,
        syncClaimedAt: claimedAt,
        syncError: null,
      });
    }

    return buildSyncEnvelope({
      workspaceId,
      events: candidates.map(auditEventToSyncEvent),
      cursor: candidates.at(-1)?.id ?? null,
      generatedAt: claimedAt,
    });
  });
}

export async function markSyncEventsSynced(eventIds, { syncedAt = new Date().toISOString(), syncVersion = null } = {}) {
  const ids = normalizedEventIds(eventIds);
  if (ids.size === 0) return 0;
  return db.transaction("rw", db.auditEvents, async () => {
    const rows = syncedRows(await db.auditEvents.toArray(), ids);
    let updated = 0;
    for (const row of rows) {
      if (!row) continue;
      await db.auditEvents.update(row.id, {
        syncState: SYNC_STATES.SYNCED,
        syncedAt,
        syncVersion,
        syncError: null,
        syncErrorCode: null,
        syncTerminal: false,
      });
      updated += 1;
    }
    return updated;
  });
}

export async function markSyncEventsFailed(eventIds, error, {
  failedAt = new Date().toISOString(),
  terminal = false,
  errorCode = null,
} = {}) {
  const ids = normalizedEventIds(eventIds);
  if (ids.size === 0) return 0;
  const message = String(error ?? "同步失败").slice(0, 500);
  return db.transaction("rw", db.auditEvents, async () => {
    const rows = syncedRows(await db.auditEvents.toArray(), ids);
    let updated = 0;
    for (const row of rows) {
      if (!row) continue;
      await db.auditEvents.update(row.id, {
        syncState: SYNC_STATES.FAILED,
        syncFailedAt: failedAt,
        syncError: message,
        syncErrorCode: errorCode == null ? null : String(errorCode),
        syncTerminal: terminal === true,
      });
      updated += 1;
    }
    return updated;
  });
}

export async function releaseSyncEventsPending(eventIds, { reason = null } = {}) {
  const ids = normalizedEventIds(eventIds);
  if (ids.size === 0) return 0;
  const message = reason == null ? null : String(reason).slice(0, 500);
  return db.transaction("rw", db.auditEvents, async () => {
    const rows = syncedRows(await db.auditEvents.toArray(), ids);
    let updated = 0;
    for (const row of rows) {
      if (!row) continue;
      await db.auditEvents.update(row.id, {
        syncState: SYNC_STATES.PENDING,
        syncError: message,
        syncErrorCode: null,
        syncTerminal: false,
        syncClaimedAt: null,
      });
      updated += 1;
    }
    return updated;
  });
}

export async function releaseStaleSyncClaims({ workspaceId = DEFAULT_WORKSPACE_ID, maxAgeMs = 10 * 60 * 1000, now = new Date().toISOString() } = {}) {
  const cutoff = Date.now() - Math.max(1, Number(maxAgeMs) || 1);
  return db.transaction("rw", db.auditEvents, async () => {
    const events = await db.auditEvents.where("workspaceId").equals(workspaceId).toArray();
    let released = 0;
    for (const event of events) {
      if (event.syncState !== SYNC_STATES.IN_FLIGHT) continue;
      const claimedAt = new Date(event.syncClaimedAt ?? 0).getTime();
      if (!Number.isFinite(claimedAt) || claimedAt > cutoff) continue;
      await db.auditEvents.update(event.id, {
        syncState: SYNC_STATES.FAILED,
        syncFailedAt: now,
        syncError: "同步任务超时，已释放并等待重试。",
        syncErrorCode: "SYNC_CLAIM_TIMEOUT",
        syncTerminal: false,
      });
      released += 1;
    }
    return released;
  });
}

export async function retryFailedSyncEvents({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
  return db.transaction("rw", db.auditEvents, async () => {
    const events = await db.auditEvents.where("workspaceId").equals(workspaceId).toArray();
    let reset = 0;
    for (const event of events) {
      if (event.syncState !== SYNC_STATES.FAILED) continue;
      await db.auditEvents.update(event.id, {
        syncState: SYNC_STATES.PENDING,
        syncError: null,
        syncErrorCode: null,
        syncTerminal: false,
      });
      reset += 1;
    }
    return reset;
  });
}
