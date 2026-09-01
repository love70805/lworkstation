export const COST_DRAFT_TTL = 2 * 60 * 60 * 1000;
export const COST_DRAFT_STORAGE_PREFIX = "shopeers:erp-cost-draft:v12:";
const LEGACY_COST_DRAFT_PREFIX = "shopeers:erp-cost-draft:";

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function costDraftKey(ledgerId) {
  return `${COST_DRAFT_STORAGE_PREFIX}${ledgerId}`;
}

export function invalidateLegacyCostDrafts(storage = browserStorage()) {
  if (!storage) return 0;
  const staleKeys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_COST_DRAFT_PREFIX) && !key.startsWith(COST_DRAFT_STORAGE_PREFIX)) staleKeys.push(key);
  }
  staleKeys.forEach((key) => storage.removeItem(key));
  return staleKeys.length;
}

export function readCostDraft(ledgerId, { storage = browserStorage(), now = Date.now() } = {}) {
  if (!ledgerId || !storage) return null;
  try {
    const draft = JSON.parse(storage.getItem(costDraftKey(ledgerId)) ?? "null");
    if (!draft || now - Number(draft.updatedAt) > COST_DRAFT_TTL) {
      storage.removeItem(costDraftKey(ledgerId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export async function readRestorableCostDraft(ledgerId, {
  storage = browserStorage(),
  now = Date.now(),
  getInbox,
} = {}) {
  const draft = readCostDraft(ledgerId, { storage, now });
  if (!draft?.sourceText) return null;
  if (!draft.loadedInboxId) return draft;
  const linkedInbox = await getInbox(draft.loadedInboxId);
  if (linkedInbox?.status === "loaded") return draft;
  clearCostDraft(ledgerId, storage);
  return null;
}

export function writeCostDraft(ledgerId, draft, { storage = browserStorage(), now = Date.now() } = {}) {
  if (!ledgerId || !storage) return;
  try {
    storage.setItem(costDraftKey(ledgerId), JSON.stringify({ ...draft, updatedAt: now }));
  } catch {
    // Draft persistence is a convenience and must not block cost review.
  }
}

export function clearCostDraft(ledgerId, storage = browserStorage()) {
  if (!ledgerId || !storage) return;
  try { storage.removeItem(costDraftKey(ledgerId)); } catch { /* ignore storage errors */ }
}
