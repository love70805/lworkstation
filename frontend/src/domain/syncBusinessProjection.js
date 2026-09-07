import { syncActionRule } from "./syncActionRegistry.js";

export function projectSyncEvent(event) {
  const rule = syncActionRule(event?.action);
  if (!rule?.entityType) return { kind: "audit_only", event };
  const after = event.after && typeof event.after === "object" ? event.after : {};
  const snapshot = after.snapshot && typeof after.snapshot === "object" ? after.snapshot : after;
  return {
    kind: "business",
    entityType: rule.entityType,
    operation: rule.operation,
    entityId: String(event.objectId),
    snapshot,
    complete: rule.operation === "delete" || Boolean(after.snapshot),
    event,
  };
}

export function listBusinessProjectionGaps(events = []) {
  return events
    .map(projectSyncEvent)
    .filter((projection) => projection.kind === "business" && !projection.complete)
    .map((projection) => ({
      eventId: projection.event.eventId ?? projection.event.id,
      action: projection.event.action,
      entityType: projection.entityType,
      entityId: projection.entityId,
    }));
}
