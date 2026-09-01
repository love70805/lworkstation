export const SYNC_ENVELOPE_FORMAT = "shopeers-sync-envelope";
export const SYNC_ENVELOPE_VERSION = 1;
export const SYNC_ACK_FORMAT = "shopeers-sync-ack";
export const SYNC_ACK_VERSION = 1;
export const SYNC_EVENT_MAX_BATCH = 500;

export const SYNC_STATES = Object.freeze({
  PENDING: "pending",
  IN_FLIGHT: "in_flight",
  SYNCED: "synced",
  FAILED: "failed",
});

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function normalizeSyncEvent(event, workspaceId) {
  if (!event || typeof event !== "object") throw new Error("同步事件格式无效。");
  const eventWorkspaceId = requiredText(event.workspaceId ?? workspaceId, "同步事件工作区");
  if (eventWorkspaceId !== workspaceId) throw new Error("同步事件不能跨工作区混用。");
  return {
    eventId: requiredText(event.eventId ?? event.id, "同步事件 ID"),
    workspaceId: eventWorkspaceId,
    objectType: requiredText(event.objectType, "同步对象类型"),
    objectId: requiredText(event.objectId, "同步对象 ID"),
    action: requiredText(event.action, "同步动作"),
    actorId: String(event.actorId ?? "local-user"),
    createdAt: requiredText(event.createdAt, "同步事件时间"),
    before: event.before ?? null,
    after: event.after ?? null,
  };
}

export function buildSyncEnvelope({ workspaceId, events = [], cursor = null, generatedAt = new Date().toISOString() } = {}) {
  const normalizedWorkspaceId = requiredText(workspaceId, "同步工作区");
  if (!Array.isArray(events)) throw new Error("同步事件必须是数组。");
  const normalizedEvents = events.map((event) => normalizeSyncEvent(event, normalizedWorkspaceId));
  const eventIds = new Set();
  for (const event of normalizedEvents) {
    if (eventIds.has(event.eventId)) throw new Error(`同步事件 ID 重复：${event.eventId}`);
    eventIds.add(event.eventId);
  }
  return {
    format: SYNC_ENVELOPE_FORMAT,
    formatVersion: SYNC_ENVELOPE_VERSION,
    workspaceId: normalizedWorkspaceId,
    generatedAt,
    cursor: cursor == null ? null : String(cursor),
    events: normalizedEvents,
  };
}

export function validateSyncEnvelope(payload) {
  if (!payload || typeof payload !== "object") throw new Error("同步包内容无效。");
  if (payload.format !== SYNC_ENVELOPE_FORMAT) throw new Error("同步包格式不受支持。");
  if (Number(payload.formatVersion) !== SYNC_ENVELOPE_VERSION) throw new Error("同步包版本不受支持。");
  const workspaceId = requiredText(payload.workspaceId, "同步工作区");
  if (!Array.isArray(payload.events)) throw new Error("同步包缺少事件列表。");
  const events = payload.events.map((event) => normalizeSyncEvent(event, workspaceId));
  const ids = new Set(events.map((event) => event.eventId));
  if (ids.size !== events.length) throw new Error("同步包包含重复事件 ID。");
  return {
    workspaceId,
    eventCount: events.length,
    cursor: payload.cursor == null ? null : String(payload.cursor),
    generatedAt: payload.generatedAt ?? null,
  };
}

export function auditEventToSyncEvent(event) {
  return normalizeSyncEvent({
    eventId: event.eventId ?? event.id,
    workspaceId: event.workspaceId,
    objectType: event.objectType,
    objectId: event.objectId,
    action: event.action,
    actorId: event.actorId,
    createdAt: event.createdAt,
    before: event.before,
    after: event.after,
  }, event.workspaceId);
}

export function validateSyncAck(payload, { workspaceId, eventIds = [] } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("同步服务回执无效。");
  if (payload.format !== SYNC_ACK_FORMAT) throw new Error("同步服务回执格式不受支持。");
  if (Number(payload.formatVersion) !== SYNC_ACK_VERSION) throw new Error("同步服务回执版本不受支持。");
  const ackWorkspaceId = requiredText(payload.workspaceId, "回执工作区");
  if (ackWorkspaceId !== requiredText(workspaceId, "同步工作区")) throw new Error("同步服务回执工作区不一致。");
  if (!Array.isArray(payload.eventIds)) throw new Error("同步服务回执缺少事件 ID。");
  const expected = new Set(eventIds.map((eventId) => String(eventId)));
  const received = [...new Set(payload.eventIds.map((eventId) => String(eventId)))];
  const missing = [...expected].filter((eventId) => !received.includes(eventId));
  if (missing.length > 0) throw new Error(`同步服务未确认全部事件：${missing.join(", ")}`);
  return {
    workspaceId: ackWorkspaceId,
    eventIds: received,
    cursor: payload.cursor == null ? null : String(payload.cursor),
    syncVersion: payload.syncVersion == null ? null : String(payload.syncVersion),
  };
}
