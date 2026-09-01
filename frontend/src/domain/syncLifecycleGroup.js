const VOID_ACTION = "voided";
const REOPEN_ACTION = "reopened_for_cost_recalculation";

function text(value) {
  return String(value ?? "").trim();
}

function afterOf(event) {
  return event?.after && typeof event.after === "object" ? event.after : {};
}

function snapshotOf(event) {
  const after = afterOf(event);
  return after.snapshot && typeof after.snapshot === "object" ? after.snapshot : {};
}

function hasIdentityMarker(event) {
  const after = afterOf(event);
  return after.transitionId != null || after.voidedBatchId != null;
}

function uniqueIssues(issues) {
  return [...new Set(issues.filter(Boolean))];
}

export class ErpVoidLifecycleContractError extends Error {
  constructor(message, { issues = [], eventIds = [] } = {}) {
    super(message);
    this.name = "ErpVoidLifecycleContractError";
    this.code = "INVALID_ERP_VOID_REOPEN_PAIR";
    this.status = 409;
    this.retryable = false;
    this.issues = uniqueIssues(issues);
    this.eventIds = eventIds.map(text).filter(Boolean);
  }
}

export function buildErpVoidTransitionId({ batchId, ledgerId, voidedAt } = {}) {
  const parts = [batchId, ledgerId, voidedAt].map(text);
  if (parts.some((value) => !value)) throw new Error("ERP 作废 transitionId 缺少批次、账本或时间。");
  return `ERP-VOID:${parts.join(":")}`;
}

export function erpVoidLifecycleDescriptor(event, { legacyBatchId = "" } = {}) {
  if (![VOID_ACTION, REOPEN_ACTION].includes(event?.action)) return null;
  const after = afterOf(event);
  const snapshot = snapshotOf(event);
  const role = event.action === VOID_ACTION ? "void" : "reopen";
  return {
    role,
    eventId: text(event.eventId ?? event.id),
    transitionId: text(after.transitionId),
    ledgerId: role === "void" ? text(snapshot.ledger?.id) : text(event.objectId),
    batchId: role === "void"
      ? text(snapshot.costBatch?.id ?? event.objectId)
      : text(after.voidedBatchId ?? legacyBatchId),
    actorId: text(event.actorId),
    reason: text(after.reason),
    createdAt: text(event.createdAt),
  };
}

function inspectVoidMetadata(event, descriptor) {
  if (descriptor?.role !== "void") return [];
  const snapshot = snapshotOf(event);
  const batch = snapshot.costBatch ?? {};
  const inbox = snapshot.inbox ?? {};
  const batchMetadata = [batch.voidedAt, batch.voidedBy, batch.voidReason].map(text);
  const inboxMetadata = [inbox.voidedAt, inbox.voidedBy, inbox.voidReason].map(text);
  const issues = [];
  if (batchMetadata.some((value) => !value)) issues.push("batchMetadata");
  if (inboxMetadata.some((value) => !value)) issues.push("inboxMetadata");
  if (batchMetadata.some((value, index) => value !== inboxMetadata[index])) issues.push("metadataMismatch");
  if (batchMetadata[0] && batchMetadata[0] !== descriptor.createdAt) issues.push("createdAt");
  if (batchMetadata[1] && batchMetadata[1] !== descriptor.actorId) issues.push("actorId");
  if (batchMetadata[2] && batchMetadata[2] !== descriptor.reason) issues.push("reason");
  return issues;
}

export function inspectErpVoidLifecycleDescriptor(event, { allowLegacy = false, legacyBatchId = "" } = {}) {
  const descriptor = erpVoidLifecycleDescriptor(event, { legacyBatchId });
  if (!descriptor) return { valid: true, descriptor: null, issues: [], mode: null };
  const strict = hasIdentityMarker(event);
  const mode = strict ? "strict" : "legacy";
  const issues = [];
  for (const field of ["eventId", "ledgerId", "batchId", "actorId", "reason", "createdAt"]) {
    if (!descriptor[field]) issues.push(field);
  }
  if (strict) {
    const after = afterOf(event);
    if (!descriptor.transitionId) issues.push("transitionId");
    if (!text(after.voidedBatchId)) issues.push("voidedBatchId");
    if (descriptor.batchId && text(after.voidedBatchId) && descriptor.batchId !== text(after.voidedBatchId)) issues.push("batchId");
    if (descriptor.transitionId && descriptor.batchId && descriptor.ledgerId && descriptor.createdAt) {
      const expected = buildErpVoidTransitionId({
        batchId: descriptor.batchId,
        ledgerId: descriptor.ledgerId,
        voidedAt: descriptor.createdAt,
      });
      if (descriptor.transitionId !== expected) issues.push("transitionId");
    }
  } else if (!allowLegacy) {
    issues.push("transitionId", "voidedBatchId");
  }
  issues.push(...inspectVoidMetadata(event, descriptor));
  return { valid: uniqueIssues(issues).length === 0, descriptor, issues: uniqueIssues(issues), mode };
}

function withLifecycleIdentity(event, descriptor) {
  return {
    ...event,
    after: {
      ...afterOf(event),
      transitionId: buildErpVoidTransitionId({
        batchId: descriptor.batchId,
        ledgerId: descriptor.ledgerId,
        voidedAt: descriptor.createdAt,
      }),
      voidedBatchId: descriptor.batchId,
    },
  };
}

export function inspectErpVoidReopenPair(voidEvent, reopenEvent, { allowLegacy = false } = {}) {
  const legacy = !hasIdentityMarker(voidEvent) && !hasIdentityMarker(reopenEvent);
  const left = inspectErpVoidLifecycleDescriptor(voidEvent, { allowLegacy: allowLegacy && legacy });
  const right = inspectErpVoidLifecycleDescriptor(reopenEvent, {
    allowLegacy: allowLegacy && legacy,
    legacyBatchId: legacy ? left.descriptor?.batchId : "",
  });
  const issues = [];
  if (!left.valid) issues.push(...left.issues.map((field) => `void.${field}`));
  if (!right.valid) issues.push(...right.issues.map((field) => `reopen.${field}`));
  if (left.descriptor?.role !== "void") issues.push("void.role");
  if (right.descriptor?.role !== "reopen") issues.push("reopen.role");
  for (const field of ["ledgerId", "batchId", "actorId", "reason", "createdAt"]) {
    if (left.descriptor?.[field] !== right.descriptor?.[field]) issues.push(field);
  }
  if (!legacy && left.descriptor?.transitionId !== right.descriptor?.transitionId) issues.push("transitionId");
  const normalizedIssues = uniqueIssues(issues);
  return {
    valid: normalizedIssues.length === 0,
    mode: legacy ? "legacy" : "strict",
    void: left.descriptor,
    reopen: right.descriptor,
    issues: normalizedIssues,
    normalizedEvents: normalizedIssues.length === 0 && legacy
      ? [withLifecycleIdentity(voidEvent, left.descriptor), withLifecycleIdentity(reopenEvent, right.descriptor)]
      : [voidEvent, reopenEvent],
  };
}

export function inspectErpVoidLifecycleSequence(events, { allowLegacy = false } = {}) {
  const normalizedEvents = [...events];
  const groups = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.action === VOID_ACTION) {
      if (events[index + 1]?.action === REOPEN_ACTION) {
        const pair = inspectErpVoidReopenPair(event, events[index + 1], { allowLegacy });
        if (!pair.valid) {
          return {
            valid: false,
            issues: pair.issues,
            eventIds: [event.eventId, events[index + 1].eventId].map(text).filter(Boolean),
            normalizedEvents,
            groups,
          };
        }
        normalizedEvents[index] = pair.normalizedEvents[0];
        normalizedEvents[index + 1] = pair.normalizedEvents[1];
        groups.push({ start: index, size: 2, mode: pair.mode, pair });
        index += 1;
        continue;
      }
      const single = inspectErpVoidLifecycleDescriptor(event, { allowLegacy });
      if (!single.valid) {
        return {
          valid: false,
          issues: single.issues.map((field) => `void.${field}`),
          eventIds: [event.eventId].map(text).filter(Boolean),
          normalizedEvents,
          groups,
        };
      }
      if (single.mode === "legacy") normalizedEvents[index] = withLifecycleIdentity(event, single.descriptor);
      groups.push({ start: index, size: 1, mode: single.mode, descriptor: single.descriptor });
      continue;
    }
    if (event?.action === REOPEN_ACTION) {
      return {
        valid: false,
        issues: ["reopen.unpaired"],
        eventIds: [event.eventId].map(text).filter(Boolean),
        normalizedEvents,
        groups,
      };
    }
  }
  return { valid: true, issues: [], eventIds: [], normalizedEvents, groups };
}

export function normalizeErpVoidLifecycleSequence(events, { allowLegacy = false } = {}) {
  const inspection = inspectErpVoidLifecycleSequence(events, { allowLegacy });
  if (!inspection.valid) {
    throw new ErpVoidLifecycleContractError(`ERP 作废与重开事件不一致：${inspection.issues.join(", ")}`, inspection);
  }
  return inspection;
}

export function selectAtomicSyncEventSelection(events, softLimit, hardLimit = 500) {
  const maximum = Math.max(2, Number(hardLimit) || 500);
  const target = Math.max(1, Math.min(maximum, Number(softLimit) || 1));
  const selected = [];
  for (let index = 0; index < events.length && selected.length < target; index += 1) {
    const event = events[index];
    let group = [event];
    if (event?.action === VOID_ACTION && events[index + 1]?.action === REOPEN_ACTION) {
      const pair = inspectErpVoidReopenPair(event, events[index + 1], { allowLegacy: true });
      if (!pair.valid) {
        throw new ErpVoidLifecycleContractError(`ERP 作废与重开事件不一致：${pair.issues.join(", ")}`, {
          issues: pair.issues,
          eventIds: [event.eventId, events[index + 1].eventId],
        });
      }
      group = [event, events[index + 1]];
    } else if (event?.action === REOPEN_ACTION) {
      throw new ErpVoidLifecycleContractError("ERP 重开事件缺少相邻的作废事件。", {
        issues: ["reopen.unpaired"], eventIds: [event.eventId],
      });
    }
    if (selected.length + group.length > maximum) break;
    selected.push(...group);
    if (group.length === 2) index += 1;
  }
  return selected;
}

export function expandAtomicSyncEventSelection(events, limit) {
  return selectAtomicSyncEventSelection(events, limit, 500);
}

export const ERP_VOID_ACTION = VOID_ACTION;
export const ERP_REOPEN_ACTION = REOPEN_ACTION;
