// Ephemeral navigation state only. No business rows, credentials or disk writes.
const snapshots = new Map();
const key = (workspaceId, view) => JSON.stringify([workspaceId, view]);
export function readProductLibraryViewState(workspaceId, view) {
  return snapshots.get(key(workspaceId, view));
}
export function saveProductLibraryViewState(workspaceId, view, snapshot) {
  if (!workspaceId) return;
  const id = key(workspaceId, view);
  snapshots.delete(id);
  snapshots.set(id, snapshot);
  while (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value);
}

export function productLibraryReturnPath(value, fallback = "/products?view=official") {
  return ["/products", "/products?view=official", "/products?view=reference", "/products?view=pending"].includes(value) ? value : fallback;
}
