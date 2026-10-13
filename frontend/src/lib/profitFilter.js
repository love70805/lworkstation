const STORAGE_PREFIX = "shopeers:profit-filter:";
const LAST_STORAGE_KEY = `${STORAGE_PREFIX}last`;
const SCOPE_PREFIX = `${STORAGE_PREFIX}scope:`;
const scopeCache = new Map();
function readSupplierScope(id, ledgerId, workspaceId) {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${SCOPE_PREFIX}${id}`) ?? 'null');
    if (!value || value.ledgerId !== ledgerId || workspaceId && value.workspaceId !== workspaceId || !Array.isArray(value.suppliers)) throw Error('missing scope');
    return { supplierSelection: cleanSupplierSelection(value.suppliers) };
  } catch { return { supplierSelection: [], supplierScopeError: '货号范围引用已失效或不属于当前账本，请重新选择货号。' }; }
}
function saveSupplierScope(suppliers, ledgerId, workspaceId) {
  const serialized = JSON.stringify({ suppliers, ledgerId, workspaceId: workspaceId ?? '' });
  const cached = scopeCache.get(serialized);
  if (cached && sessionStorage.getItem(`${SCOPE_PREFIX}${cached}`)) return cached;
  const id = crypto.randomUUID();
  sessionStorage.setItem(`${SCOPE_PREFIX}${id}`, serialized);
  scopeCache.set(serialized, id);
  while (scopeCache.size > 64) {
    const [key, oldest] = scopeCache.entries().next().value;
    sessionStorage.removeItem(`${SCOPE_PREFIX}${oldest}`); scopeCache.delete(key);
  }
  return id;
}

export const DEFAULT_PROFIT_FILTER = {
  query: "",
  storeFilter: "all",
  supplierSelection: null,
  missingOnly: false,
};

function cleanSupplierSelection(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].toSorted();
}

export function readProfitFilter(searchParams, ledgerId = "", { workspaceId } = {}) {
  const hasUrlFilter = ["q", "store", "supplier", "supplier_scope", "missing"].some((key) => searchParams?.has(key));
  if (hasUrlFilter) {
    return {
      query: searchParams?.get("q") ?? "",
      storeFilter: searchParams?.get("store") || "all",
      supplierSelection: searchParams?.has("supplier") ? cleanSupplierSelection(searchParams.getAll("supplier")) : null,
      missingOnly: searchParams?.get("missing") === "1",
      ...(searchParams?.has('supplier_scope') ? readSupplierScope(searchParams.get('supplier_scope'), ledgerId || searchParams.get('ledger') || '', workspaceId) : {}),
    };
  }

  if (typeof localStorage === "undefined") return { ...DEFAULT_PROFIT_FILTER };
  try {
    const saved = JSON.parse(localStorage.getItem(ledgerId ? `${STORAGE_PREFIX}${ledgerId}` : LAST_STORAGE_KEY) ?? "null");
    return {
      ...DEFAULT_PROFIT_FILTER,
      ...saved,
      query: String(saved?.query ?? ""),
      storeFilter: String(saved?.storeFilter ?? "all"),
      supplierSelection: cleanSupplierSelection(saved?.supplierSelection),
      missingOnly: Boolean(saved?.missingOnly),
    };
  } catch {
    return { ...DEFAULT_PROFIT_FILTER };
  }
}

export function saveProfitFilter(ledgerId, filter) {
  if (typeof localStorage === "undefined") return;
  const serialized = JSON.stringify({
    query: String(filter.query ?? ""),
    storeFilter: String(filter.storeFilter ?? "all"),
    supplierSelection: cleanSupplierSelection(filter.supplierSelection),
    missingOnly: Boolean(filter.missingOnly),
  });
  localStorage.setItem(LAST_STORAGE_KEY, serialized);
  if (ledgerId) localStorage.setItem(`${STORAGE_PREFIX}${ledgerId}`, serialized);
}

export function filterProfitRowsByScope(rows = [], filter = DEFAULT_PROFIT_FILTER) {
  const storeFilter = filter.storeFilter ?? "all";
  const supplierSet = filter.supplierSelection == null ? null : new Set(filter.supplierSelection);
  return rows.filter((row) => {
    return (storeFilter === "all" || row.store === storeFilter)
      && (!supplierSet || supplierSet.has(row.supplierNumber))
      && (!filter.missingOnly || !row.finalizable);
  });
}

// Calculated rows are immutable snapshots. Weak keys release the index when a
// ledger refresh replaces its rows, without retaining old months in memory.
const profitSearchText = new WeakMap();

export function searchProfitRows(rows = [], value = "") {
  const query = String(value ?? "").trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => {
    let text = profitSearchText.get(row);
    if (text === undefined) {
      text = [row.groupSkc ?? row.platformSkc, row.platformSku, row.attribute, row.supplierNumber, row.store]
        .map((field) => String(field ?? "").toLowerCase()).join(" ");
      profitSearchText.set(row, text);
    }
    return text.includes(query);
  });
}

export function filterProfitRows(rows = [], filter = DEFAULT_PROFIT_FILTER) {
  return searchProfitRows(filterProfitRowsByScope(rows, filter), filter.query);
}

export function readProfitView(searchParams) {
  const view = searchParams.get("view") ?? "detail";
  return ["detail", "cost"].includes(view) ? view : null;
}

export function buildProfitQuery({ ledgerId, workspaceId, query = "", storeFilter = "all", supplierSelection = null, missingOnly = false, view } = {}) {
  const params = new URLSearchParams();
  if (["detail", "cost"].includes(view)) params.set("view", view);
  if (ledgerId) params.set("ledger", ledgerId);
  if (query) params.set("q", query);
  if (storeFilter && storeFilter !== "all") params.set("store", storeFilter);
  if (Array.isArray(supplierSelection)) {
    if (supplierSelection.length === 0) params.append("supplier", "");
    else if (supplierSelection.length > 80 || JSON.stringify(supplierSelection).length > 1500) {
      try { if (!ledgerId) throw Error('ledger required'); params.set('supplier_scope', saveSupplierScope(cleanSupplierSelection(supplierSelection), ledgerId, workspaceId)); }
      catch { params.set('supplier_scope', 'unavailable'); }
    } else supplierSelection.forEach((supplier) => params.append("supplier", supplier));
  }
  if (missingOnly) params.set("missing", "1");
  return params;
}

export function buildProfitHref(filter = {}) {
  const query = buildProfitQuery(filter).toString();
  return `/profit${query ? `?${query}` : ""}`;
}

export function buildCostMatchingHref(filter = {}) {
  const query = buildProfitQuery(filter).toString();
  return `/cost-matching${query ? `?${query}` : ""}`;
}
