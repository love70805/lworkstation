import { transferProfitSupplierScope } from './profitFilter';

export function validatedLedgerSearch(search, ledger, workspaceId) {
  const params = new URLSearchParams(search);
  const id = params.get("ledger");
  if (!workspaceId || !id || ledger?.id !== id || ledger.workspaceId !== workspaceId) return "";
  const result = new URLSearchParams();
  for (const key of ["ledger", "q", "store", "supplier", "missing"]) {
    for (const value of params.getAll(key)) result.append(key, value);
  }
  if (["detail", "cost"].includes(params.get("view"))) result.set("view", params.get("view"));
  transferProfitSupplierScope(params, result, { workspaceId });
  return `?${result.toString()}`;
}

export function workspaceLedgerQuery(ledgerId, search = "", rows = [], preserveFilters = false, { workspaceId } = {}) {
  const source = new URLSearchParams(search);
  const previous = preserveFilters ? source : new URLSearchParams();
  const result = new URLSearchParams({ ledger: ledgerId, store: "all", missing: "0" });
  if (["detail", "cost"].includes(previous.get("view"))) result.set("view", previous.get("view"));
  const store = previous.get("store");
  if (store && rows.some(row => row.store === store)) result.set("store", store);
  if (previous.get("q")) result.set("q", previous.get("q"));
  if (previous.get("missing") === "1") result.set("missing", "1");
  const validSuppliers = new Set(rows.map(row => row.supplierNumber).filter(Boolean));
  for (const supplier of previous.getAll("supplier")) if (validSuppliers.has(supplier)) result.append("supplier", supplier);
  if (previous.has("supplier") && !result.has("supplier")) result.append("supplier", "");
  transferProfitSupplierScope(previous, result, { workspaceId, rows });
  // Choosing a default ledger cannot validate an incoming scope's source binding.
  if (!preserveFilters && source.has('supplier_scope')) result.set('supplier_scope', 'unavailable');
  return result;
}

export function profitWorkspaceHref(search = '', view = 'detail') {
  const params = new URLSearchParams(search);
  params.set('view', view === 'cost' ? 'cost' : 'detail');
  return `/profit?${params.toString()}`;
}
