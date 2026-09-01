import {
  SYNC_ACK_FORMAT,
  SYNC_ACK_VERSION,
  SYNC_EVENT_MAX_BATCH,
  validateSyncEnvelope,
} from "./syncEnvelope.js";
import { projectSyncEvent } from "./syncBusinessProjection.js";
import { buildSyncRecoveryPayload } from "./syncRecovery.js";
import { normalizeErpVoidLifecycleSequence } from "./syncLifecycleGroup.js";

export { SYNC_EVENT_MAX_BATCH };

export class SyncContractError extends Error {
  constructor(message, { code = "INVALID_ENVELOPE", status = 400, retryable = false, eventIds = [] } = {}) {
    super(message);
    this.name = "SyncContractError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.eventIds = eventIds.map(String);
  }
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function entityKey(projection) {
  return `${projection.event.workspaceId}\u001f${projection.entityType}\u001f${projection.entityId}`;
}

function applyEvent(entities, event) {
  const projection = projectSyncEvent(event);
  if (projection.kind === "audit_only") return;
  const key = entityKey(projection);
  if (projection.operation === "delete") {
    entities.delete(key);
    return;
  }
  entities.set(key, {
    ...projection.snapshot,
    _entityType: projection.entityType,
    _complete: projection.complete,
    _eventId: event.eventId,
  });
}

export function createSyncEventStore({
  authorize = () => true,
  maxBatch = SYNC_EVENT_MAX_BATCH,
  resolveWorkspace = (workspaceId) => ({ id: workspaceId, name: "恢复工作区", defaultCurrency: "CNY", timezone: "Asia/Shanghai" }),
  resolveBaseline = () => null,
} = {}) {
  const events = new Map();
  const entities = new Map();
  let version = 0;

  return {
    accept(payload, context = {}) {
      let inspection;
      try {
        inspection = validateSyncEnvelope(payload);
      } catch (error) {
        throw new SyncContractError(error.message);
      }
      if (inspection.eventCount === 0) throw new SyncContractError("同步包不能为空。");
      if (inspection.eventCount > maxBatch) throw new SyncContractError(`单批同步事件不能超过 ${maxBatch} 条。`);
      const normalizedEvents = payload.events.map((event) => ({ ...event, workspaceId: inspection.workspaceId }));
      if (!authorize({ workspaceId: inspection.workspaceId, actor: context.actor, token: context.token, operation: "audit_events", events: normalizedEvents })) {
        throw new SyncContractError("当前用户无权访问该工作区。", { code: "WORKSPACE_FORBIDDEN", status: 403 });
      }
      const conflicts = [];
      const staged = [];
      for (const event of normalizedEvents) {
        const key = `${inspection.workspaceId}\u001f${event.eventId}`;
        const serialized = stableSerialize(event);
        const existing = events.get(key);
        if (existing && existing.serialized !== serialized) conflicts.push(event.eventId);
        if (!existing) staged.push({ key, event, serialized });
      }
      if (conflicts.length > 0) {
        throw new SyncContractError("同一事件 ID 的内容与已存在版本不一致。", {
          code: "EVENT_CONFLICT",
          status: 409,
          eventIds: conflicts,
        });
      }

      normalizeErpVoidLifecycleSequence(staged.map(({ event }) => event), { allowLegacy: true });

      for (const item of staged) {
        events.set(item.key, item);
        applyEvent(entities, item.event);
      }
      version += staged.length > 0 ? 1 : 0;
      const syncVersion = `dev-${version}`;
      return {
        format: SYNC_ACK_FORMAT,
        formatVersion: SYNC_ACK_VERSION,
        workspaceId: inspection.workspaceId,
        eventIds: normalizedEvents.map((event) => String(event.eventId)),
        cursor: inspection.cursor ?? String(version),
        syncVersion,
      };
    },
    snapshot() {
      return {
        eventCount: events.size,
        entityCount: entities.size,
        events: [...events.values()].map(({ event }) => event),
        entities: [...entities.entries()].map(([key, value]) => ({ key, value })),
      };
    },
    recovery(workspaceId, context = {}) {
      const normalizedWorkspaceId = String(workspaceId ?? "").trim();
      if (!normalizedWorkspaceId) throw new SyncContractError("恢复工作区不能为空。");
      if (!authorize({ workspaceId: normalizedWorkspaceId, actor: context.actor, token: context.token, operation: "recovery", events: [] })) {
        throw new SyncContractError("当前用户无权恢复该工作区。", { code: "WORKSPACE_FORBIDDEN", status: 403 });
      }
      const workspaceEvents = [...events.values()]
        .map(({ event }) => event)
        .filter((event) => event.workspaceId === normalizedWorkspaceId);
      return buildSyncRecoveryPayload({
        workspaceId: normalizedWorkspaceId,
        workspace: resolveWorkspace(normalizedWorkspaceId),
        baseline: resolveBaseline(normalizedWorkspaceId),
        events: workspaceEvents,
        cursor: `dev-${version}`,
      });
    },
  };
}
