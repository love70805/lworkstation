export function validatedLedgerSearch(search, ledger, workspaceId) {
  const params = new URLSearchParams(search);
  const id = params.get("ledger");
  if (!workspaceId || !id || ledger?.id !== id || ledger.workspaceId !== workspaceId) return "";
  const result = new URLSearchParams();
  for (const key of ["ledger", "q", "store", "supplier", "missing"]) {
    for (const value of params.getAll(key)) result.append(key, value);
  }
  return `?${result.toString()}`;
}

export function workspaceLedgerQuery(ledgerId, search = "", rows = [], preserveFilters = false) {
  const previous = new URLSearchParams(preserveFilters ? search : "");
  const result = new URLSearchParams({ ledger: ledgerId, store: "all", missing: "0" });
  const store = previous.get("store");
  if (store && rows.some(row => row.store === store)) result.set("store", store);
  if (previous.get("q")) result.set("q", previous.get("q"));
  if (previous.get("missing") === "1") result.set("missing", "1");
  const validSuppliers = new Set(rows.map(row => row.supplierNumber).filter(Boolean));
  for (const supplier of previous.getAll("supplier")) if (validSuppliers.has(supplier)) result.append("supplier", supplier);
  if (previous.has("supplier") && previous.getAll("supplier").every(value => !value.trim())) result.append("supplier", "");
  return result;
}
