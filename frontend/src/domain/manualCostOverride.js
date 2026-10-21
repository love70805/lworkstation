import { canonicalPlatformSku } from "./identifiers";

export const manualSnapshot = (approval) => approval?.referenceSnapshot ?? approval?.referenceCost;
export const storeIdentity = (store) => String(store ?? "").normalize("NFKC").trim();
export const storeSkuKey = (store, sku) => JSON.stringify([storeIdentity(store), canonicalPlatformSku(sku)]);

export function validManualOverride(approval, { workspaceId, ledgerId, store, platformSku }) {
  const snapshot = manualSnapshot(approval);
  const raw = approval?.approvedAmount;
  return snapshot?.kind === "manual_override" && approval.status === "approved"
    && raw !== null && raw !== undefined && String(raw).trim() !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0
    && approval.currency === "CNY" && Boolean(approval.id && approval.approvedBy && String(approval.reason ?? "").trim())
    && Number.isFinite(Date.parse(approval.approvedAt))
    && Boolean(workspaceId && ledgerId && storeIdentity(store))
    && approval.workspaceId === workspaceId && approval.ledgerId === ledgerId
    && storeIdentity(snapshot.store) === storeIdentity(store)
    && canonicalPlatformSku(approval.platformSku) === canonicalPlatformSku(platformSku);
}

export function selectManualOverride(approvals, scope) {
  return (approvals ?? []).filter((approval) => validManualOverride(approval, scope))
    .toSorted((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)))[0] ?? null;
}

// Build once per input snapshot; keep the same validity and stable tie rules as
// selectManualOverride, without scanning every approval for every sales SKU.
export function createManualOverrideLookup(approvals = []) {
  const index = new Map();
  const key = scope => JSON.stringify([scope.workspaceId, scope.ledgerId, storeIdentity(scope.store), canonicalPlatformSku(scope.platformSku)]);
  for (const approval of approvals ?? []) {
    if (!String(approval?.platformSku ?? '').normalize('NFKC').trim()) continue;
    const scope = { workspaceId: approval?.workspaceId, ledgerId: approval?.ledgerId,
      store: manualSnapshot(approval)?.store, platformSku: approval?.platformSku };
    if (!validManualOverride(approval, scope)) continue;
    const id = key(scope), current = index.get(id);
    if (!current || String(approval.approvedAt).localeCompare(String(current.approvedAt)) > 0) index.set(id, approval);
  }
  return scope => !scope?.workspaceId || !scope.ledgerId || !storeIdentity(scope.store) ? null : index.get(key(scope)) ?? null;
}
