function normalizedSearch(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function formatSearchPeriod(period) {
  const [year, month] = String(period ?? "").split("-");
  return year && month ? `${year}年${Number(month)}月` : "";
}

export function filterMonthlyLedgers(items = [], query = "", stateLabels = {}) {
  const normalizedQuery = normalizedSearch(query);
  if (!normalizedQuery) return items;
  return items.filter((item) => [
    item.period,
    formatSearchPeriod(item.period),
    item.status,
    stateLabels[item.status],
  ].map(normalizedSearch).join(" ").includes(normalizedQuery));
}
