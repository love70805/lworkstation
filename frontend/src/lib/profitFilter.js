const STORAGE_PREFIX = "shopeers:profit-filter:";
const LAST_STORAGE_KEY = `${STORAGE_PREFIX}last`;

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

export function readProfitFilter(searchParams, ledgerId = "") {
  const hasUrlFilter = ["q", "store", "supplier", "missing"].some((key) => searchParams?.has(key));
  if (hasUrlFilter) {
    return {
      query: searchParams?.get("q") ?? "",
      storeFilter: searchParams?.get("store") || "all",
      supplierSelection: searchParams?.has("supplier") ? cleanSupplierSelection(searchParams.getAll("supplier")) : null,
      missingOnly: searchParams?.get("missing") === "1",
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

export function filterProfitRows(rows = [], filter = DEFAULT_PROFIT_FILTER) {
  const query = String(filter.query ?? "").toLowerCase();
  const supplierSet = filter.supplierSelection === null ? null : new Set(filter.supplierSelection ?? []);
  return rows.filter((row) => {
    const searchText = `${row.groupSkc} ${row.platformSku} ${row.attribute} ${row.supplierNumber} ${row.store}`.toLowerCase();
    return searchText.includes(query)
      && (filter.storeFilter === "all" || row.store === filter.storeFilter)
      && (!supplierSet || supplierSet.has(row.supplierNumber))
      && (!filter.missingOnly || !row.finalizable);
  });
}

export function buildProfitQuery({ ledgerId, query = "", storeFilter = "all", supplierSelection = null, missingOnly = false } = {}) {
  const params = new URLSearchParams();
  if (ledgerId) params.set("ledger", ledgerId);
  if (query) params.set("q", query);
  if (storeFilter && storeFilter !== "all") params.set("store", storeFilter);
  if (Array.isArray(supplierSelection)) {
    if (supplierSelection.length === 0) params.append("supplier", "");
    else supplierSelection.forEach((supplier) => params.append("supplier", supplier));
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
