// UI positions only, scoped to workspace/ledger/filter; no business snapshots.
const states = new Map();
export function clearProfitViewState() { states.clear(); }
export function readProfitViewState(key) { return states.get(key) ?? { page: 0, scroll: 0, expanded: [], detailsOpen: false }; }
export function saveProfitViewState(key, patch) {
  if (!key) return;
  const next = { ...readProfitViewState(key), ...patch };
  states.delete(key);
  states.set(key, next);
  while (states.size > 32) states.delete(states.keys().next().value);
}
