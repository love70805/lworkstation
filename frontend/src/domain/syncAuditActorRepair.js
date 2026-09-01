import { SYNC_STATES } from "./syncEnvelope";

export const LEGACY_TECHNICAL_AUDIT_ACTORS = new Set(["system-migration", "erp-assistant-v8"]);
export const LEGACY_AUDIT_ACTOR_REPAIR_CODE = "SYNC_ACTOR_REPAIR_REQUIRED";
export const LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE = "SYNC_ACTOR_REPAIR_UNCERTAIN";
export const LEGACY_AUDIT_ACTOR_BASELINE_VERSION = "local-migration-baseline-v13";
const ERP_RESET_ACTION = "erp_test_data_reset_0_2_6_beta_1";
const ERP_RESET_RELEASE = "0.2.6-beta.1";

function text(value) {
  return String(value ?? "").trim();
}

function isLegacyV12ResetEvent(event) {
  return event?.workspaceId === "workspace-default"
    && event?.objectType === "workspace"
    && event?.objectId === "all-workspaces"
    && event?.action === ERP_RESET_ACTION
    && event?.after?.release === ERP_RESET_RELEASE
    && event?.after?.counts
    && typeof event.after.counts === "object"
    && !Array.isArray(event.after.counts);
}

function repairOrigin(event) {
  const recorded = text(event?.after?.auditActorRepair?.originalActorId);
  const recordedSource = text(event?.after?.auditActorRepair?.source);
  const recordedStrategy = text(event?.after?.auditActorRepair?.strategy);
  if (
    recorded
    && ["active-cloud-member", "awaiting-cloud-member", "local-baseline"].includes(recordedStrategy)
    && (LEGACY_TECHNICAL_AUDIT_ACTORS.has(recorded) || recordedSource === "legacy-v12-reset")
  ) {
    return {
      originalActorId: recorded,
      source: recordedSource || "technical-actor",
    };
  }
  const current = text(event?.actorId);
  if (LEGACY_TECHNICAL_AUDIT_ACTORS.has(current)) return { originalActorId: current, source: "technical-actor" };
  if (isLegacyV12ResetEvent(event)) {
    return { originalActorId: current || "system-migration", source: "legacy-v12-reset" };
  }
  return null;
}

function isEligibleForAutomaticRepair(event, origin, repairMode) {
  const state = event.syncState ?? SYNC_STATES.PENDING;
  if (state === SYNC_STATES.SYNCED || state === SYNC_STATES.IN_FLIGHT) return false;
  const repair = event.after?.auditActorRepair;
  if (
    state === SYNC_STATES.FAILED
    && event.syncTerminal === true
    && event.syncErrorCode === LEGACY_AUDIT_ACTOR_REPAIR_CODE
    && repair?.strategy === "awaiting-cloud-member"
  ) return true;
  if (event.syncTerminal === true) return false;
  if (repairMode === "migration") return true;
  if (state !== SYNC_STATES.PENDING || event.syncErrorCode != null) return false;
  return Number(event.syncAttempts ?? 0) === 0
    && !event.syncClaimedAt;
}

function hasDeliveryUncertainty(event) {
  const state = event.syncState ?? SYNC_STATES.PENDING;
  return Number(event.syncAttempts ?? 0) > 0
    || Boolean(event.syncClaimedAt)
    || state === SYNC_STATES.IN_FLIGHT
    || state === SYNC_STATES.FAILED;
}

function isProtectedTerminalFailure(event, repairMode) {
  return event.syncTerminal === true
    && (repairMode === "migration" || event.syncErrorCode !== LEGACY_AUDIT_ACTOR_REPAIR_CODE);
}

function buildMisclassifiedSyncedPatch(event) {
  if (
    event.syncState !== SYNC_STATES.FAILED
    || event.syncTerminal !== true
    || event.syncErrorCode !== LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE
    || !text(event.syncedAt)
    || !repairOrigin(event)
  ) return null;
  return {
    syncState: SYNC_STATES.SYNCED,
    syncError: null,
    syncErrorCode: null,
    syncTerminal: false,
    syncClaimedAt: null,
    syncFailedAt: null,
  };
}

function buildUncertainDeliveryPatch(event, repairedAt) {
  if (event.syncErrorCode === LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE && event.syncTerminal === true) return null;
  return {
    syncState: SYNC_STATES.FAILED,
    syncError: "历史审计可能已提交云端，已保持原始身份与内容并等待原账号重试或人工处置。",
    syncErrorCode: LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE,
    syncTerminal: true,
    syncClaimedAt: null,
    syncFailedAt: repairedAt,
  };
}

export function buildLegacyAuditActorRepairPatch(event, {
  activeMemberId = "",
  cloudConfigured = false,
  cloudIntent = cloudConfigured,
  repairedAt = new Date().toISOString(),
  repairMode = "runtime",
} = {}) {
  if (!event) return null;
  if (event.syncState === SYNC_STATES.SYNCED) return null;
  if (isProtectedTerminalFailure(event, repairMode)) return null;
  const origin = repairOrigin(event);
  if (!origin) return null;
  if (repairMode === "migration" && hasDeliveryUncertainty(event)) {
    return buildUncertainDeliveryPatch(event, repairedAt);
  }
  if (!isEligibleForAutomaticRepair(event, origin, repairMode)) return null;

  const memberId = text(activeMemberId);
  const requiresCloudActor = cloudConfigured || cloudIntent;
  const repair = {
    originalActorId: origin.originalActorId,
    source: origin.source,
    repairedAt,
    strategy: requiresCloudActor && memberId && memberId !== "local-user" ? "active-cloud-member" : requiresCloudActor ? "awaiting-cloud-member" : "local-baseline",
  };
  const after = {
    ...(event.after && typeof event.after === "object" ? event.after : {}),
    auditActorRepair: repair,
  };

  if (requiresCloudActor && memberId && memberId !== "local-user") {
    if (
      text(event.actorId) === memberId
      && event.syncState === SYNC_STATES.PENDING
      && event.syncTerminal !== true
      && event.syncError == null
      && event.after?.auditActorRepair?.strategy === "active-cloud-member"
    ) return null;
    return {
      actorId: memberId,
      syncState: SYNC_STATES.PENDING,
      syncError: null,
      syncErrorCode: null,
      syncTerminal: false,
      syncClaimedAt: null,
      syncFailedAt: null,
      syncedAt: null,
      syncVersion: null,
      after,
    };
  }
  if (requiresCloudActor) {
    if (
      event.syncState === SYNC_STATES.FAILED
      && event.syncTerminal === true
      && event.syncErrorCode === LEGACY_AUDIT_ACTOR_REPAIR_CODE
      && event.after?.auditActorRepair?.strategy === "awaiting-cloud-member"
    ) return null;
    return {
      syncState: SYNC_STATES.FAILED,
      syncError: "等待当前登录成员修复历史审计身份。",
      syncErrorCode: LEGACY_AUDIT_ACTOR_REPAIR_CODE,
      syncTerminal: true,
      syncClaimedAt: null,
      syncFailedAt: repairedAt,
      after,
    };
  }
  return {
    actorId: "local-user",
    syncState: SYNC_STATES.SYNCED,
    syncError: null,
    syncErrorCode: null,
    syncTerminal: false,
    syncClaimedAt: null,
    syncFailedAt: null,
    syncedAt: repairedAt,
    syncVersion: LEGACY_AUDIT_ACTOR_BASELINE_VERSION,
    after,
  };
}

export function buildLegacyAuditActorForwardMigrationPatch(event, options = {}) {
  if (!event) return null;
  if (event.syncState === SYNC_STATES.SYNCED) return null;
  const restoredSynced = buildMisclassifiedSyncedPatch(event);
  if (restoredSynced) return restoredSynced;
  if (event.syncTerminal === true) return null;
  return buildLegacyAuditActorRepairPatch(event, {
    ...options,
    repairMode: "migration",
  });
}
