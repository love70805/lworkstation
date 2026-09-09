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
