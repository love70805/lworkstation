const STORAGE_PREFIX = "shopeers:profit-filter:";
const LAST_STORAGE_KEY = `${STORAGE_PREFIX}last`;
const SCOPE_PREFIX = `${STORAGE_PREFIX}scope:`;
const scopeCache = new Map();
function readSupplierScope(id, ledgerId, workspaceId) {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${SCOPE_PREFIX}${id}`) ?? 'null');
    if (!value || value.ledgerId !== ledgerId || workspaceId && value.workspaceId !== workspaceId) throw Error('missing scope');
    const supplierStoreSelection = cleanSupplierStoreSelection(value.supplierStoreSelection);
    if (!Array.isArray(value.suppliers) && !(value.suppliers === null && supplierStoreSelection !== null)) throw Error('missing scope');
    return { supplierSelection: cleanSupplierSelection(value.suppliers), ...(supplierStoreSelection === null ? {} : { supplierStoreSelection }) };
  } catch { return { supplierSelection: [], supplierScopeError: '货号范围引用已失效或不属于当前账本，请重新选择货号。' }; }
}
function saveSupplierScope(suppliers, ledgerId, workspaceId, supplierStoreSelection = null) {
  const serialized = JSON.stringify({ suppliers, ledgerId, workspaceId: workspaceId ?? '', ...(supplierStoreSelection === null ? {} : { supplierStoreSelection }) });
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

// References belong to one workspace and ledger. Same-ledger navigation keeps
// the verified reference; a month change intersects it with the new ledger and
// writes a new binding. Missing evidence must never turn a selection into all.
export function transferProfitSupplierScope(source, target, { workspaceId, rows } = {}) {
  if (!source.has('supplier_scope')) return;
  target.delete('supplier');
  target.set('supplier_scope', 'unavailable');
  const sourceLedgerId = source.get('ledger'), ledgerId = target.get('ledger');
  if (!workspaceId || !sourceLedgerId || !ledgerId) return;
  const scope = readSupplierScope(source.get('supplier_scope'), sourceLedgerId, workspaceId);
  if (scope.supplierScopeError) return;
  if (sourceLedgerId === ledgerId) {
    target.set('supplier_scope', source.get('supplier_scope'));
    return;
  }
  if (!Array.isArray(rows)) return;
  const suppliers = new Set(rows.map(row => row.supplierNumber).filter(Boolean));
  const pairs = new Set(rows.map(row => JSON.stringify([row.store, row.supplierNumber])));
  const supplierSelection = scope.supplierSelection?.filter(value => suppliers.has(value)) ?? null;
  const supplierStoreSelection = scope.supplierStoreSelection?.filter(entry => pairs.has(JSON.stringify([entry.store, entry.supplierNumber]))) ?? null;
  const rebound = buildProfitQuery({ ledgerId, workspaceId, supplierSelection, supplierStoreSelection });
  target.delete('supplier_scope');
  for (const key of ['supplier', 'supplier_scope']) for (const value of rebound.getAll(key)) target.append(key, value);
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
function cleanSupplierStoreSelection(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw Error('invalid store supplier scope');
  const entries = new Map();
  for (const item of value) {
    if (!item || typeof item.store !== 'string' || !item.store.trim() || typeof item.supplierNumber !== 'string' || !item.supplierNumber.trim()) throw Error('invalid store supplier scope');
    const entry = { store: item.store.trim(), supplierNumber: item.supplierNumber.trim() };
    entries.set(JSON.stringify([entry.store, entry.supplierNumber]), entry);
  }
  return [...entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, entry]) => entry);
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
    const supplierStoreSelection = cleanSupplierStoreSelection(saved?.supplierStoreSelection);
    return {
      ...DEFAULT_PROFIT_FILTER,
      ...saved,
      query: String(saved?.query ?? ""),
      storeFilter: String(saved?.storeFilter ?? "all"),
      supplierSelection: cleanSupplierSelection(saved?.supplierSelection),
      ...(supplierStoreSelection === null ? {} : { supplierStoreSelection }),
      missingOnly: Boolean(saved?.missingOnly),
    };
  } catch {
    return { ...DEFAULT_PROFIT_FILTER, supplierSelection: [], supplierScopeError: '保存的货号范围无法读取，请重新选择货号。' };
  }
}

export function saveProfitFilter(ledgerId, filter) {
  if (typeof localStorage === "undefined") return;
  const supplierStoreSelection = cleanSupplierStoreSelection(filter.supplierStoreSelection);
  const serialized = JSON.stringify({
    query: String(filter.query ?? ""),
    storeFilter: String(filter.storeFilter ?? "all"),
    supplierSelection: cleanSupplierSelection(filter.supplierSelection),
    ...(supplierStoreSelection === null ? {} : { supplierStoreSelection }),
    missingOnly: Boolean(filter.missingOnly),
  });
  localStorage.setItem(LAST_STORAGE_KEY, serialized);
  if (ledgerId) localStorage.setItem(`${STORAGE_PREFIX}${ledgerId}`, serialized);
}

export function filterProfitRowsByScope(rows = [], filter = DEFAULT_PROFIT_FILTER) {
  const storeFilter = filter.storeFilter ?? "all";
  const supplierSet = filter.supplierSelection == null ? null : new Set(filter.supplierSelection);
  // A group may include the same full number in one store and exclude it in
  // another. Keep both constraints as an intersection, including explicit [].
  const storeSuppliers = filter.supplierStoreSelection == null ? null : new Map();
  for (const entry of filter.supplierStoreSelection ?? []) {
    if (!storeSuppliers.has(entry.store)) storeSuppliers.set(entry.store, new Set());
    storeSuppliers.get(entry.store).add(entry.supplierNumber);
  }
  return rows.filter((row) => {
    return (storeFilter === "all" || row.store === storeFilter)
      && (!supplierSet || supplierSet.has(row.supplierNumber))
      && (!storeSuppliers || storeSuppliers.get(row.store)?.has(row.supplierNumber))
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

export function buildProfitQuery({ ledgerId, workspaceId, query = "", storeFilter = "all", supplierSelection = null, supplierStoreSelection = null, missingOnly = false, view } = {}) {
  const params = new URLSearchParams();
  if (["detail", "cost"].includes(view)) params.set("view", view);
  if (ledgerId) params.set("ledger", ledgerId);
  if (query) params.set("q", query);
  if (storeFilter && storeFilter !== "all") params.set("store", storeFilter);
  if (supplierStoreSelection != null) {
    try { if (!ledgerId) throw Error('ledger required'); params.set('supplier_scope', saveSupplierScope(cleanSupplierSelection(supplierSelection), ledgerId, workspaceId, cleanSupplierStoreSelection(supplierStoreSelection))); }
    catch { params.set('supplier_scope', 'unavailable'); }
  } else if (Array.isArray(supplierSelection)) {
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
