const ACTION_RULES = Object.freeze({
  capture_created: { entityType: "capture", operation: "upsert" },
  capture_draft_saved: { entityType: "capture", operation: "upsert" },
  capture_confirmed: { entityType: "capture", operation: "upsert" },
  capture_ignored: { entityType: "capture", operation: "upsert" },
  capture_product_relinked: { entityType: "capture", operation: "upsert" },
  product_created: { entityType: "product", operation: "upsert" },
  product_updated: { entityType: "product", operation: "upsert" },
  product_merged: { entityType: "product", operation: "upsert" },
  product_deleted: { entityType: "product", operation: "delete" },
  selection_status_definitions_updated: { entityType: "workspace", operation: "upsert" },
  catalog_manual_cost_confirmed: { entityType: "catalog_manual_cost", operation: "upsert" },
  catalog_manual_cost_relinked: { entityType: "catalog_manual_cost", operation: "upsert" },
  created: { entityType: "monthly_ledger", operation: "upsert" },
  imported: { entityType: "sales_import_batch", operation: "upsert" },
  warehouse_rate_updated: { entityType: "monthly_ledger", operation: "upsert" },
  deleted: { entityType: "monthly_ledger", operation: "delete" },
  published: { entityType: "erp_cost_batch", operation: "upsert" },
  voided: { entityType: "erp_cost_batch", operation: "upsert" },
  skcs_copied: { entityType: "erp_cost_request", operation: "upsert" },
  approved_1688_fallback: { entityType: "cost_approval", operation: "upsert" },
  revoked: { entityType: "cost_approval", operation: "upsert" },
  finalized: { entityType: "monthly_ledger", operation: "upsert" },
  reopened_for_cost_recalculation: { entityType: "monthly_ledger", operation: "upsert" },
});

export function projectSyncEvent(event) {
  const rule = ACTION_RULES[event?.action];
  if (!rule) return { kind: "audit_only", event };
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
